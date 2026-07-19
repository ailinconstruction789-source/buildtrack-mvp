import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bottleneckData, sCurveData, contractorPerformance, weatherInfo } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json({ 
        error: "GEMINI_API_KEY is missing. Please add it to .env.local" 
      }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const prompt = `
You are a Senior Construction Risk Analyst AI for the "BuildTrack" system.
Analyze the following real-time project data and generate the "Hourly Executive Risk Report" containing deep insights.

DATA:
1. Weather Info: ${JSON.stringify(weatherInfo)}
2. Bottleneck Data (Reworks/Latency): ${JSON.stringify(bottleneckData)}
3. S-Curve Progress (EVM): ${JSON.stringify(sCurveData)}
4. Contractor Performance: ${JSON.stringify(contractorPerformance)}

INSTRUCTIONS:
Return a JSON array containing exactly 4 objects. Each object represents an alert/insight based on the real data.
Do NOT use markdown code blocks (like \`\`\`json). Just output raw JSON.

Structure each object as follows:
{
  "title": "String (Topic of the alert)",
  "type": "String (One of: 'weather', 'contractor', 'defect', 'bottleneck', 'evm')",
  "severity": "String (One of: 'high', 'medium', 'info')",
  "message": "String (Detailed AI analysis and recommendation in Thai language. Be specific using the data provided. E.g. mention specific contractor names, task names, or percentages.)",
  "recommendation": "String (Actionable advice in Thai language)"
}

Required Topics:
1. "Weather-Induced Delay Forecasting": Analyze the weather data. If rain is expected, warn about delays in outdoor tasks.
2. "Contractor Liquidity & Performance Matrix": Analyze contractor performance. Warn if any contractor has too many reworks or tasks.
3. "Predictive Defect Analysis": Analyze bottlenecks. Identify tasks that are frequently rejected by QC.
4. "Earned Value Management (EVM) Forecasting": Analyze S-Curve. Compare PV (Planned Value) and EV (Earned Value) in the latest month. Is the project ahead or behind?

STRICT CONSTRAINTS:
1. Date Formatting: When mentioning years, always convert the Gregorian year (e.g., 2026) to Buddhist Era (B.E.) by adding 543 (e.g., 2569). NEVER write '2526'.
2. Data Grounding: Base your analysis STRICTLY on the provided JSON data. DO NOT hallucinate or invent contractor names, tasks, or percentages. If data is empty or indicates no risk, state clearly that the situation is normal.
3. Tone: Use a professional and urgent tone suitable for a C-level executive. Use proper Thai construction terminology.
4. Actionable Advice: Your "recommendation" MUST be specific and actionable (e.g., 'Assign Site Engineer to inspect daily' instead of 'Monitor closely').
5. Severity Rules: Set severity to 'high' ONLY IF EVM delay > 10% OR contractor rework > 5 OR severe weather impact > 1 day. Otherwise, use 'medium' or 'info'.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let parsedData = [];
    try {
      parsedData = JSON.parse(text);
    } catch (e) {
      // In case Gemini returns ```json ... ``` despite instructions
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(cleaned);
    }

    return NextResponse.json(parsedData);
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    return NextResponse.json({ error: error.message || "Failed to analyze data" }, { status: 500 });
  }
}
