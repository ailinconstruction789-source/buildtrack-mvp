import React from 'react';
import { LayoutDashboard, AlertTriangle } from 'lucide-react';

interface LoginViewProps {
  dialogConfig: any;
  closeDialog: () => void;
  loginData: any;
  setLoginData: (data: any) => void;
  allUsers: any[];
  handleLogin: () => void;
}

export default function LoginView({
  dialogConfig,
  closeDialog,
  loginData,
  setLoginData,
  allUsers,
  handleLogin
}: LoginViewProps) {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      {dialogConfig.isOpen && (
        <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 text-center space-y-4">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-2">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-xl font-black">{dialogConfig.title}</h3>
            <p className="text-slate-500 font-medium">{dialogConfig.message}</p>
            <button onClick={closeDialog} className="w-full bg-slate-800 text-white font-bold py-3.5 rounded-xl">รับทราบ</button>
          </div>
        </div>
      )}
      <div className="bg-white p-6 sm:p-12 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-slate-100 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500 rounded-full blur-3xl opacity-20 pointer-events-none"></div>
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-emerald-500 rounded-full blur-3xl opacity-20 pointer-events-none"></div>
        
        <div className="flex justify-center mb-6 relative z-10">
          <div className="bg-blue-50 p-4 rounded-3xl"><LayoutDashboard className="text-blue-600" size={48} /></div>
        </div>
        <h1 className="text-4xl font-black text-slate-800 italic uppercase tracking-tighter mb-2 text-center relative z-10">BuildTrack</h1>
        <p className="text-center text-slate-400 font-bold text-sm mb-8 tracking-widest relative z-10">PROJECT MANAGEMENT SYSTEM</p>
        
        <div className="space-y-4 sm:space-y-5 relative z-10">
          <div>
             <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Username</label>
             <select value={loginData.username} onChange={e => setLoginData({...loginData, username: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-bold outline-none focus:border-blue-500 focus:bg-white transition-colors text-slate-700 appearance-none">
               <option value="" disabled>-- เลือกชื่อของคุณ --</option>
               {allUsers.map(u => <option key={u.id} value={u.username}>{u.username} ({u.role})</option>)}
             </select>
          </div>
          <div>
             <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1 block">PIN Code</label>
             <input type="password" maxLength={4} value={loginData.pin} onChange={e => setLoginData({...loginData, pin: e.target.value.replace(/[^0-9]/g, '')})} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} placeholder="••••" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-black text-center tracking-[1em] outline-none focus:border-blue-500 focus:bg-white transition-colors text-2xl text-slate-700" />
          </div>
          <button onClick={handleLogin} disabled={!loginData.username || loginData.pin.length !== 4} className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl shadow-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4">Sign In</button>
        </div>
      </div>
    </div>
  );
}
