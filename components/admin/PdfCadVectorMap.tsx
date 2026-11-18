'use client';

import React, { useMemo, useState } from 'react';
import { Compass, Ruler, ZoomIn, ZoomOut } from 'lucide-react';
import {
  PDF_PLOT_BY_NUMBER,
  type DemoCellKind,
  type DemoScaleSettings,
} from '@/lib/demoProjects';

// ฟังก์ชันแปลงพิกัดท้องถิ่นของโซนบน (เอียง +23.5°) และโซนล่าง (เอียง -8.5°) ให้เชื่อมเป็นพิกัดโลก (Global SVG X,Y) เดียวกันไร้รอยต่อ
const RAD_U = (23.5 * Math.PI) / 180;
const COS_U = Math.cos(RAD_U);
const SIN_U = Math.sin(RAD_U);

function U(u: number, v: number): [number, number] {
  return [
    Number((350 + u * COS_U - v * SIN_U).toFixed(1)),
    Number((75 + u * SIN_U + v * COS_U).toFixed(1)),
  ];
}

// จุดหมุนของโซนล่าง L(0,0) เชื่อมต่อพอดีกับขอบถนนใต้แปลง 45–46 ที่ U(365, 446) = (506.8, 629.5)
const RAD_L = (-8.5 * Math.PI) / 180;
const COS_L = Math.cos(RAD_L);
const SIN_L = Math.sin(RAD_L);

function L(x: number, y: number): [number, number] {
  return [
    Number((506.8 + x * COS_L - y * SIN_L).toFixed(1)),
    Number((629.5 + x * SIN_L + y * COS_L).toFixed(1)),
  ];
}

function pts(coords: ReadonlyArray<[number, number]>): string {
  return coords.map(([x, y]) => `${x},${y}`).join(' ');
}

function rectU(u: number, v: number, w: number, h: number): [number, number][] {
  return [U(u, v), U(u + w, v), U(u + w, v + h), U(u, v + h)];
}

function rectL(x: number, y: number, w: number, h: number): [number, number][] {
  return [L(x, y), L(x + w, y), L(x + w, y + h), L(x, y + h)];
}

function polygonCenter(poly: ReadonlyArray<[number, number]>): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [px, py] of poly) {
    sx += px;
    sy += py;
  }
  return [Number((sx / poly.length).toFixed(1)), Number((sy / poly.length).toFixed(1))];
}

interface VectorPlotPolygon {
  plotNo: number;
  points: [number, number][];
  center: [number, number];
  labelAngle: number;
}

