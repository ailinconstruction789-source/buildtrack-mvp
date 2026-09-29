'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Map as MapIcon, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import { projectMapApi, type ProjectMapApi } from '@/lib/sales/projectMapClient';
import { buildProjectMap, type ProjectMapRegion, type ProjectMapSnapshot } from '@/lib/sales/projectMapContracts';
import { bookingRoundLabel, displayBookingHistoryDate } from '@/lib/sales/importedBookingHistory';
import type { ProjectSaleRow } from '@/lib/sales/projectSalesContracts';

interface Props { projectName: string; api?: ProjectMapApi }
const statuses = {
  available: { label: 'ว่าง', style: 'border-slate-400 bg-white text-slate-800' },
  booked: { label: 'จอง / อยู่ระหว่างดำเนินการ', style: 'border-emerald-600 bg-emerald-50 text-emerald-950' },
  transferred: { label: 'โอนแล้ว / ส่งมอบ', style: 'border-violet-600 bg-violet-50 text-violet-950' },
  unknown: { label: 'ต้องตรวจสอบ', style: 'border-amber-600 bg-amber-50 text-amber-950' },
} as const;
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-40';
const linkClass = 'inline-block rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100';
const money = (value: number | null) => value === null ? 'ไม่ทราบ' : `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;

function SaleDetails({ sale }: { sale: ProjectSaleRow }) {
  return <div className="space-y-2 text-sm">
    <p className="font-semibold text-slate-900">{sale.customerName}</p>
    <p>ผู้ดูแล: {sale.ownerName || 'ไม่ทราบ'}</p>
    <p>{bookingRoundLabel(sale.bookingRound)}</p>
    <p>วันที่จอง: {displayBookingHistoryDate(sale.bookedAt, sale.importedHistory?.bookedDate)}</p>
    <p>ราคาขาย: {money(sale.salePrice)}</p>
    {sale.stage === 'cancelled' && <><p className="font-semibold text-rose-700">ยกเลิกจอง</p>
      <p>วันที่ยกเลิก: {displayBookingHistoryDate(sale.cancelledAt, sale.importedHistory?.cancelledDate)}</p>
      <p>เหตุผลยกเลิก: {sale.cancellationReason || 'ไม่ทราบ'}</p></>}
    {['transferred', 'handover'].includes(sale.stage) && <p>วันที่โอนตามข้อมูลเดิม: {displayBookingHistoryDate(null, sale.importedHistory?.transferredDate)}</p>}
    <Link prefetch={false} className={linkClass} href={`/sales-crm/bookings?customerId=${encodeURIComponent(sale.customerId)}`}
      aria-label={`ประวัติการจองของ ${sale.customerName} ${bookingRoundLabel(sale.bookingRound)}`}>เปิดประวัติการจองลูกค้า →</Link>
  </div>;
}

function PlotDetails({ region }: { region: ProjectMapRegion }) {
  return <aside aria-label={`รายละเอียดแปลง ${region.name}`} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 lg:w-80 lg:shrink-0">
    <h3 className="text-lg font-bold text-slate-900">แปลง {region.name}</h3>
    <p className="mt-1 font-semibold">{statuses[region.status].label}</p>
    <p className="mt-2 text-sm text-slate-600">งานก่อสร้าง: {region.isCompleted === true ? 'สร้างเสร็จ' : region.isCompleted === false ? 'ยังไม่เสร็จ' : 'ไม่ทราบ'} (แยกจากสถานะการขาย)</p>
    {region.status === 'unknown' && <p className="my-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">ข้อมูลสถานะแปลงหรือการจองไม่ตรงกัน / ยังจับคู่ไม่ได้ กรุณาให้ Admin ตรวจสอบ ไม่ถือเป็นแปลงว่าง</p>}
    {region.currentSale && <section aria-label="ลูกค้าปัจจุบัน" className="mt-4 border-t border-slate-100 pt-3"><h4 className="mb-2 font-semibold">ลูกค้าปัจจุบัน</h4><SaleDetails sale={region.currentSale} /></section>}
    {region.status === 'available' && <div className="mt-4 space-y-2"><p className="text-sm text-slate-600">เลือกลูกค้าและทำรายการจองผ่านระบบส่วนกลาง</p><Link href="/sales-crm" prefetch={false} className={linkClass}>Lead ส่วนกลาง →</Link></div>}
    <section aria-label="ประวัติของแปลง" className="mt-5 border-t border-slate-100 pt-3">
      <h4 className="font-semibold">ประวัติการจอง ({region.history.length})</h4>
      {region.history.length === 0 ? <p className="mt-2 text-sm text-slate-500">ไม่พบประวัติการจองที่ผูกกับแปลงนี้</p> :
        <ul className="mt-3 space-y-3">{region.history.map(sale => <li key={sale.saleId} className="rounded-lg border border-slate-200 p-3"><SaleDetails sale={sale} /></li>)}</ul>}
    </section>
  </aside>;
}

export default function ProjectSalesMap(props: Props) {
  return <ProjectMapSession key={props.projectName} {...props} />;
}

function ProjectMapSession({ projectName, api = projectMapApi }: Props) {
  const [refresh, setRefresh] = useState(0), [zoom, setZoom] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ refresh: number; snapshot?: ProjectMapSnapshot; model?: ReturnType<typeof buildProjectMap>; error?: string }>({ refresh: -1 });
  const snapshot = loaded.refresh === refresh ? loaded.snapshot : undefined;
  const model = loaded.refresh === refresh ? loaded.model : undefined;
  const error = loaded.refresh === refresh ? loaded.error : undefined;
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => api.read(projectName)).then(value => {
      if (cancelled) return;
      if (value.projectName !== projectName) throw new Error('Project mismatch');
      const nextModel = buildProjectMap(value);
      setLoaded({ refresh, snapshot: value, model: nextModel });
    }).catch(() => {
      if (!cancelled) setLoaded({ refresh, error: 'อ่านผังโครงการไม่ได้ กรุณาลองโหลดใหม่ หรือติดต่อ Admin ตรวจสิทธิ์และข้อมูลผัง' });
    });
    return () => { cancelled = true; };
  }, [api, projectName, refresh]);
  const allRegions = model ? [...model.regions, ...model.unmappedPlots] : [];
  const selected = allRegions.find(region => region.key === selectedKey);
  // Counts describe unique plot identities, even when a stored layout repeats a region.
  const unique = [...new Map(allRegions.map(region => [region.plotId ?? region.key, region])).values()];
  const unit = 40 * zoom;
  const plotButton = (region: ProjectMapRegion, positioned: boolean) => <button type="button" key={region.key}
    aria-label={`แปลง ${region.name} — ${statuses[region.status].label}`} aria-pressed={selectedKey === region.key}
    onClick={() => setSelectedKey(region.key)}
    className={`${positioned ? 'absolute overflow-hidden p-0.5' : 'min-h-14 rounded-lg border p-2 text-left'} focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${!positioned ? statuses[region.status].style : ''}`}
    style={positioned ? { left: region.x * unit, top: region.y * unit, width: region.width * unit, height: region.height * unit } : undefined}>
    <span className={`flex h-full w-full flex-col items-center justify-center rounded-md border-2 ${statuses[region.status].style} ${selectedKey === region.key ? 'ring-2 ring-blue-600 ring-inset' : ''}`}>
      <span className="break-words text-xs font-bold">{region.name}</span>
      <span className="max-w-full truncate text-[9px]">{statuses[region.status].label}</span>
      {region.isCompleted === true && <span className="max-w-full truncate text-[9px] font-semibold text-blue-700">สร้างเสร็จ</span>}
    </span>
  </button>;
  return <section aria-label={`ผังโครงการ ${projectName}`} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><MapIcon size={20} aria-hidden="true" />ผังโครงการ {projectName}</h2>
        <p className="mt-1 text-xs text-slate-500">ผังเดิม · เชื่อมข้อมูลจองส่วนกลาง · อ่านอย่างเดียว</p></div>
      <button type="button" className={buttonClass} onClick={() => { setSelectedKey(null); setRefresh(current => current + 1); }}><RefreshCw size={15} aria-hidden="true" />โหลดผังล่าสุด</button>
    </div>
    {!snapshot && !error && <p role="status" className="rounded-xl bg-slate-50 p-5 text-slate-600">กำลังโหลดผังและสถานะการจอง…</p>}
    {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">{error}</p>}
    {snapshot && model && <>
      <ul aria-label="สถานะแปลง" className="flex flex-wrap gap-2">{(Object.keys(statuses) as Array<keyof typeof statuses>).map(status => <li key={status} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${statuses[status].style}`}>{statuses[status].label}: {unique.filter(region => region.status === status).length}</li>)}</ul>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
          {snapshot.layout.cells.length > 0 ? <>
            <div role="group" aria-label="ปรับขนาดผัง" className="flex gap-2">
              <button type="button" aria-label="ย่อผัง" className={buttonClass} disabled={zoom <= 0.25} onClick={() => setZoom(current => Math.max(0.25, current - 0.25))}><ZoomOut size={16} /></button>
              <button type="button" aria-label="คืนขนาดผัง 100%" className={buttonClass} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="ขยายผัง" className={buttonClass} disabled={zoom >= 2.5} onClick={() => setZoom(current => Math.min(2.5, current + 0.25))}><ZoomIn size={16} /></button>
            </div>
            <div role="region" aria-label="พื้นที่ผังแปลง เลื่อนเพื่อดูทั้งโครงการ" tabIndex={0} className="max-h-[65vh] min-h-64 w-full overflow-auto rounded-xl border border-slate-300 bg-slate-200 focus-visible:outline-2 focus-visible:outline-blue-600">
              <div data-testid="saved-project-layout" className="relative shrink-0 bg-slate-200" style={{ width: snapshot.layout.cols * unit, height: snapshot.layout.rows * unit, backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)', backgroundSize: `${unit}px ${unit}px` }}>
                {snapshot.layout.cells.filter(cell => cell.type !== 'plot').map((cell, index) => <div aria-hidden="true" key={`${cell.x}-${cell.y}-${index}`} data-testid={`map-${cell.type}`} className={`pointer-events-none absolute flex items-center justify-center ${cell.type === 'road' ? 'bg-slate-400' : cell.type === 'park' ? 'bg-green-200' : 'z-10'}`} style={{ left: cell.x * unit, top: cell.y * unit, width: unit, height: unit }}>
                  {cell.type === 'road' && cell.x % 3 === 0 && <span className="h-0.5 w-4 bg-yellow-300/70" />}
                  {cell.type === 'fence-h' && <span className="h-1 w-full border-y border-slate-700 bg-slate-500" />}
                  {cell.type === 'fence-v' && <span className="h-full w-1 border-x border-slate-700 bg-slate-500" />}
                  {cell.type === 'infra-h' && <span className="h-1 w-full border-t-2 border-dashed border-blue-600" />}
                  {cell.type === 'infra-v' && <span className="h-full w-1 border-l-2 border-dashed border-blue-600" />}
                </div>)}
                {model.regions.map(region => plotButton(region, true))}
              </div>
            </div>
          </> : <p className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">โครงการนี้ยังไม่มีผังที่บันทึกไว้ แสดงรายการแปลงด้านล่างโดยไม่สร้างตำแหน่งผังขึ้นเอง</p>}
          {model.unmappedPlots.length > 0 && <section aria-label="แปลงที่ยังไม่มีตำแหน่งบนผัง" className="rounded-xl border border-slate-200 p-3"><h3 className="mb-3 text-sm font-semibold">แปลงที่ยังไม่มีตำแหน่งบนผัง ({model.unmappedPlots.length})</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{model.unmappedPlots.map(region => plotButton(region, false))}</div></section>}
        </div>
        {selected ? <PlotDetails region={selected} /> : <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 lg:w-72 lg:shrink-0">เลือกแปลงเพื่อดูผู้จองและประวัติยกเลิก โดยไม่แก้ข้อมูล</p>}
      </div>
    </>}
  </section>;
}
