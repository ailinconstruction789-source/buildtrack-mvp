const fs = require('fs');

const file = 'components/HouseDetailView.tsx';
let content = fs.readFileSync(file, 'utf8');

// Update header
content = content.replace(
  /className="bg-slate-800 rounded-xl border-b-4 border-b-rose-600 shadow-elevation-3 p-3 text-on-primary"/,
  'className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm p-4 md:p-6 mb-8 text-on-surface"'
);

// Plot Title
content = content.replace(
  /className="text-xl font-bold italic tracking-tighter"/,
  'className="text-headline-xl font-headline-xl text-primary font-bold tracking-tight"'
);

// Secondary Text
content = content.replace(
  /className="text-slate-400 font-bold uppercase text-\[9px\] italic"/,
  'className="text-label-caps font-label-caps text-on-surface-variant"'
);

// Status Labels
content = content.replace(/text-slate-400/g, 'text-on-surface-variant');
content = content.replace(/border-slate-600/g, 'border-outline-variant');

// Table Header
content = content.replace(
  /bg-surface-container-highest shadow-elevation-1 text-\[10px\] sm:text-xs font-bold uppercase text-on-surface-variant tracking-widest/g,
  'bg-surface-container-low text-label-caps font-label-caps text-on-surface-variant uppercase tracking-widest border-b border-outline-variant'
);

// Table sticky columns
content = content.replace(
  /bg-surface-container-highest z-\[65\] border-b border-r border-outline-variant/g,
  'bg-surface-container-lowest z-[65] border-b border-r border-outline-variant'
);
content = content.replace(
  /bg-surface-container-highest z-\[60\] border-b border-outline-variant/g,
  'bg-surface-container-lowest z-[60] border-b border-outline-variant'
);

// Task Row backgrounds
content = content.replace(
  /className={\`group \$\{isMobileLayout \? 'border-b border-outline-variant flex flex-col p-3' : 'relative'\} \$\{index % 2 === 0 \? 'bg-surface' : 'bg-surface-container-highest'\}\`}/g,
  'className={`group ${isMobileLayout ? \'border-b border-outline-variant flex flex-col p-3\' : \'relative\'} ${index % 2 === 0 ? \'bg-surface-container-lowest\' : \'bg-surface-container-low\'}`}'
);

fs.writeFileSync(file, content, 'utf8');
console.log('HouseDetailView redesigned successfully');