function buildAllPlotPolygons(): VectorPlotPolygon[] {
  const list: Array<{ plotNo: number; points: [number, number][]; labelAngle: number }> = [
    // ================= โซนบน-ซ้าย: บล็อก 3 (แปลง 38–33 และ 27–32) =================
    { plotNo: 38, points: [U(0, 14), U(42, 26), U(42, 77), U(0, 77)], labelAngle: 23.5 },
    { plotNo: 37, points: rectU(42, 26, 38, 51), labelAngle: 23.5 },
    { plotNo: 36, points: rectU(80, 26, 38, 51), labelAngle: 23.5 },
    { plotNo: 35, points: rectU(118, 26, 38, 51), labelAngle: 23.5 },
    { plotNo: 34, points: rectU(156, 26, 38, 51), labelAngle: 23.5 },
    { plotNo: 33, points: rectU(194, 26, 40, 51), labelAngle: 23.5 },

    { plotNo: 27, points: rectU(0, 77, 42, 51), labelAngle: 23.5 },
    { plotNo: 28, points: rectU(42, 77, 38, 51), labelAngle: 23.5 },
    { plotNo: 29, points: rectU(80, 77, 38, 51), labelAngle: 23.5 },
    { plotNo: 30, points: rectU(118, 77, 38, 51), labelAngle: 23.5 },
    { plotNo: 31, points: rectU(156, 77, 38, 51), labelAngle: 23.5 },
    { plotNo: 32, points: rectU(194, 77, 40, 51), labelAngle: 23.5 },

    // ================= โซนบน-ซ้าย: บล็อก 2 (แปลง 26–21 และ 15–20) =================
    { plotNo: 26, points: rectU(0, 154, 42, 51), labelAngle: 23.5 },
    { plotNo: 25, points: rectU(42, 154, 38, 51), labelAngle: 23.5 },
    { plotNo: 24, points: rectU(80, 154, 38, 51), labelAngle: 23.5 },
    { plotNo: 23, points: rectU(118, 154, 38, 51), labelAngle: 23.5 },
    { plotNo: 22, points: rectU(156, 154, 38, 51), labelAngle: 23.5 },
    { plotNo: 21, points: rectU(194, 154, 40, 51), labelAngle: 23.5 },

    { plotNo: 15, points: rectU(0, 205, 40, 51), labelAngle: 23.5 },
    { plotNo: 16, points: rectU(40, 205, 39, 51), labelAngle: 23.5 },
    { plotNo: 17, points: rectU(79, 205, 39, 51), labelAngle: 23.5 },
    { plotNo: 18, points: rectU(118, 205, 39, 51), labelAngle: 23.5 },
    { plotNo: 19, points: rectU(157, 205, 39, 51), labelAngle: 23.5 },
    { plotNo: 20, points: rectU(196, 205, 38, 51), labelAngle: 23.5 },

    // ================= โซนบน-ซ้าย: บล็อก 1 (แปลง 14–9 และ 1–6) =================
    { plotNo: 14, points: rectU(0, 282, 40, 51), labelAngle: 23.5 },
    { plotNo: 13, points: rectU(40, 282, 39, 51), labelAngle: 23.5 },
    { plotNo: 12, points: rectU(79, 282, 39, 51), labelAngle: 23.5 },
    { plotNo: 11, points: rectU(118, 282, 39, 51), labelAngle: 23.5 },
    { plotNo: 10, points: rectU(157, 282, 39, 51), labelAngle: 23.5 },
    { plotNo: 9, points: rectU(196, 282, 38, 51), labelAngle: 23.5 },

    { plotNo: 1, points: rectU(0, 333, 40, 51), labelAngle: 23.5 },
    { plotNo: 2, points: rectU(40, 333, 39, 51), labelAngle: 23.5 },
    { plotNo: 3, points: rectU(79, 333, 39, 51), labelAngle: 23.5 },
    { plotNo: 4, points: rectU(118, 333, 39, 51), labelAngle: 23.5 },
    { plotNo: 5, points: rectU(157, 333, 39, 51), labelAngle: 23.5 },
    { plotNo: 6, points: rectU(196, 333, 38, 51), labelAngle: 23.5 },

    // ================= โซนสวนสาธารณะ (แปลง 7–8 รูปทรงตามแนวเขตที่ดินจริง) =================
    { plotNo: 7, points: [U(108, 414), U(160, 414), U(160, 470), U(108, 474)], labelAngle: 23.5 },
    {
      plotNo: 8,
      points: [U(160, 414), U(244, 414), U(244, 446), U(195, 458), U(160, 470)],
      labelAngle: 23.5,
    },

    // ================= โซนกลาง (แปลง 39–46 ขอบเขตที่ดินชิดแปลง 39,40 และ 41,46) =================
    { plotNo: 39, points: rectU(260, 196, 66, 48), labelAngle: 23.5 },
    { plotNo: 40, points: rectU(260, 244, 66, 48), labelAngle: 23.5 },

    { plotNo: 43, points: rectU(260, 318, 45, 51), labelAngle: 23.5 },
    { plotNo: 42, points: rectU(305, 318, 45, 51), labelAngle: 23.5 },
    { plotNo: 44, points: rectU(260, 369, 45, 51), labelAngle: 23.5 },
    { plotNo: 45, points: rectU(305, 369, 45, 51), labelAngle: 23.5 },
    // แปลง 41 (107.2 ตร.ว.) กินความลึกด้านขวาของ 42 ลงมาถึงครึ่งบนของ 45
    {
      plotNo: 41,
      points: [U(350, 318), U(404, 318), U(400, 382), U(350, 382)],
      labelAngle: 23.5,
    },
    // แปลง 46 (62.9 ตร.ว.) อยู่ใต้แปลง 41 และปาดมุมล่างขวารับโค้งถนนที่จะเลี้ยวลงโซนล่าง
    {
      plotNo: 46,
      points: [U(350, 382), U(400, 382), U(394, 426), U(368, 420), U(350, 420)],
      labelAngle: 23.5,
    },

    // ================= โซนล่าง-ขวา (แปลง 47–80 เชื่อมต่อจากถนนใต้แปลง 44–46 แบบไร้รอยต่อ) =================
    // ฝั่งซ้ายถนนเมนแนวตั้ง: 48 -> 49 -> 51 -> 52 -> 57
    // แปลง 48 ขอบบนเฉียงรับกับใต้ถนนหน้าแปลง 44–45 พอดีเป๊ะ!
    {
      plotNo: 48,
      points: [U(296, 446), L(0, 0), L(0, 48), L(-62, 48)],
      labelAngle: -8.5,
    },
    { plotNo: 49, points: rectL(-62, 48, 62, 42), labelAngle: -8.5 },
    { plotNo: 51, points: rectL(-62, 90, 62, 42), labelAngle: -8.5 },
    { plotNo: 52, points: rectL(-62, 132, 62, 42), labelAngle: -8.5 },

    // แปลง 57 อยู่หัวมุมซอย ความกว้างเท่ากับ 52 (x=-62..0) ส่วน 58, 59, 60, 61 ยื่นขอบบนสูงขึ้นไปตามแนวเขตที่ดินจริง
    { plotNo: 57, points: rectL(-62, 174, 62, 42), labelAngle: -8.5 },
    {
      plotNo: 58,
      points: [L(-104, 150), L(-62, 136), L(-62, 216), L(-104, 216)],
      labelAngle: -8.5,
    },
    {
      plotNo: 59,
      points: [L(-146, 152), L(-104, 150), L(-104, 216), L(-146, 216)],
      labelAngle: -8.5,
    },
    {
      plotNo: 60,
      points: [L(-188, 155), L(-146, 152), L(-146, 216), L(-188, 216)],
      labelAngle: -8.5,
    },
    {
      plotNo: 61,
      points: [L(-238, 166), L(-188, 155), L(-188, 216), L(-238, 216)],
      labelAngle: -8.5,
    },

    // ใต้ถนนซอยฝั่งซ้าย (y=242): แปลง 62 (คางหมูตามลำเหมือง), 63, 64
    {
      plotNo: 62,
      points: [L(-222, 242), L(-104, 242), L(-104, 298), L(-142, 298), L(-214, 266)],
      labelAngle: -8.5,
    },
    { plotNo: 63, points: rectL(-104, 242, 52, 56), labelAngle: -8.5 },
    { plotNo: 64, points: rectL(-52, 242, 52, 56), labelAngle: -8.5 },

    // ใต้แปลง 63, 64 ลงมาตามถนนเมน: แปลง 70 (กว้างรับใต้ 63–64), 71, 72
    {
      plotNo: 70,
      points: [L(-104, 298), L(0, 298), L(0, 340), L(-64, 340)],
      labelAngle: -8.5,
    },
    { plotNo: 71, points: rectL(-64, 340, 64, 36), labelAngle: -8.5 },
    { plotNo: 72, points: rectL(-64, 376, 64, 36), labelAngle: -8.5 },

    // ฝั่งขวาของถนนเมนแนวตั้ง (x=28 เป็นต้นไป):
    // บล็อกที่ 1: แปลง 47, 50 (ขอบบนเฉียงตามลำเหมืองสาธารณประโยชน์) หลังชนกับ 53, 54
    {
      plotNo: 47,
      points: [L(28, 0), L(60, -14), L(94, 4), L(86, 56), L(28, 56)],
      labelAngle: -8.5,
    },
    {
      plotNo: 50,
      points: [L(94, 4), L(148, 30), L(154, 64), L(86, 64), L(86, 56)],
      labelAngle: -8.5,
    },
    { plotNo: 53, points: rectL(28, 56, 58, 62), labelAngle: -8.5 },
    {
      plotNo: 54,
      points: [L(86, 64), L(154, 64), L(160, 118), L(86, 118)],
      labelAngle: -8.5,
    },

    // คั่นด้วยถนนซอยฝั่งขวา เส้นที่ 1 (y=118..144) -> บล็อกที่ 2: แปลง 56, 55 หลังชนกับ 65, 66
    { plotNo: 56, points: rectL(28, 144, 64, 56), labelAngle: -8.5 },
    {
      plotNo: 55,
      points: [L(92, 144), L(162, 144), L(168, 200), L(92, 200)],
      labelAngle: -8.5,
    },
    { plotNo: 65, points: rectL(28, 200, 64, 58), labelAngle: -8.5 },
    {
      plotNo: 66,
      points: [L(92, 200), L(168, 200), L(174, 258), L(92, 258)],
      labelAngle: -8.5,
    },

    // คั่นด้วยถนนซอยฝั่งขวา เส้นที่ 2 (y=258..284) -> บล็อกที่ 3: แปลง 69, 68, 67 หลังชนกับ 73, 74, 75
    { plotNo: 69, points: rectL(28, 284, 48, 64), labelAngle: -8.5 },
    { plotNo: 68, points: rectL(76, 284, 46, 64), labelAngle: -8.5 },
    {
      plotNo: 67,
      points: [L(122, 284), L(176, 284), L(182, 348), L(122, 348)],
      labelAngle: -8.5,
    },
    { plotNo: 73, points: rectL(28, 348, 48, 64), labelAngle: -8.5 },
    { plotNo: 74, points: rectL(76, 348, 46, 64), labelAngle: -8.5 },
    {
      plotNo: 75,
      points: [L(122, 348), L(182, 348), L(188, 412), L(122, 412)],
      labelAngle: -8.5,
    },

    // คั่นด้วยถนนซอยล่างสุด (y=412..438) -> แถวล่างสุด: แปลง 76, 77, 78, 79, 80
    {
      plotNo: 76,
      points: [L(-64, 438), L(14, 438), L(14, 510), L(-64, 516)],
      labelAngle: -8.5,
    },
    {
      plotNo: 77,
      points: [L(14, 438), L(58, 438), L(58, 505), L(14, 510)],
      labelAngle: -8.5,
    },
    {
      plotNo: 78,
      points: [L(58, 438), L(102, 438), L(102, 500), L(58, 505)],
      labelAngle: -8.5,
    },
    {
      plotNo: 79,
      points: [L(102, 438), L(146, 438), L(146, 495), L(102, 500)],
      labelAngle: -8.5,
    },
    {
      plotNo: 80,
      points: [L(146, 438), L(192, 438), L(198, 489), L(146, 495)],
      labelAngle: -8.5,
    },
  ];

  return list.map(item => ({
    ...item,
    center: polygonCenter(item.points),
  }));
}

