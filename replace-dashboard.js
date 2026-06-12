const fs = require('fs');

const targetFile = 'components/DashboardOverview.tsx';

const newContent = `import React from 'react';
import { supabase } from '@/lib/supabase';

interface DashboardOverviewProps {
  view: string;
  setView: (v: string) => void;
  isSiteEngineer: boolean;
  isQC: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  isForeman: boolean;
  isProcurement: boolean;
  isProjectPlanner: boolean;
  isMobileLayout: boolean;
  projects: any[];
  plots: any[];
  taskTemplates: any[];
  loggedInUser: any;
  inspectionQueue: any[];
  inspectionFilterTab: string;
  setInspectionFilterTab: (t: string) => void;
  inspectionViewMode: string;
  setInspectionViewMode: (m: string) => void;
  inspectionSort: string;
  setInspectionSort: (s: string) => void;
  activePlotsCount: number;
  completedPlotsCount: number;
  delayedPlotsCount: number;
  setSelectedProject: (p: any) => void;
  setSelectedPlot: (p: any) => void;
  setSelectedTask: (t: any) => void;
  setTaskReturnView: (v: string) => void;
  setUpdates: (u: any[]) => void;
  setProgressValue: (v: number) => void;
  setMapGrid: (g: any[]) => void;
  setIsEditMapMode: (b: boolean) => void;
  setGridCols: (c: number) => void;
  setGridRows: (r: number) => void;
  setMapZoom: (z: number) => void;
  handleEditProject: (p: any) => void;
}

export default function DashboardOverview({
  view, setView,
  isSiteEngineer, isQC, isAdmin, isOwner, isForeman, isProcurement, isProjectPlanner,
  isMobileLayout,
  projects, plots, taskTemplates, loggedInUser,
  inspectionQueue,
  activePlotsCount, completedPlotsCount, delayedPlotsCount,
  setSelectedProject, setSelectedPlot, setSelectedTask, setTaskReturnView,
  setMapGrid, setIsEditMapMode,
  setGridCols, setGridRows, setMapZoom,
  handleEditProject
}: DashboardOverviewProps) {
  if (view !== 'dashboard') return null;

  const avgProgress = projects.length > 0 
    ? Math.round(projects.reduce((acc, p) => acc + (p.progress || 0), 0) / projects.length) 
    : 0;

  return (
    <div className="max-w-[1600px] mx-auto space-y-md animate-in fade-in zoom-in-95 duration-500 pb-12">
      
      {/* 🌟 Top Admin Actions (Mobile only or specific roles) */}
      {(isAdmin || isProcurement) && isMobileLayout && (
        <div className="flex flex-wrap gap-2 mb-4 shrink-0 w-full">
          {isProcurement && (<button onClick={() => setView('procurement-contractors')} className="flex-1 items-center justify-center gap-1.5 bg-tertiary text-on-tertiary px-3 py-2.5 rounded-lg font-bold text-label-caps shadow-elevation-1 flex"><span className="material-symbols-outlined text-[14px]">engineering</span> Contractors</button>)}
          {isAdmin && (
            <>
              <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className="flex-1 items-center justify-center gap-1.5 bg-surface text-primary border border-outline-variant px-2 py-2.5 rounded-lg font-bold text-label-caps shadow-elevation-1 flex whitespace-nowrap"><span className="material-symbols-outlined text-[14px]">group</span> Users</button>
              <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className="flex-1 items-center justify-center gap-1.5 bg-primary text-on-primary px-2 py-2.5 rounded-lg font-bold text-label-caps shadow-elevation-1 flex whitespace-nowrap"><span className="material-symbols-outlined text-[14px]">add_circle</span> Project</button>
            </>
          )}
        </div>
      )}

      {/* Metrics Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-sm">
        {/* Metric 1: Overall Progress */}
        <div className="bg-surface-container-lowest rounded-xl p-md border border-outline-variant shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-sm">
            <div>
              <p className="text-body-sm font-body-sm text-on-surface-variant">Overall Progress</p>
              <h3 className="text-headline-lg font-headline-lg text-primary mt-base">{avgProgress}%</h3>
            </div>
            <span className="material-symbols-outlined text-primary bg-primary-fixed rounded-full p-xs">trending_up</span>
          </div>
          <div className="w-full bg-surface-variant rounded-full h-2 overflow-hidden">
            <div className="bg-primary h-full rounded-full transition-all duration-1000" style={{ width: \`\${avgProgress}%\` }}></div>
          </div>
          <p className="text-body-sm font-body-sm text-on-surface-variant mt-xs">Across {projects.length} projects</p>
        </div>

        {/* Metric 2: Active Units */}
        <div className="bg-surface-container-lowest rounded-xl p-md border border-outline-variant shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-sm">
            <div>
              <p className="text-body-sm font-body-sm text-on-surface-variant">Active Plots</p>
              <h3 className="text-headline-lg font-headline-lg text-primary mt-base">{activePlotsCount}</h3>
            </div>
            <span className="material-symbols-outlined text-secondary bg-secondary-fixed rounded-full p-xs">home_work</span>
          </div>
          <div className="flex items-center gap-xs">
            <span className="px-xs py-base bg-surface-container text-on-surface text-label-caps font-label-caps rounded flex items-center gap-1"><span className="material-symbols-outlined text-[12px] text-emerald-500">check_circle</span> {completedPlotsCount} Completed</span>
          </div>
        </div>

        {/* Metric 3: Delayed Plots */}
        <div className="bg-surface-container-lowest rounded-xl p-md border border-outline-variant shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-sm">
            <div>
              <p className="text-body-sm font-body-sm text-on-surface-variant">Delayed Plots</p>
              <h3 className={\`text-headline-lg font-headline-lg mt-base font-data-mono \${delayedPlotsCount > 0 ? 'text-secondary-container' : 'text-primary'}\`}>{delayedPlotsCount}</h3>
            </div>
            <span className={\`material-symbols-outlined rounded-full p-xs \${delayedPlotsCount > 0 ? 'text-secondary-container bg-secondary-fixed' : 'text-primary bg-primary-fixed'}\`}>schedule_warning</span>
          </div>
          <div className="flex items-center gap-xs">
            {delayedPlotsCount > 0 ? (
              <span className="px-xs py-base bg-error-container text-on-error-container text-label-caps font-label-caps rounded-full flex items-center gap-base">
                <span className="material-symbols-outlined text-[14px]">warning</span> Action Needed
              </span>
            ) : (
              <span className="px-xs py-base bg-surface-container text-on-surface text-label-caps font-label-caps rounded flex items-center gap-1">On Track</span>
            )}
          </div>
        </div>

        {/* Metric 4: QC Pending */}
        <div className="bg-surface-container-lowest rounded-xl p-md border border-outline-variant shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-sm">
            <div>
              <p className="text-body-sm font-body-sm text-on-surface-variant">QC Pending</p>
              <h3 className="text-headline-lg font-headline-lg text-primary mt-base">{inspectionQueue.length}</h3>
            </div>
            <span className="material-symbols-outlined text-primary bg-primary-fixed rounded-full p-xs">fact_check</span>
          </div>
          <div className="space-y-base">
            <div className="flex justify-between text-body-sm font-body-sm text-on-surface-variant">
              <span>Urgent (>24h)</span> 
              <span className="font-data-mono text-error font-bold">{inspectionQueue.filter(q => (Date.now() - q.time) > 86400000).length}</span>
            </div>
            <div className="flex justify-between text-body-sm font-body-sm text-on-surface-variant">
              <span>Standard</span> 
              <span className="font-data-mono font-bold">{inspectionQueue.filter(q => (Date.now() - q.time) <= 86400000).length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-md">
        
        {/* Left Column (Wider) */}
        <div className="lg:col-span-2 space-y-md">
          
          {/* Projects Portfolio Widget */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden flex flex-col">
            <div className="p-sm border-b border-outline-variant flex justify-between items-center bg-surface-container-lowest z-10">
              <h3 className="text-body-md font-body-md font-bold text-on-surface flex items-center gap-xs">
                <span className="material-symbols-outlined">domain</span> Projects Portfolio
              </h3>
              <div className="flex gap-xs">
                <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className="px-sm py-xs text-label-caps font-label-caps text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors border border-outline-variant">Filter</button>
              </div>
            </div>
            <div className="p-sm bg-surface-container-low grid gap-sm sm:grid-cols-2">
              {projects.map((proj) => (
                <div key={proj.name} onClick={() => { 
                    const conf = proj.layout_data?.find((c: any) => c.type === 'config');
                    setGridCols(conf?.cols || 40); setGridRows(conf?.rows || 24); setMapZoom(1);
                    setSelectedProject(proj); setMapGrid(proj.layout_data?.filter((c: any) => c.type !== 'config') || []); setIsEditMapMode(false); setView('project-detail'); 
                }} className="bg-surface-container-lowest p-md rounded-xl border border-outline-variant hover:border-primary hover:shadow-md transition-all cursor-pointer relative group">
                  {isAdmin && (
                    <button onClick={(e) => { e.stopPropagation(); handleEditProject(proj); }} className="absolute top-2 right-2 p-1.5 bg-surface-container text-on-surface-variant rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary hover:text-on-primary transition-all z-20" title="Edit Project">
                      <span className="material-symbols-outlined text-[18px]">settings</span>
                    </button>
                  )}
                  <div className="flex items-center gap-sm mb-md">
                    <div className="w-12 h-12 rounded-lg bg-primary-fixed text-primary flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[24px]">architecture</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-body-md text-on-surface line-clamp-1">{proj.name}</h4>
                      <p className="text-body-sm font-body-sm text-on-surface-variant flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">map</span> {isForeman ? \`Assigned: \${plots.filter(p => p.project_name === proj.name && p.foreman === loggedInUser?.username).length} plots\` : \`Total \${proj.plotCount || plots.filter(p => p.project_name === proj.name).length} plots\`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-xs">
                    <span className="text-label-caps font-label-caps text-on-surface-variant uppercase">Progress</span>
                    <span className="text-label-caps font-label-caps font-bold text-primary">{proj.progress || 0}%</span>
                  </div>
                  <div className="w-full bg-surface-variant rounded-full h-1.5 overflow-hidden">
                    <div className="bg-primary h-full rounded-full transition-all duration-1000" style={{ width: \`\${proj.progress || 0}%\` }}></div>
                  </div>
                </div>
              ))}
              {projects.length === 0 && (
                <div className="col-span-full py-12 text-center text-on-surface-variant font-body-md border-2 border-dashed border-outline-variant rounded-xl">
                  No projects available.
                </div>
              )}
            </div>
          </div>

          {/* Gantt Chart Preview */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm p-md">
            <h3 className="text-body-md font-body-md font-bold text-on-surface mb-sm flex items-center gap-xs">
              <span className="material-symbols-outlined">calendar_view_week</span> Upcoming Milestones <span className="text-label-caps font-normal text-on-surface-variant ml-2">(Preview)</span>
            </h3>
            <div className="relative pt-xs overflow-x-auto">
              <div className="min-w-[500px]">
                {/* Timeline Header */}
                <div className="flex text-label-caps font-label-caps text-on-surface-variant mb-xs border-b border-outline-variant pb-xs">
                  <div className="w-1/3">Task Template</div>
                  <div className="w-2/3 flex justify-between px-xs" style={{ backgroundImage: 'linear-gradient(to right, #e0e3e5 1px, transparent 1px)', backgroundSize: '20% 100%' }}>
                    <span>Wk 1</span><span>Wk 2</span><span>Wk 3</span><span>Wk 4</span><span>Wk 5</span>
                  </div>
                </div>
                {/* Timeline Rows (Mocked with TaskTemplates) */}
                <div className="space-y-xs">
                  {taskTemplates.slice(0, 4).map((task, idx) => (
                    <div key={task.id} className="flex items-center h-8">
                      <div className="w-1/3 text-body-sm font-body-sm text-on-surface truncate pr-2" title={task.task_name}>{task.task_name}</div>
                      <div className="w-2/3 relative h-full" style={{ backgroundImage: 'linear-gradient(to right, #e0e3e5 1px, transparent 1px)', backgroundSize: '20% 100%' }}>
                        <div className={\`absolute h-5 rounded-md shadow-sm top-1.5 \${['bg-primary', 'bg-secondary-container', 'bg-tertiary', 'bg-surface-variant border border-outline-variant'][idx % 4]}\`} style={{ left: \`\${(idx * 15) % 40}%\`, width: \`\${20 + (idx * 10) % 30}%\` }}></div>
                      </div>
                    </div>
                  ))}
                  {taskTemplates.length === 0 && (
                    <div className="text-center text-on-surface-variant py-4 text-sm">No task templates defined.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column (Narrower) */}
        <div className="space-y-md">
          
          {/* Action Required Card (Inspection Queue) */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm p-md">
            <h3 className="text-body-md font-body-md font-bold text-on-surface mb-sm flex items-center gap-xs">
              <span className="material-symbols-outlined text-error">warning</span> Action Required
            </h3>
            
            {inspectionQueue.length > 0 ? (
              <ul className="space-y-sm max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                {inspectionQueue.slice(0, 5).sort((a,b) => a.time - b.time).map((q: any) => {
                  const waitTime = Date.now() - q.time;
                  const isCritical = waitTime > 86400000;
                  
                  const relatedProject = projects.find(p => p.name === q.project_name); 
                  const relatedPlot = plots.find(p => p.id === q.plot_id); 
                  const relatedTask = taskTemplates.find(t => t.id === q.task_template_id);
                  const clickAction = () => { setSelectedProject(relatedProject); setSelectedPlot(relatedPlot); setSelectedTask(relatedTask); setTaskReturnView('dashboard'); setView('task-progress'); };

                  return (
                    <li key={q.id || \`\${q.plot_id}-\${q.task_template_id}\`} className={\`p-sm bg-surface-container rounded-lg border-l-4 \${isCritical ? 'border-error' : 'border-secondary-container'}\`}>
                      <div className="flex justify-between items-start gap-2">
                        <p className="text-body-sm font-body-sm font-bold text-on-surface line-clamp-1" title={q.task_name}>{q.task_name}</p>
                        <span className={\`text-label-caps font-label-caps px-2 py-1 rounded shrink-0 \${isCritical ? 'text-error bg-error-container' : 'text-secondary-container bg-secondary-fixed'}\`}>
                          Plot {q.plot_id}
                        </span>
                      </div>
                      <p className="text-body-sm font-body-sm text-on-surface-variant mt-xs line-clamp-1">Waiting for {q.statusFor}</p>
                      <button onClick={clickAction} className="mt-sm text-body-sm font-body-sm text-primary hover:underline font-medium flex items-center gap-1">Review Inspection <span className="material-symbols-outlined text-[14px]">arrow_forward</span></button>
                    </li>
                  )
                })}
                {inspectionQueue.length > 5 && (
                  <button onClick={() => setView('defects')} className="w-full mt-sm py-xs text-body-sm font-body-sm text-primary border border-outline-variant rounded hover:bg-surface-container transition-colors font-bold">
                    View All {inspectionQueue.length} Pending
                  </button>
                )}
              </ul>
            ) : (
              <div className="bg-surface-container rounded-lg p-md text-center">
                <span className="material-symbols-outlined text-[32px] text-emerald-500 mb-2">check_circle</span>
                <p className="text-body-sm font-bold text-on-surface">All caught up!</p>
                <p className="text-body-sm text-on-surface-variant mt-1">No pending inspections.</p>
              </div>
            )}
          </div>

          {/* Recent Activity List */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm p-md hidden sm:block">
            <h3 className="text-body-md font-body-md font-bold text-on-surface mb-sm flex items-center gap-xs">
              <span className="material-symbols-outlined">history</span> Recent Activity
            </h3>
            <div className="space-y-sm relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-outline-variant before:to-transparent">
              
              <div className="relative flex items-center justify-between group is-active pl-8">
                <div className="absolute left-0 flex items-center justify-center w-6 h-6 rounded-full border border-surface-container-lowest bg-primary-fixed text-primary shadow z-10">
                  <span className="material-symbols-outlined text-[14px]">done</span>
                </div>
                <div className="w-full p-xs rounded border border-outline-variant bg-surface-container-lowest shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-body-sm text-body-sm font-bold text-on-surface">System Online</div>
                    <div className="font-label-caps text-label-caps text-on-surface-variant">Just now</div>
                  </div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant">UI successfully upgraded to ConstructMaster AI Design System.</div>
                </div>
              </div>

              <div className="relative flex items-center justify-between group is-active pl-8">
                <div className="absolute left-0 flex items-center justify-center w-6 h-6 rounded-full border border-surface-container-lowest bg-surface-container-highest text-on-surface-variant shadow z-10">
                  <span className="material-symbols-outlined text-[14px]">edit_document</span>
                </div>
                <div className="w-full p-xs rounded border border-outline-variant bg-surface-container-lowest shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-body-sm text-body-sm font-bold text-on-surface">Welcome</div>
                    <div className="font-label-caps text-label-caps text-on-surface-variant">Today</div>
                  </div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant">Welcome back, {loggedInUser?.username || 'User'}!</div>
                </div>
              </div>

            </div>
            <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className="w-full mt-sm py-xs text-body-sm font-body-sm text-primary border border-outline-variant rounded hover:bg-surface-container transition-colors">View All Activity</button>
          </div>

        </div>
      </div>
    </div>
  );
}
`;

fs.writeFileSync(targetFile, newContent, 'utf8');
console.log('DashboardOverview replaced successfully!');
