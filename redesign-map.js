const fs = require('fs');

const file = 'components/MapVisualizer.tsx';
let content = fs.readFileSync(file, 'utf8');

// Update header
content = content.replace(
  /className="text-xl sm:text-4xl font-bold text-on-surface italic uppercase tracking-tighter"/,
  'className="text-headline-lg font-headline-lg text-primary"'
);
content = content.replace(
  /className="text-on-surface-variant text-\[10px\] sm:text-sm font-bold uppercase tracking-widest flex items-center gap-1\.5 sm:gap-2 mt-0\.5 sm:mt-1"/,
  'className="text-body-sm font-body-sm text-on-surface-variant mt-1 flex items-center gap-2"'
);

// Update map container background
content = content.replace(
  /className="w-full overflow-auto pb-4 custom-scrollbar bg-surface-container-highest rounded-xl sm:rounded-3xl border-2 sm:border-4 border-black\/10 shadow-inner"/,
  'className="w-full overflow-auto pb-4 custom-scrollbar bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm relative"'
);

// Add the decorative grid lines (inject inside the map container)
content = content.replace(
  /style={{ height: isMobileLayout \? '350px' : '600px' }}>\s*<div/,
  `style={{ height: isMobileLayout ? '350px' : '600px' }}>\n                       <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#041632 1px, transparent 1px), linear-gradient(90deg, #041632 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>\n                       <div`
);

// Remove the radial gradient from the movable grid because we added the background map grid lines
content = content.replace(
  /backgroundImage: `radial-gradient\(\#cbd5e1 1\.5px, transparent 1\.5px\)`,/,
  '/* removed radial gradient */'
);

// Update Plot Cards on Map
content = content.replace(
  /let cardBorderClass = statusInfo.colors;/,
  `let cardBorderClass = statusInfo.status === 'completed' ? 'bg-primary text-on-primary border-primary' 
                                 : statusInfo.status === 'ahead' ? 'bg-primary-fixed text-on-primary-fixed-variant border-primary-fixed-dim'
                                 : statusInfo.status === 'delayed' ? 'bg-error-container text-on-error-container border-error'
                                 : statusInfo.status === 'on-track' ? 'bg-secondary-container text-on-secondary-container border-secondary-container'
                                 : 'bg-surface-container-highest text-on-surface border-outline-variant';`
);

content = content.replace(
  /className={`w-full h-full border-\[2px\] sm:border-\[3px\] rounded-md sm:rounded-lg shadow-elevation-1 backdrop-blur-sm flex flex-col items-center justify-center relative transition-all group-hover:shadow-elevation-2 group-hover:scale-\[1\.02\] \${cardBorderClass}`}/g,
  `className={\`w-full h-full border rounded flex items-center justify-center font-data-mono hover:scale-105 transition-transform shadow-sm relative \${cardBorderClass}\`}`
);

// Update Plot Directory Header
content = content.replace(
  /className="font-bold text-xl tracking-tight sm:text-3xl text-on-surface italic uppercase"/,
  'className="text-headline-lg font-headline-lg text-primary"'
);

// Update Plot Directory Cards
content = content.replace(
  /className="relative group w-full bg-surface p-4 sm:p-8 rounded-xl sm:rounded-\[2\.5rem\] border border-outline-variant text-left hover:border-blue-500 hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col justify-between h-full cursor-pointer"/,
  'className="relative group w-full bg-surface-container-lowest p-md rounded-xl border border-outline-variant text-left hover:border-primary hover:shadow-md transition-all flex flex-col justify-between h-full cursor-pointer"'
);

content = content.replace(
  /className={\`\${isMobileLayout \? 'text-2xl' : 'text-4xl sm:text-5xl'} font-bold text-on-surface truncate\`}/,
  'className="text-headline-lg font-headline-lg text-primary truncate"'
);

// Update Actual Progress numbers
content = content.replace(
  /className={\`\${statusInfo.status === 'delayed' \? 'text-rose-500' : 'text-primary'} \${isMobileLayout \? 'text-sm' : 'text-lg'}\`}/,
  'className={`text-body-md font-body-md font-bold ${statusInfo.status === \'delayed\' ? \'text-error\' : \'text-primary\'}`}'
);

fs.writeFileSync(file, content, 'utf8');
console.log('MapVisualizer redesigned successfully');
