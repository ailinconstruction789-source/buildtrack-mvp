'use client';

import { useState } from 'react';
import { parseVoiceAnswers, VOICE_SCORES, VOICE_OPTIONAL_TEXT, VOICE_CHOICES,
  type VoiceAnswers, type VoiceChoiceKey, type VoiceTextKey, type VoiceScoreKey } from '@/lib/sales/customerVoicesContracts';

export const voiceFieldClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100';
export const voiceButtonClass = 'rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50';
const selections: Partial<Record<VoiceTextKey, readonly string[]>> = {
  gender: ['หญิง', 'ชาย', 'อื่นๆ'], marital_status: ['โสด', 'สมรส', 'หย่าร้าง/แยกกันอยู่'],
};
const groups = { purpose: 'วัตถุประสงค์ในการซื้อ', reason: 'เหตุผลที่เลือกเข้าชม', source: 'รู้จักเราจากช่องทางไหน' };
interface Props { disabled?: boolean; onSubmit: (answers: VoiceAnswers) => void }
export default function CustomerVoiceForm({ disabled = false, onSubmit }: Props) {
  const [scores, setScores] = useState<Partial<Record<VoiceScoreKey, number>>>({});
  const [texts, setTexts] = useState<Partial<Record<VoiceTextKey, string>>>({});
  const [choices, setChoices] = useState<Partial<Record<VoiceChoiceKey, boolean>>>({});
  const [rent, setRent] = useState(''), [error, setError] = useState('');
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); if (disabled) return;
    const answers: Record<string, string | number | boolean> = { ...scores, ...choices };
    for (const [key, value] of Object.entries(texts)) if (value.trim()) answers[key] = value;
    if (rent.trim()) {
      if (!/^\d+(\.\d{1,2})?$/.test(rent.trim())) { setError('กรุณาระบุค่าเช่าเป็นจำนวนบาท ทศนิยมไม่เกิน 2 ตำแหน่ง'); return; }
      answers.monthly_rent = Number(rent.trim());
    }
    try { const parsed = parseVoiceAnswers(answers); setError(''); onSubmit(parsed); }
    catch { setError('กรุณาให้คะแนนครบทั้ง 8 ข้อ (1–5) และตรวจข้อมูลเพิ่มเติม'); }
  };
  return <form aria-label="แบบประเมิน Customer Voices" onSubmit={submit} noValidate className="space-y-6">
    <fieldset disabled={disabled} className="space-y-4"><legend className="mb-3 text-lg font-bold">ความพึงพอใจในการเข้าชม (จำเป็นทั้ง 8 ข้อ)</legend>
      <p className="text-sm text-slate-600">1 = น้อยที่สุด · 5 = มากที่สุด กรุณาเลือกตามประสบการณ์จริง</p>
      {VOICE_SCORES.map(([key, label]) => <label key={key} className="block space-y-2"><span>{label} *</span>
        <select aria-label={`${label} *`} required className={voiceFieldClass} value={scores[key] ?? ''} onChange={event => setScores(current => ({ ...current, [key]: event.target.value ? Number(event.target.value) : undefined }))}>
          <option value="">ยังไม่ได้ให้คะแนน</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>)}
    </fieldset>
    <fieldset disabled={disabled} className="space-y-4"><legend className="mb-3 text-lg font-bold">ข้อมูลเพิ่มเติม (ไม่บังคับ)</legend>
      <p className="text-sm text-slate-600">เว้นว่างได้ ไม่มีคำตอบตั้งไว้ล่วงหน้า ข้อมูลใช้เพื่อปรับปรุงบริการและให้ฝ่ายขายดูแลการเข้าชม</p>
      <div className="grid gap-4 sm:grid-cols-2">{VOICE_OPTIONAL_TEXT.map(([key, label]) => <label key={key} className="block space-y-2"><span>{label}</span>
        {selections[key] ? <select className={voiceFieldClass} value={texts[key] ?? ''} onChange={event => setTexts(current => ({ ...current, [key]: event.target.value }))}>
          <option value="">ยังไม่ได้ตอบ / ไม่ระบุ</option>{selections[key]!.map(value => <option key={value} value={value}>{value}</option>)}
        </select> : <input className={voiceFieldClass} maxLength={500} value={texts[key] ?? ''} onChange={event => setTexts(current => ({ ...current, [key]: event.target.value }))} />}</label>)}
        <label className="block space-y-2"><span>ค่าเช่าต่อเดือน (บาท)</span><input className={voiceFieldClass} inputMode="decimal" value={rent} onChange={event => setRent(event.target.value)} /></label>
      </div>
      {(Object.keys(VOICE_CHOICES) as (keyof typeof VOICE_CHOICES)[]).map(group => <fieldset key={group} className="space-y-2"><legend className="mb-2 font-semibold">{groups[group]} (เลือกได้หลายข้อ)</legend>
        {VOICE_CHOICES[group].map(([key, label]) => <label key={key} className="flex items-start gap-3"><input type="checkbox" checked={choices[key] ?? false}
          onChange={event => setChoices(current => ({ ...current, [key]: event.target.checked }))} className="mt-1" /><span>{label}</span></label>)}
      </fieldset>)}
    </fieldset>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{error}</p>}
    <button type="submit" disabled={disabled} className={`${voiceButtonClass} bg-blue-700 text-white`}>ส่งแบบประเมิน</button>
  </form>;
}
