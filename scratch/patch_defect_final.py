import os
import re

file_path = r"app\page.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add imports
content = content.replace(
    "const TaskProgressView = dynamic(() => import('@/components/TaskProgressView'));",
    "const TaskProgressView = dynamic(() => import('@/components/TaskProgressView'));\nconst DefectProgressView = dynamic(() => import('@/components/DefectProgressView'));"
)

# 2. Add states (selectedDefect, defectReturnView)
content = content.replace(
    "const [taskReturnView, setTaskReturnView] = useState('house-detail');",
    "const [taskReturnView, setTaskReturnView] = useState('house-detail');\n  const [defectReturnView, setDefectReturnView] = useState('dashboard');\n  const [selectedDefect, setSelectedDefect] = useState<any>(null);"
)

# 3. Add mobile back button
old_mobile = """                       <button onClick={() => {
                          if (view === 'project-detail') { setView('dashboard'); setSelectedProject(null); }
                          else if (view === 'house-detail') setView('project-detail');
                          else if (view === 'task-progress') setView(taskReturnView);
                       }} className="text-white flex items-center gap-1.5 font-bold text-xs sm:text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors">"""

new_mobile = """                       <button onClick={() => {
                          if (view === 'project-detail') { setView('dashboard'); setSelectedProject(null); }
                          else if (view === 'house-detail') setView('project-detail');
                          else if (view === 'task-progress') setView(taskReturnView);
                          else if (view === 'defect-progress') setView(defectReturnView);
                       }} className="text-white flex items-center gap-1.5 font-bold text-xs sm:text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors">"""
content = content.replace(old_mobile, new_mobile)

# 4. Add desktop back button
old_desktop = """                   {view === 'task-progress' && (
                      <button onClick={() => setView(taskReturnView)} className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1.5 hover:-translate-x-1 transition-transform">
                        <ArrowLeft size={16}/> BACK TO {taskReturnView === 'dashboard' ? 'DASHBOARD' : 'PLOT'}
                      </button>
                   )}
                </div>"""

new_desktop = """                   {view === 'task-progress' && (
                      <button onClick={() => setView(taskReturnView)} className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1.5 hover:-translate-x-1 transition-transform">
                        <ArrowLeft size={16}/> BACK TO {taskReturnView === 'dashboard' ? 'DASHBOARD' : 'PLOT'}
                      </button>
                   )}
                   {view === 'defect-progress' && (
                      <button onClick={() => setView(defectReturnView)} className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1.5 hover:-translate-x-1 transition-transform">
                        <ArrowLeft size={16}/> BACK TO {defectReturnView === 'dashboard' ? 'DASHBOARD' : 'PLOT'}
                      </button>
                   )}
                </div>"""
content = content.replace(old_desktop, new_desktop)

# 5. Add DefectProgressView rendering block right after TaskProgressView
# It's at the end of TaskProgressView
old_task_render = """                    handleAdminUndoLatest={handleAdminUndoLatest}
                    handleAdminResetToZero={handleAdminResetToZero}
                  />
                )}"""

new_defect_render = """                    handleAdminUndoLatest={handleAdminUndoLatest}
                    handleAdminResetToZero={handleAdminResetToZero}
                  />
                )}
                
              {/* 🚧 LEVEL 4: Defect Progress View (Inside Modal/Same Page) 🚧 */}
              {view === 'defect-progress' && selectedDefect && (
                <DefectProgressView
                  view={view} setView={setView} defectReturnView={defectReturnView}
                  isMobileLayout={isMobileLayout} selectedDefect={selectedDefect} selectedPlot={selectedPlot}
                  setProgressValue={setProgressValue} progressValue={progressValue} isSending={isSending}
                  setFullImageUrl={setFullImageUrl} handleDeleteDefectUpdate={handleDeleteDefectUpdate}
                  setExportModalOpen={setExportModalOpen}
                  isProjectPlanner={isProjectPlanner} isAdmin={isAdmin} currentUserRole={currentUserRole}
                  updates={defectUpdates} setUpdates={setDefectUpdates}
                  inputText={inputText} setInputText={setInputText}
                  selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles}
                  isTaskCompleted={selectedDefect.status === 'resolved'}
                  handleOpenExportModal={() => setExportModalOpen(true)}
                  defects={defects} loggedInUser={loggedInUser}
                  isLockedForForeman={isLockedForForeman} isSiteEngineer={isSiteEngineer} isPendingSE={isPendingSE}
                  handleReviewAction={handleReviewAction} isQC={isQC} isPendingQC={isPendingQC}
                  isProcurement={isProcurement} isOwner={isOwner}
                  handleSendPost={handleSendDefectPost}
                  handleAdminUndoLatest={handleAdminUndoLatest}
                  handleAdminResetToZero={handleAdminResetToZero}
                />
              )}"""
content = content.replace(old_task_render, new_defect_render)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)
print("Complete!")
