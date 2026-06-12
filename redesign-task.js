const fs = require('fs');

const file = 'components/TaskProgressView.tsx';
let content = fs.readFileSync(file, 'utf8');

// Container
content = content.replace(
  /className="bg-white rounded-2xl sm:rounded-\[2\.5rem\] shadow-2xl border border-black\/5 overflow-hidden flex flex-col h-\[75vh\] sm:h-\[800px\] relative border-b-8 border-b-blue-600"/,
  'className="bg-surface-container-lowest rounded-2xl sm:rounded-[2.5rem] shadow-sm border border-outline-variant overflow-hidden flex flex-col h-[75vh] sm:h-[800px] relative"'
);

// Header
content = content.replace(
  /className={\`\$\{isMobileLayout \? 'p-4' : 'p-6 sm:p-10'\} bg-slate-800 text-white flex justify-between items-center shrink-0\`}/,
  'className={`${isMobileLayout ? \'p-4\' : \'p-6 sm:p-10\'} bg-surface-container-low text-primary flex justify-between items-center shrink-0 border-b border-outline-variant`}'
);

content = content.replace(
  /className={\`\$\{isMobileLayout \? 'text-lg' : 'text-2xl sm:text-4xl'\} font-bold text-white leading-tight mb-1 sm:mb-2 italic uppercase tracking-tight\`}/,
  'className={`${isMobileLayout ? \'text-headline-lg-mobile\' : \'text-headline-lg\'} font-headline-lg text-primary mb-1 sm:mb-2 uppercase`}'
);

content = content.replace(
  /className="text-\[10px\] sm:text-sm text-slate-400 font-bold uppercase tracking-widest"/,
  'className="text-label-caps font-label-caps text-on-surface-variant uppercase tracking-widest"'
);

// Progress text in header
content = content.replace(
  /className={\`\$\{isMobileLayout \? 'text-3xl' : 'text-5xl sm:text-6xl'\} font-bold text-blue-400 italic tracking-tighter\`}/,
  'className={`${isMobileLayout ? \'text-headline-lg-mobile\' : \'text-headline-xl\'} font-headline-xl text-primary`}'
);

// Main chat area
content = content.replace(
  /className={\`flex-1 overflow-y-auto \$\{isMobileLayout \? 'p-3 pb-32 space-y-3' : 'p-4 sm:px-8 sm:pt-8 sm:pb-\[280px\] space-y-4 sm:space-y-6'\} bg-slate-50\/50\`}/,
  'className={`flex-1 overflow-y-auto ${isMobileLayout ? \'p-3 pb-32 space-y-3\' : \'p-4 sm:px-8 sm:pt-8 sm:pb-[280px] space-y-4 sm:space-y-6\'} bg-surface`}'
);

// Chat bubble
content = content.replace(
  /className={\`flex-1 bg-white \$\{isMobileLayout \? 'p-3 rounded-2xl' : 'p-5 sm:p-6 rounded-\[1\.5rem\] sm:rounded-\[2rem\]'\} border border-black\/5 shadow-sm relative pr-8\`}/g,
  'className={`flex-1 bg-surface-container-lowest ${isMobileLayout ? \'p-3 rounded-xl\' : \'p-5 sm:p-6 rounded-2xl\'} border border-outline-variant shadow-sm relative pr-8`}'
);

// Chat text
content = content.replace(
  /className={\`text-\[\#1d1d1f\] \$\{isMobileLayout \? 'text-xs mb-2' : 'text-sm sm:text-base mb-4'\} font-medium leading-relaxed\`}/g,
  'className={`text-on-surface font-body-md ${isMobileLayout ? \'text-body-sm mb-2\' : \'text-body-md mb-4\'}`}'
);

// Footer
content = content.replace(
  /className={\`absolute bottom-0 left-0 right-0 bg-white\/95 backdrop-blur-xl border-t border-black\/5 \$\{isMobileLayout \? 'p-3' : 'p-4 sm:p-6'\} shadow-\[0_-10px_20px_rgba\(0,0,0,0\.05\)\] z-20\`}/,
  'className={`absolute bottom-0 left-0 right-0 bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant ${isMobileLayout ? \'p-3\' : \'p-4 sm:p-6\'} shadow-sm z-20`}'
);

// Input text
content = content.replace(
  /className={\`flex-1 bg-\[\#f5f5f7\] \$\{isMobileLayout \? 'rounded-lg px-3 py-2 text-\[10px\]' : 'rounded-xl sm:rounded-\[1\.5rem\] px-5 sm:px-6 py-3 sm:py-4 text-sm'\} font-bold outline-none border-2 border-transparent focus:border-blue-500 shadow-inner\`}/g,
  'className={`flex-1 bg-surface ${isMobileLayout ? \'rounded-lg px-3 py-2 text-body-sm\' : \'rounded-xl px-5 sm:px-6 py-3 sm:py-4 text-body-md\'} font-body-sm outline-none border border-outline-variant focus:border-primary shadow-inner`}'
);
content = content.replace(
  /className={\`flex-1 bg-\[\#f5f5f7\] \$\{isMobileLayout \? 'rounded-lg px-3 py-2\.5 text-\[10px\]' : 'rounded-xl sm:rounded-\[1\.5rem\] px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm'\} font-bold outline-none focus:border-blue-500\`}/g,
  'className={`flex-1 bg-surface ${isMobileLayout ? \'rounded-lg px-3 py-2 text-body-sm\' : \'rounded-xl px-5 sm:px-6 py-3 sm:py-4 text-body-md\'} font-body-sm outline-none border border-outline-variant focus:border-primary shadow-inner`}'
);

fs.writeFileSync(file, content, 'utf8');
console.log('TaskProgressView redesigned successfully');