const ALL_PLOT_POLYGONS = buildAllPlotPolygons();

interface PdfCadVectorMapProps {
  visible: ReadonlySet<DemoCellKind>;
  scaleSettings: DemoScaleSettings;
  selectedPlotNo: number | null;
  onSelectPlot: (plotNo: number) => void;
  measureMode: boolean;
}

export default function PdfCadVectorMap({
  visible,
  scaleSettings,
  selectedPlotNo,
  onSelectPlot,
  measureMode,
}: PdfCadVectorMapProps) {
  const [zoom, setZoom] = useState(1);
  const [highlightSidewalk, setHighlightSidewalk] = useState(true);
  const [measurePlotPair, setMeasurePlotPair] = useState<[number, number]>([1, 80]);

  const showPlot = visible.has('plot');
  const showRoad = visible.has('road');
  const showWalkway = visible.has('walkway');
  const showEarthwork = visible.has('earthwork');
  const showDrainage = visible.has('drainage');
  const showWater = visible.has('water');
  const showElectric = visible.has('electric');

  const plotPolyMap = useMemo(() => {
    const map = new Map<number, VectorPlotPolygon>();
    for (const p of ALL_PLOT_POLYGONS) map.set(p.plotNo, p);
    return map;
  }, []);

  // คำนวณระยะทางจริงบนผัง CAD Vector ระหว่างแปลง A และแปลง B
  const vectorMeasurement = useMemo(() => {
    const [aNo, bNo] = measurePlotPair;
    const polyA = plotPolyMap.get(aNo);
    const polyB = plotPolyMap.get(bNo);
    if (!polyA || !polyB) return null;
    const [ax, ay] = polyA.center;
    const [bx, by] = polyB.center;
    const svgDist = Math.hypot(bx - ax, by - ay);
    const scaleFactor = scaleSettings.cellLengthM / 12.5;
    const straightMeters = Number(((svgDist / 3.2) * scaleFactor).toFixed(1));
    const roadWalkwayMeters = Number((straightMeters * 1.24).toFixed(1));
    return {
      aNo,
      bNo,
      posA: { gx: ax, gy: ay },
      posB: { gx: bx, gy: by },
      straightMeters,
      roadWalkwayMeters,
    };
  }, [measurePlotPair, plotPolyMap, scaleSettings.cellLengthM]);

  function handlePlotClick(plotNo: number) {
    onSelectPlot(plotNo);
    if (measureMode) {
      setMeasurePlotPair(([prevA, prevB]) => [prevB, plotNo === prevB ? prevA : plotNo]);
    }
  }

  const sidewalkFill = highlightSidewalk ? '#fde68a' : '#cbd5e1';
  const sidewalkStroke = highlightSidewalk ? '#d97706' : '#64748b';

  // แนวเขตที่ดินรวมทั้งโครงการ (แผ่นดินผืนเดียวกันต่อเนื่องตั้งแต่แปลง 38 ลงมาถึงแปลง 76–80)
  const projectBoundaryPoints = useMemo(
    () =>
      pts([
        U(-8, 10),
        U(135, 0),
        U(135, -20),
        U(225, -20),
        U(264, 0),
        U(264, 196),
        U(328, 196),
        U(328, 292),
        U(406, 292),
        U(406, 318),
        U(402, 382),
        U(396, 430),
        L(60, -16),
        L(150, 28),
        L(162, 118),
        L(194, 440),
        L(200, 490),
        L(146, 496),
        L(-66, 518),
        L(-66, 340),
        L(-144, 300),
        L(-216, 268),
        L(-240, 242),
        L(-240, 164),
        L(-188, 152),
        L(-104, 148),
        L(-64, 134),
        U(294, 446),
        U(244, 446),
        U(195, 458),
        U(108, 476),
        U(12, 482),
        U(-8, 450),
      ]),
    [],
  );

  // พิกัดป้ายข้อความบนถนน
  const roadLabelNorth = U(118, 15);
  const roadLabelMid2 = U(118, 143);
  const roadLabelMid1 = U(118, 271);
  const roadLabelMain9m = U(118, 401);
  const roadLabelUpperSpine = U(247, 190);
  const roadLabelCenterSub = U(332, 307);
  const roadLabelConnect = U(312, 435);
  const roadLabelLowerSpine1 = L(14, 150);
  const roadLabelLowerSpine2 = L(14, 355);
  const roadLabelEast1 = L(95, 133);
  const roadLabelEast2 = L(102, 273);
  const roadLabelWestAlley = L(-135, 231);
  const roadLabelSouthBottom = L(64, 427);

  return (
    <div className="space-y-2.5">
      {/* แถบควบคุมมุมมองผัง CAD Vector */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-2.5 py-1 font-extrabold text-white shadow-2xs">
            <Compass size={14} /> ผัง CAD Vector รูปทรงจริงตาม PDF (มาตราส่วน 1:{scaleSettings.scaleRatio})
          </span>
          <span className="text-slate-700">
            เชื่อมรอยต่อถนนแปลง <strong>44–46 → 47, 48</strong> และรูปทรงแปลงริมขอบโครงการครบทั้ง <strong>80 แปลง</strong> +{' '}
            <strong className="text-amber-900">ทางเท้าหน้าบ้าน</strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setHighlightSidewalk(v => !v)}
            className={`rounded-lg border px-2.5 py-1 font-bold transition ${
              highlightSidewalk
                ? 'border-amber-500 bg-amber-100 text-amber-950 shadow-2xs'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            🚶 {highlightSidewalk ? 'กำลังเน้นสีแนวทางเท้า (สีเหลืองอำพัน)' : 'แสดงสีทางเท้าปกติ'}
          </button>
          <button
            type="button"
            onClick={() => setZoom(z => Math.max(0.75, Number((z - 0.15).toFixed(2))))}
            className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
            title="ซูมออก"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-bold text-slate-700 hover:bg-slate-100"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom(z => Math.min(1.6, Number((z + 0.15).toFixed(2))))}
            className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
            title="ซูมเข้า"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* แถบสรุปเมื่อเปิดโหมดวัดระยะบนผัง CAD Vector */}
      {measureMode && vectorMeasurement && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs text-rose-950">
          <div className="flex items-center gap-2 font-bold">
            <Ruler size={15} className="text-rose-600" />
            <span>
              วัดระยะบนผัง CAD Vector: <strong>แปลงที่ {vectorMeasurement.aNo}</strong> →{' '}
              <strong>แปลงที่ {vectorMeasurement.bNo}</strong>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span>
              ระยะตามแนวทางเท้า/ถนน: <strong className="text-sm font-black text-rose-700">{vectorMeasurement.roadWalkwayMeters} เมตร</strong>
            </span>
            <span>
              ระยะขจัดแนวตรง: <strong className="text-sm font-black text-slate-900">{vectorMeasurement.straightMeters} เมตร</strong>
            </span>
            <span className="text-[11px] text-rose-700">(คลิกที่แปลงใดก็ได้บนผังเพื่อเปลี่ยนจุดวัดระยะ)</span>
          </div>
        </div>
      )}

      {/* กระดาน SVG CAD Vector Map (พิกัดโลกผืนเดียวกัน ไร้รอยต่อ) */}
      <div className="overflow-auto rounded-2xl border-2 border-slate-300 bg-[#f8fafc] p-3 shadow-inner">
        <div
          className="mx-auto transition-transform origin-top-left"
          style={{
            width: `${Math.round(920 * zoom)}px`,
          }}
        >
          <svg
            viewBox="0 0 920 1240"
            role="img"
            aria-label="ผัง CAD Vector 80 แปลง ตามแบบ PDF 1:750"
            className="w-full h-auto rounded-xl border border-slate-200 bg-white shadow-xs select-none"
          >
            <defs>
              <pattern id="cad-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f1f5f9" strokeWidth="1" />
              </pattern>
              <pattern id="park-grass" width="10" height="10" patternUnits="userSpaceOnUse">
                <circle cx="3" cy="3" r="1.2" fill="#16a34a" opacity="0.45" />
                <circle cx="8" cy="7" r="1" fill="#15803d" opacity="0.35" />
              </pattern>
            </defs>

            <rect x="0" y="0" width="920" height="1240" fill="url(#cad-grid)" />

            {/* ป้ายกำกับที่ดินข้างเคียงตามผัง PDF */}
            <text x="450" y="28" textAnchor="middle" className="fill-slate-500 text-[12px] font-bold">
              ที่ดินบุคคลอื่น
            </text>
            <text x="880" y="42" textAnchor="end" className="fill-slate-700 text-[12px] font-extrabold">
              6 มิถุนายน 2568
            </text>
            <text x="640" y="340" textAnchor="middle" className="fill-slate-500 text-[12px] font-bold">
              ที่ดินบุคคลอื่น
            </text>
            <text x="345" y="685" textAnchor="middle" className="fill-slate-500 text-[12px] font-bold">
              ที่ดินบุคคลอื่น
            </text>
            <text x="825" y="840" textAnchor="middle" className="fill-slate-500 text-[12px] font-bold">
              ที่ดินบุคคลอื่น
            </text>
            <text x="680" y="1205" textAnchor="middle" className="fill-slate-500 text-[12px] font-bold">
              ที่ดินบุคคลอื่น
            </text>

            {/* ================= 1. ชั้นแนวเขตที่ดินรวมและสวนสาธารณะ (ผืนเดียวกันไร้รอยต่อ) ================= */}
            {showEarthwork && (
              <g>
                <polygon
                  points={projectBoundaryPoints}
                  fill="#f5ebe0"
                  stroke="#78350f"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
                {/* สวนหย่อมทิศเหนือ 19.1 ตร.ว. */}
                <polygon
                  points={pts([U(136, -18), U(224, -18), U(224, 0), U(136, 0)])}
                  fill="#bbf7d0"
                  stroke="#15803d"
                  strokeWidth="1.5"
                />
                {/* สวนหย่อมทิศตะวันตก 4.6 ตร.ว. */}
                <polygon
                  points={pts([U(-7, 282), U(0, 282), U(0, 333), U(-7, 333)])}
                  fill="#86efac"
                  stroke="#15803d"
                  strokeWidth="1.2"
                />
                {/* พื้นที่สวนสาธารณะ 253.9 ตร.ว. */}
                <polygon
                  points={pts([U(0, 414), U(108, 414), U(108, 474), U(12, 482), U(0, 452)])}
                  fill="#bbf7d0"
                  stroke="#15803d"
                  strokeWidth="2"
                />
                <polygon
                  points={pts([U(0, 414), U(108, 414), U(108, 474), U(12, 482), U(0, 452)])}
                  fill="url(#park-grass)"
                />
                {(() => {
                  const [px, py] = U(54, 444);
                  return (
                    <g transform={`translate(${px}, ${py}) rotate(23.5)`}>
                      <text x="0" y="-4" textAnchor="middle" className="fill-emerald-950 text-[9.5px] font-black">
                        🌳 พื้นที่สวนสาธารณะ
                      </text>
                      <text x="0" y="9" textAnchor="middle" className="fill-emerald-900 text-[9px] font-bold">
                        253.9 ตร.ว.
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}

            {/* ================= 2. ชั้นโครงข่ายถนน คสล. (เชื่อมรอยต่อโค้งหักศอกช่วงแปลง 46 -> 47,48 สนิท 100%) ================= */}
            {showRoad && (
              <g>
                {/* ถนนเหนือสุด กว้าง 8.00 ม. */}
                <polygon points={pts(rectU(0, 0, 260, 26))} fill="#475569" />
                {/* ถนนซอย 2 (คั่นระหว่าง 27..32 กับ 26..21) */}
                <polygon points={pts(rectU(0, 128, 260, 26))} fill="#475569" />
                {/* ถนนซอย 1 (คั่นระหว่าง 15..20 กับ 14..9) */}
                <polygon points={pts(rectU(0, 256, 260, 26))} fill="#475569" />
                {/* ถนนทางเข้าหลัก กว้าง 9.00 ม. */}
                <polygon points={pts(rectU(-14, 384, 274, 30))} fill="#334155" />
                {/* เส้นประแบ่งเลนถนนเมน 9.00 ม. */}
                <line
                  x1={U(0, 399)[0]}
                  y1={U(0, 399)[1]}
                  x2={U(234, 399)[0]}
                  y2={U(234, 399)[1]}
                  stroke="#fcd34d"
                  strokeWidth="1.5"
                  strokeDasharray="6 4"
                />
                {/* ป้อมยามและซุ้มประตูทางเข้า */}
                <polygon
                  points={pts(rectU(-18, 390, 14, 18))}
                  fill="#f59e0b"
                  stroke="#78350f"
                  strokeWidth="1.5"
                />
                {(() => {
                  const [gx, gy] = U(-24, 399);
                  return (
                    <text
                      x={gx}
                      y={gy}
                      textAnchor="end"
                      transform={`rotate(23.5, ${gx}, ${gy})`}
                      className="fill-amber-900 text-[9px] font-black"
                    >
                      ⛩️ ป้อมยาม/ซุ้มประตู
                    </text>
                  );
                })()}

                {/* ถนนเมนโซนบน (ขนาบแปลง 33, 32, 21, 20, 9, 6) */}
                <polygon points={pts(rectU(234, 0, 26, 446))} fill="#475569" />
                {/* ถนนซอยโซนกลาง (คั่นระหว่าง 40 กับ 43,42,41) */}
                <polygon points={pts(rectU(260, 292, 144, 26))} fill="#475569" />

                {/* ถนนเชื่อมใต้แปลง 44, 45, 46 โค้งต่อเนื่องลงมาเป็นถนนเมนแนวตั้งโซนล่าง (ระหว่าง 48 กับ 47 ลงไปถึง 76–80) */}
                <polygon
                  points={pts([
                    U(234, 420),
                    U(368, 420),
                    U(394, 426),
                    L(28, 0),
                    L(28, 438),
                    L(0, 438),
                    L(0, 0),
                    U(234, 446),
                  ])}
                  fill="#475569"
                />

                {/* ถนนซอยฝั่งขวา เส้นที่ 1 (คั่นระหว่าง 53,54 กับ 56,55) */}
                <polygon points={pts(rectL(28, 118, 134, 26))} fill="#475569" />
                {/* ถนนซอยฝั่งขวา เส้นที่ 2 (คั่นระหว่าง 65,66 กับ 69,68,67) */}
                <polygon points={pts(rectL(28, 258, 148, 26))} fill="#475569" />
                {/* ถนนซอยแยกฝั่งซ้าย (คั่นระหว่าง 61..57 กับ 62..64 — เยื้องสูงกว่าซอยขวาตามแบบ PDF) */}
                <polygon points={pts(rectL(-238, 216, 238, 26))} fill="#475569" />
                {/* ถนนซอยล่างสุด (หน้าแปลง 76, 77, 78, 79, 80) */}
                <polygon points={pts(rectL(-64, 412, 256, 26))} fill="#475569" />

                {/* ป้ายชื่อถนน คสล. */}
                <text x={roadLabelNorth[0]} y={roadLabelNorth[1]} textAnchor="middle" transform={`rotate(23.5, ${roadLabelNorth[0]}, ${roadLabelNorth[1]})`} className="fill-white text-[8px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
                <text x={roadLabelMid2[0]} y={roadLabelMid2[1]} textAnchor="middle" transform={`rotate(23.5, ${roadLabelMid2[0]}, ${roadLabelMid2[1]})`} className="fill-white text-[8px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
                <text x={roadLabelMid1[0]} y={roadLabelMid1[1]} textAnchor="middle" transform={`rotate(23.5, ${roadLabelMid1[0]}, ${roadLabelMid1[1]})`} className="fill-white text-[8px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
                <text x={roadLabelMain9m[0]} y={roadLabelMain9m[1]} textAnchor="middle" transform={`rotate(23.5, ${roadLabelMain9m[0]}, ${roadLabelMain9m[1]})`} className="fill-amber-200 text-[8.5px] font-extrabold">
                  ถนน คสล. กว้าง 9.00 เมตร (ทางเข้าหลัก)
                </text>
                <text x={roadLabelUpperSpine[0]} y={roadLabelUpperSpine[1]} textAnchor="middle" transform={`rotate(-66.5, ${roadLabelUpperSpine[0]}, ${roadLabelUpperSpine[1]})`} className="fill-white text-[8px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
                <text x={roadLabelCenterSub[0]} y={roadLabelCenterSub[1]} textAnchor="middle" transform={`rotate(23.5, ${roadLabelCenterSub[0]}, ${roadLabelCenterSub[1]})`} className="fill-white text-[7.5px] font-bold">
                  ถนน คสล. 8.00 เมตร
                </text>
                <text x={roadLabelConnect[0]} y={roadLabelConnect[1]} textAnchor="middle" transform={`rotate(23.5, ${roadLabelConnect[0]}, ${roadLabelConnect[1]})`} className="fill-white text-[7.5px] font-bold">
                  ถนน คสล. 8.00 เมตร
                </text>
                <text x={roadLabelLowerSpine1[0]} y={roadLabelLowerSpine1[1]} textAnchor="middle" transform={`rotate(-98.5, ${roadLabelLowerSpine1[0]}, ${roadLabelLowerSpine1[1]})`} className="fill-white text-[8px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
                <text x={roadLabelLowerSpine2[0]} y={roadLabelLowerSpine2[1]} textAnchor="middle" transform={`rotate(-98.5, ${roadLabelLowerSpine2[0]}, ${roadLabelLowerSpine2[1]})`} className="fill-white text-[8px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
                <text x={roadLabelEast1[0]} y={roadLabelEast1[1]} textAnchor="middle" transform={`rotate(-8.5, ${roadLabelEast1[0]}, ${roadLabelEast1[1]})`} className="fill-white text-[7.5px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
                <text x={roadLabelEast2[0]} y={roadLabelEast2[1]} textAnchor="middle" transform={`rotate(-8.5, ${roadLabelEast2[0]}, ${roadLabelEast2[1]})`} className="fill-white text-[7.5px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
                <text x={roadLabelWestAlley[0]} y={roadLabelWestAlley[1]} textAnchor="middle" transform={`rotate(-8.5, ${roadLabelWestAlley[0]}, ${roadLabelWestAlley[1]})`} className="fill-white text-[8px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
                <text x={roadLabelSouthBottom[0]} y={roadLabelSouthBottom[1]} textAnchor="middle" transform={`rotate(-8.5, ${roadLabelSouthBottom[0]}, ${roadLabelSouthBottom[1]})`} className="fill-white text-[8px] font-bold">
                  ถนน คสล. กว้าง 8.00 เมตร
                </text>
              </g>
            )}

            {/* ================= 3. ชั้นแนวทางเท้า (Sidewalk / Walkway) ขนาบสองฝั่งถนนหน้าบ้าน ================= */}
            {showWalkway && (
              <g fill={sidewalkFill} stroke={sidewalkStroke} strokeWidth="0.7">
                {/* ทางเท้าโซนบน-ซ้าย และโซนกลาง */}
                <polygon points={pts(rectU(0, 21.5, 234, 4.5))} />
                <polygon points={pts(rectU(0, 128, 234, 4.5))} />
                <polygon points={pts(rectU(0, 149.5, 234, 4.5))} />
                <polygon points={pts(rectU(0, 256, 234, 4.5))} />
                <polygon points={pts(rectU(0, 277.5, 234, 4.5))} />
                <polygon points={pts(rectU(0, 384, 234, 5))} />
                <polygon points={pts(rectU(0, 409, 244, 5))} />
                <polygon points={pts(rectU(234, 21.5, 4.5, 398))} />
                <polygon points={pts(rectU(255.5, 196, 4.5, 224))} />
                <polygon points={pts(rectU(260, 292, 142, 4.5))} />
                <polygon points={pts(rectU(260, 313.5, 142, 4.5))} />
                {/* ทางเท้าใต้แปลง 44, 45, 46 เชื่อมโค้งลงมาโซนล่าง */}
                <polygon points={pts([U(260, 420), U(368, 420), U(394, 426), L(28, 0), L(23.5, 0), U(366, 424.5), U(260, 424.5)])} />
                <polygon points={pts([U(260, 441.5), U(364, 441.5), L(4.5, 0), L(0, 0), U(365, 446), U(260, 446)])} />

                {/* ทางเท้าสองฝั่งถนนเมนแนวตั้งโซนล่าง */}
                <polygon points={pts(rectL(0, 0, 4.5, 412))} />
                <polygon points={pts(rectL(23.5, 0, 4.5, 412))} />
                {/* ทางเท้าซอยฝั่งซ้าย (หน้าแปลง 61..57 และ 62..64) */}
                <polygon points={pts(rectL(-238, 216, 238, 4.5))} />
                <polygon points={pts(rectL(-222, 237.5, 222, 4.5))} />
                {/* ทางเท้าซอยฝั่งขวา เส้นที่ 1 และ 2 */}
                <polygon points={pts(rectL(28, 118, 132, 4.5))} />
                <polygon points={pts(rectL(28, 139.5, 134, 4.5))} />
                <polygon points={pts(rectL(28, 258, 146, 4.5))} />
                <polygon points={pts(rectL(28, 279.5, 148, 4.5))} />
                {/* ทางเท้าซอยล่างสุด (หน้าแปลง 72, 73..75 และหน้าแปลง 76..80) */}
                <polygon points={pts(rectL(-64, 412, 252, 4.5))} />
                <polygon points={pts(rectL(-64, 433.5, 256, 4.5))} />
              </g>
            )}

            {/* หากผู้ใช้กดเปิดท่อระบายน้ำ/ท่อประปา/สายไฟในภายหลัง */}
            {showDrainage && (
              <g stroke="#0f766e" strokeWidth="2" strokeDasharray="5 2" fill="none">
                <polyline points={pts([U(0, 130), U(236, 130), U(236, 422), L(2, 0), L(2, 436)])} />
                <line x1={U(0, 258)[0]} y1={U(0, 258)[1]} x2={U(236, 258)[0]} y2={U(236, 258)[1]} />
                <line x1={U(0, 386)[0]} y1={U(0, 386)[1]} x2={U(236, 386)[0]} y2={U(236, 386)[1]} />
                <line x1={L(-236, 218)[0]} y1={L(-236, 218)[1]} x2={L(2, 218)[0]} y2={L(2, 218)[1]} />
                <line x1={L(26, 120)[0]} y1={L(26, 120)[1]} x2={L(158, 120)[0]} y2={L(158, 120)[1]} />
                <line x1={L(26, 260)[0]} y1={L(26, 260)[1]} x2={L(172, 260)[0]} y2={L(172, 260)[1]} />
                <line x1={L(-62, 436)[0]} y1={L(-62, 436)[1]} x2={L(190, 436)[0]} y2={L(190, 436)[1]} />
              </g>
            )}
            {showWater && (
              <g stroke="#0284c7" strokeWidth="1.6" fill="none">
                <polyline points={pts([U(0, 152), U(258, 152), U(258, 422), L(26, 0), L(26, 414)])} />
                <line x1={U(0, 280)[0]} y1={U(0, 280)[1]} x2={U(236, 280)[0]} y2={U(236, 280)[1]} />
                <line x1={U(0, 411)[0]} y1={U(0, 411)[1]} x2={U(236, 411)[0]} y2={U(236, 411)[1]} />
                <line x1={L(-220, 240)[0]} y1={L(-220, 240)[1]} x2={L(2, 240)[0]} y2={L(2, 240)[1]} />
                <line x1={L(26, 142)[0]} y1={L(26, 142)[1]} x2={L(158, 142)[0]} y2={L(158, 142)[1]} />
                <line x1={L(26, 282)[0]} y1={L(26, 282)[1]} x2={L(172, 282)[0]} y2={L(172, 282)[1]} />
              </g>
            )}
            {showElectric && (
              <g stroke="#d97706" strokeWidth="1.2" fill="none">
                <polyline points={pts([U(0, 385), U(235, 385), L(1, 0), L(1, 412)])} />
              </g>
            )}

            {/* ================= 4. ชั้นแปลงบ้านทั้ง 80 แปลง (Polygon ตามผัง CAD จริง) ================= */}
            {showPlot &&
              ALL_PLOT_POLYGONS.map(poly => {
                const spec = PDF_PLOT_BY_NUMBER.get(poly.plotNo);
                const isSelected = selectedPlotNo === poly.plotNo;
                const [cx, cy] = poly.center;
                return (
                  <g
                    key={poly.plotNo}
                    onClick={() => handlePlotClick(poly.plotNo)}
                    className="cursor-pointer transition-opacity hover:opacity-90"
                  >
                    <polygon
                      points={pts(poly.points)}
                      fill={
                        isSelected
                          ? '#fef3c7'
                          : spec?.zone === 'center'
                          ? '#e0e7ff'
                          : spec?.zone === 'se'
                          ? '#e0f2fe'
                          : '#dbeafe'
                      }
                      stroke={isSelected ? '#d97706' : '#1e40af'}
                      strokeWidth={isSelected ? 2.4 : 1.3}
                      strokeLinejoin="round"
                    />
                    <g transform={`translate(${cx}, ${cy}) rotate(${poly.labelAngle})`}>
                      <circle
                        cx="0"
                        cy="-5"
                        r="9"
                        fill="#ffffff"
                        stroke="#1e3a8a"
                        strokeWidth="1.25"
                      />
                      <text
                        x="0"
                        y="-1.5"
                        textAnchor="middle"
                        className="fill-slate-950 text-[9px] font-black"
                      >
                        {poly.plotNo}
                      </text>
                      <text
                        x="0"
                        y="12"
                        textAnchor="middle"
                        className="fill-blue-950 text-[8px] font-bold"
                      >
                        {spec?.areaSqWa}
                      </text>
                      <text
                        x="0"
                        y="20"
                        textAnchor="middle"
                        className="fill-slate-500 text-[6.2px] font-semibold"
                      >
                        ({spec?.frontageM}ม.)
                      </text>
                    </g>
                  </g>
                );
              })}

            {/* เส้นวัดระยะทางระหว่างแปลง A -> แปลง B บนผัง CAD Vector */}
            {measureMode && vectorMeasurement && (
              <g>
                <line
                  x1={vectorMeasurement.posA.gx}
                  y1={vectorMeasurement.posA.gy}
                  x2={vectorMeasurement.posB.gx}
                  y2={vectorMeasurement.posB.gy}
                  stroke="#e11d48"
                  strokeWidth="3"
                  strokeDasharray="8 4"
                />
                <circle cx={vectorMeasurement.posA.gx} cy={vectorMeasurement.posA.gy} r="7" fill="#e11d48" stroke="#fff" strokeWidth="2" />
                <circle cx={vectorMeasurement.posB.gx} cy={vectorMeasurement.posB.gy} r="7" fill="#e11d48" stroke="#fff" strokeWidth="2" />
                <rect
                  x={(vectorMeasurement.posA.gx + vectorMeasurement.posB.gx) / 2 - 78}
                  y={(vectorMeasurement.posA.gy + vectorMeasurement.posB.gy) / 2 - 14}
                  width="156"
                  height="26"
                  rx="6"
                  fill="#881337"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                <text
                  x={(vectorMeasurement.posA.gx + vectorMeasurement.posB.gx) / 2}
                  y={(vectorMeasurement.posA.gy + vectorMeasurement.posB.gy) / 2 + 3}
                  textAnchor="middle"
                  className="fill-white text-[10px] font-black"
                >
                  📏 {vectorMeasurement.roadWalkwayMeters} ม. (ตรง {vectorMeasurement.straightMeters} ม.)
                </text>
              </g>
            )}

            {/* สัญลักษณ์ทิศเหนือ และ ชื่อผังโครงการ มาตราส่วน 1:750 */}
            <g transform="translate(335, 1115)">
              <text x="0" y="-26" textAnchor="middle" className="fill-slate-800 text-[13px] font-extrabold">
                เหนือ
              </text>
              <circle cx="0" cy="0" r="18" fill="none" stroke="#1e293b" strokeWidth="2" />
              <polygon points="0,-16 -10,6 0,2 10,6" fill="#1e293b" />
              <line x1="0" y1="2" x2="0" y2="16" stroke="#1e293b" strokeWidth="3" />
              <text x="0" y="42" textAnchor="middle" className="fill-slate-900 text-[18px] font-black">
                ผังโครงการ
              </text>
              <line x1="-80" y1="48" x2="80" y2="48" stroke="#334155" strokeWidth="1.5" />
              <text x="0" y="66" textAnchor="middle" className="fill-slate-700 text-[13px] font-bold">
                มาตราส่วน &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 1 : {scaleSettings.scaleRatio}
              </text>
            </g>

            {/* กล่องสัญลักษณ์ (Legend Box) มุมซ้ายล่างตามแบบ PDF */}
            <g transform="translate(24, 940)">
              <rect x="0" y="0" width="210" height="58" fill="#ffffff" stroke="#334155" strokeWidth="1.5" />
              <line x1="0" y1="24" x2="210" y2="24" stroke="#334155" strokeWidth="1.2" />
              <line x1="60" y1="0" x2="60" y2="58" stroke="#334155" strokeWidth="1.2" />
              <line x1="140" y1="0" x2="140" y2="58" stroke="#334155" strokeWidth="1.2" />
              <text x="30" y="16" textAnchor="middle" className="fill-slate-800 text-[10px] font-bold">สัญลักษณ์</text>
              <text x="100" y="16" textAnchor="middle" className="fill-slate-800 text-[10px] font-bold">ความหมาย</text>
              <text x="175" y="16" textAnchor="middle" className="fill-slate-800 text-[10px] font-bold">แปลงจำหน่าย</text>
              <circle cx="30" cy="41" r="8" fill="#ffffff" stroke="#1e3a8a" strokeWidth="1.5" />
              <text x="100" y="45" textAnchor="middle" className="fill-slate-900 text-[11px] font-bold">บ้านเดี่ยว</text>
              <text x="175" y="45" textAnchor="middle" className="fill-blue-900 text-[11px] font-black">80 แปลง</text>

              <rect x="0" y="68" width="210" height="32" rx="4" fill="#fffbeb" stroke="#d97706" strokeWidth="1.2" />
              <rect x="12" y="79" width="28" height="10" fill={sidewalkFill} stroke={sidewalkStroke} strokeWidth="1" />
              <text x="48" y="88" className="fill-amber-950 text-[10px] font-bold">
                แนวทางเท้าหน้าบ้าน (กว้าง {scaleSettings.walkwayWidthM} ม.)
              </text>
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
