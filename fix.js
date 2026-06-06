const fs = require('fs');
const path = require('path');

const filePath = path.join('C:', 'Users', 'HUAWEI', 'Desktop', 'buildtrack', 'app', 'page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const startMarker = '{/* Presentation Slide Card (16:9) */}';
const endMarker = '})()}';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker, startIndex);

if (startIndex === -1 || endIndex === -1) {
  console.error("Markers not found");
  process.exit(1);
}

const newBlock = `{/* Presentation Slide Card (16:9) */}
              <div className="bg-slate-50 w-full max-w-7xl aspect-[4/3] sm:aspect-[16/9] rounded-2xl sm:rounded-[2rem] shadow-2xl flex flex-col sm:flex-row overflow-hidden border border-slate-700 max-h-full">

                {/* Left Panel: Table Summary (60%) */}
                <div className="w-full sm:w-7/12 bg-white p-4 sm:p-6 flex flex-col justify-between border-b sm:border-b-0 sm:border-r border-slate-200 shrink-0 overflow-y-auto custom-scrollbar">
                  <div>
                    {/* Header */}
                    <div className="flex justify-between items-start mb-4 border-b border-slate-100 pb-3">
                      <div>
                        <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-1">{currentPlot.id}</h2>
                        <div className={\`inline-block px-3 py-1 rounded-full font-black text-xs sm:text-sm shadow-sm \${statusInfo.status === 'delayed' ? 'bg-rose-100 text-rose-700' : statusInfo.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : statusInfo.status === 'ahead' ? 'bg-indigo-100 text-indigo-700' : statusInfo.status === 'on-track' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}\`}>
                          {statusInfo.label}
                        </div>
                      </div>
                      <div className="flex gap-3 sm:gap-6 text-right">
                        <div>
                          <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">แผน (Plan)</p>
                          <div className="text-2xl sm:text-3xl font-black text-slate-400 tracking-tighter">{statusInfo.planned}%</div>
                        </div>
                        <div>
                          <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest mb-0.5">ทำจริง (Actual)</p>
                          <div className="text-4xl sm:text-5xl font-black text-blue-600 tracking-tighter">{statusInfo.actual}%</div>
                        </div>
                      </div>
                    </div>

                    {/* Table Area */}
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
                        <h4 className="text-[11px] sm:text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <Activity size={14} className="text-indigo-500" /> สถานะงานรายงวดที่มีการอัปเดต (7 วันย้อนหลัง)
                        </h4>
                        <div className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded-md flex items-center gap-1 w-fit">
                          <Users size={12} className="text-amber-500" />
                          Foreman: {currentPlot.foreman || 'ไม่ระบุ'}
                        </div>
                      </div>

                      {plotUpdates.length > 0 ? (
                        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-xl shadow-sm">
                          <table className="w-full text-left border-collapse min-w-[500px]">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="p-2 sm:p-3 text-[9px] sm:text-[10px] font-black text-slate-500 uppercase tracking-wider w-[40%]">Task Name</th>
                                <th className="p-2 sm:p-3 text-[9px] sm:text-[10px] font-black text-slate-500 uppercase tracking-wider text-center border-l border-slate-100">Start</th>
                                <th className="p-2 sm:p-3 text-[9px] sm:text-[10px] font-black text-rose-600 uppercase tracking-wider text-center border-l border-slate-100">Duration</th>
                                <th className="p-2 sm:p-3 text-[9px] sm:text-[10px] font-black text-slate-500 uppercase tracking-wider text-center border-l border-slate-100">Finish</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                              {Array.from(new Set(plotUpdates.map((u: any) => u.action))).map((taskAction: any, tIdx) => {
                                const specificTaskUpdates = plotUpdates.filter((u: any) => u.action === taskAction);
                                const latestTaskUpdate = specificTaskUpdates[0];
                                const taskProgress = Number(latestTaskUpdate.progress) || 0;

                                const matchedAssign = assignments.slice().reverse().find(a => a.plot_id === currentPlot.id && a.task_name === taskAction);
                                const contractorName = matchedAssign ? matchedAssign.contractor_name : 'ไม่ระบุช่าง';
                                const contractorPhone = matchedAssign?.contractor_phone ? \`📞 \${matchedAssign.contractor_phone}\` : '';

                                let delayStatusStr = 'ไม่มีแผน';
                                let delayColor = 'text-slate-400 bg-slate-50 border-slate-200';

                                const planStart = matchedAssign?.start_date ? new Date(matchedAssign.start_date).toLocaleDateString('th-TH') : '-';
                                const planEnd = matchedAssign?.end_date ? new Date(matchedAssign.end_date).toLocaleDateString('th-TH') : '-';
                                const actualStart = matchedAssign?.actual_start_date ? new Date(matchedAssign.actual_start_date).toLocaleDateString('th-TH') : '-';
                                const actualEnd = matchedAssign?.actual_end_date ? new Date(matchedAssign.actual_end_date).toLocaleDateString('th-TH') : '-';

                                const calcDays = (start: string | null, end: string | null) => {
                                   if (!start || !end) return null;
                                   const s = new Date(start); s.setHours(0,0,0,0);
                                   const e = new Date(end); e.setHours(0,0,0,0);
                                   const days = Math.ceil((e.getTime() - s.getTime()) / (1000 * 3600 * 24)) + 1;
                                   return days > 0 ? days : 0;
                                };
                                const planDays = calcDays(matchedAssign?.start_date || null, matchedAssign?.end_date || null);
                                const actualDays = calcDays(matchedAssign?.actual_start_date || null, matchedAssign?.actual_end_date || null) || (matchedAssign?.actual_start_date && taskProgress < 100 ? calcDays(matchedAssign?.actual_start_date, new Date().toISOString()) : null);
                                const planDurationStr = planDays !== null ? \`\${planDays} วัน\` : '-';
                                const actualDurationStr = actualDays !== null ? \`\${actualDays} วัน\` : '-';

                                if (matchedAssign?.end_date) {
                                  const pEnd = new Date(matchedAssign.end_date);
                                  pEnd.setHours(0, 0, 0, 0);

                                  let dateToCompare = new Date();
                                  dateToCompare.setHours(0, 0, 0, 0);

                                  if (taskProgress >= 100 && matchedAssign?.actual_end_date) {
                                    dateToCompare = new Date(matchedAssign.actual_end_date);
                                    dateToCompare.setHours(0, 0, 0, 0);
                                  }

                                  const daysDiff = Math.ceil((dateToCompare.getTime() - pEnd.getTime()) / (1000 * 3600 * 24));

                                  if (daysDiff > 0) {
                                    delayStatusStr = \`ล่าช้า \${daysDiff} วัน\`;
                                    delayColor = 'text-rose-600 bg-rose-50 border-rose-200';
                                  } else if (daysDiff < 0) {
                                    delayStatusStr = \`เร็ว \${Math.abs(daysDiff)} วัน\`;
                                    delayColor = 'text-emerald-600 bg-emerald-50 border-emerald-200';
                                  } else {
                                    delayStatusStr = 'ตามแผน';
                                    delayColor = 'text-blue-600 bg-blue-50 border-blue-200';
                                  }
                                }

                                return (
                                  <tr key={tIdx} className="hover:bg-slate-50 transition-colors group">
                                    <td className="p-2 sm:p-3 align-top border-r border-slate-100">
                                      <div className="flex items-start gap-1.5 mb-1.5">
                                        <span className="bg-slate-100 text-slate-400 font-black text-[9px] px-1 py-0.5 rounded shrink-0 mt-0.5">#{tIdx + 1}</span>
                                        <span className="font-bold text-slate-800 text-[11px] sm:text-xs leading-tight line-clamp-2">{taskAction}</span>
                                      </div>
                                      <div className="flex flex-col gap-0.5 ml-5 mb-1.5">
                                        <div className="text-[9px] sm:text-[10px] font-bold text-blue-600 bg-blue-50/80 px-1 py-0.5 rounded flex items-center gap-1 w-fit">
                                          <HardHat size={10} /> {contractorName}
                                        </div>
                                        {contractorPhone && <div className="text-[8px] sm:text-[9px] text-slate-500 font-medium px-1">{contractorPhone}</div>}
                                      </div>
                                      <div className="ml-5 flex items-center gap-1.5">
                                        <div className="flex-1 bg-slate-100 rounded-full h-1 overflow-hidden">
                                          <div className="bg-indigo-500 h-1 rounded-full" style={{ width: \`\${taskProgress}%\` }}></div>
                                        </div>
                                        <span className="text-indigo-600 text-[9px] sm:text-[10px] font-black shrink-0">{taskProgress}%</span>
                                      </div>
                                      <div className="ml-5 mt-1">
                                        <span className={\`text-[8px] sm:text-[9px] font-bold border px-1 py-0.5 rounded \${delayColor}\`}>
                                          {delayStatusStr}
                                        </span>
                                      </div>
                                    </td>
                                    
                                    <td className="p-0 align-top">
                                      <div className="h-1/2 border-b border-slate-100 flex flex-col justify-center items-center py-1.5 px-1 text-center min-h-[45px] group-hover:bg-slate-50">
                                        <span className="text-[7px] font-black text-slate-400 bg-slate-100 px-1 rounded mb-0.5">PLAN:</span>
                                        <span className="text-[10px] sm:text-[11px] font-bold text-slate-700">{planStart}</span>
                                      </div>
                                      <div className="h-1/2 flex flex-col justify-center items-center py-1.5 px-1 text-center bg-indigo-50/30 group-hover:bg-indigo-50/50 min-h-[45px]">
                                        <span className="text-[7px] font-black text-blue-500 bg-blue-100 px-1 rounded mb-0.5">ACTUAL:</span>
                                        <span className="text-[10px] sm:text-[11px] font-black text-blue-700">{actualStart}</span>
                                      </div>
                                    </td>

                                    <td className="p-0 align-top border-x border-slate-100">
                                      <div className="h-1/2 border-b border-slate-100 flex flex-col justify-center items-center py-1.5 px-1 text-center min-h-[45px] group-hover:bg-slate-50">
                                        <span className="text-[10px] sm:text-[11px] font-bold text-slate-700">{planDurationStr}</span>
                                      </div>
                                      <div className="h-1/2 flex flex-col justify-center items-center py-1.5 px-1 text-center bg-indigo-50/30 group-hover:bg-indigo-50/50 min-h-[45px]">
                                        <span className="text-[10px] sm:text-[11px] font-black text-blue-700">{actualDurationStr}</span>
                                      </div>
                                    </td>

                                    <td className="p-0 align-top">
                                      <div className="h-1/2 border-b border-slate-100 flex flex-col justify-center items-center py-1.5 px-1 text-center min-h-[45px] group-hover:bg-slate-50">
                                        <span className="text-[10px] sm:text-[11px] font-bold text-slate-700">{planEnd}</span>
                                      </div>
                                      <div className="h-1/2 flex flex-col justify-center items-center py-1.5 px-1 text-center bg-indigo-50/30 group-hover:bg-indigo-50/50 min-h-[45px]">
                                        <span className="text-[10px] sm:text-[11px] font-black text-blue-700">{actualEnd}</span>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="bg-slate-50 border border-slate-200 p-6 rounded-xl text-slate-400 italic text-sm font-medium flex flex-col items-center justify-center gap-2 min-h-[200px]">
                          <Clock size={32} className="opacity-50" />
                          สัปดาห์นี้ยังไม่มีบันทึกรายงานสถานะงาน
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-slate-100 shrink-0">
                    <p className="text-[10px] sm:text-xs text-slate-400 font-bold flex items-center justify-between">
                      <span>อัปเดตล่าสุด: {new Date().toLocaleDateString('th-TH')}</span>
                      <span className="flex items-center gap-1 text-slate-300"><Monitor size={12} /> BuildTrack Schedule</span>
                    </p>
                  </div>
                </div>

                {/* Right Panel: Image Gallery (40%) */}
                <div className="w-full sm:w-5/12 bg-slate-900 p-4 sm:p-6 flex flex-col relative overflow-y-auto custom-scrollbar border-t sm:border-t-0 sm:border-l border-slate-800">
                  <h3 className="font-black text-white/90 mb-4 flex items-center gap-2 text-base sm:text-lg shrink-0"><Camera className="text-slate-400" /> รูปล่าสุดหน้างาน (Max 6)</h3>
                  {plotImages.length > 0 ? (
                    <div className="flex-1 flex flex-col">
                      <div className="grid grid-cols-2 gap-2 sm:gap-3 auto-rows-max">
                        {plotImages.slice(0, 6).map((img: any, idx: number) => (
                          <div key={idx} className="relative bg-black rounded-xl overflow-hidden aspect-square group shadow-lg border border-slate-700">
                            <img
                              src={img.url}
                              onClick={() => setFullImageUrl(img.url)}
                              className="w-full h-full object-cover opacity-80 transition-transform duration-700 group-hover:scale-110 group-hover:opacity-100 cursor-zoom-in"
                              alt={img.action}
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2 sm:p-3 pt-10 pointer-events-none">
                              <p className="text-white font-black text-[9px] sm:text-[10px] drop-shadow-md truncate mb-0.5 shadow-black">📂 {img.action}</p>
                              <p className="text-white/60 font-bold text-[8px] sm:text-[9px] text-right">{new Date(img.date).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-800/50 rounded-2xl border border-dashed border-slate-700 min-h-[250px]">
                      <ImageIcon size={48} className="text-slate-600 mb-3" />
                      <p className="text-slate-400 font-bold text-xs sm:text-sm">ยังไม่มีรูปถ่ายความคืบหน้า</p>
                    </div>
                  )}
                </div>

              </div>
            `;

content = content.substring(0, startIndex) + newBlock + '\n          ' + content.substring(endIndex);
fs.writeFileSync(filePath, content, 'utf8');
console.log("Successfully replaced Presentation Mode UI block.");
