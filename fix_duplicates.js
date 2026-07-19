const fs = require('fs');
const content = fs.readFileSync('./app/page.tsx', 'utf8');

let newContent = content.replace(/setSelectedProject\(null\); setSelectedProject\(null\);/g, "setSelectedProject(null);");
newContent = newContent.replace(/onBack=\{\(\) => setView\('dashboard'\)\}/g, "onBack={() => { setView('dashboard'); setSelectedProject(null); }}");

fs.writeFileSync('./app/page.tsx', newContent, 'utf8');
