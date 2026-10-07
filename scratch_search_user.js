const fs = require('fs');
const readline = require('readline');

async function search() {
  const fileStream = fs.createReadStream('C:/Users/HUAWEI/.gemini/antigravity/brain/921864c8-455b-4031-a10e-203b9fbe0e8b/.system_generated/logs/transcript_full.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let i = 0;
  for await (const line of rl) {
    if (line.includes('"USER_INPUT"')) {
      try {
        const obj = JSON.parse(line);
        const text = obj.content?.replace(/\n/g, ' ') || '';
        if (text.includes('เฉพาะ') || text.includes('โครงการ') || text.includes('ตาราง') || text.includes('ปิด') || text.includes('กรอบ')) {
          console.log(`[USER_INPUT ${i}] ${text.slice(0, 200)}`);
        }
        i++;
      } catch(e) {}
    }
  }
}
search();
