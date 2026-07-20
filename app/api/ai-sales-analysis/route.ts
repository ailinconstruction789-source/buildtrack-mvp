import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salesData } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json({ 
        error: "GEMINI_API_KEY is missing. Please add it to .env.local" 
      }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const prompt = `
You are a Senior Real Estate Sales Data Analyst AI for the "BuildTrack" system.
Analyze the following real-time sales data and generate textual insights for an Executive Strategic Report.

DATA:
${JSON.stringify(salesData)}

INSTRUCTIONS:
Return a JSON object with exactly the following keys, containing your Thai-language analysis based STRICTLY on the data above. Do NOT use markdown code blocks like \`\`\`json. Just raw JSON.

Structure:
{
  "executiveSummary": "String (1 paragraph highlighting the most critical finding. e.g. 'ยอดจองสูงแต่กระแสเงินสดต่ำเพราะ...'). Use real numbers from data.",
  "cashCowProject": "String (1 paragraph explaining why the best project is the cash cow, referencing its transfers and cancel rate)",
  "riskProject": "String (1 paragraph explaining the project with highest risk/cancellations, referencing its cancel rate and bookings. If none, say 'ทุกโครงการอยู่ในเกณฑ์ปลอดภัย')",
  "sweetSpot": "String (1 paragraph analyzing the most popular price range and why it's the mass market favorite)",
  "seasonality": "String (1 paragraph analyzing the high/low season based on the monthMap trend)",
  "salesPrediction": "String (1 paragraph analyzing the 'projectPredictions' data. Compare historical avgVelocity (months to 90% sold) against active projects. Provide an estimated month/year they will finish.)",
  "rootCause": "String (1 paragraph identifying the #1 cancellation reason and explaining its business impact)",
  "recommendations": [
    {
      "title": "String (Short strategy title)",
      "bullets": [ "String (Actionable step 1)", "String (Actionable step 2)" ]
    },
    {
      "title": "String",
      "bullets": [ "String", "String" ]
    },
    {
      "title": "String",
      "bullets": [ "String", "String" ]
    }
  ],
  "winningFormula": "String (1 paragraph analyzing the combination of 'แบบบ้าน' (houseModel), 'พื้นที่' (landSize), and 'ราคา' (price) that customers are most interested in and book the fastest, based on topFastestSellingPlots. Advise on what to build in the future and explicitly name 1-2 plots that sold the fastest as examples.)"
}

STRICT CONSTRAINTS:
1. Data Grounding: Base your analysis STRICTLY on the provided JSON data. DO NOT hallucinate. Use the exact numbers (rejectRate, lostRevenue, project performance) provided.
2. Tone: Professional, insightful, and strategic. Suitable for a C-level real estate executive. Use Thai language.
3. Recommendations MUST address the actual problems found in the data (e.g. if rejectRate is high, suggest bank matching).
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let parsedData = {};
    try {
      parsedData = JSON.parse(text);
    } catch (e) {
      // In case Gemini returns ```json ... ``` despite instructions
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(cleaned);
    }

    return NextResponse.json(parsedData);
  } catch (error: any) {
    console.error("AI Sales Analysis Error:", error);
    return NextResponse.json({ error: error.message || "Failed to analyze data" }, { status: 500 });
  }
}
