const fs = require('fs');
const content = fs.readFileSync('./app/page.tsx', 'utf8');

let newContent = content.replace(/onClick=\{\(\) => setView\('dashboard'\)\}/g, "onClick={() => { setView('dashboard'); setSelectedProject(null); }}");
newContent = newContent.replace(/onClick=\{\(e\) => setView\('dashboard'\)\}/g, "onClick={(e) => { setView('dashboard'); setSelectedProject(null); }}");
// Also there is a case: if (view === 'project-detail') setView('dashboard');
newContent = newContent.replace(/if \(view === 'project-detail'\) setView\('dashboard'\);/g, "if (view === 'project-detail') { setView('dashboard'); setSelectedProject(null); }");

// And another case:
// setView('dashboard');
// setNewProjectName(''); await fetchAllData(); setView('dashboard'); 
newContent = newContent.replace(/setView\('dashboard'\);/g, "setView('dashboard'); setSelectedProject(null);");
// Wait, the last replace is too broad. Let's just fix the onClick handlers first.

fs.writeFileSync('./app/page.tsx', newContent, 'utf8');
