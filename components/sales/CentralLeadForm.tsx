'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { 
  Building2, Home, CheckCircle, AlertCircle, Eye, X, Image as ImageIcon, 
  Calendar, Percent, Sparkles, DollarSign, Receipt, Tag, Maximize2, 
  CheckCircle2, Pickaxe, Loader2, CreditCard
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { CentralApiError } from '@/lib/sales/centralClient';
import { parseCentralCreateInput, type CentralCreateInput, type CentralCreateResult, type CentralSnapshot } from '@/lib/sales/centralContracts';
import type { InterestedPlot } from '@/lib/sales/plotAvailability';
import { loadAvailablePlots } from '@/lib/sales/plotAvailabilityClient';
import AvailablePlotSelect from './AvailablePlotSelect';
import { CentralPendingError, clearCentralPending, readCentralPending, writeCentralPending } from '@/lib/sales/centralPending';

interface Props {
  snapshot: CentralSnapshot;
  save: (input: CentralCreateInput, expectedActor: string) => Promise<CentralCreateResult>;
  onSaved: (result: CentralCreateResult) => void;
  onClose: () => void;
}

function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function CentralLeadForm(props: Props) {
  return <CentralLeadFormSession key={props.snapshot.actor.userId} {...props} />;
}

function CentralLeadFormSession({ snapshot, save, onSaved, onClose }: Props) {
  const [recovery] = useState(() => {
    try { return { input: readCentralPending(snapshot.actor.userId), error: '' }; }
    catch (failure) { return { input: null, error: failure instanceof Error ? failure.message : 'ตรวจคำขอค้างไม่ได้' }; }
  });
  const [name, setName] = useState(recovery.input?.name ?? '');
  const [phone, setPhone] = useState(recovery.input?.phone ?? '');
  const [channel, setChannel] = useState(recovery.input?.channel ?? 'โทร');
  const [notes, setNotes] = useState(recovery.input?.notes ?? '');
  const [owner, setOwner] = useState(recovery.input?.assignedSalesUserId ?? '');
  const [interests, setInterests] = useState<{ projectName: string; plot: InterestedPlot | null }[]>(() => recovery.input?.interests.map(interest => ({
    projectName: interest.projectName, plot: interest.plotId ? { id: interest.plotId, project_name: interest.projectName,
      plot_name: null, has_customer: null, sale_status: null } : null,
  })) ?? []);

  // 🌟 Direct Booking Toggle & States
  const [isDirectBooking, setIsDirectBooking] = useState(false);
  const [bookingProject, setBookingProject] = useState(snapshot.projects[0]?.name || '');
  const [bookingPlotId, setBookingPlotId] = useState('');
  const [availablePlots, setAvailablePlots] = useState<any[]>([]);
  const [loadingPlots, setLoadingPlots] = useState(false);
  const [plotInfo, setPlotInfo] = useState<any | null>(null);
  const [loadingPlotInfo, setLoadingPlotInfo] = useState(false);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  const [listPrice, setListPrice] = useState('');
  const [discount, setDiscount] = useState('0');
  const [deposit, setDeposit] = useState('10000');
  const [paymentMethod, setPaymentMethod] = useState<'mortgage' | 'cash'>('mortgage');
  const [contractDueDate, setContractDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });

  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(!!recovery.input);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(recovery.error);
  const pending = useRef<CentralCreateInput | null>(recovery.input);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const completed = useRef(false);
  const frozen = saving || uncertain || !!storageError;
  const isAdmin = snapshot.actor.role === 'admin';
  const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100';

  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => { if (pending.current || inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', unload); };
  }, []);

  // Load available plots when booking project changes
  useEffect(() => {
    if (!isDirectBooking || !bookingProject) {
      setAvailablePlots([]);
      setPlotInfo(null);
      return;
    }
    let cancelled = false;
    setLoadingPlots(true);
    loadAvailablePlots(bookingProject)
      .then(plots => {
        if (!cancelled) {
          setAvailablePlots(plots);
          setLoadingPlots(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailablePlots([]);
          setLoadingPlots(false);
        }
      });
    return () => { cancelled = true; };
  }, [isDirectBooking, bookingProject]);

  // Load Construction Info & Plot Pricing when bookingPlotId or bookingProject changes
  useEffect(() => {
    if (!isDirectBooking || !bookingPlotId || !bookingProject) {
      setPlotInfo(null);
      return;
    }

    let cancelled = false;
    setLoadingPlotInfo(true);

    const fetchPlotDetails = async () => {
      try {
        const { data: plotData } = await supabase
          .from('plots')
          .select('*, house_types(type_name)')
          .eq('project_name', bookingProject)
          .or(`id.eq.${bookingPlotId},plot_name.eq.${bookingPlotId},id.eq.${bookingProject}-${bookingPlotId}`)
          .maybeSingle();

        if (cancelled) return;

        if (plotData) {
          const { data: progressData } = await supabase
            .from('vw_plot_progress')
            .select('overall_progress')
            .eq('plot_id', plotData.id)
            .maybeSingle();

          const [tasksRes, assignsRes] = await Promise.all([
            supabase.from('task_templates').select('id, task_name').eq('house_type_id', plotData.house_type_id),
            supabase.from('plot_task_assignments').select('task_template_id, current_progress').eq('plot_id', plotData.id)
          ]);

          let progress = progressData?.overall_progress ? Number(progressData.overall_progress) : 0;
          let activeTask: any = null;

          if (tasksRes.data && tasksRes.data.length > 0) {
            const assignMap = new Map(assignsRes.data?.map((a: any) => [a.task_template_id, a.current_progress]) || []);
            tasksRes.data.forEach((task: any) => {
              const actual = assignMap.get(task.id) || 0;
              if (actual > 0 && actual < 100 && !activeTask) {
                activeTask = `${task.task_name} (${actual}%)`;
              }
            });
          }

          const combinedPlotInfo = {
            ...plotData,
            progress,
            activeTask
          };

          setPlotInfo(combinedPlotInfo);

          if (plotData.selling_price && Number(plotData.selling_price) > 0) {
            setListPrice(Number(plotData.selling_price).toLocaleString('en-US'));
          }
        } else {
          setPlotInfo(null);
        }
      } catch (err) {
        console.error('Error fetching plot details:', err);
      } finally {
        if (!cancelled) setLoadingPlotInfo(false);
      }
    };

    fetchPlotDetails();
    return () => { cancelled = true; };
  }, [isDirectBooking, bookingPlotId, bookingProject]);

  if (snapshot.actor.role === 'owner') return <p>Owner อ่านข้อมูลได้ แต่ไม่มีสิทธิ์สร้าง Lead</p>;

  // Numeric helpers
  const parseNum = (val: string) => {
    const cleaned = val.replace(/,/g, '').trim();
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  };

  const rawListPrice = parseNum(listPrice);
  const rawDiscount = parseNum(discount);
  const netSellingPrice = Math.max(0, rawListPrice - rawDiscount);
  const depositNum = parseNum(deposit);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || storageError || completed.current) return;
    setError('');

    if (isDirectBooking) {
      if (!bookingProject) {
        setError('กรุณาเลือกโครงการที่ต้องการจอง');
        return;
      }
      if (!bookingPlotId) {
        setError('กรุณาเลือกแปลงที่ต้องการจอง');
        return;
      }
      if (depositNum < 0) {
        setError('กรุณาระบุจำนวนเงินจองให้ถูกต้อง');
        return;
      }
    }

    try {
      let finalNotes = notes;
      let finalInterests = interests.map(interest => ({ projectName: interest.projectName, plotId: interest.plot?.id || null }));

      if (isDirectBooking) {
        const now = new Date();
        const timeBangkokStr = now.toLocaleDateString('th-TH', { 
          day: '2-digit', month: 'short', year: 'numeric', 
          hour: '2-digit', minute: '2-digit' 
        });
        const agentObj = snapshot.salesOwners.find(o => o.userId === (isAdmin ? owner : snapshot.actor.userId));
        const agentName = agentObj?.displayName || 'Sales';

        const bookingSummary = `[${timeBangkokStr} 🏷️ บันทึกการจอง (Walk-in/Direct Booking) โดย ${agentName}]\n` +
          `• โครงการ: ${bookingProject} (แปลง ${bookingPlotId})\n` +
          (rawListPrice > 0 ? `• ราคาก่อนส่วนลด: ฿${rawListPrice.toLocaleString('th-TH')} บาท\n` : '') +
          (rawDiscount > 0 ? `• ส่วนลด: ฿${rawDiscount.toLocaleString('th-TH')} บาท\n` : '') +
          (netSellingPrice > 0 ? `• ราคาขายสุทธิ: ฿${netSellingPrice.toLocaleString('th-TH')} บาท\n` : '') +
          `• เงินจองที่รับ: ฿${depositNum.toLocaleString('th-TH')} บาท (${paymentMethod === 'mortgage' ? 'กู้ธนาคาร' : 'เงินสด'})\n` +
          (contractDueDate ? `• กำหนดทำสัญญา: ${contractDueDate}\n` : '') +
          (notes.trim() ? `• บันทึก/ความต้องการ: ${notes.trim()}` : '');

        finalNotes = bookingSummary;
        finalInterests = [{ projectName: bookingProject, plotId: bookingPlotId }];
      }

      const input = pending.current || parseCentralCreateInput({
        requestId: requestId(), name, phone, channel, notes: finalNotes,
        interests: finalInterests,
        ...(isAdmin ? { assignedSalesUserId: owner } : {}),
      });

      pending.current = writeCentralPending(snapshot.actor.userId, input);
      inFlight.current = true;
      setSaving(true);
      const result = await save(input, snapshot.actor.userId);

      // If direct booking, update plot status to Booked in Supabase
      if (isDirectBooking) {
        try {
          await supabase
            .from('plots')
            .update({ status: 'Booked' })
            .or(`id.eq.${bookingPlotId},plot_name.eq.${bookingPlotId},id.eq.${bookingProject}-${bookingPlotId}`);
        } catch (err) {
          // Non-blocking
        }
      }

      completed.current = true;
      clearCentralPending(snapshot.actor.userId, input);
      pending.current = null;
      if (mounted.current) { setUncertain(false); onSaved(result); }
    } catch (failure) {
      if (failure instanceof CentralPendingError) {
        if (mounted.current) setStorageError(failure.message);
        return;
      }
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
      if (pending.current) {
        if (!uncertain && failure instanceof CentralApiError && failure.definitelyNotSaved) {
          try {
            clearCentralPending(snapshot.actor.userId, pending.current);
            pending.current = null; if (mounted.current) setUncertain(false);
          } catch (storageFailure) { if (mounted.current) setStorageError(storageFailure instanceof Error ? storageFailure.message : 'ตรวจคำขอค้างไม่ได้'); }
        } else {
          if (mounted.current) setUncertain(true);
        }
      }
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  };

  return (
    <>
      <form onSubmit={submit} aria-label="บันทึก Lead ส่วนกลาง" className="flex flex-col flex-1 overflow-hidden">
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 bg-white/95 backdrop-blur-sm shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                +
              </span>
              บันทึก Lead ใหม่
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">มีชื่อและเบอร์ก็เริ่มได้ พร้อมตัวเลือกจองแปลงทันที</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-4">
        {/* 🌟 Basic Customer Info Fields */}
        <fieldset disabled={frozen} className="grid gap-3.5 sm:grid-cols-2 disabled:opacity-70">
          <label className="text-xs font-bold text-slate-700">
            ชื่อลูกค้า <span className="text-rose-500">*</span>
            <input 
              required 
              maxLength={200} 
              value={name}
              onChange={event => setName(event.target.value)} 
              autoComplete="name" 
              placeholder="เช่น คุณสมชาย มุ่งมั่น"
              className={`${fieldClass} mt-1`} 
            />
          </label>
          <label className="text-xs font-bold text-slate-700">
            เบอร์โทร <span className="text-rose-500">*</span>
            <input 
              required 
              type="tel" 
              maxLength={32} 
              value={phone}
              onChange={event => setPhone(event.target.value)} 
              autoComplete="tel" 
              placeholder="เช่น 0812345678"
              className={`${fieldClass} mt-1`} 
            />
          </label>
          <label className="text-xs font-bold text-slate-700">
            ช่องทางรับเข้า
            <select 
              value={channel} 
              onChange={event => setChannel(event.target.value)} 
              className={`${fieldClass} mt-1`}
            >
              {['โทร', 'Walk in', 'Facebook', 'Line OA', 'Line ส่วนตัว', 'TikTok', 'Youtube', 'Referral', 'Billboard', 'Other'].map(item => <option key={item}>{item}</option>)}
            </select>
          </label>
          {isAdmin ? (
            <label className="text-xs font-bold text-slate-700">
              Sales ผู้ดูแล <span className="text-rose-500">*</span>
              <select 
                required 
                value={owner}
                onChange={event => setOwner(event.target.value)} 
                className={`${fieldClass} mt-1`}
              >
                <option value="">เลือก Sales ที่ดูแลลูกค้า</option>
                {snapshot.salesOwners.map(person => <option key={person.userId} value={person.userId}>{person.displayName}</option>)}
              </select>
            </label>
          ) : (
            <div className="rounded-xl border border-blue-100 bg-white p-3 text-xs text-blue-800 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-blue-600 shrink-0" />
              <span>คุณเป็นผู้ดูแล Lead นี้โดยอัตโนมัติ</span>
            </div>
          )}
          <label className="text-xs font-bold text-slate-700 sm:col-span-2">
            หมายเหตุ / ความต้องการ
            <textarea 
              value={notes} 
              maxLength={4000} 
              rows={2}
              placeholder="บันทึกรายละเอียดเพิ่มเติม..."
              onChange={event => setNotes(event.target.value)} 
              className={`${fieldClass} mt-1`} 
            />
          </label>
        </fieldset>

        {/* 🌟 Direct Booking Toggle Switch */}
        <div className="flex items-center justify-between p-3.5 bg-gradient-to-r from-orange-50 to-amber-50 rounded-2xl border border-orange-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center font-bold shadow-sm shadow-orange-200">
              <Tag size={16} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800">ลูกค้าเข้ามาเพื่อจองแปลงทันที (Direct Booking)</p>
              <p className="text-[11px] text-slate-500">เปิดสวิตช์นี้หากลูกค้าตกลงจองแปลง พร้อมบันทึกราคาและเงินจอง</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={isDirectBooking} 
              onChange={(e) => setIsDirectBooking(e.target.checked)} 
              className="sr-only peer" 
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600"></div>
          </label>
        </div>

        {/* 🌟 Direct Booking Expanded Section */}
        {isDirectBooking ? (
          <div className="space-y-4 rounded-2xl border border-orange-200 bg-white p-4 shadow-sm animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xs font-bold text-orange-950 flex items-center gap-1.5 border-b border-orange-100 pb-2">
              <Home size={14} className="text-orange-600" /> ข้อมูลการจองแปลงและราคา
            </h3>

            {/* Project & Available Plot Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <Building2 size={13} className="text-orange-500" /> โครงการที่จอง <span className="text-rose-500">*</span>
                </label>
                <select
                  value={bookingProject}
                  onChange={(e) => {
                    setBookingProject(e.target.value);
                    setBookingPlotId('');
                  }}
                  className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
                >
                  <option value="">-- เลือกโครงการ --</option>
                  {snapshot.projects.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <Home size={13} className="text-orange-500" /> แปลงที่จอง (เฉพาะแปลงว่าง) <span className="text-rose-500">*</span>
                </label>
                <select
                  aria-label="แปลงที่จอง"
                  value={bookingPlotId}
                  disabled={!bookingProject || loadingPlots}
                  onChange={(e) => setBookingPlotId(e.target.value)}
                  className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white disabled:opacity-50"
                >
                  <option value="">
                    {loadingPlots ? 'กำลังโหลดแปลงว่าง...' : availablePlots.length === 0 ? '-- ไม่มีแปลงว่าง --' : '-- เลือกแปลงที่ต้องการจอง --'}
                  </option>
                  {availablePlots.map((plot) => (
                    <option key={plot.id} value={plot.id}>
                      แปลง {plot.plot_name || plot.id} {plot.selling_price ? `(฿${Number(plot.selling_price).toLocaleString('th-TH')} บาท)` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Plot Construction Preview Card */}
            {loadingPlotInfo && (
              <div className="p-4 bg-orange-50/50 rounded-xl border border-orange-100 flex items-center justify-center gap-2 text-xs text-orange-700">
                <Loader2 size={16} className="animate-spin text-orange-600" />
                <span>กำลังโหลดข้อมูลบ้านและความคืบหน้าก่อสร้าง...</span>
              </div>
            )}

            {plotInfo && !loadingPlotInfo && (
              <div className="bg-gradient-to-br from-indigo-50/60 to-slate-50 p-3.5 rounded-xl border border-indigo-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                    <Home size={14} className="text-indigo-600" />
                    <span>ข้อมูลบ้านแปลง {bookingPlotId}</span>
                  </div>
                  {plotInfo.activeTask && (
                    <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full truncate max-w-[200px]">
                      งานปัจจุบัน: {plotInfo.activeTask}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  {/* House Image Preview */}
                  {plotInfo.overview_image_url || plotInfo.current_image_url || plotInfo.cover_image ? (
                    <div 
                      className="sm:col-span-4 aspect-video sm:aspect-4/3 rounded-lg overflow-hidden border border-indigo-200 relative group cursor-pointer shadow-2xs"
                      onClick={() => setFullImageUrl(plotInfo.overview_image_url || plotInfo.current_image_url || plotInfo.cover_image)}
                      title="คลิกเพื่อดูรูปขนาดใหญ่"
                    >
                      <img 
                        src={plotInfo.overview_image_url || plotInfo.current_image_url || plotInfo.cover_image} 
                        alt={`รูปหน้าบ้านแปลง ${bookingPlotId}`} 
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" 
                      />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-[10px] font-bold bg-black/60 px-2 py-0.5 rounded-full backdrop-blur-xs flex items-center gap-1">
                          <Maximize2 size={11} /> ดูรูปใหญ่
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="sm:col-span-4 aspect-video sm:aspect-4/3 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/50 flex flex-col items-center justify-center text-indigo-300 text-xs">
                      <Home size={22} className="mb-1 text-indigo-400" />
                      <span className="text-[10px]">ยังไม่มีรูปภาพ</span>
                    </div>
                  )}

                  {/* House Details & Progress */}
                  <div className="sm:col-span-8 space-y-2">
                    <div>
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="font-bold text-indigo-900">ความคืบหน้าก่อสร้าง</span>
                        <span className="font-black text-indigo-700">{plotInfo.progress || 0}%</span>
                      </div>
                      <div className="w-full bg-slate-200/80 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-indigo-600 h-full rounded-full transition-all duration-700" 
                          style={{ width: `${Math.min(100, Math.max(0, plotInfo.progress || 0))}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      <div className="bg-white/90 p-1.5 rounded-lg border border-indigo-100 text-[11px]">
                        <span className="text-[9px] text-slate-500 font-bold block">แบบบ้าน</span>
                        <span className="font-bold text-indigo-950 truncate block">
                          {plotInfo.house_types?.type_name || plotInfo.house_model || 'แบบบ้านมาตรฐาน'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-1.5 rounded-lg border border-indigo-100 text-[11px]">
                        <span className="text-[9px] text-slate-500 font-bold block">ขนาดที่ดิน</span>
                        <span className="font-bold text-indigo-950 block">
                          {plotInfo.land_size ? `${plotInfo.land_size} ตร.ว.` : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Pricing and Net Selling Calculation */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
              <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 border-b border-slate-200 pb-1.5">
                <Receipt size={13} className="text-orange-600" /> ข้อมูลราคาขายและคำนวณราคาหลังหักส่วนลด
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1"><DollarSign size={12} className="text-slate-500" /> ราคาก่อนส่วนลด (บาท) <span className="text-rose-500">*</span></span>
                    {plotInfo?.selling_price && <span className="text-[10px] text-emerald-600 font-semibold">(ดึงจากระบบ)</span>}
                  </label>
                  <input
                    type="text"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                    placeholder="เช่น 2,793,000"
                    className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Tag size={12} className="text-rose-500" /> ส่วนลด (บาท - ใส่ 0 หากไม่มี)
                  </label>
                  <input
                    type="text"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    placeholder="0"
                    className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-rose-700 focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* Real-time Net Selling Price Banner */}
              <div className="p-3 bg-emerald-500/10 border border-emerald-300/80 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold shadow-2xs">
                    <Sparkles size={14} />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-emerald-900 block">ราคาขายสุทธิหลังหักส่วนลด (Net Selling Price)</span>
                    <span className="text-[10px] text-emerald-700">
                      {rawListPrice > 0 ? `฿${rawListPrice.toLocaleString('th-TH')} - ฿${rawDiscount.toLocaleString('th-TH')}` : 'ระบุราคาก่อนส่วนลด'}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-base font-black text-emerald-700 font-mono">
                    ฿{netSellingPrice.toLocaleString('th-TH')}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-800 ml-1">บาท</span>
                </div>
              </div>

              {/* Deposit, Payment & Contract Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <CreditCard size={12} className="text-orange-600" /> เงินจองที่รับ (บาท) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                    placeholder="10,000"
                    className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    รูปแบบการชำระ
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="mortgage">กู้สถาบันการเงิน / ธนาคาร</option>
                    <option value="cash">ชำระเงินสด / โอนเต็มจำนวน</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                    <Calendar size={12} className="text-indigo-600" /> วันที่นัดทำสัญญา
                  </label>
                  <input
                    type="date"
                    value={contractDueDate}
                    onChange={(e) => setContractDueDate(e.target.value)}
                    className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* 🌟 Optional Interested Projects (When NOT direct booking) */
          <fieldset disabled={frozen} className="space-y-3">
            <legend className="text-xs font-bold text-slate-700 mb-1.5">โครงการที่สนใจ (ไม่บังคับ เลือกได้หลายโครงการ)</legend>
            <select aria-label="เพิ่มโครงการที่สนใจ" value="" disabled={frozen || interests.length >= 20}
              onChange={event => {
                if (event.target.value && !interests.some(item => item.projectName === event.target.value)) {
                  setInterests(items => [...items, { projectName: event.target.value, plot: null }]);
                }
              }} className={fieldClass}>
              <option value="">ยังไม่ระบุ / เลือกเพิ่มโครงการ</option>
              {snapshot.projects.filter(project => !interests.some(item => item.projectName === project.name))
                .map(project => <option key={project.name}>{project.name}</option>)}
            </select>
            {interests.map(interest => (
              <div key={interest.projectName} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex justify-between gap-3 mb-2">
                  <span className="font-semibold text-xs">{interest.projectName}</span>
                  <button 
                    type="button" 
                    disabled={frozen} 
                    aria-label={`ลบความสนใจ ${interest.projectName}`}
                    onClick={() => setInterests(items => items.filter(item => item.projectName !== interest.projectName))} 
                    className="text-xs text-rose-700 font-bold hover:underline"
                  >
                    นำออก
                  </button>
                </div>
                <AvailablePlotSelect projectName={interest.projectName} value={interest.plot} disabled={frozen}
                  onChange={plot => setInterests(items => items.map(item => item.projectName === interest.projectName ? { ...item, plot } : item))} />
              </div>
            ))}
            <p className="text-[11px] text-slate-500">เลือกแปลงที่เล็งได้โดยไม่จองหรือล็อกแปลง การติดตามและเข้าชมยังอยู่ส่วนกลาง เมื่อจองจึงเชื่อมลูกค้าคนเดิมกับข้อมูลจองของโครงการ</p>
          </fieldset>
        )}

        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-bold flex items-center gap-2"><AlertCircle size={15} /> {error}</div>}
        {storageError && <p role="alert" className="text-xs text-rose-800 font-bold">{storageError}</p>}
        {uncertain && <p className="text-xs text-amber-800 font-medium">ยังยืนยันผลบันทึกไม่ได้ กรุณาลองซ้ำด้วยคำขอเดิม ข้อมูลถูกพักไว้เพื่อป้องกันสร้าง Lead ซ้ำ</p>}
        </div>

        {/* Sticky Footer Actions */}
        <div className="sticky bottom-0 z-20 px-5 sm:px-6 py-3.5 border-t border-slate-100 bg-slate-50/95 backdrop-blur-sm flex items-center justify-end gap-2.5 shrink-0">
          <button type="button" onClick={onClose} disabled={frozen} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors cursor-pointer">
            ยกเลิก
          </button>
          <button 
            type="submit" 
            disabled={saving || !!storageError} 
            className={`rounded-xl text-white px-5 py-2 font-bold text-xs shadow-sm disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer ${isDirectBooking ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-700 hover:bg-blue-800'}`}
          >
            {saving ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                กำลังบันทึก...
              </>
            ) : uncertain ? (
              'ลองบันทึกซ้ำด้วยคำขอเดิม'
            ) : isDirectBooking ? (
              <>
                <CheckCircle2 size={14} />
                บันทึก Lead และยืนยันการจองแปลง
              </>
            ) : (
              'บันทึก Lead ส่วนกลาง'
            )}
          </button>
        </div>
      </form>

      {/* 🌟 Lightbox Image Zoom Modal */}
      {fullImageUrl && (
        <div 
          className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setFullImageUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-transparent rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center">
            <button
              type="button"
              onClick={() => setFullImageUrl(null)}
              className="absolute top-3 right-3 p-2 text-white bg-black/60 hover:bg-black/80 rounded-full transition-colors cursor-pointer z-10"
              aria-label="ปิดรูปภาพ"
            >
              <X size={20} />
            </button>
            <img 
              src={fullImageUrl} 
              alt="รูปหน้าบ้านขนาดใหญ่" 
              className="max-h-[85vh] w-auto object-contain rounded-xl shadow-2xl" 
            />
          </div>
        </div>
      )}
    </>
  );
}
