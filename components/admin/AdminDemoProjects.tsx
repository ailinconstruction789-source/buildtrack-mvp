'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, Eraser, FilePlus2, FlaskConical, Home, Layers,
  Loader2, Paintbrush, RefreshCw, Route, RotateCcw, Save, Sparkles, Trash2, Wand2, Wrench, Zap,
} from 'lucide-react';
import {
  DEMO_LAYERS, createDemoLayout, createDemoProject, createEmptyDemoLayout, isDemoAccessError, listDemoProjects, saveDemoProject,
  type DemoCell, type DemoCellKind, type DemoLayout, type DemoProject,
} from '@/lib/demoProjects';

interface Props { isAdmin: boolean; onBack: () => void; onDirtyChange?: (dirty: boolean) => void }
const buttonClass = 'rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold disabled:opacity-50 transition-all';

type WorkflowStepId = 'all' | 'step1_plot' | 'step2_road_walkway' | 'step3_pipes' | 'step4_electric_fence';

const WORKFLOW_STEPS: ReadonlyArray<{
  id: WorkflowStepId;
  stepNum?: number;
  title: string;
  subtitle: string;
  layers: DemoCellKind[];
  defaultLayer: DemoCellKind;
}> = [
  {
    id: 'step1_plot',
    stepNum: 1,
    title: '1. วางบ้าน & ถมดิน',
    subtitle: 'ปรับดินและวางบล็อกแปลงบ้านก่อน',
    layers: ['plot', 'earthwork'],
    defaultLayer: 'plot',
  },
  {
    id: 'step2_road_walkway',
    stepNum: 2,
    title: '2. ถนน & ทางเท้าหน้าบ้าน',
    subtitle: 'ตัดถนนและวางทางเท้าคั่นระหว่างบ้านกับถนน',
    layers: ['road', 'walkway'],
    defaultLayer: 'walkway',
  },
  {
    id: 'step3_pipes',
    stepNum: 3,
    title: '3. ท่อใยหิน & ท่อประปา',
    subtitle: 'เดินท่อใยหิน (ระบายน้ำ+บ่อพัก) และท่อประปาในแนวทางเท้า',
    layers: ['drainage', 'water'],
    defaultLayer: 'drainage',
  },
  {
    id: 'step4_electric_fence',
    stepNum: 4,
    title: '4. ไฟฟ้า เสาไฟ & รั้ว',
    subtitle: 'ปักเสาไฟ พาดสายไฟ และตีแนวรั้วรอบโครงการ',
    layers: ['electric', 'pole', 'fence'],
    defaultLayer: 'pole',
  },
  {
    id: 'all',
    title: 'ดู/แก้ไขรวมทุกชั้น',
    subtitle: 'แสดงและแก้ไขทั้ง 9 ชั้นงานสาธารณูปโภค',
    layers: DEMO_LAYERS.map(item => item.kind),
    defaultLayer: 'road',
  },
];

interface PlotBlock {
  id: string;
  label: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  cellCoords: Set<string>;
}

function computePlotBlocks(cellKeys: ReadonlySet<string>, cols: number, rows: number): {
  blocks: PlotBlock[];
  blockByCoord: Map<string, PlotBlock>;
} {
  const visited = new Set<string>();
  const rawBlocks: Array<{ minX: number; maxX: number; minY: number; maxY: number; coords: string[] }> = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const startKey = `${x}:${y}`;
      if (!cellKeys.has(`plot:${x}:${y}`) || visited.has(startKey)) continue;
      const queue: Array<[number, number]> = [[x, y]];
      visited.add(startKey);
      let minX = x, maxX = x, minY = y, maxY = y;
      const coords: string[] = [];

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        coords.push(`${cx}:${cy}`);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          const nKey = `${nx}:${ny}`;
          if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !visited.has(nKey) && cellKeys.has(`plot:${nx}:${ny}`)) {
            visited.add(nKey);
            queue.push([nx, ny]);
          }
        }
      }
      rawBlocks.push({ minX, maxX, minY, maxY, coords });
    }
  }

  rawBlocks.sort((a, b) => (a.minY - b.minY) || (a.minX - b.minX));
  let northCount = 0;
  let southCount = 0;
  const blocks: PlotBlock[] = [];
  const blockByCoord = new Map<string, PlotBlock>();

  for (const b of rawBlocks) {
    const isNorth = b.minY <= 7;
    const label = isNorth ? `A${++northCount}` : `B${++southCount}`;
    const centerX = Math.floor((b.minX + b.maxX) / 2);
    const centerY = Math.floor((b.minY + b.maxY) / 2);
    const block: PlotBlock = {
      id: `block-${b.minX}-${b.minY}`,
      label,
      minX: b.minX,
      maxX: b.maxX,
      minY: b.minY,
      maxY: b.maxY,
      centerX,
      centerY,
      cellCoords: new Set(b.coords),
    };
    blocks.push(block);
    for (const c of b.coords) blockByCoord.set(c, block);
  }

  return { blocks, blockByCoord };
}

