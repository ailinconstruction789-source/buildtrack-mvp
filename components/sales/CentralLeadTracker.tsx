'use client';

import Link from 'next/link';
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
  disabled?: boolean;
}
const selectClass = 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500';
const columns = ['No.', 'วันที่เป็น Lead', 'ชื่อลูกค้า', 'เบอร์โทร', 'โครงการที่สนใจ', 'ช่องทาง', 'ผู้ดูแล', 'แปลงที่เล็ง', 'สถานะ CRM', 'Follow-up'];

export default function CentralLeadTracker({ snapshot, filters, onFilterChange, onApply, leadWorkEnabled, bookingEnabled = false, disabled = false }: Props) {
  const visible = snapshot.customers;
  const ownerName = (id: string) => snapshot.search.owners.find(owner => owner.userId === id)?.displayName || 'ไม่ทราบชื่อผู้ดูแล';
  const change = (next: Partial<CentralTrackerFilters>) => onFilterChange({ ...filters, ...next });
  const projects = snapshot.search.projects;
  const channels = snapshot.search.channels;
  const changed = JSON.stringify(filters) !== JSON.stringify(snapshot.search.filters);
  const scopeLink = (customerId: string, interestId?: string) => `/sales-crm/${encodeURIComponent(customerId)}${interestId ? `?interestId=${encodeURIComponent(interestId)}` : ''}`;

  return <div className="space-y-3">
    <form aria-label="ค้นหา Lead ทั้งทะเบียน" onSubmit={event => { event.preventDefault(); if (!disabled) onApply(filters); }}>
    <fieldset disabled={disabled} aria-label="ตัวกรอง Lead" className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm disabled:opacity-50">
      <input aria-label="ค้นหาลูกค้าทั้งทะเบียน" value={filters.search} onChange={event => change({ search: event.target.value })}
        placeholder="ค้นหาชื่อ เบอร์ แปลง หรือโน้ตทั้งทะเบียน…" className={`min-w-48 flex-1 ${selectClass}`} />
      <select aria-label="โครงการที่สนใจ" className={selectClass} value={filters.project} onChange={event => change({ project: event.target.value, unassignedOnly: false })}>
        <option value="">ทุกโครงการ</option>{projects.map(project => <option key={project}>{project}</option>)}
      </select>
      <input aria-label="ช่องทางรับ Lead" list="central-channel-options" placeholder="ทุกช่องทาง / พิมพ์ชื่อช่องทาง" className={selectClass}
        value={filters.channel} onChange={event => change({ channel: event.target.value })} />
      <datalist id="central-channel-options">{channels.map(channel => <option key={channel} value={channel}>{channel}</option>)}</datalist>
      <select aria-label="Sales ผู้ดูแล" className={selectClass} value={filters.owner} onChange={event => change({ owner: event.target.value })}>
        <option value="">Sales ทุกคน</option>{snapshot.search.owners.map(owner => <option key={owner.userId} value={owner.userId}>{owner.displayName}</option>)}
      </select>
      <select aria-label="สถานะ CRM" className={selectClass} value={filters.status} onChange={event => change({ status: event.target.value })}>
        <option value="">ทุกสถานะ CRM</option>{Object.entries(TRACKER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={filters.unassignedOnly}
        onChange={event => change({ unassignedOnly: event.target.checked, project: '' })} />ยังไม่ระบุโครงการเท่านั้น</label>
      <button type="submit" className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white">ค้นหา / ใช้ตัวกรอง</button>
      <button type="button" onClick={() => { onFilterChange({ ...EMPTY_TRACKER_FILTERS }); onApply({ ...EMPTY_TRACKER_FILTERS }); }} className="text-xs font-semibold text-blue-700 underline">ล้างตัวกรอง</button>
    </fieldset>
    </form>
    {changed && <p className="px-1 text-xs text-amber-700">เปลี่ยนเงื่อนไขแล้ว กดค้นหา / ใช้ตัวกรองเพื่อแสดงผลใหม่</p>}
    {snapshot.search.hasMoreChannels && <p className="px-1 text-xs text-slate-500">แนะนำช่องทางจากทั้งทะเบียน 200 ชื่อแรก สามารถพิมพ์ชื่อช่องทางอื่นให้ตรงได้</p>}
    <p className="px-1 text-xs text-slate-500">แสดง {visible.length} รายการในหน้านี้ · ค้นหาและกรองจาก Lead ทั้งทะเบียนก่อนแบ่งหน้า ไม่ใช่ยอดรวมทั้งระบบ</p>
    <LeadTrackerTable columns={columns}>
      {!visible.length && <tr><td colSpan={columns.length} className="p-10 text-center text-slate-500">ไม่พบรายการตามเงื่อนไขในหน้านี้</td></tr>}
      {visible.map((customer, index) => <tr key={customer.id} className="align-top transition-colors hover:bg-slate-50/80">
        <td className="p-3 font-bold text-slate-400">{snapshot.page * CENTRAL_PAGE_SIZE + index + 1}</td>
        <td className="whitespace-nowrap p-3 text-slate-500">{customer.leadCreatedAt && Number.isFinite(Date.parse(customer.leadCreatedAt))
          ? new Date(customer.leadCreatedAt).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ไม่ทราบวันที่'}</td>
        <td className="min-w-40 p-3"><span className="font-bold text-slate-900">{customer.name}</span>
          {customer.notes && <p className="mt-1 line-clamp-2 max-w-64 text-[11px] text-slate-500" title={customer.notes}>{customer.notes}</p>}</td>
        <td className="whitespace-nowrap p-3 font-mono text-slate-600">{customer.phone ?? 'ไม่ทราบ (ข้อมูลเก่า)'}</td>
        <td className="min-w-40 p-3"><div className="space-y-2">
          {!customer.interests.length && <span className="text-slate-400">ยังไม่ระบุโครงการ</span>}
          {customer.interests.map(interest => <div key={interest.id} className="rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5 text-blue-800">{interest.projectName}</div>)}
        </div></td>
        <td className="whitespace-nowrap p-3 text-slate-600">{customer.channel || 'ไม่ทราบช่องทาง'}</td>
        <td className="min-w-44 space-y-2 p-3 text-slate-600">
          <p>Lead: {ownerName(customer.ownerUserId)}{customer.ownerUserId === snapshot.actor.userId ? ' (คุณ)' : ''}</p>
          {customer.interests.map(interest => <p key={interest.id}>{interest.projectName}: {ownerName(interest.ownerUserId)}</p>)}
        </td>
        <td className="min-w-36 space-y-2 p-3 text-indigo-700">
          {customer.interests.some(interest => interest.plotId) ? customer.interests.filter(interest => interest.plotId).map(interest =>
            <p key={interest.id}>{interest.projectName}: {interest.plotId}</p>) : <span className="text-slate-400">ยังไม่ระบุแปลง</span>}
        </td>
        <td className="min-w-44 space-y-2 p-3 text-slate-700"><p>Lead: {trackerStatusLabel(customer.intakeStatus)}</p>
          {customer.interests.map(interest => <p key={interest.id}>{interest.projectName}: {trackerStatusLabel(interest.engagementStatus)}</p>)}
        </td>
        <td className="min-w-44 space-y-2 p-3 text-blue-700">
          {bookingEnabled && !disabled && <Link href={`/sales-crm/bookings?customerId=${encodeURIComponent(customer.id)}`} prefetch={false}
            aria-label={`จองและประวัติของ ${customer.name}`} className="block rounded-lg border border-orange-200 bg-orange-50 px-2 py-1.5 font-semibold text-orange-800">จอง / ประวัติการจอง →</Link>}
          {leadWorkEnabled && !disabled ? <>
            <Link href={scopeLink(customer.id)} prefetch={false} aria-label={`งานส่วนกลางของ ${customer.name}`} className="block font-semibold hover:underline">ดูงานส่วนกลาง →</Link>
            {customer.interests.map(interest => <Link key={interest.id} href={scopeLink(customer.id, interest.id)} prefetch={false}
              aria-label={`ติดตามโครงการ ${interest.projectName} ของ ${customer.name}`} className="block hover:underline">ติดตาม {interest.projectName} →</Link>)}
          </> : <span className="text-slate-400">{disabled ? 'มีแบบฟอร์มเปิดอยู่' : 'ยังไม่เปิดงานติดตาม'}</span>}
        </td>
      </tr>)}
    </LeadTrackerTable>
    <p className="px-1 text-xs text-slate-500">สถานะ CRM คือสถานะการติดตาม ไม่ใช่สถานะจอง · ลูกค้ายังอยู่ใน Lead ส่วนกลางแม้เข้าชมหรือมีงานหลายโครงการ</p>
  </div>;
}
