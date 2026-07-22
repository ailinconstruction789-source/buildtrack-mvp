const fs = require('fs');

function fixFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    const oldCatch = `    } catch (e) {
      // In case Gemini returns \`\`\`json ... \`\`\` despite instructions
      const cleaned = text.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      parsedData = JSON.parse(cleaned);
    }`;

    const newCatch = `    } catch (e) {
      // In case Gemini returns \`\`\`json ... \`\`\` despite instructions or trailing texts
      let cleaned = text.replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
      const startIdx = cleaned.indexOf('[');
      const endIdx = cleaned.lastIndexOf(']');
      if (startIdx !== -1 && endIdx !== -1) {
          cleaned = cleaned.substring(startIdx, endIdx + 1);
      }
      try {
        parsedData = JSON.parse(cleaned);
      } catch (parseError) {
        throw new Error("Failed to parse AI response: " + parseError.message + "\\nRaw AI Text: " + text.substring(0, 100) + "...");
      }
    }`;

    if (content.includes("const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();")) {
        content = content.replace(oldCatch, newCatch);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log("Fixed", filePath);
    } else {
        console.log("Could not find catch block in", filePath);
    }
}

fixFile('app/api/ai-risk-analysis/route.ts');
fixFile('app/api/ai-sales-analysis/route.ts');
