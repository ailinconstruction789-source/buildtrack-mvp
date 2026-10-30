import React from 'react';
import { Loader2, Building, Layers } from 'lucide-react';

export interface HouseTypeFormData {
  id: string;
  type_name: string;
  memo: string;
  floor_count: number | null;
  is_infrastructure?: boolean;
}

interface AdminHouseTypesViewProps {
  setView: (view: string) => void;
  setSelectedProject: (project: any) => void;
  isEditingType: boolean;
  setIsEditingType: (isEditing: boolean) => void;
  houseTypeForm: HouseTypeFormData;
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
              <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">
                ชื่อแบบบ้าน <span className="text-rose-500 font-bold">*</span>
              </label>
              <input
                type="text"
                placeholder="เช่น Type A, บ้านเดี่ยวสิรินธร"
                value={houseTypeForm.type_name}
                onChange={(e) => setHouseTypeForm({ ...houseTypeForm, type_name: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  <Layers size={12} className="text-slate-400" />
                  <span>จำนวนชั้น</span>
                  {!houseTypeForm.is_infrastructure && <span className="text-rose-500 font-bold">*</span>}
                </label>
                {isEditingType && (houseTypeForm.floor_count === null || houseTypeForm.floor_count === undefined) && (
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    ⚠️ ยังไม่ระบุจำนวนชั้น
                  </span>
                )}
              </div>
              <select
                aria-label="จำนวนชั้น"
                value={houseTypeForm.floor_count === null || houseTypeForm.floor_count === undefined ? '' : String(houseTypeForm.floor_count)}
                onChange={(e) => {
                  const val = e.target.value;
                  setHouseTypeForm({
                    ...houseTypeForm,
                    floor_count: val === '1' ? 1 : val === '2' ? 2 : null
                  });
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500 cursor-pointer"
              >
                <option value="">ยังไม่ระบุจำนวนชั้น</option>
                <option value="1">บ้านชั้นเดียว (1 ชั้น)</option>
                <option value="2">บ้านสองชั้น (2 ชั้น)</option>
              </select>
              {!isEditingType && !houseTypeForm.is_infrastructure && (
                <p className="text-[10px] text-slate-400 mt-1">
                  * แบบบ้านใหม่ต้องเลือก 1 ชั้น หรือ 2 ชั้น ก่อนบันทึก
                </p>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">บันทึกความจำ / รายละเอียด</label>
              <textarea
                placeholder="คำอธิบายเพิ่มเติม..."
                value={houseTypeForm.memo}
                onChange={(e) => setHouseTypeForm({ ...houseTypeForm, memo: e.target.value })}
                rows={3}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500 resize-none"
              />
            </div>

            <div className="flex gap-2 pt-2">
              {isEditingType && (
                <button
                  onClick={() => {
                    setHouseTypeForm({ id: '', type_name: '', memo: '', floor_count: null });
                    setIsEditingType(false);
                  }}
                  className="bg-slate-100 text-slate-500 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-200"
                >
                  ยกเลิก
                </button>
              )}
              <button
                onClick={handleSaveHouseType}
                disabled={isSubmitting}
                className="flex-1 bg-rose-600 text-white font-black py-2.5 rounded-xl text-xs shadow-md hover:bg-rose-700 flex justify-center items-center gap-1.5 transition"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={14} /> : (isEditingType ? 'บันทึกการแก้ไข' : 'เพิ่มแบบบ้าน')}
              </button>
            </div>
          </div>
        </div>

        {/* 📋 ฝั่งขวา: รายชื่อตารางแบบบ้านที่มีอยู่เดิม */}
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-md lg:col-span-2">
          <h3 className="font-black text-slate-800 text-lg mb-4 uppercase italic tracking-tight border-b pb-2 flex items-center gap-1.5">
            <Building size={18} className="text-slate-400" /> แบบบ้านทั้งหมด ({houseTypes.length})
          </h3>

          <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
            {houseTypes.map(t => (
              <div key={t.id} className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 flex items-center justify-between gap-4 group hover:border-rose-200 transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-black text-slate-800 text-sm sm:text-base truncate">{t.type_name}</h4>
                    {t.is_infrastructure ? (
                      <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 text-[10px] font-black">
                        งานโครงสร้างพื้นฐาน
                      </span>
                    ) : t.floor_count === 1 ? (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black">
                        🏠 บ้านชั้นเดียว (1 ชั้น)
                      </span>
                    ) : t.floor_count === 2 ? (
                      <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-black">
                        🏢 บ้านสองชั้น (2 ชั้น)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-black">
                        ⚠️ ยังไม่ระบุจำนวนชั้น
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium truncate mt-0.5">{t.memo || 'ไม่มีรายละเอียดเพิ่มเติม'}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => {
                      setHouseTypeForm({
                        id: t.id,
                        type_name: t.type_name,
                        memo: t.memo || '',
                        floor_count: t.floor_count === 1 || t.floor_count === 2 ? t.floor_count : null,
                        is_infrastructure: !!t.is_infrastructure
                      });
                      setIsEditingType(true);
                    }}
                    className="bg-white border border-slate-200 text-slate-600 p-2 rounded-lg font-bold text-xs hover:bg-slate-100 hover:text-blue-600 transition-colors shadow-sm"
                    title="แก้ไขชื่อ รายละเอียด และจำนวนชั้น"
                  >
                    แก้ไข
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
