import React from 'react';
import { Users, Edit2, Key, Trash2, Loader2 } from 'lucide-react';

interface AdminUsersViewProps {
  setView: (view: string) => void;
  setSelectedProject: (project: any) => void;
  isMobileLayout: boolean;
  newUser: { name: string; role: string };
  setNewUser: (user: any) => void;
  isSubmitting: boolean;
  handleAddUser: () => void;
  allUsers: any[];
  handleEditUsername: (id: string, username: string) => void;
  handleEditPassword: (id: string, username: string) => void;
  handleDeleteUser: (id: string, username: string, role: string) => void;
}

export default function AdminUsersView({
  setView,
  setSelectedProject,
  isMobileLayout,
  newUser,
  setNewUser,
  isSubmitting,
  handleAddUser,
  allUsers,
  handleEditUsername,
  handleEditPassword,
  handleDeleteUser
}: AdminUsersViewProps) {
  return (
    <div className="animate-in slide-in-from-bottom duration-300 max-w-3xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
      <button onClick={() => { setView('dashboard'); setSelectedProject(null); }} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← {isMobileLayout ? 'BACK' : 'BACK TO DASHBOARD'}</button>
      <div className="bg-white p-5 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
        <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 sm:mb-8 flex items-center gap-2"><Users className="text-rose-600" /> Manage Users</h2>
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <input type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="ชื่อผู้ใช้ใหม่..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500" />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500 text-slate-700">
            <option value="Foreman">Foreman</option><option value="Site Engineer">Site Engineer</option><option value="QC">QC</option><option value="Project Planner">Project Planner (วางแผน)</option><option value="Procurement">Procurement (จัดจ้าง)</option><option value="Store">Store (สโตร์)</option><option value="Sales">Sales (ฝ่ายขาย)</option><option value="Admin">Admin</option><option value="Owner">Owner (ผู้บริหาร / ดูได้อย่างเดียว)</option>
          </select>
          <button onClick={handleAddUser} disabled={isSubmitting} className="bg-rose-600 text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-rose-700 flex justify-center items-center gap-2">{isSubmitting ? <Loader2 className="animate-spin" size={18} /> : 'เพิ่มผู้ใช้'}</button>
        </div>
        <div className="space-y-3">
          <h3 className="text-xs sm:text-sm font-black text-slate-500 uppercase tracking-widest mb-4">รายชื่อในระบบ (รหัสผ่านเริ่มต้น: 1234)</h3>
          {allUsers.length === 0 ? <p className="text-sm text-slate-400 italic">ไม่มีข้อมูลผู้ใช้</p> : null}
          {allUsers.map(u => {
            const isOnline = u.last_seen_at && (new Date().getTime() - new Date(u.last_seen_at).getTime()) < 10 * 60 * 1000;
            return (
            <div key={u.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-slate-300'}`} title={isOnline ? 'ออนไลน์' : 'ออฟไลน์'}></div>
                  <span className="font-bold text-slate-700 block text-sm sm:text-base">{u.username}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[9px] sm:text-xs font-black uppercase tracking-widest inline-block ${u.role === 'Admin' ? 'text-rose-500' : u.role === 'QC' ? 'text-purple-500' : u.role === 'Site Engineer' ? 'text-blue-500' : u.role === 'Project Planner' ? 'text-pink-500' : u.role === 'Procurement' ? 'text-emerald-500' : 'text-orange-500'}`}>{u.role}</span>
                  {u.last_seen_at && !isOnline ? <span className="text-[9px] text-slate-400">ล่าสุด: {new Date(u.last_seen_at).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span> : null}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleEditUsername(u.id, u.username)} className="text-slate-400 hover:text-blue-500 p-2 bg-white rounded-lg shadow-sm" title="แก้ไขชื่อ ID"><Edit2 size={16} /></button>
                <button onClick={() => handleEditPassword(u.id, u.username)} className="text-slate-400 hover:text-blue-500 p-2 bg-white rounded-lg shadow-sm" title="แก้ไขรหัสผ่าน"><Key size={16} /></button>
                <button onClick={() => handleDeleteUser(u.id, u.username, u.role)} className="text-slate-400 hover:text-rose-500 p-2 bg-white rounded-lg shadow-sm"><Trash2 size={16} /></button>
              </div>
            </div>
          )})}
        </div>
      </div>
    </div>
  );
}
