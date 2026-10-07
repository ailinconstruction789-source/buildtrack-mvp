import { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  User, Phone, MapPin, Calendar, Clock, ChevronRight, X, Sparkles, 
  Building, BookmarkCheck, FileText, ExternalLink, Filter, Search, 
  CheckCircle2, RefreshCw, Tag, AlertCircle, History, ArrowRight, Key
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { CentralSearchSnapshot } from '@/lib/sales/centralContracts';
import { CENTRAL_PAGE_SIZE } from '@/lib/sales/centralContracts';
import { EMPTY_TRACKER_FILTERS, TRACKER_STATUS_LABELS, trackerStatusLabel, type CentralTrackerFilters } from '@/lib/sales/centralTracker';
import { LeadTrackerTable } from './LeadTrackerPresentation';
import CentralVisitAppointmentModal from './CentralVisitAppointmentModal';
import CentralLeadFollowUpModal from './CentralLeadFollowUpModal';
import CentralLeadBookingModal from './CentralLeadBookingModal';
import RentalContractModal from './RentalContractModal';
import RentalActionModal from './RentalActionModal';

interface Props {
  snapshot: CentralSearchSnapshot;
  filters: CentralTrackerFilters;
  onFilterChange: (filters: CentralTrackerFilters) => void;
  onApply: (filters: CentralTrackerFilters) => void;
  leadWorkEnabled: boolean;
  bookingEnabled?: boolean;
  visitsEnabled?: boolean;
  disabled?: boolean;
}

const selectClass = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs';
const columns = ['No.', 'วันที่เป็น Lead', 'ชื่อลูกค้า', 'เบอร์โทร', 'โครงการที่สนใจ', 'ช่องทาง', 'ผู้ดูแล', 'แปลงที่เล็ง', 'สถานะ CRM', 'Follow-up'];

export function getCustomerStageCategory(customer: any): 'active' | 'rented' | 'booked' | 'lost' {
  const statusLower = (customer.intakeStatus || customer.status || '').toLowerCase();
  const notesLower = (customer.notes || '').toLowerCase();
  
  // 1. Check if Rented
  if (
    statusLower.includes('rent') ||
    statusLower.includes('เช่า') ||
    notesLower.includes('สัญญาเช่า') ||
    notesLower.includes('ผู้เช่า')
  ) {
    return 'rented';
  }

  // 2. Check if Booked
  if (
    statusLower === 'booked' || 
    statusLower === 'contracted' || 
    statusLower === 'reserved' || 
    statusLower === 'closed_won' ||
    (customer.notes && customer.notes.includes('🏷️ บันทึกการจอง'))
  ) {
    return 'booked';
  }
  
  // 3. Check if Lost / Cold / Inactive
  if (
    statusLower === 'lost' || 
    statusLower === 'nurture' || 
    statusLower === 'cold' || 
    statusLower === 'unqualified' || 
    statusLower === 'dropped' || 
    statusLower === 'cancelled' ||
    statusLower === 'closed_lost'
  ) {
    return 'lost';
  }
  
  // Also check customer interests
  if (customer.interests && customer.interests.length > 0) {
    const hasBookedInterest = customer.interests.some((i: any) => 
      (i.engagementStatus || '').toLowerCase() === 'booked'
    );
    if (hasBookedInterest) return 'booked';

    const allLost = customer.interests.every((i: any) => 
      ['lost', 'nurture', 'cold', 'unqualified'].includes((i.engagementStatus || '').toLowerCase())
    );
    if (allLost && (statusLower === 'lost' || statusLower === 'nurture')) return 'lost';
  }

  // 4. Default is Active
  return 'active';
}

export default function CentralLeadTracker({ snapshot, filters, onFilterChange, onApply, leadWorkEnabled, bookingEnabled = false, visitsEnabled = false, disabled = false }: Props) {
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [appointmentTarget, setAppointmentTarget] = useState<{ customer: any; interest?: any } | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<{ customer: any; interest?: any } | null>(null);
  const [bookingTarget, setBookingTarget] = useState<{ customer: any; interest?: any } | null>(null);
  const [rentalTarget, setRentalTarget] = useState<{ customer: any; interest?: any } | null>(null);
  const [rentalActionTarget, setRentalActionTarget] = useState<{ customer: any; interest?: any } | null>(null);
  const [appointmentNotice, setAppointmentNotice] = useState('');
  
  // 🌟 Smart Stage Filter State: 'active' | 'rented' | 'booked' | 'lost' | 'all'
  const [viewFilter, setViewFilter] = useState<'active' | 'rented' | 'booked' | 'lost' | 'all'>('active');
  const [isReactivating, setIsReactivating] = useState(false);

  useEffect(() => {
    if (disabled) {
      setSelectedCustomer(null);
      setAppointmentTarget(null);
      setFollowUpTarget(null);
      setBookingTarget(null);
      setRentalTarget(null);
      setRentalActionTarget(null);
    }
  }, [disabled]);

  const visible = snapshot.customers || [];
  
  // Calculate counts for each stage
  const activeCount = visible.filter(c => getCustomerStageCategory(c) === 'active').length;
  const rentedCount = visible.filter(c => getCustomerStageCategory(c) === 'rented').length;
  const bookedCount = visible.filter(c => getCustomerStageCategory(c) === 'booked').length;
  const lostCount = visible.filter(c => getCustomerStageCategory(c) === 'lost').length;

  // Filter visible customers by selected stage view
  const displayedCustomers = viewFilter === 'all' 
    ? visible 
    : visible.filter(c => getCustomerStageCategory(c) === viewFilter);

  const ownerName = (id: string) => snapshot.search?.owners?.find(owner => owner.userId === id)?.displayName || (id && id !== 'unassigned' ? id : 'ส่วนกลาง / ไม่ระบุ');
  const change = (next: Partial<CentralTrackerFilters>) => onFilterChange({ ...filters, ...next });
  const projects = snapshot.search?.projects || [];
  const channels = snapshot.search?.channels || [];
  const changed = JSON.stringify(filters) !== JSON.stringify(snapshot.search?.filters || {});

  // Re-activate cold/lost lead back to active
  const handleReactivate = async (cust: any) => {
    setIsReactivating(true);
    try {
      const now = new Date();
      const timeBangkokStr = now.toLocaleDateString('th-TH', { 
        day: '2-digit', month: 'short', year: 'numeric', 
        hour: '2-digit', minute: '2-digit' 
      });
      const reactivateNote = `[${timeBangkokStr} 🔄 ดึงกลับมาติดตามต่อ (Re-activated)]\nเปลี่ยนสถานะกลับเป็น Follow Up เพื่อเริ่มติดตามงานขายใหม่`;
      const combinedNotes = cust.notes ? `${reactivateNote}\n\n---\n${cust.notes}` : reactivateNote;

      // Update leads table
      await supabase
        .from('leads')
        .update({
          status: 'Follow Up',
          notes: combinedNotes,
          updated_at: now.toISOString()
        })
        .eq('id', cust.id);

      // Record activity
      await supabase
        .from('lead_activities')
        .insert({
          lead_id: cust.id,
          activity_type: 'note',
          result: 'contact_success',
          note: reactivateNote,
          occurred_at: now.toISOString()
        });

      setAppointmentNotice(`ดึง "${cust.name}" กลับมาอยู่ในรายการ 🟢 กำลังติดตาม เรียบร้อยแล้ว!`);
      setSelectedCustomer(null);
      onApply(filters);
    } catch (err) {
      console.error('Error reactivating lead:', err);
    } finally {
      setIsReactivating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 🌟 1. Smart Stage Filter Pills Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setViewFilter('active')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              viewFilter === 'active'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${viewFilter === 'active' ? 'bg-white' : 'bg-emerald-500'}`}></span>
            🟢 กำลังติดตาม ({activeCount})
          </button>

          <button
            type="button"
            onClick={() => setViewFilter('rented')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              viewFilter === 'rented'
                ? 'bg-gradient-to-r from-blue-700 to-indigo-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Key size={13} />
            🔑 สัญญาเช่า ({rentedCount})
          </button>

          <button
            type="button"
            onClick={() => setViewFilter('booked')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              viewFilter === 'booked'
                ? 'bg-orange-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Tag size={13} />
            🏷️ จองแล้ว ({bookedCount})
          </button>

          <button
            type="button"
            onClick={() => setViewFilter('lost')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              viewFilter === 'lost'
                ? 'bg-slate-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>💤</span>
            ไม่สนใจ / พักติดตาม
          </button>

          <button
            type="button"
            onClick={() => setViewFilter('all')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              viewFilter === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            📁 ทั้งหมด
          </button>
        </div>

        <span className="hidden lg:inline-block text-[11px] text-slate-400 font-medium px-2">
          {viewFilter === 'active' && '💡 แสดงเฉพาะ Lead ที่กำลังติดตาม เพื่อให้ Sales โฟกัสงานขายได้เร็ว'}
          {viewFilter === 'booked' && '💡 ลูกค้าที่ตกลงจองแปลงแล้ว กำลังรอดำเนินการสัญญา/โอน'}
          {viewFilter === 'lost' && '💡 ลูกค้าที่พักติดตาม/ไม่สนใจ สามารถกดดึงกลับมาติดตามใหม่ได้'}
          {viewFilter === 'all' && '💡 รวมลูกค้าทุกสถานะในหน้านี้'}
        </span>
      </div>

      {/* 🌟 2. Search & Detail Filter Bar */}
      <form aria-label="ค้นหา Lead ทั้งทะเบียน" onSubmit={event => { event.preventDefault(); if (!disabled) onApply(filters); }}>
        <fieldset disabled={disabled} aria-label="ตัวกรอง Lead" className="flex flex-wrap items-center gap-2 sm:gap-2.5 rounded-2xl border border-slate-200/90 bg-white p-3.5 sm:p-4 shadow-sm disabled:opacity-50">
          <div className="relative w-full sm:w-auto sm:min-w-56 sm:flex-1">
            <Search size={14} className="absolute left-3 top-3 text-slate-400" />
            <input aria-label="ค้นหาลูกค้าทั้งทะเบียน" value={filters.search} onChange={event => change({ search: event.target.value })}
              placeholder="ค้นหาชื่อ เบอร์ แปลง หรือโน้ตทั้งทะเบียน…" className={`w-full pl-8.5 pr-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500`} />
          </div>
          <select aria-label="โครงการที่สนใจ" className={selectClass} value={filters.project} onChange={event => change({ project: event.target.value, unassignedOnly: false })}>
            <option value="">ทุกโครงการ</option>{projects.map(project => <option key={project}>{project}</option>)}
          </select>
          <input aria-label="ช่องทางรับ Lead" list="central-channel-options" placeholder="ทุกช่องทาง / พิมพ์ชื่อช่องทาง" className={selectClass}
            value={filters.channel} onChange={event => change({ channel: event.target.value })} />
          <datalist id="central-channel-options">{channels.map(channel => <option key={channel} value={channel}>{channel}</option>)}</datalist>
          <select aria-label="Sales ผู้ดูแล" className={selectClass} value={filters.owner} onChange={event => change({ owner: event.target.value })}>
            <option value="">Sales ทุกคน</option>{snapshot.search?.owners?.map(owner => <option key={owner.userId} value={owner.userId}>{owner.displayName}</option>)}
          </select>
          <select aria-label="สถานะ CRM" className={selectClass} value={filters.status} onChange={event => change({ status: event.target.value })}>
            <option value="">ทุกสถานะ CRM</option>{Object.entries(TRACKER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none px-1 py-1">
            <input type="checkbox" checked={filters.unassignedOnly}
              onChange={event => change({ unassignedOnly: event.target.checked, project: '' })} className="rounded text-blue-600 focus:ring-blue-500" />
            <span>ยังไม่ระบุโครงการเท่านั้น</span>
          </label>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button type="submit" className="rounded-xl bg-blue-700 hover:bg-blue-800 transition-colors px-4 py-2 text-xs font-bold text-white shadow-sm cursor-pointer">ค้นหา / ใช้ตัวกรอง</button>
            <button type="button" onClick={() => { onFilterChange({ ...EMPTY_TRACKER_FILTERS }); onApply({ ...EMPTY_TRACKER_FILTERS }); }} className="text-xs font-bold text-slate-500 hover:text-blue-700 px-2 py-1 underline cursor-pointer">ล้างตัวกรอง</button>
          </div>
        </fieldset>
      </form>

      {changed && <p className="px-2 text-xs font-medium text-amber-700">⚠️ มีการเปลี่ยนเงื่อนไข กดค้นหา / ใช้ตัวกรองเพื่ออัปเดตข้อมูล</p>}
      {snapshot.search.hasMoreChannels && <p className="px-2 text-xs text-slate-500">แนะนำช่องทางจากทั้งทะเบียน 200 ชื่อแรก สามารถพิมพ์ชื่อช่องทางอื่นให้ตรงได้</p>}
      
      <div className="flex items-center justify-between px-2 text-xs font-medium text-slate-500">
        <span>
          แสดง <strong>{displayedCustomers.length}</strong> รายการในหมวดนี้ (จากทั้งหมด {visible.length} รายการในหน้านี้)
        </span>
        <span className="text-[11px] text-slate-400">ค้นหาและกรองจาก Lead ทั้งทะเบียนก่อนแบ่งหน้า</span>
      </div>

      {appointmentNotice && (
        <div role="status" className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-xs font-bold text-emerald-800 flex items-center justify-between gap-2 animate-in fade-in shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600" />
            <span>{appointmentNotice}</span>
          </div>
          <button type="button" onClick={() => setAppointmentNotice('')} className="p-1 text-emerald-600 hover:text-emerald-800 rounded-lg hover:bg-emerald-100 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 🌟 3. Lead Tracker Data Table */}
      <LeadTrackerTable columns={columns}>
        {!displayedCustomers.length && (
          <tr>
            <td colSpan={columns.length} className="p-12 text-center text-slate-400 font-medium">
              ไม่พบรายการตามเงื่อนไขในหน้านี้
            </td>
          </tr>
        )}
        {displayedCustomers.map((customer, index) => {
          const stage = getCustomerStageCategory(customer);
          return (
            <tr key={customer.id} onClick={(e) => {
              if (disabled || (e.target as HTMLElement).closest('a, button')) return;
              setSelectedCustomer(customer);
            }} className="align-top transition-colors hover:bg-blue-50/50 cursor-pointer group">
              <td className="p-3.5 font-bold text-slate-400">{snapshot.page * CENTRAL_PAGE_SIZE + index + 1}</td>
              <td className="whitespace-nowrap p-3.5 text-slate-500">{customer.leadCreatedAt && Number.isFinite(Date.parse(customer.leadCreatedAt))
                ? new Date(customer.leadCreatedAt).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ไม่ทราบวันที่'}</td>
              <td className="min-w-40 p-3.5">
                <span className="font-bold text-slate-900 group-hover:text-blue-700 transition-colors flex items-center gap-1.5">{customer.name}</span>
                {customer.notes && <p className="mt-1 line-clamp-2 max-w-64 text-[11px] text-slate-500 bg-slate-50 p-1.5 rounded-lg border border-slate-100" title={customer.notes}>{customer.notes}</p>}</td>
              <td className="whitespace-nowrap p-3.5 font-mono text-slate-700 font-bold">{customer.phone ?? 'ไม่ทราบ (ข้อมูลเก่า)'}</td>
              <td className="min-w-40 p-3.5"><div className="space-y-1.5">
                {!customer.interests.length && <span className="text-slate-400 italic text-[11px]">ยังไม่ระบุโครงการ</span>}
                {customer.interests.map(interest => <div key={interest.id} className="rounded-lg border border-blue-100 bg-blue-50/80 px-2 py-1 text-[11px] font-semibold text-blue-800">{interest.projectName}</div>)}
              </div></td>
              <td className="whitespace-nowrap p-3.5 text-slate-600"><span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-medium">{customer.channel || 'ไม่ทราบช่องทาง'}</span></td>
              <td className="min-w-44 space-y-1 p-3.5 text-slate-600 text-xs">
                <p className="font-semibold text-slate-800">Lead: {ownerName(customer.ownerUserId)}{customer.ownerUserId === snapshot.actor.userId ? ' (คุณ)' : ''}</p>
                {customer.interests.map(interest => <p key={interest.id} className="text-[11px] text-slate-500">{interest.projectName}: {ownerName(interest.ownerUserId)}</p>)}
              </td>
              <td className="min-w-36 space-y-1 p-3.5 text-indigo-700 font-semibold text-xs">
                {customer.interests.some(interest => interest.plotId) ? customer.interests.filter(interest => interest.plotId).map(interest =>
                  <p key={interest.id} className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-800 border border-indigo-100 text-[11px]">{interest.projectName}: {interest.plotId}</p>) : <span className="text-slate-400 text-[11px] italic">ยังไม่ระบุแปลง</span>}
              </td>
              <td className="min-w-44 space-y-1.5 p-3.5 text-slate-700 text-xs">
                <p>
                  <span className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                    stage === 'rented'
                      ? 'bg-blue-100 text-blue-900 border border-blue-200'
                      : stage === 'booked'
                      ? 'bg-orange-100 text-orange-800 border border-orange-200'
                      : stage === 'lost'
                      ? 'bg-slate-200 text-slate-700 border border-slate-300'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}>
                    {stage === 'rented' ? '🔑 สัญญาเช่า' : stage === 'booked' ? '🏷️ จองแล้ว' : stage === 'lost' ? '💤 พักติดตาม/ไม่สนใจ' : `🟢 ${trackerStatusLabel(customer.intakeStatus)}`}
                  </span>
                </p>
                {customer.interests.map(interest => <p key={interest.id} className="text-[11px] text-slate-600">{interest.projectName}: <span className="font-semibold text-blue-700">{trackerStatusLabel(interest.engagementStatus)}</span></p>)}
              </td>
              <td className="whitespace-nowrap p-3.5 text-center">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => !disabled && setSelectedCustomer(customer)}
                  aria-label={`ข้อมูลด่วนและจัดการ ${customer.name}`}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:pointer-events-none text-white font-bold text-xs shadow-xs transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                >
                  <User size={13} /> ข้อมูลด่วน / จัดการ
                </button>
              </td>
            </tr>
          );
        })}
      </LeadTrackerTable>
      <p className="px-2 text-[11px] text-slate-400">สถานะ CRM คือสถานะการติดตาม ไม่ใช่สถานะจอง · ลูกค้ายังอยู่ใน Lead ส่วนกลางแม้เข้าชมหรือมีงานหลายโครงการ</p>

      {/* 🌟 4. Customer Detail Slide-Over Drawer */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-[200] overflow-hidden bg-slate-950/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
          <div className="relative w-full max-w-md sm:max-w-lg bg-white h-full shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-300">
            {/* Sticky Drawer Header */}
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 p-5 sm:p-6 flex items-start justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0 ${
                  getCustomerStageCategory(selectedCustomer) === 'booked'
                    ? 'bg-orange-100 border border-orange-200 text-orange-700'
                    : getCustomerStageCategory(selectedCustomer) === 'lost'
                    ? 'bg-slate-100 border border-slate-200 text-slate-700'
                    : 'bg-blue-100 border border-blue-200 text-blue-700'
                }`}>
                  {selectedCustomer.name.slice(0, 1)}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    {selectedCustomer.name}
                  </h3>
                  <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <Phone size={12} className="text-slate-400" />
                    {selectedCustomer.phone ? (
                      <a href={`tel:${selectedCustomer.phone}`} className="text-blue-600 hover:underline">{selectedCustomer.phone}</a>
                    ) : 'ไม่ระบุเบอร์โทร'}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedCustomer(null)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer">
                <X size={20} />
              </button>
            </div>

            {/* Scrollable Drawer Body */}
            <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">
              {/* Status Banner */}
              <div className={`p-3 rounded-2xl border flex items-center justify-between text-xs ${
                getCustomerStageCategory(selectedCustomer) === 'rented'
                  ? 'bg-blue-50 border-blue-200 text-blue-900'
                  : getCustomerStageCategory(selectedCustomer) === 'booked'
                  ? 'bg-orange-50 border-orange-200 text-orange-800'
                  : getCustomerStageCategory(selectedCustomer) === 'lost'
                  ? 'bg-slate-100 border-slate-200 text-slate-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}>
                <span className="font-bold">
                  {getCustomerStageCategory(selectedCustomer) === 'rented' && '🔑 สถานะ: สัญญาเช่า (Rental Contract)'}
                  {getCustomerStageCategory(selectedCustomer) === 'booked' && '🏷️ สถานะ: จองแปลงแล้ว (Booked)'}
                  {getCustomerStageCategory(selectedCustomer) === 'lost' && '💤 สถานะ: พักการติดตาม / ไม่สนใจ'}
                  {getCustomerStageCategory(selectedCustomer) === 'active' && `🟢 สถานะ: กำลังติดตาม (${trackerStatusLabel(selectedCustomer.intakeStatus)})`}
                </span>
                {getCustomerStageCategory(selectedCustomer) === 'lost' && (
                  <button
                    type="button"
                    disabled={isReactivating}
                    onClick={() => handleReactivate(selectedCustomer)}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] shadow-2xs transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={isReactivating ? 'animate-spin' : ''} />
                    ดึงกลับมาติดตามต่อ
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <span className="text-slate-400 font-bold block mb-1">ช่องทางรับ Lead</span>
                  <span className="font-black text-slate-700">{selectedCustomer.channel || 'ไม่ระบุ'}</span>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <span className="text-slate-400 font-bold block mb-1">ผู้ดูแล Lead</span>
                  <span className="font-black text-slate-700">{ownerName(selectedCustomer.ownerUserId)}</span>
                </div>
              </div>

              {selectedCustomer.notes && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-1">
                  <h4 className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                    <FileText size={14} className="text-amber-600" /> หมายเหตุ / ความต้องการ / บันทึกราคา
                  </h4>
                  <p className="text-xs text-amber-950 font-medium whitespace-pre-wrap leading-relaxed">{selectedCustomer.notes}</p>
                </div>
              )}

              <div className="space-y-3">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <Building size={16} className="text-blue-600" /> โครงการที่สนใจ ({selectedCustomer.interests?.length || 0})
                </h4>
                {!selectedCustomer.interests?.length ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400 font-medium">
                    ยังไม่ได้ระบุโครงการที่สนใจ
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedCustomer.interests.map((interest: any) => (
                      <div key={interest.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-slate-800">{interest.projectName}</span>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                            {trackerStatusLabel(interest.engagementStatus)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>แปลงที่เล็ง: <strong className="text-slate-800">{interest.plotId || 'ยังไม่ระบุ'}</strong></span>
                          <span>ผู้ดูแล: <strong className="text-slate-800">{ownerName(interest.ownerUserId)}</strong></span>
                        </div>
                        <div className="flex gap-2 pt-1 border-t border-slate-100">
                          {visitsEnabled && (
                            <button
                              type="button"
                              onClick={() => setAppointmentTarget({ customer: selectedCustomer, interest })}
                              aria-label={`นัดหมายและเข้าชม ${interest.projectName} ของ ${selectedCustomer.name}`}
                              className="flex-1 text-center py-1.5 px-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-100 transition-colors cursor-pointer flex items-center justify-center gap-1"
                            >
                              📅 นัดเข้าชม
                            </button>
                          )}
                          {leadWorkEnabled && (
                            <button
                              type="button"
                              onClick={() => setFollowUpTarget({ customer: selectedCustomer, interest })}
                              aria-label={`ติดตามโครงการ ${interest.projectName} ของ ${selectedCustomer.name}`}
                              className="flex-1 text-center py-1.5 px-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 transition-colors cursor-pointer flex items-center justify-center gap-1"
                            >
                              📝 ติดตามงาน
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* General appointment button - when no specific interest cards exist */}
              {visitsEnabled && !selectedCustomer.interests?.length && (
                <button
                  type="button"
                  onClick={() => setAppointmentTarget({ customer: selectedCustomer })}
                  className="w-full text-center py-2 px-3 rounded-xl bg-indigo-50/80 border border-indigo-200 hover:bg-indigo-100 text-indigo-800 text-xs font-bold block transition-colors cursor-pointer"
                >
                  📅 + นัดหมายเข้าชมโครงการ (เลือกโครงการ)
                </button>
              )}

              {/* General follow-up button - when no specific interest cards exist */}
              {leadWorkEnabled && !selectedCustomer.interests?.length && (
                <button
                  type="button"
                  onClick={() => setFollowUpTarget({ customer: selectedCustomer })}
                  aria-label={`งานส่วนกลางของ ${selectedCustomer.name}`}
                  className="w-full text-center py-2 px-3 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold block transition-colors cursor-pointer"
                >
                  📝 บันทึกการติดตามลูกค้า
                </button>
              )}
            </div>

            {/* Sticky Drawer Footer Actions */}
            <div className="sticky bottom-0 z-10 bg-slate-50/95 backdrop-blur-sm border-t border-slate-100 p-4 sm:p-5 space-y-2 shrink-0">
              {bookingEnabled && getCustomerStageCategory(selectedCustomer) === 'rented' && (
                <button
                  type="button"
                  onClick={() => setRentalActionTarget({ customer: selectedCustomer, interest: selectedCustomer.interests?.[0] })}
                  aria-label={`จัดการสัญญาเช่าของ ${selectedCustomer.name}`}
                  className="w-full py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-cyan-700 to-blue-800 hover:from-cyan-800 hover:to-blue-900 text-white font-bold text-xs sm:text-sm text-center block shadow-sm transition-colors cursor-pointer"
                >
                  🔑 จัดการสัญญาเช่า (เปลี่ยนเป็นซื้อ / ต่อสัญญา / ย้ายออก)
                </button>
              )}

              {bookingEnabled && getCustomerStageCategory(selectedCustomer) !== 'booked' && getCustomerStageCategory(selectedCustomer) !== 'rented' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBookingTarget({ customer: selectedCustomer, interest: selectedCustomer.interests?.[0] })}
                    aria-label={`จองและประวัติของ ${selectedCustomer.name}`}
                    className="w-full py-2.5 sm:py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs sm:text-sm text-center block shadow-sm transition-colors cursor-pointer"
                  >
                    🏷️ บันทึกการจองแปลง
                  </button>
                  <button
                    type="button"
                    onClick={() => setRentalTarget({ customer: selectedCustomer, interest: selectedCustomer.interests?.[0] })}
                    aria-label={`สัญญาเช่าของ ${selectedCustomer.name}`}
                    className="w-full py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 hover:from-blue-800 hover:to-slate-950 text-white font-bold text-xs sm:text-sm text-center block shadow-sm transition-colors cursor-pointer"
                  >
                    🔑 บันทึกสัญญาเช่า (แบบ A, B, C)
                  </button>
                </div>
              )}

              <button type="button" onClick={() => setSelectedCustomer(null)}
                className="w-full py-2 sm:py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors cursor-pointer">
                ปิดแผงข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 5. Modal Dialog for In-App Visit Appointment */}
      {appointmentTarget && (
        <CentralVisitAppointmentModal
          isOpen={!!appointmentTarget}
          onClose={() => setAppointmentTarget(null)}
          customer={appointmentTarget.customer}
          initialInterest={appointmentTarget.interest}
          projects={projects}
          salesOwners={snapshot.search?.owners || []}
          onSaved={(msg) => {
            setAppointmentNotice(msg);
            setSelectedCustomer(null);
            onApply(filters);
            setTimeout(() => setAppointmentNotice(''), 8000);
          }}
        />
      )}

      {/* 🌟 6. Modal Dialog for In-App Lead Follow-up */}
      {followUpTarget && (
        <CentralLeadFollowUpModal
          isOpen={!!followUpTarget}
          onClose={() => setFollowUpTarget(null)}
          customer={followUpTarget.customer}
          initialInterest={followUpTarget.interest}
          projects={projects}
          salesOwners={snapshot.search?.owners || []}
          onSaved={(msg) => {
            setAppointmentNotice(msg);
            setSelectedCustomer(null);
            onApply(filters);
            setTimeout(() => setAppointmentNotice(''), 8000);
          }}
        />
      )}

      {/* 🌟 7. Modal Dialog for In-App Booking */}
      {bookingTarget && (
        <CentralLeadBookingModal
          isOpen={!!bookingTarget}
          onClose={() => setBookingTarget(null)}
          customer={bookingTarget.customer}
          initialInterest={bookingTarget.interest}
          projects={projects}
          salesOwners={snapshot.search?.owners || snapshot.salesOwners || []}
          currentUser={{
            userId: snapshot.actor.userId,
            displayName: (snapshot.search?.owners || snapshot.salesOwners || []).find(o => o.userId === snapshot.actor.userId)?.displayName || 'คุณ'
          }}
          onSwitchToRental={() => {
            const cust = bookingTarget.customer;
            const inter = bookingTarget.interest;
            setBookingTarget(null);
            setRentalTarget({ customer: cust, interest: inter });
          }}
          onSaved={(msg) => {
            setAppointmentNotice(msg);
            setSelectedCustomer(null);
            onApply(filters);
            setTimeout(() => setAppointmentNotice(''), 8000);
          }}
        />
      )}

      {/* 🌟 8. Modal Dialog for In-App Rental Contract (Programs A, B, C) */}
      {rentalTarget && (
        <RentalContractModal
          isOpen={!!rentalTarget}
          onClose={() => setRentalTarget(null)}
          lead={rentalTarget.customer ? {
            id: rentalTarget.customer.id,
            customer_name: rentalTarget.customer.name,
            phone: rentalTarget.customer.phone,
            project_name: rentalTarget.interest?.projectName || projects[0] || 'ไอลิน สันทราย 2',
            interested_plot_id: rentalTarget.interest?.plotId || null,
            sales_owner: (snapshot.search?.owners || snapshot.salesOwners || []).find(o => o.userId === rentalTarget.customer.ownerUserId)?.displayName,
            agent_name: (snapshot.search?.owners || snapshot.salesOwners || []).find(o => o.userId === rentalTarget.customer.ownerUserId)?.displayName,
            created_at: new Date().toISOString()
          } : null}
          plotId={rentalTarget.interest?.plotId || null}
          projectName={rentalTarget.interest?.projectName || projects[0] || 'ไอลิน สันทราย 2'}
          salesOwners={snapshot.search?.owners || snapshot.salesOwners || []}
          user={{
            userId: snapshot.actor.userId,
            displayName: (snapshot.search?.owners || snapshot.salesOwners || []).find(o => o.userId === snapshot.actor.userId)?.displayName || 'คุณ',
            username: (snapshot.search?.owners || snapshot.salesOwners || []).find(o => o.userId === snapshot.actor.userId)?.displayName || 'คุณ'
          }}
          onSaved={() => {
            setAppointmentNotice(`🎉 บันทึกสัญญาเช่าสำเร็จสำหรับคุณ ${rentalTarget.customer.name}`);
            setSelectedCustomer(null);
            setRentalTarget(null);
            onApply(filters);
            setTimeout(() => setAppointmentNotice(''), 8000);
          }}
        />
      )}

      {/* 🌟 9. Modal Dialog for Rental Actions (Convert to Buy / Renew / Move Out) */}
      {rentalActionTarget && (
        <RentalActionModal
          isOpen={!!rentalActionTarget}
          onClose={() => setRentalActionTarget(null)}
          lead={rentalActionTarget.customer ? {
            id: rentalActionTarget.customer.id,
            customer_name: rentalActionTarget.customer.name,
            phone: rentalActionTarget.customer.phone,
            project_name: rentalActionTarget.interest?.projectName || projects[0] || 'ไอลิน สันทราย 2',
            interested_plot_id: rentalActionTarget.interest?.plotId || null,
            created_at: new Date().toISOString()
          } : null}
          onSaved={() => {
            setAppointmentNotice(`✨ อัปเดตสัญญาเช่าเรียบร้อยแล้ว`);
            setSelectedCustomer(null);
            setRentalActionTarget(null);
            onApply(filters);
            setTimeout(() => setAppointmentNotice(''), 8000);
          }}
        />
      )}
    </div>
  );
}
