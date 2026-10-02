import { useState } from 'react';
import Link from 'next/link';
import { User, Phone, MapPin, Calendar, Clock, ChevronRight, X, Sparkles, Building, BookmarkCheck, FileText, ExternalLink, Filter, Search } from 'lucide-react';
import type { CentralSearchSnapshot } from '@/lib/sales/centralContracts';
import { CENTRAL_PAGE_SIZE } from '@/lib/sales/centralContracts';
import { EMPTY_TRACKER_FILTERS, TRACKER_STATUS_LABELS, trackerStatusLabel, type CentralTrackerFilters } from '@/lib/sales/centralTracker';
import { LeadTrackerTable } from './LeadTrackerPresentation';

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

export default function CentralLeadTracker({ snapshot, filters, onFilterChange, onApply, leadWorkEnabled, bookingEnabled = false, visitsEnabled = false, disabled = false }: Props) {
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const visible = snapshot.customers || [];
  const ownerName = (id: string) => snapshot.search?.owners?.find(owner => owner.userId === id)?.displayName || 'ไม่ทราบชื่อผู้ดูแล';
  const change = (next: Partial<CentralTrackerFilters>) => onFilterChange({ ...filters, ...next });
  const projects = snapshot.search?.projects || [];
  const channels = snapshot.search?.channels || [];
  const changed = JSON.stringify(filters) !== JSON.stringify(snapshot.search?.filters || {});
  const scopeLink = (customerId: string, interestId?: string) => `/sales-crm/${encodeURIComponent(customerId)}${interestId ? `?interestId=${encodeURIComponent(interestId)}` : ''}`;

  return <div className="space-y-4">
    <form aria-label="ค้นหา Lead ทั้งทะเบียน" onSubmit={event => { event.preventDefault(); if (!disabled) onApply(filters); }}>
    <fieldset disabled={disabled} aria-label="ตัวกรอง Lead" className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm disabled:opacity-50">
      <div className="relative min-w-56 flex-1">
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
      <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none px-1"><input type="checkbox" checked={filters.unassignedOnly}
        onChange={event => change({ unassignedOnly: event.target.checked, project: '' })} className="rounded text-blue-600 focus:ring-blue-500" />ยังไม่ระบุโครงการเท่านั้น</label>
      <div className="flex items-center gap-2">
        <button type="submit" className="rounded-xl bg-blue-700 hover:bg-blue-800 transition-colors px-4 py-2 text-xs font-bold text-white shadow-sm">ค้นหา / ใช้ตัวกรอง</button>
        <button type="button" onClick={() => { onFilterChange({ ...EMPTY_TRACKER_FILTERS }); onApply({ ...EMPTY_TRACKER_FILTERS }); }} className="text-xs font-bold text-slate-500 hover:text-blue-700 px-2 py-1 underline">ล้างตัวกรอง</button>
      </div>
    </fieldset>
    </form>
    {changed && <p className="px-2 text-xs font-medium text-amber-700">⚠️ มีการเปลี่ยนเงื่อนไข กดค้นหา / ใช้ตัวกรองเพื่ออัปเดตข้อมูล</p>}
    {snapshot.search.hasMoreChannels && <p className="px-2 text-xs text-slate-500">แนะนำช่องทางจากทั้งทะเบียน 200 ชื่อแรก สามารถพิมพ์ชื่อช่องทางอื่นให้ตรงได้</p>}
    <div className="flex items-center justify-between px-2 text-xs font-medium text-slate-500">
      <span>แสดง {visible.length} รายการในหน้านี้ (คลิกแถวเพื่อดูรายละเอียดด่วน)</span>
      <span className="text-[11px] text-slate-400">ค้นหาและกรองจาก Lead ทั้งทะเบียนก่อนแบ่งหน้า</span>
    </div>

    <LeadTrackerTable columns={columns}>
      {!visible.length && <tr><td colSpan={columns.length} className="p-12 text-center text-slate-400 font-medium">ไม่พบรายการตามเงื่อนไขในหน้านี้</td></tr>}
      {visible.map((customer, index) => <tr key={customer.id} onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button')) return;
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
        <td className="min-w-44 space-y-1.5 p-3.5 text-slate-700 text-xs"><p><span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 font-bold text-slate-700 text-[11px]">Lead: {trackerStatusLabel(customer.intakeStatus)}</span></p>
          {customer.interests.map(interest => <p key={interest.id} className="text-[11px] text-slate-600">{interest.projectName}: <span className="font-semibold text-blue-700">{trackerStatusLabel(interest.engagementStatus)}</span></p>)}
        </td>
        <td className="min-w-48 space-y-1.5 p-3.5 text-blue-700">
          <button type="button" onClick={() => setSelectedCustomer(customer)} className="w-full text-center py-1 px-2 mb-1 rounded-lg bg-blue-600 text-white font-bold text-[11px] hover:bg-blue-700 shadow-xs flex items-center justify-center gap-1 transition-colors">
            <User size={12} /> ข้อมูลด่วน / จัดการ
          </button>
          {visitsEnabled && !disabled && customer.interests.map(interest => <Link key={`visit-${interest.id}`}
            href={`/sales-crm/visits?${new URLSearchParams({ customerId: customer.id, interestId: interest.id })}`} prefetch={false}
            aria-label={`นัดหมายและเข้าชม ${interest.projectName} ของ ${customer.name}`}
            className="block rounded-lg border border-indigo-200 bg-indigo-50/90 px-2 py-1 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100 transition-colors">
            นัดหมาย / เข้าชม {interest.projectName} →</Link>)}
          {bookingEnabled && !disabled && <Link href={`/sales-crm/bookings?customerId=${encodeURIComponent(customer.id)}`} prefetch={false}
            aria-label={`จองและประวัติของ ${customer.name}`} className="block rounded-lg border border-orange-200 bg-orange-50/90 px-2 py-1 text-[11px] font-semibold text-orange-800 hover:bg-orange-100 transition-colors">จอง / ประวัติการจอง →</Link>}
          {leadWorkEnabled && !disabled ? <>
            <Link href={scopeLink(customer.id)} prefetch={false} aria-label={`งานส่วนกลางของ ${customer.name}`} className="block text-[11px] font-semibold hover:underline">ดูงานส่วนกลาง →</Link>
            {customer.interests.map(interest => <Link key={interest.id} href={scopeLink(customer.id, interest.id)} prefetch={false}
              aria-label={`ติดตามโครงการ ${interest.projectName} ของ ${customer.name}`} className="block text-[11px] hover:underline">ติดตาม {interest.projectName} →</Link>)}
          </> : <span className="text-slate-400 text-[11px]">{disabled ? 'มีแบบฟอร์มเปิดอยู่' : ''}</span>}
        </td>
      </tr>)}
    </LeadTrackerTable>
    <p className="px-2 text-[11px] text-slate-400">สถานะ CRM คือสถานะการติดตาม ไม่ใช่สถานะจอง · ลูกค้ายังอยู่ใน Lead ส่วนกลางแม้เข้าชมหรือมีงานหลายโครงการ</p>

    {/* 🌟 Customer Detail Slide-Over Drawer */}
    {selectedCustomer && (
      <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
        <div className="relative w-full max-w-md bg-white h-full shadow-2xl p-6 overflow-y-auto space-y-6 flex flex-col justify-between animate-in slide-in-from-right duration-300">
          <div className="space-y-6">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700 font-black text-lg">
                  {selectedCustomer.name.slice(0, 1)}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">{selectedCustomer.name}</h3>
                  <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <Phone size={12} className="text-slate-400" />
                    {selectedCustomer.phone ? (
                      <a href={`tel:${selectedCustomer.phone}`} className="text-blue-600 hover:underline">{selectedCustomer.phone}</a>
                    ) : 'ไม่ระบุเบอร์โทร'}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedCustomer(null)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                <X size={20} />
              </button>
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
                  <FileText size={14} className="text-amber-600" /> หมายเหตุ / ความต้องการ
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
                          <Link href={`/sales-crm/visits?${new URLSearchParams({ customerId: selectedCustomer.id, interestId: interest.id })}`}
                            className="flex-1 text-center py-1.5 px-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-100 transition-colors">
                            📅 นัดเข้าชม
                          </Link>
                        )}
                        {leadWorkEnabled && (
                          <Link href={scopeLink(selectedCustomer.id, interest.id)}
                            className="flex-1 text-center py-1.5 px-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 transition-colors">
                            📝 ติดตามงาน
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-2">
            {bookingEnabled && (
              <Link href={`/sales-crm/bookings?customerId=${encodeURIComponent(selectedCustomer.id)}`}
                className="w-full py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm text-center block shadow-sm transition-colors">
                🏷️ บันทึกการจอง / ดูประวัติจอง
              </Link>
            )}
            <button type="button" onClick={() => setSelectedCustomer(null)}
              className="w-full py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors">
              ปิดแผงข้อมูล
            </button>
          </div>
        </div>
      </div>
    )}
  </div>;
}
