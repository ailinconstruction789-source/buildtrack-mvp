import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { DollarSign, Save, Loader2, Search } from 'lucide-react';

export default function AdminPlotPricing({ projects, plots, fetchAllData }: any) {
  const [selectedProject, setSelectedProject] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error' | '', message: '' | string }>({ type: '', message: '' });

  // Initialize edits when project changes
  useEffect(() => {
    if (selectedProject) {
      const projPlots = plots.filter((p: any) => p.project_name === selectedProject);
      const initialEdits: Record<string, string> = {};
      projPlots.forEach((p: any) => {
        initialEdits[p.id] = p.selling_price ? String(p.selling_price) : '';
      });
      setEdits(initialEdits);
      setSaveStatus({ type: '', message: '' });
    }
  }, [selectedProject, plots]);

  const handlePriceChange = (plotId: string, val: string) => {
    setEdits(prev => ({ ...prev, [plotId]: val }));
    // Clear status when user starts typing again
    if (saveStatus.message) setSaveStatus({ type: '', message: '' });
  };

  const parseMoney = (val: any) => {
    if (val == null || val === '') return 0;
    const numStr = val.toString().replace(/[^0-9.-]+/g,"");
    const num = Number(numStr);
    return isNaN(num) ? 0 : num;
  };

  const handleSavePrices = async () => {
    if (!selectedProject) return;
    setIsSubmitting(true);
    setSaveStatus({ type: '', message: '' });

    try {
      const projPlots = plots.filter((p: any) => p.project_name === selectedProject);
      
      // We will perform updates in parallel
      const updatePromises = projPlots.map((p: any) => {
        const newVal = edits[p.id];
        const numVal = parseMoney(newVal);
        
        // Only update if it actually changed
        if (numVal !== (p.selling_price || 0)) {
          return supabase
            .from('plots')
            .update({ selling_price: numVal })
            .eq('id', p.id);
        }
        return null;
      }).filter(Boolean);

      if (updatePromises.length > 0) {
        const results = await Promise.all(updatePromises);
        
        // Check if any result had an error
        const errors = results.filter((res: any) => res && res.error);
        if (errors.length > 0) {
          throw new Error(errors[0].error.message);
        }

        await fetchAllData();
        setSaveStatus({ type: 'success', message: `บันทึกราคาขายสำเร็จอัปเดต ${updatePromises.length} แปลง` });
      } else {
         setSaveStatus({ type: 'success', message: 'ไม่มีการเปลี่ยนแปลงราคา' });
      }
      
    } catch (err: any) {
      console.error(err);
      setSaveStatus({ type: 'error', message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentPlots = plots.filter((p: any) => p.project_name === selectedProject).sort((a: any, b: any) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-500 w-full mx-auto h-full p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 sm:mb-8 gap-3 sm:gap-4">
        <div>
          <h2 className="text-2xl sm:text-4xl font-black text-slate-800 italic uppercase tracking-tighter flex items-center gap-3"><DollarSign className="text-emerald-500" size={32} /> กำหนดราคาขาย</h2>
          <p className="text-slate-500 text-[10px] sm:text-sm font-bold uppercase tracking-widest mt-0.5 sm:mt-1">ระบุราคาขายสำหรับใช้คำนวณ Executive Analytics</p>
        </div>
      </div>

      <div className="bg-white p-6 sm:p-10 rounded-[2rem] border border-slate-200 shadow-xl">
        {/* Dropdown เลือกโครงการ */}
        <div className="mb-8 bg-slate-50 p-6 rounded-2xl border border-slate-100">
          <label className="block text-xs font-black text-slate-500 mb-2 uppercase tracking-widest">เลือกโครงการเพื่อจัดการราคา</label>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-emerald-500 shadow-sm"
          >
            <option value="">-- กรุณาเลือกโครงการ --</option>
            {projects.map((proj: any) => (
              <option key={proj.name} value={proj.name}>{proj.name}</option>
            ))}
          </select>
        </div>

        {selectedProject && (
          <div className="border-t border-slate-100 pt-8 animate-in fade-in duration-300">
            <div className="flex justify-between items-end mb-6">
              <div>
                <h3 className="text-lg font-black text-slate-800">รายการแปลงในโครงการ {selectedProject}</h3>
              </div>
              <button 
                onClick={handleSavePrices} 
                disabled={isSubmitting}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-6 rounded-xl shadow-md transition-colors flex items-center gap-2"
              >
                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                บันทึกราคาทั้งหมด
              </button>
            </div>

            {saveStatus.message && (
              <div className={`p-4 mb-6 rounded-xl font-bold text-sm ${saveStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                {saveStatus.message}
              </div>
            )}

            <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="p-4 text-xs font-black uppercase text-slate-500">รหัสแปลง</th>
                    <th className="p-4 text-xs font-black uppercase text-slate-500">สถานะปัจจุบัน</th>
                    <th className="p-4 text-xs font-black uppercase text-slate-500">ความคืบหน้า</th>
                    <th className="p-4 text-xs font-black uppercase text-slate-500 w-[250px]">ราคาขาย (บาท)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentPlots.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-400 font-bold">ไม่มีข้อมูลแปลงในโครงการนี้</td>
                    </tr>
                  ) : currentPlots.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 font-bold text-slate-800">
                        แปลง {p.id}
                      </td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-black ${
                          p.sale_status === 'transferred' ? 'bg-purple-100 text-purple-700' :
                          p.has_customer ? 'bg-pink-100 text-pink-700' :
                          p.sale_status === 'ready_for_sale' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {p.sale_status === 'transferred' ? 'โอนแล้ว' : p.has_customer ? 'มีลูกค้า (เร่งปิดจ๊อบ)' : p.sale_status === 'ready_for_sale' ? 'พร้อมขาย' : 'กำลังก่อสร้าง'}
                        </span>
                      </td>
                      <td className="p-4 font-bold text-slate-600">
                        {p.progress}% {p.is_completed && p.progress === 100 && ' (เสร็จสมบูรณ์)'}
                      </td>
                      <td className="p-4">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">฿</span>
                          <input 
                            type="number" 
                            value={edits[p.id] !== undefined ? edits[p.id] : ''} 
                            onChange={(e) => handlePriceChange(p.id, e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-4 py-2 font-bold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all"
                            placeholder="0"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
