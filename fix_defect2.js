const fs = require('fs');
const path = require('path');
const file = path.join('app', 'page.tsx');
let lines = fs.readFileSync(file, 'utf8').split('\n');

// Keep lines before 2653 (indices 0 to 2651)
// Keep lines from 2663 (indices 2662 to end)
const newLines = [...lines.slice(0, 2652), ...lines.slice(2662)];

fs.writeFileSync(file, newLines.join('\n'), 'utf8');
console.log('Fixed defect modal lines');
