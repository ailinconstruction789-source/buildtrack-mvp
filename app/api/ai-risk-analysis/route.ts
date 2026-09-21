import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType, Schema } from '@google/generative-ai';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      bottleneckData, 
      sCurveData, 
      contractorPerformance, 
      contractorWorkloadStats,
      weatherInfo,
      weatherRiskAnalysis,
      evmMetrics,
      predictiveDelays,
      activePlotStats 
    } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json({ 
        error: "GEMINI_API_KEY is missing. Please add it to .env.local" 
      }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    const responseSchema = {
      type: SchemaType.ARRAY,
      description: "Array of exactly 4 risk insights.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING, description: "Topic of the alert" },
          type: { type: SchemaType.STRING, description: "One of: 'weather', 'contractor', 'defect', 'bottleneck', 'evm'" },
          severity: { type: SchemaType.STRING, description: "One of: 'high', 'medium', 'info'" },
          message: { type: SchemaType.STRING, description: "Detailed AI analysis and recommendation in Thai language. Be specific using the data provided. E.g. mention specific plot numbers, delay days, contractor names, task names, or percentages." },
          recommendation: { type: SchemaType.STRING, description: "Actionable advice in Thai language" },
        },
        required: ["title", "type", "severity", "message", "recommendation"]
      }
    } as Schema;

    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        maxOutputTokens: 8192,
      }
    });

    const prompt = `
You are a Senior Construction Risk Analyst AI for the "BuildTrack" system.
Analyze the following real-time project data and generate the "Hourly Executive Risk Report" containing deep strategic insights for project directors and executives.

SCOPE NOTE:
- All analysis strictly focuses on houses currently UNDER ACTIVE CONSTRUCTION.
- Completed houses (100% finished or handed over) and ready-for-sale houses have been EXCLUDED from the risk calculations and delay metrics.

DATA:
1. Active Construction Scope: ${JSON.stringify(activePlotStats || { note: "Only active in-construction plots" })}
2. Weather Forecast & Outdoor Exposure: Weather: ${JSON.stringify(weatherInfo)}, Active Tasks Exposure: ${JSON.stringify(weatherRiskAnalysis || {})}
3. Contractor Liquidity & Workload: Capacity & Plots Count: ${JSON.stringify(contractorWorkloadStats || [])}, Overall Stats: ${JSON.stringify(contractorPerformance || [])}
4. Bottleneck & QC Handoff Latency: ${JSON.stringify(bottleneckData || [])}
5. EVM Progress & S-Curve: SPI/Status: ${JSON.stringify(evmMetrics || {})}, S-Curve History: ${JSON.stringify(sCurveData || [])}
6. Plot Predictive Delays (Top critical plots): ${JSON.stringify(predictiveDelays || [])}

INSTRUCTIONS:
Return a JSON array containing exactly 4 objects. Each object represents an alert/insight based on the real data.
Do NOT use markdown code blocks (like \`\`\`json). Just output raw JSON.

Structure each object as follows:
{
  "title": "String (Topic of the alert)",
  "type": "String (One of: 'weather', 'contractor', 'defect', 'bottleneck', 'evm')",
  "severity": "String (One of: 'high', 'medium', 'info')",
  "message": "String (Detailed AI analysis in Thai language. Be specific using the data provided. E.g. mention specific plot numbers, delay days, contractor names, task names, SPI, or percentages.)",
  "recommendation": "String (Actionable strategic advice in Thai language)"
}

Required 4 Pillars:
1. "Weather-Induced Delay Forecasting": Analyze the weather forecast against outdoor vs indoor tasks. If rain/storms are expected, analyze how many active plots have outdoor work (concrete, structural, roof, painting) that will stall, and suggest workforce reallocation to indoor tasks.
2. "Contractor Liquidity & Performance Matrix": Analyze contractor workload capacity (how many active plots each contractor handles concurrently). Warn if any contractor has an excessive workload, high rework rate, or liquidity risk.
3. "Predictive Defect & Bottleneck Analysis": Analyze QC latency and repeat reworks. Identify specific task bottlenecks that cause the most handoff delay across active plots.
4. "Earned Value Management (EVM) Forecasting": Analyze SPI (Schedule Performance Index) and cumulative EV vs PV. Forecast whether the active project phase will complete ahead, on-time, or behind schedule.

STRICT CONSTRAINTS:
1. Date Formatting: When mentioning years, always convert the Gregorian year (e.g., 2026) to Buddhist Era (B.E.) by adding 543 (e.g., 2569). NEVER write '2526'.
2. Excluded Plots: DO NOT flag completed or ready-for-sale houses as delayed.
3. Data Grounding: Base your analysis STRICTLY on the provided JSON data. DO NOT hallucinate or invent contractor names, tasks, or percentages. If data is empty or indicates no risk, state clearly that the situation is normal.
4. Tone: Use a professional and urgent tone suitable for a C-level executive. Use proper Thai construction terminology.
5. Actionable Advice: Your "recommendation" MUST be specific and actionable (e.g., 'Reassign 3 worker crews from outdoor to indoor tiling' instead of 'Monitor closely').
6. Severity Rules: Set severity to 'high' ONLY IF EVM delay > 10% (SPI < 0.90) OR contractor rework > 5 OR severe weather impact > 1 day. Otherwise, use 'medium' or 'info'.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let parsedData = [];
    try {
      parsedData = JSON.parse(text);
    } catch (e) {
      // In case Gemini returns ```json ... ``` despite instructions or trailing texts
      let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const startIdx = cleaned.indexOf('[');
      const endIdx = cleaned.lastIndexOf(']');
      if (startIdx !== -1 && endIdx !== -1) {
          cleaned = cleaned.substring(startIdx, endIdx + 1);
      }
      try {
        parsedData = JSON.parse(cleaned);
      } catch (parseError: any) {
        // Safe string escaping for error log
        const safeText = String(text).substring(0, 500).replace(/\n/g, '\\n');
        throw new Error("Failed to parse AI response: " + parseError.message + " | Raw AI Text: " + safeText + "...");
      }
    }

    return NextResponse.json(parsedData);
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    return NextResponse.json({ error: error.message || "Failed to analyze data" }, { status: 500 });
  }
}
