const fs = require('fs');
const content = fs.readFileSync('app/page.tsx', 'utf-8');

const startStr = "{/* 🗺️ View: Project Detail & Map Builder */}";
const endStr = "{/* 📋 LEVEL 3: House Detail */}";

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
    const chunk = content.substring(startIdx, endIdx);
    fs.writeFileSync('map_chunk.txt', chunk);
    console.log('Chunk extracted to map_chunk.txt');
} else {
    console.log('Not found');
}
