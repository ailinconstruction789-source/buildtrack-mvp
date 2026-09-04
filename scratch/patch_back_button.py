import os

file_path = r"app\page.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace mobile back button
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


# Replace desktop back button
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

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patched successfully")
