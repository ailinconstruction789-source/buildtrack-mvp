const fs = require('fs');
const content = fs.readFileSync('app/page.tsx', 'utf-8');

const startStr = "{/* 📋 LEVEL 3: House Detail */}";
const endStr = "{/* 🛠️ LEVEL 4: Task Progress */}"; // wait, the comment was `{/* 📋 LEVEL 4: Task Progress */}` or `{/* 🚀 LEVEL 4: Task Progress */}`? Let me just search for view === 'task-progress'

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf("               {view === 'task-progress' && selectedTask && (");

if (startIdx !== -1 && endIdx !== -1) {
    const chunk = content.substring(startIdx, endIdx);
    fs.writeFileSync('house_chunk.txt', chunk);
    console.log('Chunk extracted to house_chunk.txt');
} else {
    console.log('Not found', startIdx, endIdx);
}
