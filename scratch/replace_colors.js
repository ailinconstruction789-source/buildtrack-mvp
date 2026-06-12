const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, '..', 'components');

const replacements = [
  { regex: /bg-white/g, replace: 'bg-surface' },
  { regex: /text-\[\#1d1d1f\]/g, replace: 'text-on-surface' },
  { regex: /text-\[\#86868b\]/g, replace: 'text-on-surface-variant' },
  { regex: /bg-\[\#f5f5f7\]/g, replace: 'bg-surface-container-highest' },
  { regex: /border-black\/5/g, replace: 'border-outline-variant' },
  { regex: /border-slate-200/g, replace: 'border-outline-variant' },
  { regex: /border-slate-100/g, replace: 'border-outline-variant' },
  { regex: /bg-slate-50/g, replace: 'bg-surface-container-lowest' },
  { regex: /bg-slate-100/g, replace: 'bg-surface-container-low' },
  { regex: /bg-slate-800/g, replace: 'bg-surface-container-high text-on-surface' },
  { regex: /text-slate-800/g, replace: 'text-on-surface' },
  { regex: /text-slate-700/g, replace: 'text-on-surface-variant' },
  { regex: /text-slate-600/g, replace: 'text-on-surface-variant' },
  { regex: /text-slate-500/g, replace: 'text-on-surface-variant' },
  { regex: /text-slate-400/g, replace: 'text-outline' },
  { regex: /bg-blue-600/g, replace: 'bg-primary' },
  { regex: /text-blue-600/g, replace: 'text-primary' },
  { regex: /text-blue-500/g, replace: 'text-primary' },
  { regex: /bg-emerald-600/g, replace: 'bg-tertiary text-on-tertiary' },
  { regex: /bg-rose-500/g, replace: 'bg-error text-on-error' },
  { regex: /bg-rose-600/g, replace: 'bg-error text-on-error' },
  { regex: /text-rose-600/g, replace: 'text-error' },
  { regex: /text-rose-500/g, replace: 'text-error' },
  { regex: /border-rose-200/g, replace: 'border-error-container' },
  { regex: /bg-rose-50/g, replace: 'bg-error-container' },
  { regex: /shadow-sm/g, replace: 'shadow-elevation-1' },
  { regex: /shadow-md/g, replace: 'shadow-elevation-2' },
  { regex: /shadow-lg/g, replace: 'shadow-elevation-3' },
  { regex: /rounded-2xl/g, replace: 'rounded-2xl' },
  { regex: /rounded-\[2rem\]/g, replace: 'rounded-3xl' },
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;
  
  replacements.forEach(({ regex, replace }) => {
    content = content.replace(regex, replace);
  });

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${path.basename(filePath)}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.tsx')) {
      processFile(fullPath);
    }
  }
}

walkDir(componentsDir);
console.log('Component colors updated successfully.');
