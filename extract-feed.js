const fs = require('fs');

const componentContent = `import React from 'react';
import { Activity, Loader2 } from 'lucide-react';

interface GlobalTimelineFeedProps {
  view: string;
  allUpdatesRecord: any[];
  taskTemplates: any[];
  plots: any[];
  visibleFeedCount: number;
  observerTargetRef: React.RefObject<HTMLDivElement>;
  setFullImageUrl: (url: string) => void;
}

export default function GlobalTimelineFeed({
  view,
  allUpdatesRecord,
  taskTemplates,
  plots,
  visibleFeedCount,
  observerTargetRef,
  setFullImageUrl
}: GlobalTimelineFeedProps) {
  if (view !== 'global-feed') return null;

  return (
    <div className="animate-in fade-in zoom-in-95 duration-500 max-w-[900px] mx-auto pb-12">
      <div className="mb-6 sm:mb-8 border-b border-outline-variant pb-4">
        <h2 className="text-headline-lg font-headline-lg font-bold text-primary flex items-center gap-xs uppercase">
          <span className="material-symbols-outlined text-[32px] text-secondary">history</span> Site Activity Live Feed
        </h2>
        <p className="text-body-sm font-body-sm text-on-surface-variant uppercase tracking-widest mt-1 font-bold">ไทม์ไลน์รวมการรายงานแบบ Real-time จากทุกแปลงงาน</p>
      </div>

      <div className="space-y-4 sm:space-y-6">
        {(!allUpdatesRecord || allUpdatesRecord.length === 0) ? (
          <div className="bg-surface-container-lowest rounded-xl border border-dashed border-outline-variant p-12 text-center text-on-surface-variant font-body-md italic">
            ยังไม่มีประวัติการรายงานงานในระบบย่อยนี้
          </div>
        ) : (
          <div className="space-y-md relative before:absolute before:inset-0 before:ml-[15px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-1 before:bg-gradient-to-b before:from-transparent before:via-outline-variant before:to-transparent pt-4">
            {allUpdatesRecord.slice(0, visibleFeedCount).map((update: any, index: number) => {
              const task = taskTemplates.find(t => t.id === update.task_template_id);
              const taskName = task ? task.task_name : update.action;
              const currentPlotInfo = plots.find(p => String(p.id) === String(update.plot_id));
              const projectNameText = currentPlotInfo ? currentPlotInfo.project_name : 'ไม่ระบุโครงการ';
              
              // Alternating layout for desktop timeline
              const isEven = index % 2 === 0;

              return (
                <div key={update.id} className={\`relative flex items-center justify-between md:justify-normal group is-active \${isEven ? 'md:flex-row-reverse' : ''}\`}>
                  
                  {/* Timeline Node */}
                  <div className={\`flex items-center justify-center w-8 h-8 rounded-full border-2 border-surface-container-lowest \${update.role === 'QC' ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-primary text-on-primary'} shadow-sm shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10\`}>
                    <span className="material-symbols-outlined text-[16px]">
                      {update.action === 'แจ้ง Defect / ซ่อม' ? 'build' : update.role === 'QC' ? 'fact_check' : 'update'}
                    </span>
                  </div>
                  
                  {/* Card Content */}
                  <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] p-md rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow">
                    
                    {/* Header */}
                    <div className="flex items-center justify-between mb-sm flex-wrap gap-2">
                      <div className="flex gap-2 items-center flex-wrap">
                        <span className="bg-secondary-container text-on-secondary-container font-label-caps text-label-caps px-2 py-1 rounded shadow-sm shrink-0 flex items-center gap-1 uppercase">
                          <span className="material-symbols-outlined text-[12px]">domain</span> {projectNameText}
                        </span>
                        <span className="bg-surface-container-highest text-on-surface font-label-caps text-label-caps px-2 py-1 rounded shadow-sm shrink-0 uppercase">
                          Plot {update.plot_id}
                        </span>
                      </div>
                      <span className="bg-primary-fixed text-primary font-data-mono text-[11px] px-2 py-1 rounded-lg">
                        {update.progress}%
                      </span>
                    </div>

                    <h4 className="font-body-md text-body-md font-bold text-on-surface mb-md">
                      {taskName}
                    </h4>

                    {/* Reporter & Time */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-outline-variant mb-md">
                      <div className="flex items-center gap-sm">
                        <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center text-on-surface font-black text-sm border border-outline-variant shrink-0">
                          {update.user_name?.charAt(0) || 'U'}
                        </div>
                        <div>
                          <span className="font-body-sm font-bold text-on-surface flex items-center gap-xs">
                            {update.user_name}
                            <span className={\`text-label-caps px-1.5 py-0.5 rounded uppercase \${update.role === 'QC' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : update.role === 'Site Engineer' ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-highest text-on-surface-variant'}\`}>
                              {update.role}
                            </span>
                          </span>
                          <p className="text-[11px] text-on-surface-variant font-data-mono mt-0.5">
                            {new Date(update.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} • {new Date(update.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>

                      {update.weather_info && (
                        <div className="text-label-caps text-primary bg-primary-fixed border border-primary-fixed-dim px-2.5 py-1 rounded flex items-center gap-1.5 w-fit" title="Weather">
                          <span className="material-symbols-outlined text-[14px]">cloud</span> {update.weather_info}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <p className="text-body-sm font-body-sm text-on-surface-variant bg-surface-container-low p-3 rounded border border-outline-variant/50">
                      {update.text_content || 'No details provided.'}
                    </p>

                    {/* Images */}
                    {update.image_url && (
                      <div className={\`mt-md grid gap-2 \${update.image_url.split(',').filter((u: string) => u.trim() !== '').length > 1 ? 'grid-cols-2' : 'grid-cols-1'}\`}>
                        {update.image_url.split(',').filter((u: string) => u.trim() !== '').map((url: any, i: any) => (
                          <img
                            key={i}
                            src={url.trim()}
                            onClick={() => setFullImageUrl(url.trim())}
                            className="w-full h-40 object-cover rounded border border-outline-variant cursor-zoom-in hover:opacity-90 transition-opacity"
                            alt="Report"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            
            {allUpdatesRecord.length > visibleFeedCount && (
              <div ref={observerTargetRef} className="py-6 flex justify-center items-center relative z-20">
                <span className="bg-surface-container text-on-surface-variant text-label-caps px-4 py-2 rounded-full flex items-center gap-2 border border-outline-variant shadow-sm uppercase font-bold">
                  <Loader2 size={14} className="animate-spin" /> Loading more...
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
`;

fs.writeFileSync('components/GlobalTimelineFeed.tsx', componentContent, 'utf8');

// Now replace it in app/page.tsx
const pageFile = 'app/page.tsx';
let pageContent = fs.readFileSync(pageFile, 'utf8');

// Remove the old block (lines 1478 to 1592)
const lines = pageContent.split('\\n');
const replacementStr = \`              {/* 📜 🌟 View: Global Timeline Feed */}
              <GlobalTimelineFeed
                view={view}
                allUpdatesRecord={allUpdatesRecord}
                taskTemplates={taskTemplates}
                plots={plots}
                visibleFeedCount={visibleFeedCount}
                observerTargetRef={observerTargetRef}
                setFullImageUrl={setFullImageUrl}
              />\`;

lines.splice(1477, 1592 - 1477 + 1, replacementStr);

// Add import
const importStr = "import GlobalTimelineFeed from '@/components/GlobalTimelineFeed';";
if (!lines.includes(importStr)) {
  lines.splice(8, 0, importStr);
}

fs.writeFileSync(pageFile, lines.join('\\n'), 'utf8');
console.log('GlobalTimelineFeed extracted and redesigned successfully!');
