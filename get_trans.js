const fs = require('fs'); 
const lines = fs.readFileSync('C:/Users/HUAWEI/.gemini/antigravity/brain/9c2919f0-4bcd-4b61-a603-0ae68ad4f2c6/.system_generated/logs/transcript.jsonl', 'utf8').split('\n'); 
lines.filter(l => l.includes('USER_INPUT')).slice(-100).forEach(l => { 
  try { 
    const p = JSON.parse(l); 
    console.log('----'); 
    console.log(p.content); 
  } catch(e){} 
});
