const fs = require('fs');

const pagePath = 'C:\\Users\\HUAWEI\\Desktop\\buildtrack\\app\\page.tsx';
const mapVisPath = 'C:\\Users\\HUAWEI\\Desktop\\buildtrack\\components\\MapVisualizer.tsx';
const dashPath = 'C:\\Users\\HUAWEI\\Desktop\\buildtrack\\components\\DashboardOverview.tsx';

// 1. Update app/page.tsx
let pageContent = fs.readFileSync(pagePath, 'utf8');
if (!pageContent.includes('handleTogglePlotCustomer={handleTogglePlotCustomer} handleTogglePlotCompleted={handleTogglePlotCompleted}') && pageContent.includes('<MapVisualizer')) {
    pageContent = pageContent.replace(
        /<MapVisualizer([\s\S]*?)setCurrentSlideIndex=\{setCurrentSlideIndex\}/,
        '<MapVisualizer$1setCurrentSlideIndex={setCurrentSlideIndex}\n                handleTogglePlotCustomer={handleTogglePlotCustomer}\n                handleTogglePlotCompleted={handleTogglePlotCompleted}'
    );
    fs.writeFileSync(pagePath, pageContent);
    console.log('Updated app/page.tsx');
}

// 2. Update MapVisualizer.tsx
let mapVisContent = fs.readFileSync(mapVisPath, 'utf8');
if (!mapVisContent.includes('handleTogglePlotCustomer')) {
    mapVisContent = mapVisContent.replace(
        /setCurrentSlideIndex: \(i: number\) => void;/,
        'setCurrentSlideIndex: (i: number) => void;\n  handleTogglePlotCustomer?: (id: string, current: boolean) => void;\n  handleTogglePlotCompleted?: (id: string, current: boolean) => void;'
    );
    mapVisContent = mapVisContent.replace(
        /setCurrentSlideIndex\n  \} = props;/,
        'setCurrentSlideIndex,\n    handleTogglePlotCustomer,\n    handleTogglePlotCompleted\n  } = props;'
    );

    // Add buttons
    const buttonsHTML = `
                            {isAdmin && handleTogglePlotCustomer && handleTogglePlotCompleted && (
                                <div className="flex gap-2 mb-3 z-20 relative">
                                  <button onClick={(e) => { e.stopPropagation(); handleTogglePlotCustomer(plot.id, !!plot.has_customer); }} className={\`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all border \${plot.has_customer ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100' : 'bg-[#f5f5f7] text-[#86868b] border-transparent hover:bg-slate-200'}\`}>
                                    👤 {plot.has_customer ? 'มีลูกค้า' : 'ระบุลูกค้า'}
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); handleTogglePlotCompleted(plot.id, !!plot.is_completed); }} className={\`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all border \${plot.is_completed ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : 'bg-[#f5f5f7] text-[#86868b] border-transparent hover:bg-slate-200'}\`}>
                                    🔑 {plot.is_completed ? 'โอนแล้ว' : 'พร้อมโอน'}
                                  </button>
                                </div>
                            )}
`;
    mapVisContent = mapVisContent.replace(
        /<div className="flex flex-col gap-1">/,
        buttonsHTML + '                              <div className="flex flex-col gap-1">'
    );
    fs.writeFileSync(mapVisPath, mapVisContent);
    console.log('Updated MapVisualizer.tsx');
}

// 3. Update DashboardOverview.tsx
let dashContent = fs.readFileSync(dashPath, 'utf8');

const newListViewHTML = `
                  {/* 🌟 Layout แบบ Grouped Table View */}
                  if (inspectionViewMode === 'list') {
                      // We will handle 'list' mode completely differently, so this block is not reached in the normal map.
                      // Wait, I will replace the whole mapping logic instead.
                      return null;
                  }
`;

// Replace the render block for `inspectionQueue`
const oldQueueBlock = /{inspectionQueue\.filter[\s\S]*?<\/\div>\n\s*\}?\n\s*<\/\div>\n\s*\)}/;

