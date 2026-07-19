$content = Get-Content -Raw C:\Users\HUAWEI\Desktop\buildtrack\app\page.tsx

$target1 = @"
                              const planStart = matchedAssign?.start_date ? new Date(matchedAssign.start_date).toLocaleDateString('th-TH') : '-';
                              const planEnd = matchedAssign?.end_date ? new Date(matchedAssign.end_date).toLocaleDateString('th-TH') : '-';
                              const actualStart = matchedAssign?.actual_start_date ? new Date(matchedAssign.actual_start_date).toLocaleDateString('th-TH') : '-';
                              const actualEnd = matchedAssign?.actual_end_date ? new Date(matchedAssign.actual_end_date).toLocaleDateString('th-TH') : '-';

                              if (matchedAssign?.end_date) {
"@

$replacement1 = @"
                              const planStart = matchedAssign?.start_date ? new Date(matchedAssign.start_date).toLocaleDateString('th-TH') : '-';
                              const planEnd = matchedAssign?.end_date ? new Date(matchedAssign.end_date).toLocaleDateString('th-TH') : '-';
                              const actualStart = matchedAssign?.actual_start_date ? new Date(matchedAssign.actual_start_date).toLocaleDateString('th-TH') : '-';
                              const actualEnd = matchedAssign?.actual_end_date ? new Date(matchedAssign.actual_end_date).toLocaleDateString('th-TH') : '-';

                              const calcDays = (start, end) => {
                                 if (!start || !end) return null;
                                 const s = new Date(start); s.setHours(0,0,0,0);
                                 const e = new Date(end); e.setHours(0,0,0,0);
                                 const days = Math.ceil((e.getTime() - s.getTime()) / (1000 * 3600 * 24)) + 1;
                                 return days > 0 ? days : 0;
                              };
                              const planDays = calcDays(matchedAssign?.start_date, matchedAssign?.end_date);
                              const actualDays = calcDays(matchedAssign?.actual_start_date, matchedAssign?.actual_end_date) || (matchedAssign?.actual_start_date && taskProgress < 100 ? calcDays(matchedAssign?.actual_start_date, new Date().toISOString()) : null);
                              const planDurationStr = planDays !== null ? `${planDays} วัน` : '-';
                              const actualDurationStr = actualDays !== null ? `${actualDays} วัน` : '-';

                              if (matchedAssign?.end_date) {
"@

$target2 = @"
                                  {/* ข้อมูลวันที่ */}
                                  <div className="grid grid-cols-2 gap-2 text-[10px] sm:text-xs bg-slate-50 p-2 rounded-lg border border-slate-100">
                                    <div>
                                      <p className="text-slate-400 font-bold mb-0.5">วันที่ตามแผน (Plan)</p>
                                      <p className="font-black text-slate-600">{planStart} - {planEnd}</p>
                                    </div>
                                    <div>
                                      <p className="text-slate-400 font-bold mb-0.5">วันที่ทำจริง (Actual)</p>
                                      <p className="font-black text-indigo-700">{actualStart} - {actualEnd}</p>
                                    </div>
                                  </div>
"@

$replacement2 = @"
                                  {/* ข้อมูลวันที่ */}
                                  <div className="grid grid-cols-2 gap-2 text-[10px] sm:text-xs bg-slate-50 p-2 sm:p-3 rounded-lg border border-slate-200">
                                    <div className="border-r border-slate-200 pr-2">
                                      <p className="text-slate-400 font-bold mb-1">📅 แผน (Plan)</p>
                                      <p className="font-black text-slate-600 mb-0.5">{planStart} - {planEnd}</p>
                                      <p className="text-[9px] sm:text-[10px] font-bold text-slate-500">ระยะเวลา: <span className="text-slate-700">{planDurationStr}</span></p>
                                    </div>
                                    <div className="pl-1">
                                      <p className="text-indigo-400 font-bold mb-1">🚀 ทำจริง (Actual)</p>
                                      <p className="font-black text-indigo-700 mb-0.5">{actualStart} - {actualEnd}</p>
                                      <p className="text-[9px] sm:text-[10px] font-bold text-indigo-500">ใช้เวลา: <span className="text-indigo-800">{actualDurationStr}</span></p>
                                    </div>
                                  </div>
"@

$content = $content.Replace($target1.Replace("`r`n", "`n"), $replacement1.Replace("`r`n", "`n"))
$content = $content.Replace($target2.Replace("`r`n", "`n"), $replacement2.Replace("`r`n", "`n"))

Set-Content C:\Users\HUAWEI\Desktop\buildtrack\app\page.tsx -Value $content
Write-Host "Duration Replacement Done."
