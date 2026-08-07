import React from 'react';
import { PlusCircle, Loader2 } from 'lucide-react';

interface AdminProjectViewProps {
  setView: (view: string) => void;
  setSelectedProject: (project: any) => void;
  isMobileLayout: boolean;
  newProjectName: string;
  setNewProjectName: (name: string) => void;
  isSubmitting: boolean;
  handleAddProject: () => void;
}

export default function AdminProjectView({
  setView,
  setSelectedProject,
  isMobileLayout,
  newProjectName,
  setNewProjectName,
  isSubmitting,
  handleAddProject
}: AdminProjectViewProps) {
  return (
    <div className="animate-in slide-in-from-bottom duration-300 max-w-xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
      <button onClick={() => { setView('dashboard'); setSelectedProject(null); }} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← {isMobileLayout ? 'BACK' : 'BACK TO PROJECTS'}</button>
      <div className="bg-white p-6 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
        <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 sm:mb-8 flex items-center gap-2"><PlusCircle className="text-rose-600" /> Add Project</h2>
        <div className="space-y-4">
          <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-sm font-bold outline-none focus:border-rose-500" placeholder="ชื่อโครงการ..." />
          <button onClick={handleAddProject} disabled={isSubmitting} className="w-full bg-rose-600 text-white font-black py-4 rounded-xl shadow-lg hover:bg-rose-700 flex justify-center items-center gap-2 text-sm sm:text-lg">{isSubmitting ? <Loader2 className="animate-spin" size={20} /> : 'ยืนยันสร้างโครงการ'}</button>
        </div>
      </div>
    </div>
  );
}