const newQueueBlock = `{inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000)).length === 0 ? ( 
            <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-dashed border-black/10 p-8 sm:p-16 text-center flex flex-col items-center justify-center gap-3 sm:gap-4">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#f5f5f7] rounded-full flex items-center justify-center"><CheckCircle size={32} className="text-emerald-400 opacity-50"/></div>
                <p className="text-slate-400 font-bold italic text-sm sm:text-xl">ไม่มีงานรอตรวจสอบในหมวดหมู่นี้</p>
            </div> 
          ) : (
            <div className="max-h-[50vh] sm:max-h-[600px] overflow-y-auto custom-scrollbar pr-1 sm:pr-3 pb-2">
              {inspectionViewMode === 'card' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                  {inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000)).map(q => {
                    const isUrgent = (Date.now() - q.time) > 172800000;
                    const relatedProject = projects.find(p => p.name === q.project_name); const relatedPlot = plots.find(p => p.id === q.plot_id); const relatedTask = taskTemplates.find(t => t.id === q.task_template_id);
                    const clickAction = () => { setSelectedProject(relatedProject); setSelectedPlot(relatedPlot); setSelectedTask(relatedTask); setTaskReturnView('dashboard'); setView('task-progress'); };
                    return (
                      <button key={\`\${q.plot_id}-\${q.task_template_id}\`} onClick={clickAction} className={\`bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[1.5rem] border \${isUrgent ? 'border-rose-400 bg-rose-50/50' : 'border-black/5'} shadow-sm hover:border-blue-500 hover:shadow-lg hover:-translate-y-1 transition-all text-left group relative overflow-hidden\`}>
                          {isUrgent && <div className="absolute top-0 left-0 w-full h-1.5 bg-rose-500"></div>}
                          <div className="flex justify-between items-start mb-3 mt-1 sm:mt-0">
                            <span className={\`text-[9px] sm:text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-md text-white shadow-sm \${q.statusFor === 'QC' ? 'bg-purple-600' : 'bg-blue-600'}\`}>รอ {q.statusFor}</span>
                            <span className={\`text-[9px] sm:text-[10px] font-bold flex items-center gap-1 px-2 py-1 rounded-md \${isUrgent ? 'bg-rose-100 text-rose-600 animate-pulse' : 'bg-[#f5f5f7] text-[#86868b]'}\`}><Clock size={10}/> {new Date(q.time).toLocaleDateString('th-TH',{day:'numeric', month:'short'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                          </div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <h4 className="font-bold text-[#1d1d1f] text-2xl">{q.plot_id}</h4>
                            {isUrgent && <AlertTriangle size={16} className="text-rose-500 animate-pulse"/>}
                          </div>
                          <p className="text-xs sm:text-sm font-bold text-[#86868b] line-clamp-2 my-1.5 min-h-[32px] sm:min-h-[40px]">{q.task_name}</p>
                          <p className="text-[10px] sm:text-xs text-slate-400 flex items-center gap-1.5 mt-3 pt-3 border-t border-black/5/60"><HardHat size={14} className="text-slate-300"/> {q.foreman}</p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {Object.entries(
                    inspectionQueue
                      .filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000))
                      .reduce((acc, q) => {
                        if (!acc[q.plot_id]) acc[q.plot_id] = [];
                        acc[q.plot_id].push(q);
                        return acc;
                      }, {} as Record<string, any[]>)
                  )
                  // Sort plots by having the most urgent items first
                  .sort((a, b) => {
                    const aUrgent = a[1].some(q => (Date.now() - q.time) > 172800000) ? 1 : 0;
                    const bUrgent = b[1].some(q => (Date.now() - q.time) > 172800000) ? 1 : 0;
                    return bUrgent - aUrgent;
                  })
                  .map(([plotId, tasks]) => {
                    // Sort tasks inside plot: urgent first
                    const sortedTasks = [...tasks].sort((a, b) => {
                      const aUrgent = (Date.now() - a.time) > 172800000 ? 1 : 0;
                      const bUrgent = (Date.now() - b.time) > 172800000 ? 1 : 0;
                      return bUrgent - aUrgent || a.time - b.time;
                    });
                    
                    return (
                      <div key={plotId} className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                        <div className="bg-slate-50 px-4 py-3 border-b border-black/5 flex justify-between items-center">
                          <h4 className="font-bold text-lg text-[#1d1d1f] flex items-center gap-2">
                            <MapIcon size={16} className="text-blue-500" /> แปลง {plotId}
                          </h4>
                          <span className="text-xs font-bold text-slate-500 bg-white px-2 py-1 rounded shadow-sm border border-black/5">
                            {tasks.length} รายการ
                          </span>
                        </div>
                        <div className="flex flex-col divide-y divide-black/5">
                          {sortedTasks.map(q => {
                            const isUrgent = (Date.now() - q.time) > 172800000;
                            const relatedProject = projects.find(p => p.name === q.project_name); 
                            const relatedPlot = plots.find(p => p.id === q.plot_id); 
                            const relatedTask = taskTemplates.find(t => t.id === q.task_template_id);
                            const clickAction = () => { setSelectedProject(relatedProject); setSelectedPlot(relatedPlot); setSelectedTask(relatedTask); setTaskReturnView('dashboard'); setView('task-progress'); };

                            return (
                              <button key={\`\${q.plot_id}-\${q.task_template_id}\`} onClick={clickAction} className={\`p-3 sm:p-4 hover:bg-[#f5f5f7] transition-colors text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 group \${isUrgent ? 'bg-rose-50/30' : ''}\`}>
                                <div className="flex items-center gap-3 sm:gap-4 flex-1 overflow-hidden">
                                    <div className={\`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex flex-col items-center justify-center shrink-0 shadow-inner \${q.statusFor === 'QC' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}\`}>
                                      <span className="text-[10px] sm:text-[11px] font-bold uppercase">รอ {q.statusFor}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                          <p className="text-xs sm:text-sm font-bold text-[#1d1d1f] truncate">{q.task_name}</p>
                                          {isUrgent && <span className="bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse shadow-sm shrink-0"><AlertTriangle size={10}/> ด่วน</span>}
                                      </div>
                                      <p className="text-[10px] sm:text-xs text-[#86868b] flex items-center gap-1"><HardHat size={10}/> {q.foreman}</p>
                                    </div>
                                </div>
                                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-1 shrink-0 sm:pl-4">
                                    <span className={\`text-[10px] sm:text-xs font-bold \${isUrgent ? 'text-rose-600' : 'text-slate-400'}\`}><Clock size={12} className="inline mr-1"/> {new Date(q.time).toLocaleDateString('th-TH', {month:'short', day:'numeric'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}`;

dashContent = dashContent.replace(oldQueueBlock, newQueueBlock);

fs.writeFileSync(dashPath, dashContent);
console.log('Updated DashboardOverview.tsx');
