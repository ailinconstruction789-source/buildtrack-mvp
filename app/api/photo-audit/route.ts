import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import { parseThaiOrIsoDate, calculatePhotoAudit } from '@/lib/photoAudit';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { imageUrl, imageBase64, reportedPlotId, reportedCreatedAt } = body;

    if (!imageUrl && !imageBase64) {
      return NextResponse.json({ error: 'Missing imageUrl or imageBase64' }, { status: 400 });
    }

    // 0. Check Central Database Cache in Supabase first (0 tokens, 0 Baht!)
    if (imageUrl) {
      try {
        const { data: existing, error: dbErr } = await supabase
          .from('photo_watermark_audits')
          .select('*')
          .eq('image_url', imageUrl)
          .maybeSingle();

        if (existing && !dbErr) {
          let audit = existing.audit_data;
          if ((!audit || typeof audit !== 'object') && existing.taken_at && reportedCreatedAt) {
            audit = calculatePhotoAudit(existing.taken_at, reportedCreatedAt, existing.plot_tag, reportedPlotId);
          }
          return NextResponse.json({
            success: true,
            cached: true,
            hasWatermark: Boolean(existing.has_watermark),
            rawWatermarkText: existing.raw_watermark_text || '',
            takenAt: existing.taken_at,
            takenDateStr: existing.taken_date_str,
            takenTimeStr: existing.taken_time_str,
            location: existing.location,
            plotTag: existing.plot_tag,
            audit,
            scannedAt: existing.created_at || new Date().toISOString()
          });
        }
      } catch {
        // Table may not be created yet, proceed gracefully
      }
    }

    let buffer: Buffer;
    let mimeType = 'image/jpeg';

    if (imageBase64) {
      let cleanBase64 = imageBase64;
      if (imageBase64.includes(';base64,')) {
        const parts = imageBase64.split(';base64,');
        mimeType = parts[0].replace('data:', '') || 'image/jpeg';
        cleanBase64 = parts[1];
      }
      buffer = Buffer.from(cleanBase64, 'base64');
    } else {
      // Fetch image from URL
      try {
        const res = await fetch(imageUrl);
        if (!res.ok) {
          return NextResponse.json({
            success: false,
            skipped: true,
            error: `Failed to download image (${res.status})`
          }, { status: 200 });
        }
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('image/')) {
          mimeType = contentType.split(';')[0];
        }
        const arrayBuf = await res.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      } catch (fetchErr: any) {
        return NextResponse.json({
          success: false,
          skipped: true,
          error: `Network error downloading image: ${fetchErr.message}`
        }, { status: 200 });
      }
    }

    // 1. Optional: Quick EXIF check
    let exifTakenDate: Date | null = null;
    try {
      const meta = await sharp(buffer).metadata();
      if (meta.exif) {
        const exifStr = meta.exif.toString('binary');
        const match = exifStr.match(/(\d{4})[:\-](\d{2})[:\-](\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
          const [, y, m, d, hh, mm, ss] = match;
          exifTakenDate = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(hh) - 7, parseInt(mm), parseInt(ss)));
        }
      }
    } catch {
      // Ignore EXIF parsing error, proceed to AI OCR
    }

    // 2. Call Gemini Vision API
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        skipped: true,
        error: 'GEMINI_API_KEY is missing'
      }, { status: 200 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.1,
      }
    });

    const prompt = `You are an automated photo timestamp & watermark auditor for the "BuildTrack" construction app.
Foremen take photos using watermark camera apps (e.g., Timestamp Camera, TruePic, Marki).
These apps stamp text directly onto the image (typically along bottom-left, bottom-right, or corners).

Examine this image carefully for any timestamp or text overlay:
1. Date & time (e.g. "16 ต.ค. 2569 13:50:41", "16 Oct 2026 13:50:41", "2026-10-16 13:50")
   - If Thai Buddhist year 25xx is used, calculate Gregorian year (e.g. 2569 - 543 = 2026).
2. Location text (e.g. "อ.สันทราย, จ.เชียงใหม่ 50210")
3. Plot tag or house identifier (e.g. "AL6-45", "A-12", "แปลง 45")

Return STRICTLY a JSON object matching this schema with no markdown or formatting outside JSON:
{
  "hasWatermark": true,
  "rawWatermarkText": "All extracted text lines",
  "takenDateStr": "extracted date text",
  "takenTimeStr": "extracted time text",
  "isoDateTime": "ISO-8601 string with Asia/Bangkok time e.g. 2026-10-16T13:50:41+07:00",
  "location": "location text or null",
  "plotTag": "plot identifier or null"
}

If no stamped watermark or timestamp text is visible in the photo, return:
{
  "hasWatermark": false
}`;

    let aiResultText = '';
    try {
      const base64Data = buffer.toString('base64');
      const response = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'image/jpeg' : mimeType,
            data: base64Data
          }
        }
      ]);
      aiResultText = response.response.text();
    } catch (modelError: any) {
      // Check if Rate Limit / Quota Exceeded (HTTP 429 / RESOURCE_EXHAUSTED)
      const errStr = String(modelError.message || '');
      const isQuotaOrLimit = modelError.status === 429 || errStr.includes('429') || errStr.includes('quota') || errStr.includes('RESOURCE_EXHAUSTED');

      if (isQuotaOrLimit) {
        // Graceful degradation: skip reading without breaking the upload flow
        return NextResponse.json({
          success: false,
          skipped: true,
          isQuotaExceeded: true,
          error: 'ติดโควต้าการอ่านภาพชั่วคราว ข้ามไปก่อน สามารถสแกนภายหลังได้'
        }, { status: 200 });
      }

      // Fallback model if 2.5 is temporarily busy
      try {
        const fallbackModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const base64Data = buffer.toString('base64');
        const response = await fallbackModel.generateContent([
          prompt,
          {
            inlineData: {
              mimeType: mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'image/jpeg' : mimeType,
              data: base64Data
            }
          }
        ]);
        aiResultText = response.response.text();
      } catch (fallbackError: any) {
        return NextResponse.json({
          success: false,
          skipped: true,
          error: fallbackError.message || 'AI service unavailable'
        }, { status: 200 });
      }
    }

    // Clean JSON markdown
    let cleaned = aiResultText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      cleaned = cleaned.substring(startIdx, endIdx + 1);
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { hasWatermark: false, rawWatermarkText: aiResultText };
    }

    if (!parsed.hasWatermark && exifTakenDate) {
      parsed.hasWatermark = true;
      parsed.isoDateTime = exifTakenDate.toISOString();
      parsed.rawWatermarkText = `EXIF Metadata: ${exifTakenDate.toISOString()}`;
    }

    // Standardize takenAt date
    let takenDate: Date | null = null;
    if (parsed.isoDateTime) {
      takenDate = parseThaiOrIsoDate(parsed.isoDateTime);
    }
    if (!takenDate && parsed.takenDateStr) {
      const combined = `${parsed.takenDateStr} ${parsed.takenTimeStr || '12:00:00'}`;
      takenDate = parseThaiOrIsoDate(combined);
    }
    if (!takenDate && exifTakenDate) {
      takenDate = exifTakenDate;
    }

    // Compute audit differences if reportedCreatedAt is provided
    let audit = undefined;
    if (takenDate && reportedCreatedAt) {
      audit = calculatePhotoAudit(takenDate, reportedCreatedAt, parsed.plotTag, reportedPlotId);
    }

    const resultPayload = {
      success: true,
      hasWatermark: Boolean(parsed.hasWatermark),
      rawWatermarkText: parsed.rawWatermarkText || '',
      takenAt: takenDate ? takenDate.toISOString() : (parsed.isoDateTime || null),
      takenDateStr: parsed.takenDateStr || (takenDate ? takenDate.toLocaleDateString('th-TH') : null),
      takenTimeStr: parsed.takenTimeStr || (takenDate ? takenDate.toLocaleTimeString('th-TH') : null),
      location: parsed.location || null,
      plotTag: parsed.plotTag || null,
      audit,
      scannedAt: new Date().toISOString()
    };

    // 3. Centralized Storage: Save to Supabase photo_watermark_audits table
    if (imageUrl) {
      try {
        await supabase.from('photo_watermark_audits').upsert({
          image_url: imageUrl,
          plot_id: reportedPlotId || parsed.plotTag || null,
          has_watermark: Boolean(parsed.hasWatermark),
          raw_watermark_text: parsed.rawWatermarkText || '',
          taken_at: takenDate ? takenDate.toISOString() : null,
          taken_date_str: resultPayload.takenDateStr,
          taken_time_str: resultPayload.takenTimeStr,
          location: parsed.location || null,
          plot_tag: parsed.plotTag || null,
          audit_status: audit?.status || 'unknown',
          audit_data: audit || null
        }, { onConflict: 'image_url' });
      } catch {
        // Table might not exist yet, continue without failing
      }
    }

    return NextResponse.json(resultPayload);

  } catch (error: any) {
    console.error('Photo Audit API Error:', error);
    return NextResponse.json({
      success: false,
      skipped: true,
      error: error.message || 'Internal error'
    }, { status: 200 });
  }
}
