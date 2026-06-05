const fs = require('fs');
const content = fs.readFileSync('app/page.tsx', 'utf-8');

const startStr = "{/* 📋 LEVEL 3: House Detail */}";
const endStr = "{/* 🛠️ LEVEL 5: ADMIN - เพิ่มแปลงบ้าน */}";

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
    const chunk = content.substring(startIdx, endIdx);
    fs.writeFileSync('task_chunk.txt', chunk);
    console.log('Chunk extracted to task_chunk.txt');
} else {
    console.log('Not found');
}
