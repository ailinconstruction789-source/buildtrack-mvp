'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Calculator, CheckCircle2, Compass, Eraser, Eye, FilePlus2, FileText, FlaskConical,
  Home, Loader2, MapPin, Paintbrush, RefreshCw, RotateCcw, Ruler, Save, Sparkles, Upload, Wand2, Wrench,
} from 'lucide-react';
import {
  DEFAULT_DEMO_SCALE_SETTINGS, DEMO_LAYERS, PDF_LAND_UTILIZATION, PDF_MASTERPLAN_PLOTS, PDF_PLOT_BY_COORD, PDF_PLOT_BY_NUMBER,
  calculateDemoProjectMetrics, createDemoLayout, createDemoProject, createEmptyDemoLayout, createPdfMasterPlanLayout,
  isDemoAccessError, listDemoProjects, measureDemoGridDistance, saveDemoProject,
  type DemoCell, type DemoCellKind, type DemoLayout, type DemoProject, type DemoScaleSettings, type PdfMasterPlanPlotSpec,
} from '@/lib/demoProjects';
import PdfCadVectorMap from './PdfCadVectorMap';

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
  pdfSpec?: PdfMasterPlanPlotSpec;
}

function computePlotBlocks(
  cells: ReadonlyArray<DemoCell>,
  cellKeys: ReadonlySet<string>,
  cols: number,
  rows: number,
): {
  blocks: PlotBlock[];
  blockByCoord: Map<string, PlotBlock>;
} {
  const blocks: PlotBlock[] = [];
  const blockByCoord = new Map<string, PlotBlock>();
  const visited = new Set<string>();

  // 1. ตรวจหาแปลงบ้านจากผัง PDF (แปลง 1–80 ที่แยกแต่ละช่องเป็น 1 แปลงพร้อมเลขแปลงและเนื้อที่จริง)
  for (const cell of cells) {
    if (cell.kind !== 'plot') continue;
    const match = /^pdf-plot-(\d+)$/.exec(cell.id);
    const spec = match ? PDF_PLOT_BY_NUMBER.get(Number(match[1])) : undefined;
    if (spec) {
      const coord = `${cell.x}:${cell.y}`;
      visited.add(coord);
      const block: PlotBlock = {
        id: cell.id,
        label: String(spec.plotNo),
        minX: cell.x,
        maxX: cell.x,
        minY: cell.y,
        maxY: cell.y,
        centerX: cell.x,
        centerY: cell.y,
        cellCoords: new Set([coord]),
        pdfSpec: spec,
      };
      blocks.push(block);
      blockByCoord.set(coord, block);
    }
  }

  // 2. สำหรับแปลงบ้านที่วาดแบบบล็อกหลายช่อง (เช่น 4x4 ช่อง A1..A4, B1..B4)
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
  isSelectedPlot,
  measurePointRole,
  inMeasureRoute,
}: {
  x: number;
  y: number;
  cells: DemoCell[];
  visible: ReadonlySet<DemoCellKind>;
  cellKeys: ReadonlySet<string>;
  blockByCoord: ReadonlyMap<string, PlotBlock>;
  highlightWalkwayCorridor: boolean;
  isSelectedPlot: boolean;
  measurePointRole: 'start' | 'end' | null;
  inMeasureRoute: boolean;
}) {
  const has = (kind: DemoCellKind) => visible.has(kind) && cellKeys.has(`${kind}:${x}:${y}`);
  const hasAdj = (kind: DemoCellKind, dx: number, dy: number) =>
    visible.has(kind) && cellKeys.has(`${kind}:${x + dx}:${y + dy}`);

  const plotBlock = has('plot') ? blockByCoord.get(`${x}:${y}`) : undefined;
  const pdfSpec = plotBlock?.pdfSpec;
  const isPdfPlot = Boolean(pdfSpec);

  // หากเป็นแปลงบ้านจากผัง PDF (1 ช่อง = 1 แปลง) ให้ตีกรอบแยกแต่ละแปลงชัดเจน
  const isPlotTop = has('plot') && (isPdfPlot || !hasAdj('plot', 0, -1) || blockByCoord.get(`${x}:${y - 1}`)?.id !== plotBlock?.id);
  const isPlotBottom = has('plot') && (isPdfPlot || !hasAdj('plot', 0, 1) || blockByCoord.get(`${x}:${y + 1}`)?.id !== plotBlock?.id);
  const isPlotLeft = has('plot') && (isPdfPlot || !hasAdj('plot', -1, 0) || blockByCoord.get(`${x - 1}:${y}`)?.id !== plotBlock?.id);
  const isPlotRight = has('plot') && (isPdfPlot || !hasAdj('plot', 1, 0) || blockByCoord.get(`${x + 1}:${y}`)?.id !== plotBlock?.id);
  const isPlotCenter = plotBlock && plotBlock.centerX === x && plotBlock.centerY === y;

  // ตรวจพื้นที่พิเศษในผัง PDF (สวนสาธารณะ 253.9 ตร.ว., สวนหย่อม, ป้อมยาม/ซุ้มประตู)
  const isPublicPark = cells.some(c => c.id.startsWith('pdf-park-'));
  const isPocketPark = cells.some(c => c.id.startsWith('pdf-pocket-park-'));
  const isMainGateRoad = cells.some(c => c.id.startsWith('pdf-gate-road-'));
  const isMain9mRoad = cells.some(c => c.id.startsWith('pdf-road-9m-'));

  // ตรวจว่าด้านไหนของแปลงบ้านติดกับทางเท้าหรือถนน เพื่อแสดงประตูรั้วหน้าบ้าน
  const facesSouthRoad = isPlotBottom && (cellKeys.has(`walkway:${x}:${y + 1}`) || cellKeys.has(`road:${x}:${y + 1}`));
  const facesNorthRoad = isPlotTop && (cellKeys.has(`walkway:${x}:${y - 1}`) || cellKeys.has(`road:${x}:${y - 1}`));
  const facesEastRoad = isPlotRight && (cellKeys.has(`walkway:${x + 1}:${y}`) || cellKeys.has(`road:${x + 1}:${y}`));
  const facesWestRoad = isPlotLeft && (cellKeys.has(`walkway:${x - 1}:${y}`) || cellKeys.has(`road:${x - 1}:${y}`));
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

  const isManhole = has('drainage') && ((drainH && drainV) || x % 3 === 2);
  const hasAdjacentPlotNorth = cellKeys.has(`plot:${x}:${y - 1}`);
  const hasAdjacentPlotSouth = cellKeys.has(`plot:${x}:${y + 1}`);
  const isWaterMeterTap = has('water') && (hasAdjacentPlotNorth || hasAdjacentPlotSouth) && x % 2 === 0;

  return (
    <>
      {/* 1. ชั้นงานถมดิน หรือ สวนสาธารณะ */}
      {has('earthwork') && (
        <span
          className="pointer-events-none absolute inset-0"
          style={
            isPublicPark || isPocketPark
              ? {
                  backgroundColor: '#bbf7d0',
                  backgroundImage: 'radial-gradient(#15803d 0.85px, transparent 0.85px)',
                  backgroundSize: '6px 6px',
                }
              : {
                  backgroundColor: '#e6ccb2',
                  backgroundImage: 'radial-gradient(#b08968 0.75px, transparent 0.75px)',
                  backgroundSize: '6px 6px',
                  opacity: has('plot') ? 0.45 : 0.75,
                }
          }
        >
          {isPublicPark && x === 3 && (
            <span className="absolute inset-0 z-20 flex items-center justify-center">
              <span className="whitespace-nowrap rounded-md border border-emerald-700 bg-emerald-800/95 px-1.5 py-0.5 text-[9px] font-black text-white shadow-xs">
                🌳 สวนสาธารณะ 253.9 ตร.ว.
              </span>
            </span>
          )}
          {isPocketPark && (
            <span className="absolute inset-0 z-20 flex items-center justify-center">
              <span className="whitespace-nowrap rounded-xs bg-emerald-700/90 px-1 text-[8px] font-bold text-white">
                🌿 สวนหย่อม
              </span>
            </span>
          )}
        </span>
      )}

      {/* 2. ชั้นแปลงบ้าน (รองรับทั้งแปลง 1–80 จาก PDF และบล็อก 4x4) */}
      {has('plot') && (
        <span
          className={`pointer-events-none absolute inset-0 z-[5] transition-all ${
            isSelectedPlot
              ? 'bg-amber-100 ring-2 ring-inset ring-amber-500'
              : pdfSpec?.zone === 'center'
              ? 'bg-gradient-to-br from-indigo-50 to-indigo-200/90'
              : pdfSpec?.zone === 'se'
              ? 'bg-gradient-to-br from-cyan-50 to-sky-200/90'
              : 'bg-gradient-to-br from-sky-100 to-blue-200/90'
          }`}
          style={{
            borderTop: isPlotTop ? '2px solid #1d4ed8' : '1px dashed rgba(59,130,246,0.2)',
            borderBottom: isPlotBottom ? '2px solid #1d4ed8' : '1px dashed rgba(59,130,246,0.2)',
            borderLeft: isPlotLeft ? '2px solid #1d4ed8' : '1px dashed rgba(59,130,246,0.2)',
            borderRight: isPlotRight ? '2px solid #1d4ed8' : '1px dashed rgba(59,130,246,0.2)',
            borderTopLeftRadius: isPlotTop && isPlotLeft ? '5px' : '0',
            borderTopRightRadius: isPlotTop && isPlotRight ? '5px' : '0',
            borderBottomLeftRadius: isPlotBottom && isPlotLeft ? '5px' : '0',
            borderBottomRightRadius: isPlotBottom && isPlotRight ? '5px' : '0',
          }}
        >
          {isPdfPlot && pdfSpec ? (
            <span className="absolute inset-0 z-20 flex flex-col items-center justify-center leading-none">
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-blue-800 bg-white px-1 text-[9px] font-black text-blue-950 shadow-2xs">
                {pdfSpec.plotNo}
              </span>
              <span className="mt-0.5 text-[8px] font-bold text-slate-800">
                {pdfSpec.areaSqWa}ว²
              </span>
            </span>
          ) : (
            <>
              {!isPlotTop && !isPlotBottom && (
                <span className="absolute inset-x-1 inset-y-0.5 rounded-xs bg-white/75 shadow-2xs" />
              )}
              {isPlotCenter && plotBlock && (
                <span className="absolute inset-0 z-20 flex items-center justify-center">
                  <span className="whitespace-nowrap rounded-md border border-blue-700 bg-blue-900/90 px-1.5 py-0.5 text-[10px] font-black tracking-tight text-white shadow-sm">
                    🏠 แปลง {plotBlock.label}
                  </span>
                </span>
              )}
            </>
          )}
          {/* ประตูรั้วหน้าบ้านฝั่งติดทางเท้า/ถนน */}
          {(isGateCell || (isPdfPlot && (facesSouthRoad || facesNorthRoad || facesEastRoad || facesWestRoad))) && (
            <span
              className={`absolute z-10 rounded-full bg-amber-500 border border-amber-800 ${
                facesSouthRoad
                  ? 'inset-x-2 bottom-0 h-1 translate-y-1/2'
                  : facesNorthRoad
                  ? 'inset-x-2 top-0 h-1 -translate-y-1/2'
                  : facesEastRoad
                  ? 'inset-y-2 right-0 w-1 translate-x-1/2'
                  : 'inset-y-2 left-0 w-1 -translate-x-1/2'
              }`}
              title="ประตูหน้าบ้านออกสู่ถนน/ทางเท้า"
            />
          )}
        </span>
      )}

      {/* 3. ชั้นถนนผิวจราจร (แสดงความต่างถนนเมน 9.00 ม. และถนนซอย 8.00 ม.) */}
      {has('road') && (
        <span
          className={`pointer-events-none absolute inset-0 z-[6] ${
            isMainGateRoad || isMain9mRoad ? 'bg-slate-800' : 'bg-slate-700'
          }`}
        >
          {hasAdj('road', 0, 1) && !hasAdj('road', 0, -1) && (
            <span className="absolute bottom-0 inset-x-0 z-10 border-b-2 border-dashed border-amber-300/80 translate-y-[1px]" />
          )}
          {!hasAdj('road', 0, -1) && (
            <span className="absolute top-0 inset-x-0 border-t-2 border-slate-400/70" />
          )}
          {!hasAdj('road', 0, 1) && (
            <span className="absolute bottom-0 inset-x-0 border-b-2 border-slate-400/70" />
          )}
          {isMainGateRoad && (
            <span className="absolute inset-0 z-20 flex items-center justify-center">
              <span className="whitespace-nowrap rounded-xs bg-amber-400 px-1 py-0.5 text-[8px] font-black text-slate-950 shadow-xs">
                ⛩️ ซุ้มประตู 9ม.
              </span>
            </span>
          )}
        </span>
      )}

      {/* 4. ชั้นทางเท้า (Walkway / Utility Corridor) */}
      {has('walkway') && !has('road') && (
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
      {has('walkway') && has('road') && (
        <>
          {!hasAdj('road', 0, -1) && (
            <span
              className="pointer-events-none absolute inset-x-0 top-0 z-[8] h-[5px] border-b border-amber-600/80 bg-amber-200/95"
              title="ทางเท้าหน้าบ้าน (กว้าง 1.50 ม.)"
            />
          )}
          {!hasAdj('road', 0, 1) && (
            <span
              className="pointer-events-none absolute inset-x-0 bottom-0 z-[8] h-[5px] border-t border-amber-600/80 bg-amber-200/95"
              title="ทางเท้าหน้าบ้าน (กว้าง 1.50 ม.)"
            />
          )}
          {!hasAdj('road', -1, 0) && (
            <span
              className="pointer-events-none absolute inset-y-0 left-0 z-[8] w-[5px] border-r border-amber-600/80 bg-amber-200/95"
              title="ทางเท้าหน้าบ้าน (กว้าง 1.50 ม.)"
            />
          )}
          {!hasAdj('road', 1, 0) && (
            <span
              className="pointer-events-none absolute inset-y-0 right-0 z-[8] w-[5px] border-l border-amber-600/80 bg-amber-200/95"
              title="ทางเท้าหน้าบ้าน (กว้าง 1.50 ม.)"
            />
          )}
        </>
      )}

      {/* 5. ชั้นท่อใยหิน / ท่อระบายน้ำ + บ่อพัก */}
      {has('drainage') && (
        <>
          {(drainH || !drainV) && (
            <span
              className="pointer-events-none absolute inset-x-0 z-[14] h-[4px] -translate-y-1/2 bg-teal-600 shadow-2xs"
              style={{
                top: '24%',
                backgroundImage:
                  'repeating-linear-gradient(90deg, #0f766e 0px, #0f766e 8px, #5eead4 8px, #5eead4 10px)',
              }}
            />
          )}
          {drainV && (
            <span
              className="pointer-events-none absolute inset-y-0 z-[14] w-[4px] -translate-x-1/2 bg-teal-600 shadow-2xs"
              style={{
                left: '24%',
                backgroundImage:
                  'repeating-linear-gradient(180deg, #0f766e 0px, #0f766e 8px, #5eead4 8px, #5eead4 10px)',
              }}
            />
          )}
          {isManhole && (
            <span
              className="pointer-events-none absolute z-[18] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-white bg-teal-900 shadow-xs"
              style={{ top: '24%', left: drainV && !drainH ? '24%' : '50%' }}
              title="บ่อพักท่อใยหิน/ระบายน้ำ (Manhole)"
            />
          )}
        </>
      )}

      {/* 6. ชั้นท่อประปา + จุดแยกมิเตอร์เข้าบ้าน */}
      {has('water') && (
        <>
          {(waterH || !waterV) && (
            <span
              className="pointer-events-none absolute inset-x-0 z-[15] h-[3.5px] -translate-y-1/2 bg-sky-400 border-y border-white/60"
              style={{ top: '62%' }}
            />
          )}
          {waterV && (
            <span
              className="pointer-events-none absolute inset-y-0 z-[15] w-[3.5px] -translate-x-1/2 bg-sky-400 border-x border-white/60"
              style={{ left: '62%' }}
            />
          )}
          {isWaterMeterTap && (
            <span
              className="pointer-events-none absolute z-[18] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-sky-600"
              style={{ top: '62%', left: '62%' }}
              title="จุดแยกมิเตอร์ประปาเข้าแปลงบ้าน"
            />
          )}
        </>
      )}

      {/* 7. ชั้นแนวสายไฟฟ้า */}
      {has('electric') && (
        <>
          {(elecH || !elecV) && (
            <span
              className="pointer-events-none absolute inset-x-0 z-[16] border-t-[2px] border-amber-400"
              style={{ top: '84%' }}
            />
          )}
          {elecV && (
            <span
              className="pointer-events-none absolute inset-y-0 z-[16] border-l-[2px] border-amber-400"
              style={{ left: '84%' }}
            />
          )}
        </>
      )}

      {/* 8. ชั้นเสาไฟฟ้า */}
      {has('pole') && (
        <span
          className="pointer-events-none absolute z-[22] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-200 bg-violet-700 shadow-md ring-1 ring-violet-500/40"
          style={{ top: '80%', left: '50%' }}
          title="เสาไฟฟ้าส่องสว่าง/แรงต่ำ"
        />
      )}

      {/* 9. ชั้นรั้วรอบโครงการ */}
      {has('fence') && (
        <>
          {(fenceH || !fenceV) && (
            <span
              className="pointer-events-none absolute inset-x-0 z-[12] border-t-[2.5px] border-dashed border-amber-800"
              style={{ top: '50%' }}
            />
          )}
          {fenceV && (
            <span
              className="pointer-events-none absolute inset-y-0 z-[12] border-l-[2.5px] border-dashed border-amber-800"
              style={{ left: '50%' }}
            />
          )}
        </>
      )}

      {/* 10. ไฮไลต์เส้นทางวัดระยะทาง (Distance Ruler Overlay) */}
      {inMeasureRoute && (
        <span className="pointer-events-none absolute inset-0 z-[25] bg-rose-500/25 ring-2 ring-inset ring-rose-500" />
      )}
      {measurePointRole && (
        <span className="pointer-events-none absolute inset-0 z-[28] flex items-center justify-center bg-rose-600/35 ring-2 ring-rose-600">
          <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-black text-white shadow-sm">
            {measurePointRole === 'start' ? 'จุด A' : 'จุด B'}
          </span>
        </span>
      )}

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

  // สถานะสำหรับระบบ PDF Master Plan & การคำนวณระยะทาง
  const [scaleSettings, setScaleSettings] = useState<DemoScaleSettings>(DEFAULT_DEMO_SCALE_SETTINGS);
  const [uploadedPdfName, setUploadedPdfName] = useState<string>('ผังโครงการ 80 แปลง (มาตราส่วน 1:750 · 6 มิ.ย. 2568)');
  const [showPdfReferenceModal, setShowPdfReferenceModal] = useState(false);
  const [showCadVectorMap, setShowCadVectorMap] = useState<boolean | null>(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number; label: string } | null>({
    x: 1,
    y: 9,
    label: 'ซุ้มประตูทางเข้า (ถนน 9 ม.)',
  });
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number; label: string } | null>({
    x: 2,
    y: 1,
    label: 'แปลง 38 (เหนือสุด)',
  });
  const [selectedPlotNo, setSelectedPlotNo] = useState<number | null>(1);

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

    const { blocks, blockByCoord } = computePlotBlocks(
      layout?.cells ?? [],
      cellKeys,
      layout?.cols ?? 24,
      layout?.rows ?? 16,
    );

    return { cellKeys, byCoord, blocks, blockByCoord, rowHasWalkway, rowHasPlotOrRoad, rowHasFenceOnly };
  }, [layout]);

  // คำนวณระยะทางและปริมาณงานวิศวกรรมแบบ Real-time จากผังปัจจุบัน
  const metrics = useMemo(() => {
    if (!layout) return null;
    return calculateDemoProjectMetrics(layout, scaleSettings);
  }, [layout, scaleSettings]);

  // คำนวณระยะทางระหว่างจุด A และจุด B
  const activeMeasurement = useMemo(() => {
    if (!measureStart || !measureEnd) return null;
    return measureDemoGridDistance(measureStart, measureEnd, scaleSettings);
  }, [measureStart, measureEnd, scaleSettings]);

  // เซตพิกัดที่อยู่ในแนวเส้นทางวัดระยะ A -> B
  const measureRouteCoords = useMemo(() => {
    const set = new Set<string>();
    if (!measureMode || !measureStart || !measureEnd) return set;
    const stepX = measureEnd.x >= measureStart.x ? 1 : -1;
    for (let x = measureStart.x; x !== measureEnd.x + stepX; x += stepX) {
      set.add(`${x}:${measureStart.y}`);
    }
    const stepY = measureEnd.y >= measureStart.y ? 1 : -1;
    for (let y = measureStart.y; y !== measureEnd.y + stepY; y += stepY) {
      set.add(`${measureEnd.x}:${y}`);
    }
    return set;
  }, [measureMode, measureStart, measureEnd]);

  const selectedPlotSpec = useMemo(
    () => (selectedPlotNo ? PDF_PLOT_BY_NUMBER.get(selectedPlotNo) ?? null : null),
    [selectedPlotNo],
  );

  // คำนวณความสูงแต่ละแถวตามสัดส่วนงานจริง
  const gridTemplateRows = useMemo(() => {
    if (!layout) return '';
    const tracks: string[] = [];
    for (let y = 0; y < layout.rows; y++) {
      const isWalkwayRow = gridIndex.rowHasWalkway.has(y) && !gridIndex.rowHasPlotOrRoad.has(y);
      const isBorderRow =
        (y === 0 || y === layout.rows - 1) &&
        gridIndex.rowHasFenceOnly.has(y) &&
        !gridIndex.rowHasPlotOrRoad.has(y) &&
        !isWalkwayRow;
      if (isWalkwayRow) {
        tracks.push(zoomCorridor || activeStep === 'step3_pipes' ? '44px' : '28px');
      } else if (isBorderRow) {
        tracks.push('24px');
      } else {
        tracks.push('44px');
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
  async function createFromPdfMasterPlan(customPdfFileName?: string) {
    if (!isAdmin || !loaded || operation.current || !name.trim() || !mayLeave()) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    const current = epoch.current;
    const projectName = customPdfFileName
      ? `${name.trim()} (${customPdfFileName.replace(/\.[^.]+$/, '')})`.slice(0, 100)
      : name.trim();
    const reqKey = `pdf80:${projectName}`;
    if (createRequest.current?.name !== reqKey) createRequest.current = { name: reqKey, id: crypto.randomUUID() };
    try {
      const project = await createDemoProject(projectName, createRequest.current.id, { pdfMasterPlan: true });
      if (epoch.current !== current) return;
      setProjects(rows => [project, ...rows.filter(row => row.id !== project.id)]);
      setSelected(project); setLayout(project.layout_data); setDirty(false); createRequest.current = null;
      setActiveStep('step2_road_walkway');
      setVisible(new Set<DemoCellKind>(['earthwork', 'plot', 'road', 'walkway', 'fence']));
      setShowCadVectorMap(true);
      if (customPdfFileName) setUploadedPdfName(`${customPdfFileName} (มาตราส่วน 1:750 · 80 แปลง)`);
      setNotice('Generate ผังโครงการ 80 แปลง (บ้าน + ถนน + ทางเท้า ตามรูปทรง CAD/PDF จริง) เรียบร้อยแล้ว');
    } catch (reason) {
      if (epoch.current !== current) return;
      if (isDemoAccessError(reason)) clearWorkspaceState();
      setError(reason instanceof Error ? reason.message : 'สร้างโครงการ Demo จาก PDF ไม่สำเร็จ');
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

  function getCellLabel(x: number, y: number): string {
    const block = gridIndex.blockByCoord.get(`${x}:${y}`);
    if (block?.pdfSpec) return `แปลง ${block.pdfSpec.plotNo} (${block.pdfSpec.areaSqWa} ตร.ว.)`;
    if (block) return `แปลง ${block.label}`;
    if (x === 1 && y === 9) return 'ซุ้มประตูทางเข้า (ถนน 9 ม.)';
    if (gridIndex.cellKeys.has(`road:${x}:${y}`)) return `ถนน คสล. (${x + 1}, ${y + 1})`;
    return `พิกัด (${x + 1}, ${y + 1})`;
  }

  function handleCellInteraction(x: number, y: number, isDrag = false) {
    if (busy || !layout || !isAdmin) return;

    // อัปเดตแปลงที่เลือกใน Inspector ถ้าคลิกโดนแปลงบ้านจาก PDF
    const clickedBlock = gridIndex.blockByCoord.get(`${x}:${y}`);
    if (clickedBlock?.pdfSpec && !isDrag) {
      setSelectedPlotNo(clickedBlock.pdfSpec.plotNo);
    } else {
      const specByCoord = PDF_PLOT_BY_COORD.get(`${x}:${y}`);
      if (specByCoord && !isDrag) setSelectedPlotNo(specByCoord.plotNo);
    }

    // โหมดวัดระยะทางบนผัง (คลิกจุด A -> จุด B)
    if (measureMode) {
      if (isDrag) return;
      const label = getCellLabel(x, y);
      if (!measureStart || (measureStart && measureEnd)) {
        setMeasureStart({ x, y, label });
        setMeasureEnd(null);
        setNotice(`ตั้งจุดเริ่มต้นวัดระยะ A ที่ ${label} แล้ว — คลิกอีกจุดบนผังเพื่อวัดระยะทาง`);
      } else {
        setMeasureEnd({ x, y, label });
        const result = measureDemoGridDistance(measureStart, { x, y, label }, scaleSettings);
        setNotice(
          `วัดระยะจาก ${measureStart.label} → ${label}: แนวเดินท่อ/ถนน ${result.routeDistanceM} เมตร (แนวตรง ${result.straightDistanceM} เมตร)`,
        );
      }
      return;
    }

    paint(x, y);
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
      if (!erase) {
        const pdfSpec = layer === 'plot' ? PDF_PLOT_BY_COORD.get(`${x}:${y}`) : undefined;
        const cellId = pdfSpec ? `pdf-plot-${pdfSpec.plotNo}` : `${layer}-${x}-${y}`;
        cells.push({ id: cellId, kind: layer, x, y });
      }
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

  // โหลดผังโครงการจริง 80 แปลงจาก PDF (มาตราส่วน 1:750) — แสดงเฉพาะบ้าน + ถนน + ทางเท้า ก่อน
  function applyPdfMasterPlanToCurrent(customPdfName?: string) {
    if (busy || !layout || !isAdmin) return;
    setLayout(createPdfMasterPlanLayout());
    setVisible(new Set<DemoCellKind>(['earthwork', 'plot', 'road', 'walkway', 'fence']));
    setShowCadVectorMap(true);
    setScaleSettings(DEFAULT_DEMO_SCALE_SETTINGS);
    setSelectedPlotNo(1);
    if (customPdfName) {
      setUploadedPdfName(`${customPdfName} (มาตราส่วน 1:750 · 80 แปลง)`);
    } else {
      setUploadedPdfName('ผังโครงการ 80 แปลง (มาตราส่วน 1:750 · 6 มิ.ย. 2568)');
    }
    setDirty(true);
    setNotice(
      'Generate ผังโครงการ 80 แปลง (แสดงเฉพาะ แปลงบ้าน 1–80 + ถนน คสล. + ทางเท้าหน้าบ้าน แบบ CAD Vector และ Grid) เรียบร้อยแล้ว กด "บันทึกผัง Demo" เพื่อบันทึก',
    );
  }

  function handlePdfFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (selected && layout) {
      applyPdfMasterPlanToCurrent(file.name);
    } else {
      void createFromPdfMasterPlan(file.name);
    }
  }

  // โหลดผังต้นแบบมาตรฐาน 8 แปลง (A1-A4 / B1-B4)
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
          <p className="mt-2 text-sm text-slate-600">พื้นที่ทดลอง Project Map สำหรับ Admin · รองรับการ Generate ผังจาก PDF (1:750) และคำนวณระยะทางวิศวกรรม</p>
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
      <div className="grid gap-5 lg:grid-cols-[270px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <form onSubmit={create} className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-4">
            <label htmlFor="demo-project-name" className="block text-sm font-bold text-slate-800">สร้างโครงการทดลอง</label>
            <input id="demo-project-name" value={name} maxLength={100} disabled={busy || !loaded} onChange={event => setName(event.target.value)} className="w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="ชื่อโครงการ Demo" required />
            <button type="submit" disabled={busy || !loaded || !name.trim()} className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 px-3 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'กำลังดำเนินการ…' : 'สร้าง Demo พร้อมผังตัวอย่าง'}</button>
            <button
              type="button"
              disabled={busy || !loaded || !name.trim()}
              onClick={() => void createFromPdfMasterPlan()}
              className="w-full rounded-xl border-2 border-indigo-300 bg-indigo-600 hover:bg-indigo-700 px-3 py-2.5 text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              <FileText size={15} /> สร้างจากผัง PDF 80 แปลง (1:750)
            </button>
            <label className="w-full cursor-pointer rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/70 hover:bg-indigo-100 px-3 py-2 text-xs font-bold text-indigo-950 flex items-center justify-center gap-1.5">
              <Upload size={14} className="text-indigo-700" />
              <span>อัปโหลด PDF ผังโครงการเพื่อสร้าง Map</span>
              <input
                type="file"
                accept=".pdf,image/*"
                disabled={busy || !loaded}
                onChange={handlePdfFileUpload}
                className="sr-only"
              />
            </label>
            <button
              type="button"
              disabled={busy || !loaded || !name.trim()}
              onClick={() => void createBlank()}
              className="w-full rounded-xl border-2 border-violet-200 bg-violet-50/70 hover:bg-violet-100 px-3 py-2.5 text-xs font-bold text-violet-900 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <FilePlus2 size={15} /> สร้าง Demo หน้าเปล่า (เริ่มวาดเอง)
            </button>
            <p className="text-xs leading-relaxed text-slate-500">รองรับทั้งผังจริง 80 แปลงจาก PDF (1:750), ผังตัวอย่าง 8 แปลง หรือหน้าเปล่าสำหรับฝึกวาดเอง</p>
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
                <p className="text-xs text-slate-500">
                  อ้างอิง: <strong className="text-slate-700">{uploadedPdfName}</strong> · มาตราส่วน 1:{scaleSettings.scaleRatio} {dirty && '· มีการแก้ไขที่ยังไม่บันทึก'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => applyPdfMasterPlanToCurrent()}
                  className={`${buttonClass} flex items-center gap-1.5 bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700 shadow-xs`}
                  title="นำเข้าผังโครงการจริง 80 แปลง จากไฟล์ PDF มาตราส่วน 1:750 พร้อมคำนวณระยะทางทั้งหมด"
                >
                  <FileText size={15} /> Generate ผัง 80 แปลงจาก PDF (1:750)
                </button>
                <label className={`${buttonClass} cursor-pointer flex items-center gap-1.5 bg-indigo-50 text-indigo-900 border-indigo-200 hover:bg-indigo-100`}>
                  <Upload size={15} /> อัปโหลด PDF ผังใหม่
                  <input type="file" accept=".pdf,image/*" disabled={busy} onChange={handlePdfFileUpload} className="sr-only" />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowPdfReferenceModal(v => !v)}
                  className={`${buttonClass} flex items-center gap-1.5 ${
                    showPdfReferenceModal ? 'bg-amber-100 text-amber-950 border-amber-300' : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Eye size={15} /> {showPdfReferenceModal ? 'ซ่อนผัง PDF ต้นฉบับ' : 'ดูเทียบ PDF ต้นฉบับ (1:750)'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={clearToBlankCanvas}
                  className={`${buttonClass} flex items-center gap-1.5 bg-white text-rose-700 border-rose-200 hover:bg-rose-50`}
                >
                  <RotateCcw size={15} /> ล้างเป็นผังเปล่า (เริ่มวาดใหม่)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={resetToStandardBlueprint}
                  className={`${buttonClass} flex items-center gap-1.5 bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100`}
                >
                  <Sparkles size={15} /> โหลดผังต้นแบบใหม่
                </button>
                <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={`${buttonClass} flex items-center gap-2 bg-slate-900 text-white`}><Save size={16} /> บันทึกผัง Demo</button>
              </div>
            </div>

            {/* 📄 หน้าต่างดูเทียบไฟล์ PDF ต้นฉบับ 1:750 และตาราง Land Utilization */}
            {showPdfReferenceModal && (
              <div className="mb-4 grid gap-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 p-4 lg:grid-cols-[1.2fr_1fr]">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5">
                      <FileText size={15} className="text-indigo-600" /> ไฟล์ PDF ผังโครงการต้นฉบับ (มาตราส่วน 1 : 750 · 6 มิถุนายน 2568)
                    </h3>
                    <a
                      href="/demo/masterplan-80-plots.pdf"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-bold text-indigo-700 underline hover:text-indigo-900"
                    >
                      เปิดไฟล์ PDF เต็มจอ ↗
                    </a>
                  </div>
                  <iframe
                    title="ผังโครงการ PDF 1:750"
                    src="/demo/masterplan-80-plots.pdf"
                    className="h-80 w-full rounded-xl border border-slate-300 bg-white"
                  />
                </div>
                <div className="space-y-2.5 text-xs">
                  <h3 className="font-extrabold text-slate-900">ตารางอ้างอิงสัดส่วนพื้นที่จาก PDF (Land Utilization)</h3>
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="p-2 font-bold">รายการพื้นที่</th>
                          <th className="p-2 text-right font-bold">เนื้อที่ (ตร.ว.)</th>
                          <th className="p-2 text-right font-bold">ไร่-งาน-ตร.ว.</th>
                          <th className="p-2 text-right font-bold">สัดส่วน</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        <tr className="font-bold text-slate-900 bg-slate-50/60">
                          <td className="p-2">พื้นที่โครงการรวม</td>
                          <td className="p-2 text-right">6,980.0</td>
                          <td className="p-2 text-right">17-1-80.0</td>
                          <td className="p-2 text-right">100.00%</td>
                        </tr>
                        <tr>
                          <td className="p-2">พื้นที่ขาย (บ้านเดี่ยว 80 แปลง)</td>
                          <td className="p-2 text-right font-semibold text-blue-700">4,947.3</td>
                          <td className="p-2 text-right">12-1-47.3</td>
                          <td className="p-2 text-right">70.88%</td>
                        </tr>
                        <tr>
                          <td className="p-2">พื้นที่ถนน คสล. (กว้าง 9 ม. & 8 ม.)</td>
                          <td className="p-2 text-right font-semibold text-slate-800">1,712.1</td>
                          <td className="p-2 text-right">4-1-12.1</td>
                          <td className="p-2 text-right">24.53%</td>
                        </tr>
                        <tr>
                          <td className="p-2">พื้นที่สวนสาธารณะ</td>
                          <td className="p-2 text-right font-semibold text-emerald-700">253.9</td>
                          <td className="p-2 text-right">0-2-53.9</td>
                          <td className="p-2 text-right">3.64%</td>
                        </tr>
                        <tr>
                          <td className="p-2">พื้นที่นิติบุคคล</td>
                          <td className="p-2 text-right">25.4</td>
                          <td className="p-2 text-right">0-0-25.4</td>
                          <td className="p-2 text-right">0.36%</td>
                        </tr>
                        <tr>
                          <td className="p-2">พื้นที่สวนหย่อม (4.6 + 19.1 ตร.ว.)</td>
                          <td className="p-2 text-right">23.7</td>
                          <td className="p-2 text-right">0-0-23.7</td>
                          <td className="p-2 text-right">0.34%</td>
                        </tr>
                        <tr>
                          <td className="p-2">พื้นที่ป้อมยามและซุ้มประตู (9.1 + 8.4)</td>
                          <td className="p-2 text-right">17.5</td>
                          <td className="p-2 text-right">0-0-17.5</td>
                          <td className="p-2 text-right">0.25%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

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

            {/* 🎨 ปุ่มเลือกชั้นข้อมูลที่จะวาด */}
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
                      setMeasureMode(false);
                      setLayer(item.kind);
                      setVisible(previous => new Set([...previous, item.kind]));
                    }}
                    className={`${buttonClass} flex items-center gap-2 ${
                      layer === item.kind && !measureMode
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

            {/* 🛠️ แถบเครื่องมือช่วยวางผังอัจฉริยะ + โหมดวัดระยะทางบนผัง */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={!erase && !measureMode}
                  onClick={() => { setMeasureMode(false); setErase(false); }}
                  className={`${buttonClass} flex items-center gap-1 bg-white ${!erase && !measureMode ? 'border-slate-800 text-slate-900 ring-1 ring-slate-800' : 'text-slate-600'}`}
                >
                  <Paintbrush size={15} /> วาด
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={erase && !measureMode}
                  onClick={() => { setMeasureMode(false); setErase(true); }}
                  className={`${buttonClass} flex items-center gap-1 bg-white ${erase && !measureMode ? 'border-rose-400 bg-rose-50 text-rose-700 ring-1 ring-rose-300' : 'text-slate-600'}`}
                >
                  <Eraser size={15} /> ลบเฉพาะชั้นที่เลือก
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={measureMode}
                  onClick={() => setMeasureMode(v => !v)}
                  className={`${buttonClass} flex items-center gap-1.5 ${
                    measureMode
                      ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                      : 'border-rose-200 bg-rose-50/70 text-rose-900 hover:bg-rose-100'
                  }`}
                >
                  <Ruler size={15} /> 📏 วัดระยะทางบนผัง (A → B)
                </button>

                {layer === 'plot' && !erase && !measureMode && (
                  <div className="flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50/70 p-1">
                    <button
                      type="button"
                      onClick={() => setPlotStampMode('single')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                        plotStampMode === 'single' ? 'bg-blue-600 text-white shadow-2xs' : 'text-blue-800 hover:bg-blue-100'
                      }`}
                    >
                      วาดทีละช่อง / รายแปลง
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

                {(activeStep === 'step2_road_walkway' || layer === 'walkway' || layer === 'road') && !measureMode && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={autoGenerateSidewalkBetweenPlotAndRoad}
                    className="rounded-xl border border-slate-300 bg-white hover:bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-800 flex items-center gap-1.5 shadow-2xs"
                  >
                    <Wand2 size={14} className="text-violet-600" /> สร้างทางเท้าขนาบขอบถนนอัตโนมัติ
                  </button>
                )}

                {(activeStep === 'step3_pipes' || layer === 'drainage' || layer === 'water') && !measureMode && (
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

            {/* 📏 แผงผลลัพธ์การวัดระยะทางระหว่างจุด A → จุด B (แสดงเมื่อเปิดโหมดวัดระยะ หรือมีค่าที่วัดไว้) */}
            {measureMode && (
              <div className="mb-3 rounded-xl border-2 border-rose-200 bg-rose-50/70 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-extrabold text-rose-950">
                    <Ruler size={16} className="text-rose-600" />
                    <span>เครื่องมือวัดระยะทางจากสเกล PDF (1:{scaleSettings.scaleRatio} · 1 ช่อง = {scaleSettings.cellLengthM} เมตร):</span>
                    <span className="font-normal text-rose-800">คลิกจุดเริ่มต้น (A) และจุดสิ้นสุด (B) บนผัง หรือเลือกเส้นทางตัวอย่างด้านขวา</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setMeasureStart({ x: 1, y: 9, label: 'ซุ้มประตูทางเข้า (9 ม.)' });
                        setMeasureEnd({ x: 2, y: 1, label: 'แปลง 38 (เหนือสุด)' });
                      }}
                      className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[11px] font-bold text-rose-900 hover:bg-rose-100"
                    >
                      ซุ้มประตู → แปลง 38
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMeasureStart({ x: 1, y: 9, label: 'ซุ้มประตูทางเข้า (9 ม.)' });
                        setMeasureEnd({ x: 11, y: 7, label: 'แปลง 41 (โซนกลาง)' });
                      }}
                      className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[11px] font-bold text-rose-900 hover:bg-rose-100"
                    >
                      ซุ้มประตู → แปลง 41
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMeasureStart({ x: 1, y: 9, label: 'ซุ้มประตูทางเข้า (9 ม.)' });
                        setMeasureEnd({ x: 20, y: 15, label: 'แปลง 80 (ใต้สุด)' });
                      }}
                      className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[11px] font-bold text-rose-900 hover:bg-rose-100"
                    >
                      ซุ้มประตู → แปลง 80 (ท้ายโครงการ)
                    </button>
                  </div>
                </div>
                {activeMeasurement && (
                  <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <div className="rounded-lg border border-rose-200 bg-white p-2">
                      <span className="block text-[10px] text-slate-500">จุด A → จุด B</span>
                      <span className="font-bold text-slate-900">{activeMeasurement.from.label} → {activeMeasurement.to.label}</span>
                    </div>
                    <div className="rounded-lg border border-rose-200 bg-white p-2">
                      <span className="block text-[10px] text-slate-500">ระยะเดินท่อ/ตามแนวถนน</span>
                      <span className="text-sm font-black text-rose-700">{activeMeasurement.routeDistanceM.toLocaleString()} เมตร</span>
                    </div>
                    <div className="rounded-lg border border-rose-200 bg-white p-2">
                      <span className="block text-[10px] text-slate-500">ระยะขจัดแนวตรง</span>
                      <span className="text-sm font-black text-slate-900">{activeMeasurement.straightDistanceM.toLocaleString()} เมตร</span>
                    </div>
                    <div className="rounded-lg border border-rose-200 bg-white p-2">
                      <span className="block text-[10px] text-slate-500">ท่อใยหิน/บ่อพักในระยะนี้</span>
                      <span className="font-bold text-teal-800">{activeMeasurement.estimatedPipeSections1m} ท่อน · บ่อพัก {activeMeasurement.estimatedManholes} จุด</span>
                    </div>
                    <div className="rounded-lg border border-rose-200 bg-white p-2">
                      <span className="block text-[10px] text-slate-500">เสาไฟฟ้าตามระยะนี้</span>
                      <span className="font-bold text-violet-800">ประมาณ {activeMeasurement.estimatedElectricPoles} ต้น</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 📐 แถบสลับมุมมอง CAD Vector Map vs ตาราง Grid และคำอธิบายโครงสร้างทางเท้า */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-900 px-3.5 py-2 text-[11px] text-slate-200">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-bold text-amber-300">โครงสร้างผังเริ่มต้น (เน้นทางเท้าก่อน):</span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-4 rounded-xs bg-sky-300 border border-blue-700" />
                  <span><strong>แปลงบ้าน 1–80</strong></span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-4 rounded-xs bg-slate-600 border border-slate-400" />
                  <span><strong>ถนน คสล. (9.00 ม. / 8.00 ม.)</strong></span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-5 rounded-xs bg-amber-300 border border-amber-600" />
                  <span><strong>แนวทางเท้าขนาบสองฝั่งถนน (กว้าง {scaleSettings.walkwayWidthM} ม.)</strong></span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCadVectorMap(v => !(v ?? Boolean(metrics?.isPdfMasterPlan)))}
                className={`rounded-lg px-2.5 py-1 text-xs font-extrabold transition ${
                  (showCadVectorMap ?? Boolean(metrics?.isPdfMasterPlan))
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {(showCadVectorMap ?? Boolean(metrics?.isPdfMasterPlan))
                  ? '📐 ซ่อนผังรูปทรง CAD Vector'
                  : '📐 แสดงผังรูปทรง CAD Vector (1:750)'}
              </button>
            </div>

            {/* 📐 ผังรูปทรงตามแบบ CAD/PDF จริง (Vector Map 1:750) — แปลง 1–80 รวมถึง 47–80 เรียงตรงตามแบบจริง */}
            {(showCadVectorMap ?? Boolean(metrics?.isPdfMasterPlan)) && (
              <div className="mb-4">
                <PdfCadVectorMap
                  visible={visible}
                  scaleSettings={scaleSettings}
                  selectedPlotNo={selectedPlotNo}
                  onSelectPlot={plotNo => setSelectedPlotNo(plotNo)}
                  measureMode={measureMode}
                />
              </div>
            )}

            {/* 🗺️ ผัง Project Map แบบตาราง (สำหรับแก้ไข/วาดรายช่อง) */}
            <div className="overflow-auto rounded-2xl border-2 border-slate-300 bg-slate-100 p-2 shadow-inner">
              <div
                role="group"
                aria-label="ผัง Demo แบบตาราง"
                className="grid w-full min-w-[820px] select-none rounded-xl bg-white shadow-xs overflow-hidden"
                style={{
                  gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
                  gridTemplateRows,
                }}
              >
                {Array.from({ length: layout.rows * layout.cols }, (_, index) => {
                  const x = index % layout.cols, y = Math.floor(index / layout.cols);
                  const coordKey = `${x}:${y}`;
                  const cells = gridIndex.byCoord.get(coordKey) ?? [];
                  const hasPlot = visible.has('plot') && gridIndex.cellKeys.has(`plot:${x}:${y}`);
                  const hasRoad = visible.has('road') && gridIndex.cellKeys.has(`road:${x}:${y}`);
                  const highlightWalkwayCorridor = activeStep === 'step3_pipes' || layer === 'drainage' || layer === 'water';
                  const block = gridIndex.blockByCoord.get(coordKey);
                  const isSelectedPlot = Boolean(block?.pdfSpec && block.pdfSpec.plotNo === selectedPlotNo);
                  const measurePointRole: 'start' | 'end' | null =
                    measureMode && measureStart?.x === x && measureStart?.y === y
                      ? 'start'
                      : measureMode && measureEnd?.x === x && measureEnd?.y === y
                      ? 'end'
                      : null;

                  return (
                    <button
                      key={index}
                      type="button"
                      disabled={busy}
                      aria-label={`ช่อง ${x + 1}, ${y + 1}`}
                      onPointerDown={event => { if (event.pointerType === 'mouse' && event.button === 0) handleCellInteraction(x, y, false); }}
                      onPointerEnter={event => { if (event.pointerType === 'mouse' && event.buttons === 1) handleCellInteraction(x, y, true); }}
                      onClick={() => handleCellInteraction(x, y, false)}
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
                        isSelectedPlot={isSelectedPlot}
                        measurePointRole={measurePointRole}
                        inMeasureRoute={measureRouteCoords.has(coordKey)}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <fieldset className="mt-4 flex flex-wrap gap-x-4 gap-y-2"><legend className="mb-2 text-xs font-bold text-slate-600">แสดงชั้นข้อมูล ({gridIndex.blocks.length} แปลงบ้าน)</legend>
              {DEMO_LAYERS.map(item => <label key={item.kind} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer"><input type="checkbox" checked={visible.has(item.kind)} onChange={() => setVisible(previous => { const next = new Set(previous); if (next.has(item.kind)) next.delete(item.kind); else next.add(item.kind); return next; })} />{item.label}</label>)}
            </fieldset>

            {/* 📊 ระบบคำนวณระยะทางและปริมาณงานวิศวกรรม (อ้างอิงจากระยะจริงใน PDF มาตราส่วน 1:750) */}
            {metrics && (
              <div className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
                      <Calculator size={17} className="text-indigo-600" />
                      ระบบคำนวณระยะทางและปริมาณงานอัตโนมัติ (อ้างอิงสเกล PDF 1:{scaleSettings.scaleRatio})
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      คำนวณสดตามจำนวนแปลงและแนวเส้นสาธารณูปโภคที่วางบนผัง · ปรับเทียบค่าระยะมาตรฐานด้านล่างได้ทันที
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700">
                      <span>ระยะต่อช่อง (ม.):</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        step={0.5}
                        value={scaleSettings.cellLengthM}
                        onChange={e => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v > 0) setScaleSettings(prev => ({ ...prev, cellLengthM: v }));
                        }}
                        className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right font-bold text-indigo-700"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700">
                      <span>ระยะบ่อพัก (ม.):</span>
                      <input
                        type="number"
                        min={2}
                        max={50}
                        step={0.5}
                        value={scaleSettings.manholeIntervalM}
                        onChange={e => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v > 0) setScaleSettings(prev => ({ ...prev, manholeIntervalM: v }));
                        }}
                        className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-right font-bold text-teal-700"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700">
                      <span>ระยะเสาไฟ (ม.):</span>
                      <input
                        type="number"
                        min={5}
                        max={100}
                        step={1}
                        value={scaleSettings.poleIntervalM}
                        onChange={e => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v > 0) setScaleSettings(prev => ({ ...prev, poleIntervalM: v }));
                        }}
                        className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-right font-bold text-violet-700"
                      />
                    </label>
                  </div>
                </div>

                {/* การ์ดสรุปปริมาณงาน 6 หมวดหลัก */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-blue-200 bg-white p-3.5 shadow-2xs">
                    <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                      <span>🏠 1. แปลงบ้านจัดสรร & ถมดิน</span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-800">
                        {metrics.plotCount} แปลง
                      </span>
                    </div>
                    <p className="mt-2 text-lg font-black text-slate-900">
                      {metrics.totalPlotAreaSqWa.toLocaleString()} ตร.ว.{' '}
                      <span className="text-xs font-semibold text-slate-500">({metrics.totalPlotAreaSqM.toLocaleString()} ตร.ม.)</span>
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      หน้ากว้างแปลงติดถนนรวม: <strong>{metrics.totalPlotFrontageM.toLocaleString()} เมตร</strong>
                      {metrics.publicParkAreaSqWa > 0 && ` · สวนสาธารณะ ${metrics.publicParkAreaSqWa} ตร.ว.`}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-300 bg-white p-3.5 shadow-2xs">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                      <span>🛣️ 2. ถนน คสล. (กว้าง 9 ม. & 8 ม.)</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-700">
                        ยาวรวม {metrics.roadLengthM.toLocaleString()} ม.
                      </span>
                    </div>
                    <p className="mt-2 text-lg font-black text-slate-900">
                      {metrics.roadAreaSqM.toLocaleString()} ตร.ม.{' '}
                      <span className="text-xs font-semibold text-slate-500">({metrics.roadAreaSqWa.toLocaleString()} ตร.ว.)</span>
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      ถนนเมน 9 ม.: <strong>{metrics.mainRoad9mLengthM} ม.</strong> · ถนนซอย 8 ม.: <strong>{metrics.subRoad8mLengthM} ม.</strong>
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>🚶 3. ทางเท้า & ร่องสาธารณูปโภค</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-700">
                        กว้าง {scaleSettings.walkwayWidthM} ม.
                      </span>
                    </div>
                    <p className="mt-2 text-lg font-black text-slate-900">
                      {metrics.walkwayLengthM.toLocaleString()} เมตร
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      พื้นที่ทางเท้ารวม: <strong>{metrics.walkwayAreaSqM.toLocaleString()} ตร.ม.</strong>
                    </p>
                  </div>

                  <div className="rounded-xl border border-teal-200 bg-white p-3.5 shadow-2xs">
                    <div className="flex items-center justify-between text-xs font-bold text-teal-900">
                      <span>🟢 4. ท่อใยหิน / ท่อระบายน้ำ</span>
                      <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-black text-teal-800">
                        บ่อพัก {metrics.manholeCount} จุด
                      </span>
                    </div>
                    <p className="mt-2 text-lg font-black text-teal-900">
                      {metrics.drainageLengthM.toLocaleString()} เมตร
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      ท่อใยหิน (ท่อนละ 1 ม.): <strong>{metrics.drainagePipeSections1m.toLocaleString()} ท่อน</strong> · บ่อพักทุก {scaleSettings.manholeIntervalM} ม.
                    </p>
                  </div>

                  <div className="rounded-xl border border-sky-200 bg-white p-3.5 shadow-2xs">
                    <div className="flex items-center justify-between text-xs font-bold text-sky-900">
                      <span>🔵 5. ท่อประปา & มิเตอร์น้ำ</span>
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-800">
                        หัวต่อเข้าบ้าน {metrics.waterMeterTapCount} จุด
                      </span>
                    </div>
                    <p className="mt-2 text-lg font-black text-sky-900">
                      {metrics.waterPipeLengthM.toLocaleString()} เมตร
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      เดินขนานในร่องทางเท้า พร้อมจุดแยกเข้าแปลงบ้านครบ {metrics.waterMeterTapCount} แปลง
                    </p>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-white p-3.5 shadow-2xs">
                    <div className="flex items-center justify-between text-xs font-bold text-amber-900">
                      <span>⚡ 6. แนวสายไฟ เสาไฟ & รั้วโครงการ</span>
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-800">
                        เสาไฟ {metrics.poleCount} ต้น (แนะนำ {metrics.recommendedPoleCount})
                      </span>
                    </div>
                    <p className="mt-2 text-lg font-black text-slate-900">
                      สายไฟ {metrics.electricLineLengthM.toLocaleString()} ม. · รั้ว {metrics.fenceLengthM.toLocaleString()} ม.
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      ระยะห่างเสาไฟมาตรฐานทุก {scaleSettings.poleIntervalM} ม. · รั้วรอบแนวเขตที่ดิน
                    </p>
                  </div>
                </div>

                {/* 🔍 ข้อมูลแปลงบ้านรายแปลงจาก PDF (แปลงที่ 1–80) */}
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-extrabold text-slate-900">
                      <MapPin size={15} className="text-blue-600" />
                      <span>ตรวจสอบขนาดและระยะรายแปลงจาก PDF (แปลงที่ 1 – 80):</span>
                    </div>
                    <select
                      aria-label="เลือกแปลงบ้านจากผัง PDF"
                      value={selectedPlotNo ?? 1}
                      onChange={e => setSelectedPlotNo(Number(e.target.value))}
                      className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-800"
                    >
                      {PDF_MASTERPLAN_PLOTS.map(p => (
                        <option key={p.plotNo} value={p.plotNo}>
                          แปลงที่ {p.plotNo} — {p.areaSqWa} ตร.ว. (หน้ากว้าง {p.frontageM} ม. × ลึก {p.depthM} ม.)
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedPlotSpec && (
                    <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                      <div className="rounded-lg bg-blue-50/70 p-2">
                        <span className="block text-[10px] text-slate-500">หมายเลขแปลง / โซน</span>
                        <span className="font-black text-blue-950">แปลงที่ {selectedPlotSpec.plotNo}</span>
                        <span className="block text-[10px] text-blue-800">{selectedPlotSpec.zoneLabel}</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <span className="block text-[10px] text-slate-500">เนื้อที่ตามผัง PDF</span>
                        <span className="font-black text-slate-900">
                          {selectedPlotSpec.areaSqWa} ตร.ว. ({(selectedPlotSpec.areaSqWa * 4).toFixed(1)} ตร.ม.)
                        </span>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <span className="block text-[10px] text-slate-500">ระยะหน้ากว้างติดถนน</span>
                        <span className="font-black text-emerald-800">{selectedPlotSpec.frontageM.toFixed(2)} เมตร</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <span className="block text-[10px] text-slate-500">ความลึกแปลง</span>
                        <span className="font-black text-slate-900">{selectedPlotSpec.depthM.toFixed(2)} เมตร</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <span className="block text-[10px] text-slate-500">ขนาดถนน คสล. หน้าแปลง</span>
                        <span className="font-black text-indigo-900">กว้าง {selectedPlotSpec.roadWidthM.toFixed(2)} เมตร</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>}
        </div>
      </div>
    </section>
  );
}
