'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Eraser, FlaskConical, Loader2, Paintbrush, RefreshCw, Save } from 'lucide-react';
import {
  DEMO_LAYERS, createDemoProject, isDemoAccessError, listDemoProjects, saveDemoProject,
  type DemoCell, type DemoCellKind, type DemoLayout, type DemoProject,
} from '@/lib/demoProjects';

interface Props { isAdmin: boolean; onBack: () => void; onDirtyChange?: (dirty: boolean) => void }
const buttonClass = 'rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold disabled:opacity-50';

function CellMark({ cell, color, cellKeys }: { cell: DemoCell; color: string; cellKeys: ReadonlySet<string> }) {
  if (cell.kind === 'pole') return <span className="absolute inset-[28%] z-20 rounded-full border-2 border-white shadow" style={{ backgroundColor: color }} />;
  if (['drainage', 'water', 'electric', 'fence'].includes(cell.kind)) {
    const offset: Partial<Record<DemoCellKind, string>> = { drainage: '35%', water: '55%', electric: '75%', fence: '50%' };
    const horizontal = cellKeys.has(`${cell.kind}:${cell.x - 1}:${cell.y}`) || cellKeys.has(`${cell.kind}:${cell.x + 1}:${cell.y}`);
    const vertical = cellKeys.has(`${cell.kind}:${cell.x}:${cell.y - 1}`) || cellKeys.has(`${cell.kind}:${cell.x}:${cell.y + 1}`);
    const style = { borderColor: color, borderStyle: cell.kind === 'fence' ? 'dashed' : 'solid' };
    return <>
      {(horizontal || !vertical) && <span className="pointer-events-none absolute inset-x-0 z-10 border-t-[3px]" style={{ ...style, top: offset[cell.kind] }} />}
      {vertical && <span className="pointer-events-none absolute inset-y-0 z-10 border-l-[3px]" style={{ ...style, left: offset[cell.kind] }} />}
    </>;
  }
  return <span className={`absolute ${cell.kind === 'plot' ? 'inset-[12%] rounded-sm border border-white/70' : 'inset-0'}`} style={{ backgroundColor: color, opacity: cell.kind === 'earthwork' ? 0.5 : 1 }} />;
}

