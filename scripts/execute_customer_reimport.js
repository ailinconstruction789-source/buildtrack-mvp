const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=([^\r\n]+)/)?.[1]?.trim();
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=([^\r\n]+)/)?.[1]?.trim();
const supabase = createClient(url, key);

function normalizeProjectName(raw, defaultProject = 'ไอลิน6') {
  if (!raw) return defaultProject;
  const str = raw.toString().trim();
  const lower = str.toLowerCase().replace(/\s+/g, '');

  if (lower === 'k4' || lower.includes('กานต์รวี4') || lower.includes('กานต์รวี 4')) return 'กานต์รวี4';
  if (lower === 'k2' || lower === 'k2พิเศษ' || lower.includes('กานต์รวี2') || lower.includes('กานต์รวี 2')) return 'กานต์รวี2';
  if (lower === 'al4' || lower.includes('ไอลิน4') || lower.includes('ไอลิน 4')) return 'ไอลิน 4';
  if (lower === 'al6' || lower.includes('ไอลิน6') || lower.includes('ไอลิน 6')) return 'ไอลิน6';
  if (lower === 'al3' || lower.includes('ไอลิน3') || lower.includes('ไอลิน 3')) return 'ไอลิน 3';
  if (lower === 'al2' || lower.includes('ไอลิน2') || lower.includes('ไอลิน 2')) return 'ไอลิน 2';
  if (lower === 'yr' || lower.includes('โยริว')) return 'โยริว';
  if (lower.includes('สันทราย2') || lower.includes('st2') || lower.includes('alst2')) return 'ไอลิน สันทราย 2';

  if (str.includes(',')) {
    const primary = str.split(',')[0].trim();
    return normalizeProjectName(primary, defaultProject);
  }
  return str;
}

function normalizeSalesOwner(name) {
  if (!name) return 'ทีมขาย';
  const str = name.trim();
  const lower = str.toLowerCase().replace(/\s+/g, '');
  if (lower === 'piew' || str.includes('ปวีณา') || str.includes('เปิ้ล')) return 'PIEW';
  if (lower === 'bell' || str.includes('พนิดดา') || str.includes('เบล')) return 'BELL';
  if (lower === 'ying' || str.includes('จริยา') || str.includes('หญิง')) return 'YING';
  if (lower === 'nook' || str.includes('สุมลยา') || str.includes('นุ๊ก')) return 'NOOK';
  if (lower === 'field' || str.includes('กรุณพล') || str.includes('ฟิลด์')) return 'FIELD';
  if (lower === 'teaw' || str.includes('วีรกาณต์') || str.includes('แต้ว')) return 'TEAW';
  if (lower === 'jeejee' || str.includes('อัจฉรา') || str.includes('จีจี้')) return 'JEEJEE';
  return str;
}

function parseDateValue(dateStr) {
  if (dateStr === null || dateStr === undefined || dateStr === '' || dateStr === '-' || dateStr === 0 || dateStr === '0') return null;
  const str = dateStr.toString().trim();
  if (!str || str === '-' || str === '0') return null;

  if (/^\d+(\.\d+)?$/.test(str)) {
    const serial = parseFloat(str);
    if (serial < 1000) return null; // Invalid serial
    const utcDays = Math.floor(serial - 25569);
    const utcValue = utcDays * 86400; 
    const dateInfo = new Date(utcValue * 1000);
    if (!isNaN(dateInfo.getTime())) {
      return new Date(Date.UTC(dateInfo.getFullYear(), dateInfo.getMonth(), dateInfo.getDate(), 5, 0, 0)).toISOString();
    }
  }

  const parts = str.split(/[\/\-.]/);
  if (parts.length === 3) {
    let part1 = parseInt(parts[0], 10);
    let part2 = parseInt(parts[1], 10);
    let part3 = parseInt(parts[2], 10);

    let day = part1;
    let month = part2;
    let year = part3;

    if (part1 > 1000) {
      year = part1;
      month = part2;
      day = part3;
    }

    if (year > 2400) {
      year -= 543;
    } else if (year < 100) {
      year += 2000;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month - 1, day, 5, 0, 0)).toISOString();
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    let year = parsed.getFullYear();
    if (year > 2400) year -= 543;
    return new Date(Date.UTC(year, parsed.getMonth(), parsed.getDate(), 5, 0, 0)).toISOString();
  }

  return null;
}

