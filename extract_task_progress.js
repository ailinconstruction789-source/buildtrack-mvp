const fs = require('fs');
const content = fs.readFileSync('app/page.tsx', 'utf-8');

const startStr = "{view === 'task-progress' && selectedTask && (";
const endStr = "{view === 'procurement-contractors' && (isAdmin || isProcurement) && (";

// Wait, the line before `view === 'task-progress'` is probably `               {/* 🚀 LEVEL 4: Task Progress */}` or something similar.
// Let's just find `view === 'task-progress'` and extract until the next view.

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
    // Also include the `{/* ... */}` comment before it if it exists.
    let realStart = content.lastIndexOf('{/*', startIdx);
    if (startIdx - realStart > 100) {
        realStart = startIdx; // don't go too far back
    }
    const chunk = content.substring(realStart, endIdx);
    fs.writeFileSync('task_chunk.txt', chunk);
    console.log('Chunk extracted to task_chunk.txt');
} else {
    console.log('Not found', startIdx, endIdx);
}
