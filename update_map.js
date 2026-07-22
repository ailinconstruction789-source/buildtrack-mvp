const fs = require('fs');

let code = fs.readFileSync('components/MapVisualizer.tsx', 'utf8');

// 1. Add Toggle Button next to ZoomOut
const toggleButtonHTML = `
                           {/* 🌟 โหมดสาธารณูปโภค (Utility Mode) */}
                           <button 
                             onClick={() => setIsUtilityMode(!isUtilityMode)} 
                             className={\`px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl font-bold text-xs sm:text-sm shadow-sm transition-all flex items-center gap-1.5 \${isUtilityMode ? 'bg-cyan-600 text-white hover:bg-cyan-700' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'}\`}
                           >
                             {isUtilityMode ? '🛣️ โหมดสาธารณูปโภค' : '🏡 โหมดบ้าน'}
                           </button>
`;
code = code.replace(/<button onClick=\{handleZoomOut\}/, toggleButtonHTML + '\n                             <button onClick={handleZoomOut}');

// 2. Add isInfra logic inside plotBounds.map
const plotLogicInjection = `
                           const isInfra = houseTypes?.find((h: any) => h.id === plotInfo.house_type_id)?.is_infrastructure || false;
                           
                           let utilityModeClass = '';
                           if (isUtilityMode) {
                              if (isInfra) {
                                  utilityModeClass = "ring-4 ring-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.8)] z-[55] bg-cyan-100/90";
                              } else {
                                  utilityModeClass = "opacity-20 grayscale pointer-events-none";
                              }
                           } else {
                              if (isInfra) {
                                  utilityModeClass = "opacity-50 grayscale";
                              }
                           }
`;
code = code.replace(/const w = bounds\.maxX - bounds\.minX \+ 1, h = bounds\.maxY - bounds\.minY \+ 1;/, 'const w = bounds.maxX - bounds.minX + 1, h = bounds.maxY - bounds.minY + 1;\n' + plotLogicInjection);

// 3. Apply utilityModeClass to the main wrapping div of the plot label
code = code.replace(/className=\{\`absolute flex items-center justify-center p-1 transition-all \$\{isEditMapMode \? 'opacity-50 pointer-events-none' : 'hover:z-50 cursor-pointer group'\} \$\{searchHighlightClass\}\`/g, "className={`absolute flex items-center justify-center p-1 transition-all ${isEditMapMode ? 'opacity-50 pointer-events-none' : 'hover:z-50 cursor-pointer group'} ${searchHighlightClass} ${utilityModeClass}`");

fs.writeFileSync('components/MapVisualizer.tsx', code);
console.log('MapVisualizer updated');
