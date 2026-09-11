"use client";

import React, { useState, useEffect } from 'react';
import { X, Star, Save, MessageSquare, Check, User, Heart, Sparkles, Building, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { CustomerVoice, Lead } from '@/types/sales';

interface CustomerVoicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead?: Lead | null;
  projectName?: string;
  user?: any;
  onSaved?: () => void;
}

export default function CustomerVoicesModal({
  isOpen,
  onClose,
  lead,
  projectName = 'ไอลิน สันทราย 2',
  user,
  onSaved
}: CustomerVoicesModalProps) {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const [form, setForm] = useState<Partial<CustomerVoice>>({
    customer_name: '',
    nickname: '',
    age: '',
    gender: 'หญิง',
    phone: '',
    line_id: '',
    project_name: projectName,
    agent_name: user?.username || '',
    marital_status: 'โสด',
    education_level: 'ปริญญาตรี',
    occupation: '',
    monthly_income: '30,000 - 50,000 บาท',
    family_members: '2-3 คน',
    previous_residence: 'เช่าบ้าน/คอนโด',
    monthly_rent: 0,
    
    // Purpose
    purpose_relocate: false,
    purpose_family_expansion: false,
    purpose_independence: false,
    purpose_rent_to_own: false,
    purpose_debt_consolidation: false,
    
    // Reason
    reason_price: false,
    reason_location: false,
    reason_promotion: false,
    reason_design: false,
    reason_house_type: false,
    reason_other: '',
    
    // Source
    source_facebook: false,
    source_tiktok: false,
    source_youtube: false,
    source_billboard: false,
    source_other: '',
    
    // Scores
    score_knowledge: 5,
    score_problem_solving: 5,
    score_service_mind: 5,
    score_appearance: 5,
    score_cleanliness: 5,
    score_house_design: 5,
    score_price: 5,
    score_location: 5,
    score_average: 5.0
  });

  // Calculate average score dynamically
  const scores = [
    form.score_knowledge || 5,
    form.score_problem_solving || 5,
    form.score_service_mind || 5,
    form.score_appearance || 5,
    form.score_cleanliness || 5,
    form.score_house_design || 5,
    form.score_price || 5,
    form.score_location || 5,
  ];
  const calculatedAvg = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2));

  useEffect(() => {
    if (isOpen && lead) {
      setForm(prev => ({
        ...prev,
        customer_name: lead.customer_name || '',
        phone: lead.phone || '',
        occupation: lead.occupation || prev.occupation || '',
        project_name: lead.project_name || projectName,
        agent_name: lead.agent_name || user?.username || prev.agent_name
      }));

      // Check if existing survey exists in DB
      const loadExistingSurvey = async () => {
        if (!lead.id) return;
        setFetching(true);
        try {
          const { data } = await supabase
            .from('customer_voices')
            .select('*')
            .eq('lead_id', lead.id)
            .maybeSingle();

          if (data) {
            setForm(data);
          }
        } catch (err) {
          console.error('Error fetching survey:', err);
        } finally {
          setFetching(false);
        }
      };

      loadExistingSurvey();
    }
  }, [isOpen, lead, projectName, user]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        ...form,
        lead_id: lead?.id || null,
        survey_date: new Date().toISOString(),
        score_average: calculatedAvg,
        updated_at: new Date().toISOString()
      };

      if (form.id) {
        await supabase.from('customer_voices').update(payload).eq('id', form.id);
      } else {
        await supabase.from('customer_voices').insert([payload]);
      }

      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      console.error('Save survey error:', err);
      alert('บันทึกแบบสำรวจไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden my-auto">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 px-6 py-5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300">
              <MessageSquare size={22} />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black flex items-center gap-2">
                แบบสอบถามความพึงพอใจ & เสียงสะท้อนลูกค้า (Customer Voices)
              </h2>
              <p className="text-xs text-blue-200/80 font-medium">
                {lead ? `ลูกค้า: ${lead.customer_name} (${lead.phone || '-'})` : 'แบบสำรวจข้อมูลลูกค้าโครงการ'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        {fetching ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <Loader2 className="animate-spin text-blue-600" size={32} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Section 1: ข้อมูลระบุตัวตน & ส่วนตัว */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-4">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-2">
                <User size={16} className="text-blue-600" /> 1. ข้อมูลระบุตัวตนและข้อมูลส่วนตัว
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-slate-600 font-bold mb-1">ชื่อ-นามสกุล *</label>
                  <input
                    type="text"
                    required
                    value={form.customer_name || ''}
                    onChange={e => setForm({ ...form, customer_name: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">ชื่อเล่น</label>
                  <input
                    type="text"
                    value={form.nickname || ''}
                    onChange={e => setForm({ ...form, nickname: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">เบอร์โทร *</label>
                  <input
                    type="text"
                    required
                    value={form.phone || ''}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">ID Line</label>
                  <input
                    type="text"
                    value={form.line_id || ''}
                    onChange={e => setForm({ ...form, line_id: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">อายุ</label>
                  <input
                    type="text"
                    value={form.age || ''}
                    onChange={e => setForm({ ...form, age: e.target.value })}
                    placeholder="เช่น 32 ปี"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">เพศ</label>
                  <select
                    value={form.gender || 'หญิง'}
                    onChange={e => setForm({ ...form, gender: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="หญิง">หญิง</option>
                    <option value="ชาย">ชาย</option>
                    <option value="อื่นๆ">อื่นๆ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">สถานภาพ</label>
                  <select
                    value={form.marital_status || 'โสด'}
                    onChange={e => setForm({ ...form, marital_status: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="โสด">โสด</option>
                    <option value="สมรส">สมรส</option>
                    <option value="หย่าร้าง/แยกกันอยู่">หย่าร้าง/แยกกันอยู่</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">อาชีพ</label>
                  <input
                    type="text"
                    value={form.occupation || ''}
                    onChange={e => setForm({ ...form, occupation: e.target.value })}
                    placeholder="เช่น พนักงานเอกชน, ค้าขาย"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">รายได้ต่อเดือน</label>
                  <input
                    type="text"
                    value={form.monthly_income || ''}
                    onChange={e => setForm({ ...form, monthly_income: e.target.value })}
                    placeholder="เช่น 35,000 บาท"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">สมาชิกในครอบครัว</label>
                  <input
                    type="text"
                    value={form.family_members || ''}
                    onChange={e => setForm({ ...form, family_members: e.target.value })}
                    placeholder="เช่น 3 คน (พ่อแม่ลูก)"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">ที่อยู่อาศัยเดิม</label>
                  <input
                    type="text"
                    value={form.previous_residence || ''}
                    onChange={e => setForm({ ...form, previous_residence: e.target.value })}
                    placeholder="เช่น เช่าหอพัก, อยู่กับพ่อแม่"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">ค่าเช่าต่อเดือน (ถ้ามี)</label>
                  <input
                    type="number"
                    value={form.monthly_rent || 0}
                    onChange={e => setForm({ ...form, monthly_rent: Number(e.target.value) })}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: จุดประสงค์การซื้อบ้าน */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-2">
                <Heart size={16} className="text-rose-500" /> 2. จุดประสงค์ในการซื้อบ้าน (เลือกได้มากกว่า 1 ข้อ)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
                {[
                  { key: 'purpose_relocate', label: 'ย้ายที่อยู่อาศัยใหม่' },
                  { key: 'purpose_family_expansion', label: 'รองรับครอบครัวขยาย/แต่งงาน' },
                  { key: 'purpose_independence', label: 'ต้องการความอิสระ / เป็นส่วนตัว' },
                  { key: 'purpose_rent_to_own', label: 'เปลี่ยนค่าเช่ามาเป็นเงินผ่อนบ้าน' },
                  { key: 'purpose_debt_consolidation', label: 'รวมหนี้เป็นก้อนเดียว (ปิดภาระหนี้)' },
                ].map(item => (
                  <label key={item.key} className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-slate-200 hover:border-blue-400 cursor-pointer transition-colors font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!(form as any)[item.key]}
                      onChange={e => setForm({ ...form, [item.key]: e.target.checked })}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Section 3: เหตุผลที่เยี่ยมชมโครงการ */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-2">
                <Building size={16} className="text-amber-500" /> 3. เหตุผลที่เข้ามาเยี่ยมชมโครงการ
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
                {[
                  { key: 'reason_price', label: 'ราคาเหมาะสม คุ้มค่า' },
                  { key: 'reason_location', label: 'ทำเลที่ตั้ง เดินทางสะดวก' },
                  { key: 'reason_promotion', label: 'โปรโมชั่นและข้อเสนอถูกใจ' },
                  { key: 'reason_design', label: 'ดีไซน์และการตกแต่งสวยงาม' },
                  { key: 'reason_house_type', label: 'แบบบ้านและขนาดที่ดินตรงความต้องการ' },
                ].map(item => (
                  <label key={item.key} className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-slate-200 hover:border-amber-400 cursor-pointer transition-colors font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!(form as any)[item.key]}
                      onChange={e => setForm({ ...form, [item.key]: e.target.checked })}
                      className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                    />
                    {item.label}
                  </label>
                ))}
              </div>
              <div className="mt-2 text-xs">
                <input
                  type="text"
                  placeholder="เหตุผลอื่นๆ เพิ่มเติม (ถ้ามี)"
                  value={form.reason_other || ''}
                  onChange={e => setForm({ ...form, reason_other: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Section 4: แหล่งข้อมูล */}
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-2">
                <Sparkles size={16} className="text-indigo-500" /> 4. รู้จักโครงการผ่านแหล่งข้อมูลใด
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                {[
                  { key: 'source_facebook', label: 'Facebook Ads / เพจ' },
                  { key: 'source_tiktok', label: 'TikTok' },
                  { key: 'source_youtube', label: 'YouTube' },
                  { key: 'source_billboard', label: 'ป้ายโฆษณาหน้าโครงการ' },
                ].map(item => (
                  <label key={item.key} className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-slate-200 hover:border-indigo-400 cursor-pointer transition-colors font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!(form as any)[item.key]}
                      onChange={e => setForm({ ...form, [item.key]: e.target.checked })}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Section 5: ประเมินความพึงพอใจ 8 ด้าน (1-5) */}
            <div className="bg-blue-50/50 p-5 rounded-2xl border border-blue-200 space-y-4">
              <div className="flex items-center justify-between border-b border-blue-200/80 pb-2">
                <h3 className="text-sm font-black text-blue-900 flex items-center gap-2">
                  <Star size={16} className="text-amber-500 fill-amber-500" /> 5. แบบประเมินความพึงพอใจ (5 = มากที่สุด, 1 = น้อยที่สุด)
                </h3>
                <div className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">
                  คะแนนเฉลี่ย: {calculatedAvg} / 5.0
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {[
                  { key: 'score_knowledge', label: '1. พนักงานให้ความรู้ ข้อมูลครบถ้วน' },
                  { key: 'score_problem_solving', label: '2. แก้ปัญหา/ตอบข้อสงสัยรวดเร็ว' },
                  { key: 'score_service_mind', label: '3. บริการด้วยความเต็มใจ สุภาพ' },
                  { key: 'score_appearance', label: '4. พนักงานแต่งกายเรียบร้อย บุคลิกภาพดี' },
                  { key: 'score_cleanliness', label: '5. สิ่งแวดล้อมโครงการ/บ้านตัวอย่างสะอาด' },
                  { key: 'score_house_design', label: '6. แบบบ้านและฟังก์ชันตรงใจ' },
                  { key: 'score_price', label: '7. ราคาและงวดผ่อนตรงใจ' },
                  { key: 'score_location', label: '8. ทำเลและโลเคชั่นตรงใจ' },
                ].map(item => (
                  <div key={item.key} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                    <span className="font-semibold text-slate-700">{item.label}</span>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {[1, 2, 3, 4, 5].map(star => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setForm({ ...form, [item.key]: star })}
                          className={`w-7 h-7 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            (form as any)[item.key] === star 
                              ? 'bg-amber-500 text-white shadow-sm scale-110' 
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {star}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl border border-slate-300 font-bold text-xs text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 cursor-pointer"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                บันทึกแบบสอบถาม
              </button>
            </div>

          </form>
        )}

      </div>
    </div>
  );
}
