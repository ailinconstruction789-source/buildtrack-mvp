const fs = require('fs');

// 1. Fix buttons in HouseDetailView.tsx
let houseFile = 'components/HouseDetailView.tsx';
let houseContent = fs.readFileSync(houseFile, 'utf8');

houseContent = houseContent.replace(
  /'bg-slate-800 border-slate-700 text-on-surface-variant hover:bg-slate-700 hover:text-white'/g,
  "'bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-variant hover:text-primary'"
);
houseContent = houseContent.replace(
  /'bg-emerald-600 border-emerald-500 text-on-primary shadow-\[0_0_10px_rgba\(5,150,105,0\.4\)\]'/g,
  "'bg-emerald-100 border-emerald-500 text-emerald-800 shadow-sm'"
);
houseContent = houseContent.replace(
  /'bg-primary border-blue-500 text-on-primary shadow-\[0_0_10px_rgba\(37,99,235,0\.4\)\]'/g,
  "'bg-blue-100 border-blue-500 text-blue-800 shadow-sm'"
);

// 2. Add props to MapVisualizer.tsx and buttons
let mapFile = 'components/MapVisualizer.tsx';
let mapContent = fs.readFileSync(mapFile, 'utf8');

if (!mapContent.includes('handleTogglePlotCustomer: (')) {
  mapContent = mapContent.replace(
    /handleZoomReset: \(\) => void;/,
    `handleZoomReset: () => void;
  handleTogglePlotCustomer: (plotId: any, currentStatus: boolean) => void;
  handleTogglePlotCompleted: (plotId: any, currentStatus: boolean, actualProgress: number) => void;
  getPlotOverallStatus: (plotId: any) => any;`
  );

  mapContent = mapContent.replace(
    /handleZoomReset\n\s*} = props;/,
    `handleZoomReset,
    handleTogglePlotCustomer, handleTogglePlotCompleted, getPlotOverallStatus
  } = props;`
  );
}

// Add buttons to the plot cards in MapVisualizer.tsx
const buttonCode = `
                               {isAdmin && (
                                 <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleTogglePlotCustomer(plot.id, plot.has_customer); }} 
                                      className={\`px-2 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1 shadow-sm \${plot.has_customer ? 'bg-blue-100 border-blue-500 text-blue-800' : 'bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-variant hover:text-primary'}\`}
                                    >
                                      👤 {plot.has_customer ? 'จองแล้ว' : 'ระบุลูกค้า'}
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const statusInfo = getPlotOverallStatus(plot.id);
                                        handleTogglePlotCompleted(plot.id, plot.is_completed, statusInfo.actual);
                                      }} 
                                      className={\`px-2 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1 shadow-sm \${plot.is_completed ? 'bg-emerald-100 border-emerald-500 text-emerald-800' : 'bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-variant hover:text-primary'}\`}
                                    >
                                      🔑 {plot.is_completed ? 'โอนแล้ว' : 'พร้อมโอน'}
                                    </button>
                                 </div>
                               )}
`;

if (!mapContent.includes('handleTogglePlotCustomer(plot.id')) {
  mapContent = mapContent.replace(
    /<div className="flex items-center gap-2">(\s*)<span className="material-symbols-outlined text-primary text-\[18px\]">home_work<\/span>(\s*)<h4 className="text-headline-lg font-headline-lg text-primary truncate">{plot\.id}<\/h4>/,
    `<div className="flex flex-col gap-1">\n                                 <div className="flex items-center gap-2">$1<span className="material-symbols-outlined text-primary text-[18px]">home_work</span>$2<h4 className="text-headline-lg font-headline-lg text-primary truncate">{plot.id}</h4>\n                                 </div>${buttonCode}`
  );
  // Also close the new div
  mapContent = mapContent.replace(
    /<\/h4>\n                                 <\/div>\s*<\/div>\s*<div className="flex flex-wrap items-center/,
    `</h4>\n                                 </div>${buttonCode}\n                                 </div>\n                                 </div>\n                                 <div className="flex flex-wrap items-center`
  );
}

// 3. Pass props in app/page.tsx
let pageFile = 'app/page.tsx';
let pageContent = fs.readFileSync(pageFile, 'utf8');

if (!pageContent.includes('handleTogglePlotCustomer={handleTogglePlotCustomer}')) {
  pageContent = pageContent.replace(
    /handleZoomReset=\{handleZoomReset\}/,
    `handleZoomReset={handleZoomReset}
                  handleTogglePlotCustomer={handleTogglePlotCustomer}
                  handleTogglePlotCompleted={handleTogglePlotCompleted}
                  getPlotOverallStatus={getPlotOverallStatus}`
  );
}

fs.writeFileSync(houseFile, houseContent, 'utf8');
fs.writeFileSync(mapFile, mapContent, 'utf8');
fs.writeFileSync(pageFile, pageContent, 'utf8');

console.log('Restored and improved toggle buttons');
