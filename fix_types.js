const fs = require('fs');

let content = fs.readFileSync('app/page.tsx', 'utf-8');

// 1. Fix JSX duplicate className
content = content.replace(/className="([^"]+)" size=\{14\} className="([^"]+)"/g, 'className="$1 $2" size={14}');

// 2. Fix ArrayLike<File> overload errors
// Usually it's Array.from(e.target.files)
content = content.replace(/Array\.from\(e\.target\.files\)/g, 'Array.from(e.target.files || [])');

// 3. Fix missing types for local arrays
content = content.replace(/const activeLayers = \[\];/g, 'const activeLayers: any[] = [];');
content = content.replace(/const timeMarkers = \[\];/g, 'const timeMarkers: any[] = [];');
content = content.replace(/let plotImages = \[\];/g, 'let plotImages: any[] = [];');
content = content.replace(/let activities = \[\];/g, 'let activities: any[] = [];');
content = content.replace(/const plotImages = \[\];/g, 'const plotImages: any[] = [];');
content = content.replace(/const activities = \[\];/g, 'const activities: any[] = [];');

// 4. Fix implicit any in maps and indices
// E.g. [taskId] -> [taskId: string] or just ignore them since we're using any, but for `Parameter 'u' implicitly has an 'any' type`
// `(u) =>` -> `(u: any) =>`
content = content.replace(/\(u\) =>/g, '(u: any) =>');
content = content.replace(/\(url, i\) =>/g, '(url: any, i: any) =>');
content = content.replace(/\(url\) =>/g, '(url: any) =>');
content = content.replace(/\(c\) =>/g, '(c: any) =>');
content = content.replace(/\(p\) =>/g, '(p: any) =>');
content = content.replace(/\(task\) =>/g, '(task: any) =>');
content = content.replace(/\(plot\) =>/g, '(plot: any) =>');
content = content.replace(/\(layer\) =>/g, '(layer: any) =>');

// 5. Fix Property 'id' does not exist on type 'never'
// This comes from `useState([])` that I missed!
// Wait, my previous regex was `useState\(\[\]\)` which might have missed `useState( [] )` or `useState([])` if there was no exact match.
content = content.replace(/useState\(\[\]\)/g, 'useState<any[]>([])');

fs.writeFileSync('app/page.tsx', content);
console.log("Type fixes applied.");