/** Separate sandbox: no production project IDs, task writes, reports or upload paths. */
export default function AdminDemoProjects({ isAdmin, onBack, onDirtyChange }: Props) {
  const [projects, setProjects] = useState<DemoProject[]>([]);
  const [selected, setSelected] = useState<DemoProject | null>(null);
  const [layout, setLayout] = useState<DemoLayout | null>(null);
  const [name, setName] = useState('โครงการทดลองสาธารณูปโภค');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [layer, setLayer] = useState<DemoCellKind>('road');
  const [erase, setErase] = useState(false);
  const [visible, setVisible] = useState<Set<DemoCellKind>>(() => new Set(DEMO_LAYERS.map(item => item.kind)));
  const epoch = useRef(0);
  const createRequest = useRef<{ name: string; id: string } | null>(null);
  const operation = useRef(false);

  const gridIndex = useMemo(() => {
    const cellKeys = new Set<string>();
    const byCoord = new Map<string, DemoCell[]>();
    for (const cell of layout?.cells ?? []) {
      cellKeys.add(`${cell.kind}:${cell.x}:${cell.y}`);
      const coord = `${cell.x}:${cell.y}`;
      const bucket = byCoord.get(coord);
      if (bucket) bucket.push(cell);
      else byCoord.set(coord, [cell]);
    }
    return { cellKeys, byCoord };
  }, [layout]);

  function clearWorkspaceState() {
    setProjects([]); setSelected(null); setLayout(null); setLoaded(false); setDirty(false); createRequest.current = null;
  }

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const current = ++epoch.current;
    clearWorkspaceState(); setError(''); setNotice(''); setBusy(false); operation.current = false;
    if (!isAdmin) return;
    listDemoProjects().then(rows => {
      if (epoch.current === current) { setProjects(rows); setLoaded(true); }
    }).catch(reason => {
      if (epoch.current === current) setError(reason instanceof Error ? reason.message : 'โหลดโครงการ Demo ไม่สำเร็จ');
    });
    return () => { epoch.current++; };
  }, [isAdmin]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function mayLeave() { return !dirty || window.confirm('ผังยังไม่ได้บันทึก ต้องการออกและทิ้งการแก้ไขหรือไม่?'); }
  function open(project: DemoProject) {
    if (busy || !mayLeave()) return;
    setSelected(project); setLayout(project.layout_data); setDirty(false); setError(''); setNotice('');
  }
  async function reload() {
    if (!isAdmin || operation.current || busy || !mayLeave()) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    const current = epoch.current;
    const selectedId = selected?.id;
    try {
      const rows = await listDemoProjects();
      if (epoch.current !== current) return;
      const latest = selectedId ? rows.find(row => row.id === selectedId) ?? null : null;
      setProjects(rows); setSelected(latest); setLayout(latest ? latest.layout_data : null);
      setLoaded(true); setDirty(false);
      setNotice('โหลดข้อมูลโครงการ Demo ล่าสุดแล้ว');
    } catch (reason) {
      if (epoch.current !== current) return;
      if (isDemoAccessError(reason)) clearWorkspaceState();
      setError(reason instanceof Error ? reason.message : 'โหลดโครงการ Demo ไม่สำเร็จ');
    } finally { operation.current = false; if (epoch.current === current) setBusy(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!isAdmin || !loaded || operation.current || !name.trim() || !mayLeave()) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    const current = epoch.current;
    if (createRequest.current?.name !== name.trim()) createRequest.current = { name: name.trim(), id: crypto.randomUUID() };
    try {
      const project = await createDemoProject(name, createRequest.current.id);
      if (epoch.current !== current) return;
      setProjects(rows => [project, ...rows.filter(row => row.id !== project.id)]);
      setSelected(project); setLayout(project.layout_data); setDirty(false); createRequest.current = null;
      setNotice('สร้างโครงการ Demo พร้อมผังตัวอย่างแล้ว');
    } catch (reason) {
      if (epoch.current !== current) return;
      if (isDemoAccessError(reason)) clearWorkspaceState();
      setError(reason instanceof Error ? reason.message : 'สร้างโครงการ Demo ไม่สำเร็จ');
    } finally { operation.current = false; if (epoch.current === current) setBusy(false); }
  }
  async function save() {
    if (!isAdmin || !selected || !layout || !dirty || operation.current) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    const current = epoch.current;
    try {
      const project = await saveDemoProject(selected, layout);
      if (epoch.current !== current) return;
      setSelected(project); setLayout(project.layout_data); setDirty(false);
      setProjects(rows => rows.map(row => row.id === project.id ? project : row));
      setNotice('บันทึกผัง Demo แล้ว');
    } catch (reason) {
      if (epoch.current !== current) return;
      if (isDemoAccessError(reason)) clearWorkspaceState();
      setError(reason instanceof Error ? reason.message : 'บันทึกไม่สำเร็จ การแก้ไขยังอยู่บนหน้าจอ');
    } finally { operation.current = false; if (epoch.current === current) setBusy(false); }
  }
  function paint(x: number, y: number) {
    if (busy || !layout || !isAdmin) return;
    const exists = layout.cells.some(cell => cell.kind === layer && cell.x === x && cell.y === y);
    if (exists === !erase) return;
    setLayout(previous => {
      if (!previous) return previous;
      const cells = previous.cells.filter(cell => !(cell.kind === layer && cell.x === x && cell.y === y));
      if (!erase) cells.push({ id: `${layer}-${x}-${y}`, kind: layer, x, y });
      return { ...previous, cells };
    });
    setVisible(previous => new Set([...previous, layer])); setDirty(true); setNotice('');
  }

  if (!isAdmin) return <p role="alert" className="p-6 text-slate-600">โครงการ Demo ใช้งานได้เฉพาะ Admin</p>;

  return (
    <section className="mx-auto max-w-7xl space-y-5 p-3 sm:p-6">
      <button type="button" disabled={busy} onClick={() => { if (mayLeave()) onBack(); }} className="flex items-center gap-2 text-sm font-semibold text-slate-600"><ArrowLeft size={16} /> กลับหน้าโครงการ</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><FlaskConical className="text-violet-600" /> โครงการ Demo</h1>
          <p className="mt-2 text-sm text-slate-600">พื้นที่ทดลอง Project Map สำหรับ Admin · ข้อมูลแยกจากโครงการและรายงานจริง</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => void reload()} className={`${buttonClass} flex items-center gap-1.5 bg-white text-slate-700`}>
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> โหลดข้อมูลล่าสุด
          </button>
          <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">DEMO · ADMIN ONLY</span>
        </div>
      </div>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {!loaded && !error && <p role="status" className="flex gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> กำลังตรวจสิทธิ์และโหลดโครงการ Demo…</p>}
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <form onSubmit={create} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <label htmlFor="demo-project-name" className="block text-sm font-bold text-slate-800">สร้างโครงการทดลอง</label>
            <input id="demo-project-name" value={name} maxLength={100} disabled={busy || !loaded} onChange={event => setName(event.target.value)} className="w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="ชื่อโครงการ Demo" required />
            <button disabled={busy || !loaded || !name.trim()} className="w-full rounded-xl bg-violet-600 px-3 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'กำลังดำเนินการ…' : 'สร้าง Demo พร้อมผังตัวอย่าง'}</button>
            <p className="text-xs leading-relaxed text-slate-500">มีตัวอย่างแปลงบ้าน ถนน งานดิน รั้ว ท่อ เสาไฟ และทางเดินให้ทดลองแก้ไข</p>
          </form>
          <nav aria-label="รายการโครงการ Demo" className="space-y-2">
            {projects.map(project => <button key={project.id} type="button" disabled={busy} onClick={() => open(project)} aria-current={selected?.id === project.id ? 'true' : undefined} className={`w-full rounded-xl border p-3 text-left text-sm font-semibold ${selected?.id === project.id ? 'border-violet-300 bg-violet-50 text-violet-900' : 'border-slate-200 bg-white text-slate-700'}`}>
              <span className="block break-words">{project.name}</span><span className="mt-1 block text-xs font-normal text-slate-500">DEMO · ฉบับบันทึก {project.revision}</span>
            </button>)}
            {loaded && !projects.length && <p className="p-3 text-sm text-slate-500">ยังไม่มีโครงการ Demo</p>}
          </nav>
        </aside>
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          {!selected || !layout ? <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center text-slate-500"><FlaskConical size={36} className="text-violet-300" /><p>สร้างหรือเลือกโครงการ Demo เพื่อเปิดผังทดลอง</p></div> : <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-bold text-slate-900">{selected.name}</h2><p className="text-xs text-slate-500">ผังจำลอง ไม่ใช่มาตราส่วนสำรวจ {dirty && '· มีการแก้ไขที่ยังไม่บันทึก'}</p></div>
              <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={`${buttonClass} flex items-center gap-2 bg-slate-900 text-white`}><Save size={16} /> บันทึกผัง Demo</button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2" aria-label="เลือกชั้นข้อมูลที่จะวาด">
              {DEMO_LAYERS.map(item => <button type="button" key={item.kind} disabled={busy} aria-pressed={layer === item.kind} onClick={() => { setLayer(item.kind); setVisible(previous => new Set([...previous, item.kind])); }} className={`${buttonClass} flex items-center gap-2 ${layer === item.kind ? 'border-violet-400 bg-violet-50 text-violet-800' : 'text-slate-600'}`}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</button>)}
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy} aria-pressed={!erase} onClick={() => setErase(false)} className={`${buttonClass} flex items-center gap-1 ${!erase ? 'bg-slate-100' : ''}`}><Paintbrush size={15} /> วาด</button>
              <button type="button" disabled={busy} aria-pressed={erase} onClick={() => setErase(true)} className={`${buttonClass} flex items-center gap-1 ${erase ? 'bg-rose-50 text-rose-700' : ''}`}><Eraser size={15} /> ลบเฉพาะชั้นที่เลือก</button>
              <span className="text-xs text-slate-500">แตะช่องเพื่อวาด · ใช้เมาส์ลากต่อเนื่องได้</span>
            </div>
            <div className="overflow-auto rounded-xl border border-slate-200 bg-slate-50">
              <div role="group" aria-label="ผัง Demo แบบตาราง" className="grid w-full min-w-[720px] select-none" style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))` }}>
                {Array.from({ length: layout.rows * layout.cols }, (_, index) => {
                  const x = index % layout.cols, y = Math.floor(index / layout.cols);
                  const cells = gridIndex.byCoord.get(`${x}:${y}`) ?? [];
                  return <button key={index} type="button" disabled={busy} aria-label={`ช่อง ${x + 1}, ${y + 1}`} onPointerDown={event => { if (event.pointerType === 'mouse' && event.button === 0) paint(x, y); }} onPointerEnter={event => { if (event.pointerType === 'mouse' && event.buttons === 1) paint(x, y); }} onClick={() => paint(x, y)} className="relative aspect-square border-b border-r border-slate-200/70 focus:z-30 focus:outline-2 focus:outline-violet-500 hover:z-30 hover:ring-2 hover:ring-violet-400">
                    {DEMO_LAYERS.filter(item => visible.has(item.kind)).flatMap(item => cells.filter(cell => cell.kind === item.kind).map(cell => <CellMark key={cell.id} cell={cell} cellKeys={gridIndex.cellKeys} color={item.color} />))}
                  </button>;
                })}
              </div>
            </div>
            <fieldset className="mt-4 flex flex-wrap gap-x-4 gap-y-2"><legend className="mb-2 text-xs font-bold text-slate-600">แสดงชั้นข้อมูล</legend>
              {DEMO_LAYERS.map(item => <label key={item.kind} className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={visible.has(item.kind)} onChange={() => setVisible(previous => { const next = new Set(previous); if (next.has(item.kind)) next.delete(item.kind); else next.add(item.kind); return next; })} />{item.label}</label>)}
            </fieldset>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">รุ่นนี้ใช้ทดลองตำแหน่งและชั้นข้อมูลบนผัง ยังไม่คำนวณปริมาณงาน ความก้าวหน้า หรือผลตรวจรับ</p>
          </>}
        </div>
      </div>
    </section>
  );
}
