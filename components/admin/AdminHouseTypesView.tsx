import React from 'react';
import { Loader2, Building } from 'lucide-react';

interface AdminHouseTypesViewProps {
  setView: (view: string) => void;
  setSelectedProject: (project: any) => void;
  isEditingType: boolean;
  setIsEditingType: (isEditing: boolean) => void;
  houseTypeForm: { id: string; type_name: string; memo: string };
  setHouseTypeForm: (form: any) => void;
  houseTypes: any[];
  isSubmitting: boolean;
  handleSaveHouseType: () => void;
}

export default function AdminHouseTypesView({
  setView,
  setSelectedProject,
  isEditingType,
  setIsEditingType,
  houseTypeForm,
  setHouseTypeForm,
  houseTypes,
  isSubmitting,
  handleSaveHouseType
}: AdminHouseTypesViewProps) {
  return (
    <div className="animate-in slide-in-from-bottom duration-300 max-w-4xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
      <button onClick={() => { setView('dashboard'); setSelectedProject(null); }} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← BACK TO DASHBOARD</button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 🛠️ ฝั่งซ้าย: ฟอร์ม กรอกข้อมูล เพิ่ม/แก้ไข */}
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-md h-fit">
          <h3 className="font-black text-slate-800 text-lg mb-4 uppercase italic tracking-tight border-b pb-2 flex items-center gap-1.5 text-rose-600">
            {isEditingType ? '📝 แก้ไขแบบบ้าน' : '➕ เพิ่มแบบบ้านใหม่'}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">ชื่อแบบบ้าน</label>
              <input type="text" placeholder="เช่น Type A, บ้านเดี่ยวสองชั้น" value={houseTypeForm.type_name} onChange={(e) => setHouseTypeForm({ ...houseTypeForm, type_name: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">บันทึกความจำ / รายละเอียด</label>
              <textarea placeholder="คำอธิบายเพิ่มเติม..." value={houseTypeForm.memo} onChange={(e) => setHouseTypeForm({ ...houseTypeForm, memo: e.target.value })} rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500 resize-none" />
            </div>

            <div className="flex gap-2 pt-2">
              {isEditingType && (
                <button onClick={() => { setHouseTypeForm({ id: '', type_name: '', memo: '' }); setIsEditingType(false); }} className="bg-slate-100 text-slate-500 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-200">ยกเลิก</button>
              )}
              <button onClick={handleSaveHouseType} disabled={isSubmitting} className="flex-1 bg-rose-600 text-white font-black py-2.5 rounded-xl text-xs shadow-md hover:bg-rose-700 flex justify-center items-center gap-1.5">
                {isSubmitting ? <Loader2 className="animate-spin" size={14} /> : (isEditingType ? 'บันทึกการแก้ไข' : 'เพิ่มแบบบ้าน')}
              </button>
            </div>
          </div>
        </div>

        {/* 📋 ฝั่งขวา: รายชื่อตารางแบบบ้านที่มีอยู่เดิม */}
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-md lg:col-span-2">
          <h3 className="font-black text-slate-800 text-lg mb-4 uppercase italic tracking-tight border-b pb-2 flex items-center gap-1.5"><Building size={18} className="text-slate-400" /> แบบบ้านทั้งหมด ({houseTypes.length})</h3>

          <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
            {houseTypes.map(t => (
              <div key={t.id} className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 flex items-center justify-between gap-4 group hover:border-rose-200 transition-colors">
                <div className="min-w-0">
                  <h4 className="font-black text-slate-800 text-sm sm:text-base truncate">{t.type_name}</h4>
                  <p className="text-[11px] text-slate-400 font-medium truncate mt-0.5">{t.memo || 'ไม่มีรายละเอียดเพิ่มเติม'}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => {
                      setHouseTypeForm({ id: t.id, type_name: t.type_name, memo: t.memo || '' });
                      setIsEditingType(true);
                    }}
                    className="bg-white border border-slate-200 text-slate-600 p-2 rounded-lg font-bold text-xs hover:bg-slate-100 hover:text-blue-600 transition-colors shadow-sm"
                    title="แก้ไขชื่อและรายละเอียด"
                  >
                    แก้ไขชื่อ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