function parseMoneyValue(val) {
  if (val === null || val === undefined || val === '' || val === '-') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const numStr = val.toString().replace(/[^0-9.-]+/g, '');
  const num = Number(numStr);
  return isNaN(num) ? null : num;
}

async function runReimport() {
  console.log('=== STARTING COMPLETE CUSTOMER RE-IMPORT ===');

  // 1. Authenticate as Owner
  console.log('Authenticating as Owner...');
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'owner@buildtrack.local',
    password: '1234BT!'
  });
  if (authErr) throw new Error('Auth failed: ' + authErr.message);
  console.log('Authenticated as:', authData.user.email);

  // 2. Fetch plots from DB
  const { data: allPlots, error: plotsErr } = await supabase.from('plots').select('*');
  if (plotsErr) throw plotsErr;
  console.log(`Fetched ${allPlots?.length} plots from database.`);

  // 3. Read latest Excel file
  const excelFile = 'ข้อมูลลูกค้าล่าสุด.xlsx';
  if (!fs.existsSync(excelFile)) throw new Error(`File not found: ${excelFile}`);
  const wb = XLSX.readFile(excelFile);
  const ws = wb.Sheets['ข้อมูลลูกค้า'] || wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws);
  console.log(`Read ${rawRows.length} rows from ${excelFile}.`);

  // 4. Clear existing leads
  console.log('Clearing old leads...');
  const { error: delErr } = await supabase.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) {
    console.warn('Warning on clear leads:', delErr.message);
  }
  console.log('Cleared existing leads.');

  // 5. Reset all plots status before applying new sales
  console.log('Resetting all plots status...');
  let resetCount = 0;
  for (const plot of allPlots) {
    await supabase.from('plots').update({
      has_customer: false,
      sale_status: 'ready_for_sale',
      highlight_note: null,
      is_completed: false
    }).eq('id', plot.id);
    resetCount++;
  }
  console.log(`Reset ${resetCount} plots to ready_for_sale.`);

  // 6. Process rows and prepare lead batches
  let leadPayloads = [];
  let skippedRows = 0;
  const plotUpdates = new Map(); // plotId -> update payload

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const customerName = String(row['ชื่อ-นามสกุล'] || row['ชื่อลูกค้า'] || row['Customer Name'] || row['ชื่อ'] || '').trim();
    if (!customerName || customerName === '-' || customerName === 'undefined') {
      skippedRows++;
      continue;
    }

    const rawProj = String(row['โครงการ'] || '').trim();
    const projectName = normalizeProjectName(rawProj, 'ไอลิน6');
    const rawPlot = String(row['แปลง'] || row['รหัสแปลง'] || '').trim();
    const cleanPlotName = rawPlot && rawPlot !== '-' ? rawPlot.replace(/^(AL\d+|YR|K\d+พิเศษ|K\d+|ไอลิน\s*\d+|โยริว|กานต์รวี\s*\d+)-?/i, '').replace(/^0+/, '').trim() : '';

    // Dates
    const rawVisit = row['วันที่เยี่ยมชม'] || row['วันที่เข้ามาดู'];
    const visitDate = parseDateValue(rawVisit) || new Date().toISOString();
    const rawBooking = row['วันที่จอง'] || row['วันที่เข้ามาจอง'];
    const bookingDate = parseDateValue(rawBooking);
    const rawTransfer = row['วันที่โอน'] || row['วันที่โอน_1'];
    const transferredDate = parseDateValue(rawTransfer);
    const rawCancel = row['วันที่ยกเลิก'];
    const cancelDate = parseDateValue(rawCancel);
    const rawExpected = row['คาดโอนเดือน'] || row['วันที่คาดว่าจะโอน'];
    const expectedTransferDate = parseDateValue(rawExpected);

    // Money
    const salePrice = parseMoneyValue(row[' ราคาซื้อขาย '] || row['ราคาซื้อขาย']);
    const landPrice = parseMoneyValue(row[' ราคาทด 13 '] || row['ราคาทด 13']);
    const bookingAmount = bookingDate ? (salePrice ? Math.min(salePrice, 50000) : 10000) : null;

    // Status mapping
    const rawStatus = String(row['โอนเเล้ว'] || row['สถานะ'] || '').trim().toLowerCase();
    let crmStatus = 'Follow-up — อยู่ระหว่างติดตาม';
    let legacyStatus = 'Visit';
    let autoStatus = 'Lead เข้า';
    let lostReason = null;

    if (rawStatus.includes('ยกเลิก') || cancelDate) {
      crmStatus = 'Lost — ยุติการซื้อ / ไม่จอง';
      legacyStatus = 'Cancelled';
      autoStatus = 'ยกเลิกจอง';
      lostReason = 'ยกเลิกจอง';
    } else if (rawStatus.includes('โอน') || transferredDate) {
      crmStatus = 'Transferred / Won — โอนกรรมสิทธิ์สำเร็จ';
      legacyStatus = 'Transferred';
      autoStatus = 'โอนแล้ว';
    } else if (rawStatus.includes('สัญญา')) {
      crmStatus = 'Contracted — ทำสัญญาแล้ว';
      legacyStatus = 'Contracted';
      autoStatus = 'ทำสัญญาแล้ว';
    } else if (rawStatus.includes('จอง') || bookingDate) {
      crmStatus = 'Booked — จองแล้ว';
      legacyStatus = 'Reserved';
      autoStatus = 'จองแล้ว';
    } else if (rawStatus.includes('เยียมชม') || rawStatus.includes('เยี่ยมชม')) {
      crmStatus = 'Considering — กำลังพิจารณา / เปรียบเทียบ';
      legacyStatus = 'Visit';
      autoStatus = 'เข้าชมแล้ว';
    }

    // Agent & Notes
    const rawAgent = String(row['พนักงานขาย'] || row['เซลล์'] || 'ทีมขาย').trim() || 'ทีมขาย';
    const agentName = normalizeSalesOwner(rawAgent);
    const rawNotes = String(row['หมายเหตุสินเชื่อ'] || row['หมายเหตุ'] || '').trim();
    const rawOccupation = String(row['อาชีพ'] || '').trim();
    const rawLand = String(row['ที่ดิน'] || '').trim();
    const landNote = rawLand && rawLand !== '-' ? `ที่ดิน ${rawLand} ตร.ว.` : '';
    const expNote = expectedTransferDate ? `คาดโอน: ${new Date(expectedTransferDate).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' })}` : '';
    const priceNote = salePrice ? `ราคา: ${salePrice.toLocaleString()} บ.` : '';
    const landPriceNote = landPrice ? `ราคาทด13: ${landPrice.toLocaleString()} บ.` : '';
    
    const notes = [rawNotes, landNote, priceNote, landPriceNote, expNote].filter(Boolean).join(' · ');
    const occupation = rawOccupation && rawOccupation !== '-' ? rawOccupation : '';

    // Match plot in DB
    let matchedPlot = null;
    if (cleanPlotName && allPlots) {
      matchedPlot = allPlots.find(p => {
        const pProj = normalizeProjectName(p.project_name);
        if (pProj !== projectName) return false;

        const pIdClean = p.id.replace(/^(ไอลิน\s*\d+|โยริว|กานต์รวี\s*\d+)-?/i, '').replace(/^0+/, '').trim();
        const pNameClean = (p.plot_name || '').replace(/^0+/, '').trim();

        return p.id === rawPlot ||
               p.plot_name === rawPlot ||
               pNameClean === cleanPlotName ||
               pIdClean === cleanPlotName ||
               p.id === `${projectName}-${cleanPlotName}`;
      });
    }

    const payload = {
      customer_name: customerName,
      phone: '-',
      project_name: projectName,
      channel: 'Walk in',
      source: 'Walk in',
      agent_name: agentName,
      created_by_agent: agentName,
      lead_date: visitDate,
      contacted_date: visitDate,
      appointment_date: null,
      actual_visit_date: visitDate,
      follow_up_count: 0,
      last_follow_up_date: null,
      interested_plot_id: matchedPlot ? matchedPlot.id : null,
      interested_plot_name: cleanPlotName || (matchedPlot ? matchedPlot.plot_name : null),
      booking_date: bookingDate,
      booking_amount: bookingAmount,
      loan_submission_date: null,
      loan_approved_date: null,
      transferred_date: transferredDate,
      lost_reason: lostReason,
      lost_reason_detail: null,
      crm_status: crmStatus,
      auto_status: autoStatus,
      notes: notes || null,
      occupation: occupation || null,
      interest: projectName,
      status: legacyStatus,
      created_at: visitDate || new Date().toISOString()
    };

    leadPayloads.push(payload);

    // If customer is Booked or Transferred, prepare plot update
    if (matchedPlot && (legacyStatus === 'Reserved' || legacyStatus === 'Transferred' || legacyStatus === 'Contracted')) {
      const isTrans = legacyStatus === 'Transferred';
      plotUpdates.set(matchedPlot.id, {
        id: matchedPlot.id,
        has_customer: true,
        sale_status: isTrans ? 'transferred' : 'sold',
        highlight_note: `ลูกค้า: ${customerName} (${isTrans ? 'โอนแล้ว' : 'จองแล้ว'})`,
        is_completed: isTrans ? true : matchedPlot.is_completed || false
      });
    }
  }

  // 7. Insert leads in batches of 100
  console.log(`Inserting ${leadPayloads.length} leads in batches...`);
  const BATCH_SIZE = 100;
  let totalInserted = 0;

  for (let b = 0; b < leadPayloads.length; b += BATCH_SIZE) {
    const chunk = leadPayloads.slice(b, b + BATCH_SIZE);
    const { data: inserted, error: chunkErr } = await supabase.from('leads').insert(chunk).select('id');
    if (chunkErr) {
      console.error(`Batch ${b / BATCH_SIZE + 1} insert error:`, chunkErr);
      throw chunkErr;
    }
    totalInserted += (inserted?.length || chunk.length);
    process.stdout.write(`Inserted ${totalInserted}/${leadPayloads.length} leads...\r`);
  }
  console.log(`\nSuccessfully inserted ${totalInserted} leads.`);

  // 8. Update plots with locked/sold/transferred status
  console.log(`Updating ${plotUpdates.size} matched plots...`);
  let totalPlotsUpdated = 0;
  for (const [plotId, updateData] of plotUpdates.entries()) {
    const { error: pErr } = await supabase.from('plots').update({
      has_customer: updateData.has_customer,
      sale_status: updateData.sale_status,
      highlight_note: updateData.highlight_note,
      is_completed: updateData.is_completed
    }).eq('id', plotId);

    if (pErr) {
      console.error(`Plot ${plotId} update error:`, pErr);
    } else {
      totalPlotsUpdated++;
    }
  }
  console.log(`Successfully updated ${totalPlotsUpdated} plots in database.`);

  // 9. Specific check for ไอลิน 4 แปลง 29 (คุณนันท์ลภัส เจริญรุ่งวาณิชย์)
  console.log('\n=== VERIFYING SPECIFIC CHECK: ไอลิน 4 แปลง 29 ===');
  const { data: checkLead } = await supabase.from('leads').select('*').ilike('customer_name', '%นันท์ลภัส%');
  console.log('Lead for นันท์ลภัส:', checkLead);

  const { data: checkPlot } = await supabase.from('plots').select('*').eq('id', 'ไอลิน 4-29');
  console.log('Plot ไอลิน 4-29:', checkPlot);

  console.log('\n=== RE-IMPORT SUMMARY ===');
  console.log(`Total Leads in Database: ${totalInserted}`);
  console.log(`Total Plots Linked & Updated: ${totalPlotsUpdated}`);
  console.log(`Skipped Empty Rows: ${skippedRows}`);
}

runReimport().catch(console.error);