function CellMark({
  x,
  y,
  cells,
  visible,
  cellKeys,
  blockByCoord,
  highlightWalkwayCorridor,
}: {
  x: number;
  y: number;
  cells: DemoCell[];
  visible: ReadonlySet<DemoCellKind>;
  cellKeys: ReadonlySet<string>;
  blockByCoord: ReadonlyMap<string, PlotBlock>;
  highlightWalkwayCorridor: boolean;
}) {
  const has = (kind: DemoCellKind) => visible.has(kind) && cellKeys.has(`${kind}:${x}:${y}`);
  const hasAdj = (kind: DemoCellKind, dx: number, dy: number) =>
    visible.has(kind) && cellKeys.has(`${kind}:${x + dx}:${y + dy}`);

  const plotBlock = has('plot') ? blockByCoord.get(`${x}:${y}`) : undefined;
  const isPlotTop = has('plot') && !hasAdj('plot', 0, -1);
  const isPlotBottom = has('plot') && !hasAdj('plot', 0, 1);
  const isPlotLeft = has('plot') && !hasAdj('plot', -1, 0);
  const isPlotRight = has('plot') && !hasAdj('plot', 1, 0);
  const isPlotCenter = plotBlock && plotBlock.centerX === x && plotBlock.centerY === y;

  // ตรวจว่าด้านไหนของแปลงบ้านติดกับทางเท้าหรือถนน เพื่อแสดงประตูรั้วหน้าบ้าน
  const facesSouthRoad = isPlotBottom && (cellKeys.has(`walkway:${x}:${y + 1}`) || cellKeys.has(`road:${x}:${y + 1}`));
  const facesNorthRoad = isPlotTop && (cellKeys.has(`walkway:${x}:${y - 1}`) || cellKeys.has(`road:${x}:${y - 1}`));
  const isGateCell = plotBlock && x === plotBlock.centerX && (facesSouthRoad || facesNorthRoad);

  // ตรวจทิศทางของท่อใยหิน/ระบายน้ำ, ท่อประปา, แนวสายไฟ
  const drainH = hasAdj('drainage', -1, 0) || hasAdj('drainage', 1, 0);
  const drainV = hasAdj('drainage', 0, -1) || hasAdj('drainage', 0, 1);
  const waterH = hasAdj('water', -1, 0) || hasAdj('water', 1, 0);
  const waterV = hasAdj('water', 0, -1) || hasAdj('water', 0, 1);
  const elecH = hasAdj('electric', -1, 0) || hasAdj('electric', 1, 0);
  const elecV = hasAdj('electric', 0, -1) || hasAdj('electric', 0, 1);
  const fenceH = hasAdj('fence', -1, 0) || hasAdj('fence', 1, 0);
  const fenceV = hasAdj('fence', 0, -1) || hasAdj('fence', 0, 1);

  // จุดบ่อพักท่อใยหิน (Manhole): แสดงทุกๆ ระยะหน้าแปลงบ้านหรือจุดเลี้ยวท่อ
  const isManhole = has('drainage') && ((drainH && drainV) || x % 5 === 2);
  // จุดแยกท่อประปาเข้าแปลงบ้าน (Water Meter Tap)
  const hasAdjacentPlotNorth = cellKeys.has(`plot:${x}:${y - 1}`);
  const hasAdjacentPlotSouth = cellKeys.has(`plot:${x}:${y + 1}`);
  const isWaterMeterTap = has('water') && (hasAdjacentPlotNorth || hasAdjacentPlotSouth) && x % 5 === 4;

  return (
    <>
      {/* 1. ชั้นงานถมดิน */}
      {has('earthwork') && (
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundColor: '#e6ccb2',
            backgroundImage: 'radial-gradient(#b08968 0.75px, transparent 0.75px)',
            backgroundSize: '6px 6px',
            opacity: has('plot') ? 0.45 : 0.75,
          }}
        />
      )}

      {/* 2. ชั้นแปลงบ้าน (รวมบล็อกเป็นหลัง ไม่แยกเป็นจุดเล็กๆ) */}
      {has('plot') && (
        <span
          className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-br from-sky-100 to-blue-200/90 transition-all"
          style={{
            borderTop: isPlotTop ? '2.5px solid #1d4ed8' : '1px dashed rgba(59,130,246,0.2)',
            borderBottom: isPlotBottom ? '2.5px solid #1d4ed8' : '1px dashed rgba(59,130,246,0.2)',
            borderLeft: isPlotLeft ? '2.5px solid #1d4ed8' : '1px dashed rgba(59,130,246,0.2)',
            borderRight: isPlotRight ? '2.5px solid #1d4ed8' : '1px dashed rgba(59,130,246,0.2)',
            borderTopLeftRadius: isPlotTop && isPlotLeft ? '8px' : '0',
            borderTopRightRadius: isPlotTop && isPlotRight ? '8px' : '0',
            borderBottomLeftRadius: isPlotBottom && isPlotLeft ? '8px' : '0',
            borderBottomRightRadius: isPlotBottom && isPlotRight ? '8px' : '0',
          }}
        >
          {/* หลังคา/ตัวบ้านด้านในแปลง */}
          {!isPlotTop && !isPlotBottom && (
            <span className="absolute inset-x-1 inset-y-0.5 rounded-xs bg-white/75 shadow-2xs" />
          )}
          {/* ป้ายชื่อแปลงบ้านตรงกลางบล็อก */}
          {isPlotCenter && plotBlock && (
            <span className="absolute inset-0 z-20 flex items-center justify-center">
              <span className="whitespace-nowrap rounded-md border border-blue-700 bg-blue-900/90 px-1.5 py-0.5 text-[10px] font-black tracking-tight text-white shadow-sm">
                🏠 แปลง {plotBlock.label}
              </span>
            </span>
          )}
          {/* ประตูรั้วหน้าบ้านฝั่งติดทางเท้า/ถนน */}
          {isGateCell && (
            <span
              className={`absolute inset-x-1 z-10 h-1.5 rounded-full bg-amber-500 border border-amber-800 ${
                facesSouthRoad ? 'bottom-0 translate-y-1/2' : 'top-0 -translate-y-1/2'
              }`}
              title="ประตูหน้าบ้านออกสู่ทางเท้า"
            />
          )}
        </span>
      )}

      {/* 3. ชั้นถนนผิวจราจร */}
      {has('road') && (
        <span className="pointer-events-none absolute inset-0 z-[6] bg-slate-700">
          {/* เส้นประสีเหลืองแบ่งเลนกึ่งกลางถนน */}
          {hasAdj('road', 0, 1) && !hasAdj('road', 0, -1) && (
            <span className="absolute bottom-0 inset-x-0 z-10 border-b-2 border-dashed border-amber-300/80 translate-y-[1px]" />
          )}
          {!hasAdj('road', 0, -1) && (
            <span className="absolute top-0 inset-x-0 border-t-2 border-slate-400/70" />
          )}
          {!hasAdj('road', 0, 1) && (
            <span className="absolute bottom-0 inset-x-0 border-b-2 border-slate-400/70" />
          )}
        </span>
      )}

      {/* 4. ชั้นทางเท้า (Walkway / Utility Corridor คั่นระหว่างบ้านกับถนน) */}
      {has('walkway') && (
        <span
          className={`pointer-events-none absolute inset-0 z-[7] transition-all ${
            highlightWalkwayCorridor
              ? 'bg-amber-50/95 ring-1 ring-inset ring-amber-400'
              : 'bg-slate-200/95'
          }`}
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, rgba(100,116,139,0.18) 0px, rgba(100,116,139,0.18) 1px, transparent 1px, transparent 10px)',
            borderTop: cellKeys.has(`road:${x}:${y - 1}`) ? '2px solid #94a3b8' : '1px solid #cbd5e1',
            borderBottom: cellKeys.has(`road:${x}:${y + 1}`) ? '2px solid #94a3b8' : '1px solid #cbd5e1',
          }}
        />
      )}

      {/* 5. ชั้นท่อใยหิน / ท่อระบายน้ำ (ร่องที่ 1 ในทางเท้า - สีเขียวมรกตเข้ม พร้อมบ่อพัก) */}
      {has('drainage') && (
        <>
          {(drainH || !drainV) && (
            <span
              className="pointer-events-none absolute inset-x-0 z-[14] h-[5px] -translate-y-1/2 bg-teal-700 shadow-2xs"
              style={{
                top: '26%',
                backgroundImage:
                  'repeating-linear-gradient(90deg, #0f766e 0px, #0f766e 8px, #5eead4 8px, #5eead4 10px)',
              }}
            />
          )}
          {drainV && (
            <span
              className="pointer-events-none absolute inset-y-0 z-[14] w-[5px] -translate-x-1/2 bg-teal-700 shadow-2xs"
              style={{
                left: '26%',
                backgroundImage:
                  'repeating-linear-gradient(180deg, #0f766e 0px, #0f766e 8px, #5eead4 8px, #5eead4 10px)',
              }}
            />
          )}
          {isManhole && (
            <span
              className="pointer-events-none absolute z-[18] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-white bg-teal-900 shadow-xs"
              style={{ top: '26%', left: drainV && !drainH ? '26%' : '50%' }}
              title="บ่อพักท่อใยหิน/ระบายน้ำ (Manhole)"
            />
          )}
        </>
      )}

      {/* 6. ชั้นท่อประปา (ร่องที่ 2 ในทางเท้า - วิ่งคู่ขนานแยกจากท่อใยหิน ไม่ทับกัน + หัวต่อเข้าบ้าน) */}
      {has('water') && (
        <>
          {(waterH || !waterV) && (
            <span
              className="pointer-events-none absolute inset-x-0 z-[15] h-[4px] -translate-y-1/2 bg-sky-500 border-y border-white/60"
              style={{ top: '62%' }}
            />
          )}
          {waterV && (
            <span
              className="pointer-events-none absolute inset-y-0 z-[15] w-[4px] -translate-x-1/2 bg-sky-500 border-x border-white/60"
              style={{ left: '62%' }}
            />
          )}
          {isWaterMeterTap && (
            <>
              <span
                className="pointer-events-none absolute z-[17] w-[2px] bg-sky-400"
                style={{
                  left: '62%',
                  top: hasAdjacentPlotNorth ? '0%' : '62%',
                  height: hasAdjacentPlotNorth ? '62%' : '38%',
                }}
              />
              <span
                className="pointer-events-none absolute z-[18] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-sky-600"
                style={{ top: '62%', left: '62%' }}
                title="จุดแยกมิเตอร์ประปาเข้าแปลงบ้าน"
              />
            </>
          )}
        </>
      )}

      {/* 7. ชั้นแนวสายไฟฟ้า (ร่องที่ 3 ชิดขอบรั้วบ้าน) */}
      {has('electric') && (
        <>
          {(elecH || !elecV) && (
            <span
              className="pointer-events-none absolute inset-x-0 z-[16] border-t-[2.5px] border-amber-500"
              style={{ top: '84%' }}
            />
          )}
          {elecV && (
            <span
              className="pointer-events-none absolute inset-y-0 z-[16] border-l-[2.5px] border-amber-500"
              style={{ left: '84%' }}
            />
          )}
        </>
      )}

      {/* 8. ชั้นเสาไฟฟ้า */}
      {has('pole') && (
        <span
          className="pointer-events-none absolute z-[22] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-200 bg-violet-700 shadow-md ring-2 ring-violet-500/40"
          style={{ top: '80%', left: '50%' }}
          title="เสาไฟฟ้าส่องสว่าง/แรงต่ำ"
        />
      )}

      {/* 9. ชั้นรั้วรอบโครงการ */}
      {has('fence') && (
        <>
          {(fenceH || !fenceV) && (
            <span
              className="pointer-events-none absolute inset-x-0 z-[12] border-t-[3px] border-dashed border-amber-800"
              style={{ top: '50%' }}
            />
          )}
          {fenceV && (
            <span
              className="pointer-events-none absolute inset-y-0 z-[12] border-l-[3px] border-dashed border-amber-800"
              style={{ left: '50%' }}
            />
          )}
        </>
      )}

      {/* Fallback สำหรับชั้นอื่นๆ ที่อาจถูกซ่อนแยก */}
      {cells.length === 0 && null}
    </>
  );
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
  const [activeStep, setActiveStep] = useState<WorkflowStepId>('all');
  const [layer, setLayer] = useState<DemoCellKind>('road');
  const [erase, setErase] = useState(false);
  const [plotStampMode, setPlotStampMode] = useState<'single' | 'block4x4'>('single');
  const [zoomCorridor, setZoomCorridor] = useState(false);
  const [visible, setVisible] = useState<Set<DemoCellKind>>(() => new Set(DEMO_LAYERS.map(item => item.kind)));
  const epoch = useRef(0);
  const createRequest = useRef<{ name: string; id: string } | null>(null);
  const operation = useRef(false);

  const gridIndex = useMemo(() => {
    const cellKeys = new Set<string>();
    const byCoord = new Map<string, DemoCell[]>();
    const rowHasWalkway = new Set<number>();
    const rowHasPlotOrRoad = new Set<number>();
    const rowHasFenceOnly = new Set<number>();

    for (const cell of layout?.cells ?? []) {
      cellKeys.add(`${cell.kind}:${cell.x}:${cell.y}`);
      const coord = `${cell.x}:${cell.y}`;
      const bucket = byCoord.get(coord);
      if (bucket) bucket.push(cell);
      else byCoord.set(coord, [cell]);

      if (cell.kind === 'walkway') rowHasWalkway.add(cell.y);
      if (cell.kind === 'plot' || cell.kind === 'road') rowHasPlotOrRoad.add(cell.y);
      if (cell.kind === 'fence') rowHasFenceOnly.add(cell.y);
    }

    const { blocks, blockByCoord } = computePlotBlocks(cellKeys, layout?.cols ?? 24, layout?.rows ?? 16);

    return { cellKeys, byCoord, blocks, blockByCoord, rowHasWalkway, rowHasPlotOrRoad, rowHasFenceOnly };
  }, [layout]);

  // คำนวณความสูงแต่ละแถวตามสัดส่วนงานจริง (ทางเท้าแคบกว่าบ้านและถนน ยกเว้นเมื่อกดซูมขยายทางเท้า)
  const gridTemplateRows = useMemo(() => {
    if (!layout) return '';
    const tracks: string[] = [];
    for (let y = 0; y < layout.rows; y++) {
      const isWalkwayRow = gridIndex.rowHasWalkway.has(y) && !gridIndex.rowHasPlotOrRoad.has(y);
      const isBorderRow = y === 0 || y === layout.rows - 1 || (gridIndex.rowHasFenceOnly.has(y) && !gridIndex.rowHasPlotOrRoad.has(y) && !isWalkwayRow);
      if (isWalkwayRow) {
        tracks.push(zoomCorridor || activeStep === 'step3_pipes' ? '44px' : '28px');
      } else if (isBorderRow) {
        tracks.push('22px');
      } else {
        tracks.push('42px');
      }
    }
    return tracks.join(' ');
  }, [layout, gridIndex, zoomCorridor, activeStep]);

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
  async function createBlank() {
    if (!isAdmin || !loaded || operation.current || !name.trim() || !mayLeave()) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    const current = epoch.current;
    const reqKey = `blank:${name.trim()}`;
    if (createRequest.current?.name !== reqKey) createRequest.current = { name: reqKey, id: crypto.randomUUID() };
    try {
      const project = await createDemoProject(name, createRequest.current.id, { empty: true });
      if (epoch.current !== current) return;
      setProjects(rows => [project, ...rows.filter(row => row.id !== project.id)]);
      setSelected(project); setLayout(project.layout_data); setDirty(false); createRequest.current = null;
      setActiveStep('step1_plot'); setLayer('plot'); setErase(false); setPlotStampMode('block4x4');
      setNotice('สร้างโครงการ Demo หน้าเปล่าแล้ว เริ่มวางบล็อกบ้านจากขั้นที่ 1 ได้เลย');
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

    // โหมดวางบล็อกบ้านสำเร็จรูป 1 หลัง (4x4 ช่อง)
    if (!erase && layer === 'plot' && plotStampMode === 'block4x4') {
      setLayout(previous => {
        if (!previous) return previous;
        const nextCells = [...previous.cells];
        const existingKeys = new Set(nextCells.map(c => `${c.kind}:${c.x}:${c.y}`));
        for (let dx = 0; dx < 4; dx++) {
          for (let dy = 0; dy < 4; dy++) {
            const tx = x + dx, ty = y + dy;
            if (tx >= previous.cols || ty >= previous.rows) continue;
            if (!existingKeys.has(`earthwork:${tx}:${ty}`)) {
              existingKeys.add(`earthwork:${tx}:${ty}`);
              nextCells.push({ id: `earthwork-${tx}-${ty}`, kind: 'earthwork', x: tx, y: ty });
            }
            if (!existingKeys.has(`plot:${tx}:${ty}`)) {
              existingKeys.add(`plot:${tx}:${ty}`);
              nextCells.push({ id: `plot-${tx}-${ty}`, kind: 'plot', x: tx, y: ty });
            }
          }
        }
        return { ...previous, cells: nextCells };
      });
      setVisible(previous => new Set([...previous, 'plot', 'earthwork']));
      setDirty(true);
      setNotice('วางบล็อกแปลงบ้าน (4×4 ช่อง) เรียบร้อยแล้ว');
      return;
    }

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

  // เครื่องมืออัตโนมัติ: สร้างทางเท้าคั่นระหว่างแปลงบ้านกับถนน
  function autoGenerateSidewalkBetweenPlotAndRoad() {
    if (busy || !layout || !isAdmin) return;
    let addedCount = 0;
    setLayout(previous => {
      if (!previous) return previous;
      const nextCells = [...previous.cells];
      const existing = new Set(nextCells.map(c => `${c.kind}:${c.x}:${c.y}`));

      for (let y = 0; y < previous.rows; y++) {
        for (let x = 0; x < previous.cols; x++) {
          if (existing.has(`road:${x}:${y}`) || existing.has(`plot:${x}:${y}`)) continue;
          const touchesRoad =
            existing.has(`road:${x}:${y - 1}`) ||
            existing.has(`road:${x}:${y + 1}`) ||
            existing.has(`road:${x - 1}:${y}`) ||
            existing.has(`road:${x + 1}:${y}`);
          if (touchesRoad && !existing.has(`walkway:${x}:${y}`)) {
            existing.add(`walkway:${x}:${y}`);
            nextCells.push({ id: `walkway-${x}-${y}`, kind: 'walkway', x, y });
            addedCount++;
          }
        }
      }
      return { ...previous, cells: nextCells };
    });
    setVisible(previous => new Set([...previous, 'walkway']));
    setDirty(true);
    setNotice(addedCount > 0 ? `สร้างแนวทางเท้าขอบถนนเพิ่ม ${addedCount} ช่องเรียบร้อยแล้ว` : 'มีแนวทางเท้าขนาบถนนครบทุกจุดแล้ว');
  }

  // เครื่องมืออัตโนมัติ: เดินท่อใยหินและท่อประปาขนานกันในทุกช่องที่เป็นทางเท้า
  function autoLayPipesAlongSidewalk() {
    if (busy || !layout || !isAdmin) return;
    let addedCount = 0;
    setLayout(previous => {
      if (!previous) return previous;
      const nextCells = [...previous.cells];
      const existing = new Set(nextCells.map(c => `${c.kind}:${c.x}:${c.y}`));

      for (const cell of previous.cells) {
        if (cell.kind !== 'walkway') continue;
        for (const pipeKind of ['drainage', 'water'] as const) {
          const key = `${pipeKind}:${cell.x}:${cell.y}`;
          if (!existing.has(key)) {
            existing.add(key);
            nextCells.push({ id: `${pipeKind}-${cell.x}-${cell.y}`, kind: pipeKind, x: cell.x, y: cell.y });
            addedCount++;
          }
        }
      }
      return { ...previous, cells: nextCells };
    });
    setVisible(previous => new Set([...previous, 'walkway', 'drainage', 'water']));
    setDirty(true);
    setNotice(addedCount > 0 ? `เดินแนวท่อใยหินและท่อประปาตามทางเท้าเพิ่ม ${addedCount} จุดเรียบร้อยแล้ว` : 'ทางเท้าทุกช่องมีแนวท่อใยหินและท่อประปาครบแล้ว');
  }

  // โหลดผังต้นแบบใหม่ (บ้าน A1-A4 / B1-B4 + ถนน + ทางเท้าคั่น + ท่อใยหิน & ท่อประปา)
  function resetToStandardBlueprint() {
    if (busy || !layout || !isAdmin) return;
    setLayout(createDemoLayout());
    setVisible(new Set(DEMO_LAYERS.map(item => item.kind)));
    setDirty(true);
    setNotice('โหลดผังต้นแบบใหม่ (วางบ้าน → ถนน → ทางเท้าคั่น → ท่อใยหินและท่อประปา) แล้ว กด "บันทึกผัง Demo" เพื่อบันทึก');
  }

  // ล้างผังเป็นหน้าเปล่าเพื่อเริ่มวาดตั้งแต่ต้น (ขั้นที่ 1 -> 2 -> 3 -> 4)
  function clearToBlankCanvas() {
    if (busy || !layout || !isAdmin) return;
    setLayout(createEmptyDemoLayout());
    setVisible(new Set(DEMO_LAYERS.map(item => item.kind)));
    setActiveStep('step1_plot');
    setLayer('plot');
    setErase(false);
    setPlotStampMode('block4x4');
    setDirty(true);
    setNotice('ล้างผังเป็นหน้าเปล่าแล้ว! เริ่มจากขั้นที่ 1 (คลิกวางบล็อกบ้าน) → ขั้นที่ 2 (ทำถนน+ทางเท้า) → ขั้นที่ 3 (วางท่อใยหิน/ท่อประปา) ได้เลย');
  }

  if (!isAdmin) return <p role="alert" className="p-6 text-slate-600">โครงการ Demo ใช้งานได้เฉพาะ Admin</p>;

  const currentStepObj = WORKFLOW_STEPS.find(s => s.id === activeStep) ?? WORKFLOW_STEPS[4];

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
          <form onSubmit={create} className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-4">
            <label htmlFor="demo-project-name" className="block text-sm font-bold text-slate-800">สร้างโครงการทดลอง</label>
            <input id="demo-project-name" value={name} maxLength={100} disabled={busy || !loaded} onChange={event => setName(event.target.value)} className="w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="ชื่อโครงการ Demo" required />
            <button type="submit" disabled={busy || !loaded || !name.trim()} className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 px-3 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'กำลังดำเนินการ…' : 'สร้าง Demo พร้อมผังตัวอย่าง'}</button>
            <button
              type="button"
              disabled={busy || !loaded || !name.trim()}
              onClick={() => void createBlank()}
              className="w-full rounded-xl border-2 border-violet-200 bg-violet-50/70 hover:bg-violet-100 px-3 py-2.5 text-xs font-bold text-violet-900 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <FilePlus2 size={15} /> สร้าง Demo หน้าเปล่า (เริ่มวาดเอง)
            </button>
            <p className="text-xs leading-relaxed text-slate-500">เลือกสร้างพร้อมผังตัวอย่าง หรือสร้างหน้าเปล่าเพื่อทดลองวางบ้าน ถนน ทางเท้า และท่อตั้งแต่เริ่มต้น</p>
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
              <div>
                <h2 className="font-bold text-slate-900">{selected.name}</h2>
                <p className="text-xs text-slate-500">ผังจำลองสัดส่วนวิศวกรรม (บ้านรวมบล็อก + ถนน + ทางเท้าพร้อมร่องท่อใยหิน/ประปา) · ไม่ใช่มาตราส่วนสำรวจ {dirty && '· มีการแก้ไขที่ยังไม่บันทึก'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={clearToBlankCanvas}
                  className={`${buttonClass} flex items-center gap-1.5 bg-white text-rose-700 border-rose-200 hover:bg-rose-50`}
                  title="ล้างข้อมูลบนกระดานเป็นหน้าเปล่า เพื่อเริ่มฝึกวางบ้าน ถนน ทางเท้า และท่อตั้งแต่ต้น"
                >
                  <RotateCcw size={15} /> ล้างเป็นผังเปล่า (เริ่มวาดใหม่)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={resetToStandardBlueprint}
                  className={`${buttonClass} flex items-center gap-1.5 bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100`}
                  title="จัดวางผังตัวอย่างใหม่: แปลงบ้าน A1-A4 / B1-B4 + ถนน + ทางเท้า + ท่อใยหินและท่อประปา"
                >
                  <Sparkles size={15} /> โหลดผังต้นแบบใหม่
                </button>
                <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={`${buttonClass} flex items-center gap-2 bg-slate-900 text-white`}><Save size={16} /> บันทึกผัง Demo</button>
              </div>
            </div>

            {/* 🧭 แถบลำดับขั้นตอนการวางผังตามหน้างานจริง (Step-by-Step Construction Workflow) */}
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {WORKFLOW_STEPS.map(step => {
                const isActive = activeStep === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setActiveStep(step.id);
                      if (!step.layers.includes(layer)) {
                        setLayer(step.defaultLayer);
                      }
                      setVisible(prev => new Set([...prev, ...step.layers]));
                    }}
                    className={`rounded-xl border p-2.5 text-left transition-all ${
                      isActive
                        ? 'border-violet-500 bg-violet-50/90 text-violet-950 shadow-xs ring-1 ring-violet-400'
                        : 'border-slate-200 bg-slate-50/60 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-extrabold">{step.title}</span>
                      {isActive && <CheckCircle2 size={14} className="text-violet-600 shrink-0" />}
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-slate-500 line-clamp-2">{step.subtitle}</p>
                  </button>
                );
              })}
            </div>

            {/* 🎨 ปุ่มเลือกชั้นข้อมูลที่จะวาด (คงปุ่มครบทั้ง 9 ชั้นและไฮไลต์ตามขั้นตอน) */}
            <div className="mb-3 flex flex-wrap gap-2" aria-label="เลือกชั้นข้อมูลที่จะวาด">
              {DEMO_LAYERS.map(item => {
                const inCurrentStep = activeStep === 'all' || currentStepObj.layers.includes(item.kind);
                return (
                  <button
                    type="button"
                    key={item.kind}
                    disabled={busy}
                    aria-pressed={layer === item.kind}
                    onClick={() => {
                      setLayer(item.kind);
                      setVisible(previous => new Set([...previous, item.kind]));
                    }}
                    className={`${buttonClass} flex items-center gap-2 ${
                      layer === item.kind
                        ? 'border-violet-500 bg-violet-50 text-violet-900 ring-1 ring-violet-400'
                        : inCurrentStep
                        ? 'border-slate-300 bg-white text-slate-800'
                        : 'border-slate-200/70 bg-slate-50/60 text-slate-400'
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* 🛠️ แถบเครื่องมือช่วยวางผังอัจฉริยะ (Smart Helpers ตามขั้นตอน) */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} aria-pressed={!erase} onClick={() => setErase(false)} className={`${buttonClass} flex items-center gap-1 bg-white ${!erase ? 'border-slate-800 text-slate-900 ring-1 ring-slate-800' : 'text-slate-600'}`}><Paintbrush size={15} /> วาด</button>
                <button type="button" disabled={busy} aria-pressed={erase} onClick={() => setErase(true)} className={`${buttonClass} flex items-center gap-1 bg-white ${erase ? 'border-rose-400 bg-rose-50 text-rose-700 ring-1 ring-rose-300' : 'text-slate-600'}`}><Eraser size={15} /> ลบเฉพาะชั้นที่เลือก</button>

                {layer === 'plot' && !erase && (
                  <div className="flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50/70 p-1">
                    <button
                      type="button"
                      onClick={() => setPlotStampMode('single')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                        plotStampMode === 'single' ? 'bg-blue-600 text-white shadow-2xs' : 'text-blue-800 hover:bg-blue-100'
                      }`}
                    >
                      วาดทีละช่อง
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlotStampMode('block4x4')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold flex items-center gap-1 transition ${
                        plotStampMode === 'block4x4' ? 'bg-blue-600 text-white shadow-2xs' : 'text-blue-800 hover:bg-blue-100'
                      }`}
                    >
                      <Home size={13} /> วางบล็อกบ้าน 1 หลัง (4×4)
                    </button>
                  </div>
                )}

                {(activeStep === 'step2_road_walkway' || layer === 'walkway' || layer === 'road') && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={autoGenerateSidewalkBetweenPlotAndRoad}
                    className="rounded-xl border border-slate-300 bg-white hover:bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-800 flex items-center gap-1.5 shadow-2xs"
                  >
                    <Wand2 size={14} className="text-violet-600" /> สร้างทางเท้าขนาบขอบถนนอัตโนมัติ
                  </button>
                )}

                {(activeStep === 'step3_pipes' || layer === 'drainage' || layer === 'water') && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={autoLayPipesAlongSidewalk}
                    className="rounded-xl border border-teal-300 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 text-xs font-bold text-teal-900 flex items-center gap-1.5 shadow-2xs"
                  >
                    <Wrench size={14} className="text-teal-700" /> เดินท่อใยหิน+ท่อประปาตามทางเท้าอัตโนมัติ
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setZoomCorridor(v => !v)}
                  className={`rounded-xl border px-2.5 py-1.5 text-xs font-bold transition ${
                    zoomCorridor
                      ? 'border-amber-400 bg-amber-50 text-amber-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {zoomCorridor ? '🔍 ขยายร่องทางเท้าอยู่' : '🔍 ซูมขยายร่องทางเท้า'}
                </button>
              </div>
            </div>

            {/* 📐 คำอธิบายร่องทางเท้า (Cross-Section Legend ของทางเท้าคั่นระหว่างบ้านกับถนน) */}
            <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-slate-200 bg-slate-900 px-3.5 py-2 text-[11px] text-slate-200">
              <span className="font-bold text-amber-300">โครงสร้างในแถบทางเท้า (ระหว่างบ้านกับถนน):</span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-5 rounded-xs bg-teal-500" />
                <span>ร่องบน: <strong>ท่อใยหิน/ระบายน้ำ + บ่อพัก (■)</strong></span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-5 rounded-xs bg-sky-400" />
                <span>ร่องกลาง: <strong>ท่อประปา + จุดแยกมิเตอร์เข้าบ้าน (●)</strong></span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-1 w-5 bg-amber-400" />
                <span>ร่องชิดรั้ว: <strong>แนวสายไฟ + เสาไฟ (🟣)</strong></span>
              </span>
            </div>

            {/* 🗺️ ผัง Project Map สัดส่วนจริง */}
            <div className="overflow-auto rounded-2xl border-2 border-slate-300 bg-slate-100 p-2 shadow-inner">
              <div
                role="group"
                aria-label="ผัง Demo แบบตาราง"
                className="grid w-full min-w-[780px] select-none rounded-xl bg-white shadow-xs overflow-hidden"
                style={{
                  gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
                  gridTemplateRows,
                }}
              >
                {Array.from({ length: layout.rows * layout.cols }, (_, index) => {
                  const x = index % layout.cols, y = Math.floor(index / layout.cols);
                  const cells = gridIndex.byCoord.get(`${x}:${y}`) ?? [];
                  const hasPlot = visible.has('plot') && gridIndex.cellKeys.has(`plot:${x}:${y}`);
                  const hasRoad = visible.has('road') && gridIndex.cellKeys.has(`road:${x}:${y}`);
                  const highlightWalkwayCorridor = activeStep === 'step3_pipes' || layer === 'drainage' || layer === 'water';

                  return (
                    <button
                      key={index}
                      type="button"
                      disabled={busy}
                      aria-label={`ช่อง ${x + 1}, ${y + 1}`}
                      onPointerDown={event => { if (event.pointerType === 'mouse' && event.button === 0) paint(x, y); }}
                      onPointerEnter={event => { if (event.pointerType === 'mouse' && event.buttons === 1) paint(x, y); }}
                      onClick={() => paint(x, y)}
                      className={`relative focus:z-30 focus:outline-2 focus:outline-violet-500 hover:z-30 hover:ring-2 hover:ring-violet-400 ${
                        hasPlot || hasRoad ? 'border-0' : 'border-b border-r border-slate-200/60'
                      }`}
                    >
                      <CellMark
                        x={x}
                        y={y}
                        cells={cells}
                        visible={visible}
                        cellKeys={gridIndex.cellKeys}
                        blockByCoord={gridIndex.blockByCoord}
                        highlightWalkwayCorridor={highlightWalkwayCorridor}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <fieldset className="mt-4 flex flex-wrap gap-x-4 gap-y-2"><legend className="mb-2 text-xs font-bold text-slate-600">แสดงชั้นข้อมูล ({gridIndex.blocks.length} แปลงบ้าน)</legend>
              {DEMO_LAYERS.map(item => <label key={item.kind} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer"><input type="checkbox" checked={visible.has(item.kind)} onChange={() => setVisible(previous => { const next = new Set(previous); if (next.has(item.kind)) next.delete(item.kind); else next.add(item.kind); return next; })} />{item.label}</label>)}
            </fieldset>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">รุ่นนี้ใช้ทดลองตำแหน่งและชั้นข้อมูลบนผัง ยังไม่คำนวณปริมาณงาน ความก้าวหน้า หรือผลตรวจรับ</p>
          </>}
        </div>
      </div>
    </section>
  );
}
