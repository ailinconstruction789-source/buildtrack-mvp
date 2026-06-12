const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../app/page.tsx');
const content = fs.readFileSync(file, 'utf8').split('\n');

content.forEach((line, i) => {
  if (line.toLowerCase().includes('toast') || line.includes('สำเร็จ')) {
    console.log(`${i+1}: ${line.trim()}`);
  }
});
