import { supabase } from '@/lib/supabase';
import { readTrustedActor } from '@/lib/auth/trustedActor';

export type DemoCellKind = 'plot' | 'road' | 'earthwork' | 'fence' | 'drainage' | 'water' | 'electric' | 'pole' | 'walkway';
export interface DemoCell { id: string; x: number; y: number; kind: DemoCellKind }
export interface DemoLayout { version: 1; cols: 24; rows: 16; cells: DemoCell[] }
export interface DemoProject {
  id: string;
  name: string;
  layout_data: DemoLayout;
  revision: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export const DEMO_LAYERS: ReadonlyArray<{ kind: DemoCellKind; label: string; color: string }> = [
  { kind: 'earthwork', label: 'งานถมดิน', color: '#d6b58b' },
  { kind: 'plot', label: 'แปลงบ้าน', color: '#3b82f6' },
  { kind: 'road', label: 'ถนน', color: '#475569' },
  { kind: 'walkway', label: 'ทางเท้า', color: '#94a3b8' },
  { kind: 'drainage', label: 'ท่อใยหิน/ระบายน้ำ', color: '#0f766e' },
  { kind: 'water', label: 'ท่อประปา', color: '#0284c7' },
  { kind: 'electric', label: 'แนวไฟฟ้า', color: '#ca8a04' },
  { kind: 'pole', label: 'เสาไฟ', color: '#7c3aed' },
  { kind: 'fence', label: 'รั้วโครงการ', color: '#a16207' },
];

const table = 'admin_demo_projects';
const projection = 'id,name,layout_data,revision,created_at,updated_at,created_by';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = new Set<string>(DEMO_LAYERS.map(layer => layer.kind));
const invalidData = 'ข้อมูลโครงการ Demo ไม่ถูกต้อง กรุณาโหลดใหม่';
const changedSession = 'บัญชีผู้ใช้เปลี่ยนระหว่างดำเนินการ กรุณาเปิดโครงการ Demo ใหม่';
export function isDemoAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return message === changedSession
    || message.includes('เฉพาะ Admin')
    || message.includes('ยังยืนยันสิทธิ์ของบัญชีไม่ได้');
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function validateDemoProjectName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 100 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('กรุณาระบุชื่อโครงการ Demo ความยาว 1–100 ตัวอักษร');
  }
  return value.trim();
}

export function parseDemoLayout(value: unknown): DemoLayout {
  if (!record(value) || !exactKeys(value, ['version', 'cols', 'rows', 'cells'])
    || value.version !== 1 || value.cols !== 24 || value.rows !== 16
    || !Array.isArray(value.cells) || value.cells.length > 24 * 16 * kinds.size) throw new Error(invalidData);
  const ids = new Set<string>();
  const positions = new Set<string>();
  const cells = value.cells.map(raw => {
    if (!record(raw) || !exactKeys(raw, ['id', 'x', 'y', 'kind']) || typeof raw.id !== 'string'
      || !raw.id.trim() || raw.id.length > 100 || /[\u0000-\u001f\u007f]/.test(raw.id)
      || typeof raw.x !== 'number' || !Number.isInteger(raw.x) || raw.x < 0 || raw.x >= 24
      || typeof raw.y !== 'number' || !Number.isInteger(raw.y) || raw.y < 0 || raw.y >= 16
      || typeof raw.kind !== 'string' || !kinds.has(raw.kind)) throw new Error(invalidData);
    const key = `${raw.kind}:${raw.x}:${raw.y}`;
    if (ids.has(raw.id) || positions.has(key)) throw new Error(invalidData);
    ids.add(raw.id);
    positions.add(key);
    return { id: raw.id, x: raw.x, y: raw.y, kind: raw.kind as DemoCellKind };
  });
  return { version: 1, cols: 24, rows: 16, cells };
}

export function parseDemoProject(value: unknown): DemoProject {
  if (!record(value) || typeof value.id !== 'string' || !uuid.test(value.id)
    || typeof value.created_by !== 'string' || !uuid.test(value.created_by)
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))
    || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) throw new Error(invalidData);
  return {
    id: value.id, name: validateDemoProjectName(value.name), layout_data: parseDemoLayout(value.layout_data),
    revision: value.revision, created_at: value.created_at, updated_at: value.updated_at, created_by: value.created_by,
  };
}

/** Empty 24x16 sandbox layout for drawing from scratch. */
export function createEmptyDemoLayout(): DemoLayout {
  return { version: 1, cols: 24, rows: 16, cells: [] };
}

export interface PdfMasterPlanPlotSpec {
  plotNo: number;
  zone: 'nw' | 'center' | 'se';
  zoneLabel: string;
  x: number;
  y: number;
  areaSqWa: number;
  frontageM: number;
  depthM: number;
  roadWidthM: 8 | 9;
}

export const PDF_LAND_UTILIZATION = {
  documentTitle: 'ผังโครงการ (บ้านเดี่ยว 80 แปลง)',
  documentDate: '6 มิถุนายน 2568',
  scaleRatio: 750,
  totalProjectAreaSqWa: 6980.0,
  totalProjectAreaRaiNganWa: '17-1-80.0',
  saleableAreaSqWa: 4947.3,
  saleableAreaRaiNganWa: '12-1-47.3',
  saleablePercent: 70.88,
  roadAreaSqWa: 1712.1,
  roadAreaRaiNganWa: '4-1-12.1',
  roadPercent: 24.53,
  juristicAreaSqWa: 25.4,
  publicParkAreaSqWa: 253.9,
  pocketParkAreaSqWa: 23.7,
  guardhouseAreaSqWa: 17.5,
  perimeterFenceSurveyM: 748.5,
} as const;

export const PDF_MASTERPLAN_PLOTS: ReadonlyArray<PdfMasterPlanPlotSpec> = [
  // โซนเหนือ-ตะวันตก (แปลง 1–38)
  { plotNo: 1, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ติดถนนเมน 9 ม.)', x: 2, y: 8, areaSqWa: 62.3, frontageM: 12.66, depthM: 17.36, roadWidthM: 9 },
  { plotNo: 2, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ติดถนนเมน 9 ม.)', x: 3, y: 8, areaSqWa: 53.2, frontageM: 13.30, depthM: 16.00, roadWidthM: 9 },
  { plotNo: 3, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ติดถนนเมน 9 ม.)', x: 4, y: 8, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 9 },
  { plotNo: 4, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ติดถนนเมน 9 ม.)', x: 5, y: 8, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 9 },
  { plotNo: 5, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ติดถนนเมน 9 ม.)', x: 6, y: 8, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 9 },
  { plotNo: 6, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ติดถนนเมน 9 ม.)', x: 7, y: 8, areaSqWa: 53.9, frontageM: 12.50, depthM: 16.00, roadWidthM: 9 },
  { plotNo: 7, zone: 'nw', zoneLabel: 'โซนสวนสาธารณะหน้าโครงการ', x: 5, y: 10, areaSqWa: 63.8, frontageM: 16.95, depthM: 16.00, roadWidthM: 9 },
  { plotNo: 8, zone: 'nw', zoneLabel: 'โซนสวนสาธารณะหน้าโครงการ', x: 6, y: 10, areaSqWa: 109.8, frontageM: 30.58, depthM: 16.00, roadWidthM: 9 },
  { plotNo: 9, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1)', x: 7, y: 7, areaSqWa: 53.9, frontageM: 12.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 10, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1)', x: 6, y: 7, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 11, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1)', x: 5, y: 7, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 12, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1)', x: 4, y: 7, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 13, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1)', x: 3, y: 7, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 14, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1)', x: 2, y: 7, areaSqWa: 56.2, frontageM: 11.20, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 15, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1 เหนือ)', x: 2, y: 5, areaSqWa: 55.2, frontageM: 9.28, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 16, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1 เหนือ)', x: 3, y: 5, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 17, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1 เหนือ)', x: 4, y: 5, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 18, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1 เหนือ)', x: 5, y: 5, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 19, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1 เหนือ)', x: 6, y: 5, areaSqWa: 50.0, frontageM: 12.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 20, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 1 เหนือ)', x: 7, y: 5, areaSqWa: 53.9, frontageM: 11.16, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 21, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2)', x: 7, y: 4, areaSqWa: 54.9, frontageM: 12.23, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 22, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2)', x: 6, y: 4, areaSqWa: 50.0, frontageM: 11.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 23, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2)', x: 5, y: 4, areaSqWa: 50.0, frontageM: 11.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 24, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2)', x: 4, y: 4, areaSqWa: 50.0, frontageM: 11.49, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 25, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2)', x: 3, y: 4, areaSqWa: 50.0, frontageM: 11.49, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 26, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2)', x: 2, y: 4, areaSqWa: 56.9, frontageM: 11.27, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 27, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2 เหนือ)', x: 2, y: 2, areaSqWa: 57.7, frontageM: 11.46, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 28, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2 เหนือ)', x: 3, y: 2, areaSqWa: 51.5, frontageM: 11.49, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 29, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2 เหนือ)', x: 4, y: 2, areaSqWa: 51.5, frontageM: 11.49, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 30, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2 เหนือ)', x: 5, y: 2, areaSqWa: 51.5, frontageM: 11.49, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 31, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2 เหนือ)', x: 6, y: 2, areaSqWa: 51.5, frontageM: 11.49, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 32, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 2 เหนือ)', x: 7, y: 2, areaSqWa: 55.3, frontageM: 10.99, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 33, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 3 เหนือสุด)', x: 7, y: 1, areaSqWa: 55.3, frontageM: 10.99, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 34, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 3 เหนือสุด)', x: 6, y: 1, areaSqWa: 52.0, frontageM: 11.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 35, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 3 เหนือสุด)', x: 5, y: 1, areaSqWa: 52.0, frontageM: 11.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 36, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 3 เหนือสุด)', x: 4, y: 1, areaSqWa: 52.0, frontageM: 11.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 37, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 3 เหนือสุด)', x: 3, y: 1, areaSqWa: 52.0, frontageM: 11.50, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 38, zone: 'nw', zoneLabel: 'โซนเหนือ-ตะวันตก (ซอย 3 เหนือสุด)', x: 2, y: 1, areaSqWa: 84.7, frontageM: 12.80, depthM: 18.30, roadWidthM: 8 },

  // โซนกลาง (แปลง 39–46)
  { plotNo: 39, zone: 'center', zoneLabel: 'โซนกลาง (ฝั่งตะวันออกถนนเมน)', x: 9, y: 4, areaSqWa: 71.7, frontageM: 14.12, depthM: 18.32, roadWidthM: 8 },
  { plotNo: 40, zone: 'center', zoneLabel: 'โซนกลาง (ฝั่งตะวันออกถนนเมน)', x: 9, y: 5, areaSqWa: 75.3, frontageM: 12.11, depthM: 20.20, roadWidthM: 8 },
  { plotNo: 41, zone: 'center', zoneLabel: 'โซนกลาง (แปลงมุมตะวันออก)', x: 11, y: 7, areaSqWa: 107.2, frontageM: 21.17, depthM: 33.22, roadWidthM: 8 },
  { plotNo: 42, zone: 'center', zoneLabel: 'โซนกลาง', x: 10, y: 7, areaSqWa: 53.8, frontageM: 13.45, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 43, zone: 'center', zoneLabel: 'โซนกลาง', x: 9, y: 7, areaSqWa: 59.1, frontageM: 11.30, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 44, zone: 'center', zoneLabel: 'โซนกลาง (ติดถนนเมน)', x: 9, y: 8, areaSqWa: 65.9, frontageM: 18.38, depthM: 15.30, roadWidthM: 8 },
  { plotNo: 45, zone: 'center', zoneLabel: 'โซนกลาง (ติดถนนเมน)', x: 10, y: 8, areaSqWa: 53.7, frontageM: 11.27, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 46, zone: 'center', zoneLabel: 'โซนกลาง (ติดถนนเมน)', x: 11, y: 8, areaSqWa: 62.9, frontageM: 15.60, depthM: 19.60, roadWidthM: 8 },

  // โซนใต้-ตะวันออก (แปลง 47–80)
  { plotNo: 47, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกบน)', x: 17, y: 7, areaSqWa: 68.6, frontageM: 11.00, depthM: 19.57, roadWidthM: 8 },
  { plotNo: 48, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ฝั่งตะวันตกถนนเมน)', x: 14, y: 9, areaSqWa: 74.9, frontageM: 18.34, depthM: 17.34, roadWidthM: 8 },
  { plotNo: 49, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ฝั่งตะวันตกถนนเมน)', x: 14, y: 10, areaSqWa: 53.8, frontageM: 12.00, depthM: 18.08, roadWidthM: 8 },
  { plotNo: 50, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกบน)', x: 18, y: 7, areaSqWa: 94.5, frontageM: 14.54, depthM: 26.59, roadWidthM: 8 },
  { plotNo: 51, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ฝั่งตะวันตกถนนเมน)', x: 15, y: 10, areaSqWa: 56.1, frontageM: 12.05, depthM: 18.89, roadWidthM: 8 },
  { plotNo: 52, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (หัวมุมซอยตะวันตก)', x: 15, y: 11, areaSqWa: 53.4, frontageM: 12.69, depthM: 16.10, roadWidthM: 8 },
  { plotNo: 53, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกบน)', x: 17, y: 8, areaSqWa: 65.3, frontageM: 14.81, depthM: 17.56, roadWidthM: 8 },
  { plotNo: 54, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกบน)', x: 18, y: 8, areaSqWa: 72.7, frontageM: 13.02, depthM: 20.99, roadWidthM: 8 },
  { plotNo: 55, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกกลาง)', x: 18, y: 10, areaSqWa: 75.5, frontageM: 15.10, depthM: 17.84, roadWidthM: 8 },
  { plotNo: 56, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกกลาง)', x: 17, y: 10, areaSqWa: 69.8, frontageM: 13.75, depthM: 17.24, roadWidthM: 8 },
  { plotNo: 57, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ซอยตะวันตก)', x: 14, y: 11, areaSqWa: 55.7, frontageM: 16.00, depthM: 12.50, roadWidthM: 8 },
  { plotNo: 58, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ซอยตะวันตก)', x: 13, y: 11, areaSqWa: 70.7, frontageM: 12.50, depthM: 24.67, roadWidthM: 8 },
  { plotNo: 59, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ซอยตะวันตก)', x: 12, y: 11, areaSqWa: 64.7, frontageM: 12.50, depthM: 22.71, roadWidthM: 8 },
  { plotNo: 60, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ซอยตะวันตก)', x: 11, y: 11, areaSqWa: 66.8, frontageM: 12.50, depthM: 21.79, roadWidthM: 8 },
  { plotNo: 61, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ซอยตะวันตกสุด)', x: 10, y: 11, areaSqWa: 80.5, frontageM: 14.14, depthM: 21.25, roadWidthM: 8 },
  { plotNo: 62, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ซอยตะวันตกฝั่งใต้)', x: 12, y: 13, areaSqWa: 93.6, frontageM: 32.56, depthM: 22.15, roadWidthM: 8 },
  { plotNo: 63, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ซอยตะวันตกฝั่งใต้)', x: 13, y: 13, areaSqWa: 54.5, frontageM: 12.50, depthM: 17.80, roadWidthM: 8 },
  { plotNo: 64, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ซอยตะวันตกฝั่งใต้)', x: 14, y: 13, areaSqWa: 58.1, frontageM: 13.53, depthM: 18.70, roadWidthM: 8 },
  { plotNo: 65, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกกลาง)', x: 17, y: 11, areaSqWa: 68.9, frontageM: 18.14, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 66, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกกลาง)', x: 18, y: 11, areaSqWa: 81.5, frontageM: 17.79, depthM: 16.12, roadWidthM: 8 },
  { plotNo: 67, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกล่าง)', x: 19, y: 13, areaSqWa: 61.3, frontageM: 13.47, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 68, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกล่าง)', x: 18, y: 13, areaSqWa: 50.0, frontageM: 11.90, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 69, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกล่าง)', x: 17, y: 13, areaSqWa: 55.7, frontageM: 13.00, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 70, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ฝั่งตะวันตกตอนล่าง)', x: 15, y: 13, areaSqWa: 103.1, frontageM: 14.70, depthM: 26.18, roadWidthM: 8 },
  { plotNo: 71, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ฝั่งตะวันตกตอนล่าง)', x: 14, y: 14, areaSqWa: 71.2, frontageM: 12.50, depthM: 22.22, roadWidthM: 8 },
  { plotNo: 72, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (ฝั่งตะวันตกตอนล่าง)', x: 15, y: 14, areaSqWa: 61.7, frontageM: 12.50, depthM: 19.02, roadWidthM: 8 },
  { plotNo: 73, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกล่าง)', x: 20, y: 13, areaSqWa: 57.7, frontageM: 13.65, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 74, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกล่าง)', x: 21, y: 13, areaSqWa: 56.5, frontageM: 12.85, depthM: 16.00, roadWidthM: 8 },
  { plotNo: 75, zone: 'se', zoneLabel: 'โซนใต้-ตะวันออก (บล็อกล่าง)', x: 22, y: 13, areaSqWa: 64.0, frontageM: 12.85, depthM: 17.91, roadWidthM: 8 },
  { plotNo: 76, zone: 'se', zoneLabel: 'โซนใต้สุด (แปลง 76–80)', x: 16, y: 15, areaSqWa: 123.7, frontageM: 19.02, depthM: 26.27, roadWidthM: 8 },
  { plotNo: 77, zone: 'se', zoneLabel: 'โซนใต้สุด (แปลง 76–80)', x: 17, y: 15, areaSqWa: 52.7, frontageM: 13.78, depthM: 18.19, roadWidthM: 8 },
  { plotNo: 78, zone: 'se', zoneLabel: 'โซนใต้สุด (แปลง 76–80)', x: 18, y: 15, areaSqWa: 52.8, frontageM: 12.90, depthM: 16.92, roadWidthM: 8 },
  { plotNo: 79, zone: 'se', zoneLabel: 'โซนใต้สุด (แปลง 76–80)', x: 19, y: 15, areaSqWa: 52.7, frontageM: 12.75, depthM: 16.10, roadWidthM: 8 },
  { plotNo: 80, zone: 'se', zoneLabel: 'โซนใต้สุด (แปลง 76–80)', x: 20, y: 15, areaSqWa: 64.5, frontageM: 15.25, depthM: 15.27, roadWidthM: 8 },
];

export const PDF_PLOT_BY_NUMBER: ReadonlyMap<number, PdfMasterPlanPlotSpec> = new Map(
  PDF_MASTERPLAN_PLOTS.map(p => [p.plotNo, p]),
);

export const PDF_PLOT_BY_COORD: ReadonlyMap<string, PdfMasterPlanPlotSpec> = new Map(
  PDF_MASTERPLAN_PLOTS.map(p => [`${p.x}:${p.y}`, p]),
);

/**
 * สร้างผังโครงการ 80 แปลง จากไฟล์ PDF ต้นฉบับ (มาตราส่วน 1:750 วันที่ 6 มิ.ย. 2568)
 * ค่าเริ่มต้นแสดงเฉพาะ: แปลงบ้าน (1–80), สวนสาธารณะ 253.9 ตร.ว., ป้อมยาม/ซุ้มประตู,
 * ถนน คสล. 9 ม. / 8 ม., และแนวทางเท้าขนาบสองฝั่งถนน (ยังไม่วางเสาไฟฟ้าและท่อน้ำเพื่อไม่ให้รกตา)
 */
export function createPdfMasterPlanLayout(options?: { includeUtilities?: boolean }): DemoLayout {
  const cells: DemoCell[] = [];
  const seen = new Set<string>();
  const add = (kind: DemoCellKind, x: number, y: number, customId?: string) => {
    if (x < 0 || x >= 24 || y < 0 || y >= 16) return;
    const key = `${kind}:${x}:${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ id: customId ?? `${kind}-${x}-${y}`, x, y, kind });
  };

  // 1. วางแปลงบ้านครบทั้ง 80 แปลง (แปลงที่ 1–80) พร้อมชั้นงานถมดินใต้แปลง
  for (const plot of PDF_MASTERPLAN_PLOTS) {
    add('earthwork', plot.x, plot.y, `pdf-earthwork-plot-${plot.plotNo}`);
    add('plot', plot.x, plot.y, `pdf-plot-${plot.plotNo}`);
  }

  // พื้นที่สวนสาธารณะ 253.9 ตร.ว. (x=2..4, y=10) และสวนหย่อม (x=7, y=0)
  for (const x of [2, 3, 4]) {
    add('earthwork', x, 10, `pdf-park-${x}-10`);
  }
  add('earthwork', 7, 0, 'pdf-pocket-park-7-0');

  // 2. วางโครงข่ายถนน คสล. กว้าง 9.00 ม. (ทางเข้าหลัก) และ 8.00 ม. (ถนนภายในโครงการ)
  add('road', 1, 9, 'pdf-gate-road-1-9');
  for (let x = 2; x <= 8; x++) {
    add('road', x, 9, `pdf-road-9m-${x}-9`);
  }

  // ถนนซอยโซนเหนือ-ตะวันตก กว้าง 8.00 ม. (y=0, y=3, y=6) และถนนเมนแนวตั้ง (x=8, y=0..9)
  for (const y of [0, 3, 6]) {
    for (let x = 2; x <= 8; x++) add('road', x, y, `pdf-road-8m-${x}-${y}`);
  }
  for (let y = 0; y <= 9; y++) {
    add('road', 8, y, `pdf-road-8m-8-${y}`);
  }

  // ถนนโซนกลาง กว้าง 8.00 ม.
  for (let x = 9; x <= 12; x++) add('road', x, 6, `pdf-road-8m-${x}-6`);
  for (let x = 9; x <= 16; x++) add('road', x, 9, `pdf-road-8m-${x}-9`);

  // ถนนเมนโซนใต้-ตะวันออก (x=16, y=7..14) และถนนซอยแยกย่อย กว้าง 8.00 ม.
  for (let y = 7; y <= 14; y++) add('road', 16, y, `pdf-road-8m-16-${y}`);
  for (let x = 16; x <= 20; x++) add('road', x, 9, `pdf-road-8m-${x}-9`);
  for (let x = 10; x <= 21; x++) add('road', x, 12, `pdf-road-8m-${x}-12`);
  for (let x = 16; x <= 22; x++) add('road', x, 14, `pdf-road-8m-${x}-14`);

  // 3. วางแนวทางเท้า (Walkway / Sidewalk) ขนาบสองฝั่งถนนหน้าแปลงบ้านทุกสาย
  const roadCells = cells.filter(c => c.kind === 'road');
  for (const r of roadCells) {
    add('walkway', r.x, r.y);
    if (options?.includeUtilities) {
      add('drainage', r.x, r.y);
      add('water', r.x, r.y);
      add('electric', r.x, r.y);
    }
  }

  // เสาไฟฟ้าจะวางเฉพาะเมื่อระบุ includeUtilities เท่านั้น (ค่าเริ่มต้นยังไม่วางเสาไฟและท่อน้ำ)
  if (options?.includeUtilities) {
    const poleCoords: Array<[number, number]> = [
      [1, 9], [3, 9], [5, 9], [7, 9],
      [2, 6], [4, 6], [6, 6], [8, 6], [10, 6], [12, 6],
      [2, 3], [4, 3], [6, 3], [8, 3],
      [2, 0], [5, 0], [8, 0],
      [10, 9], [13, 9], [16, 9], [19, 9],
      [16, 7], [16, 11],
      [10, 12], [13, 12], [16, 12], [19, 12], [21, 12],
      [16, 14], [18, 14], [20, 14], [22, 14],
    ];
    for (const [px, py] of poleCoords) {
      add('pole', px, py);
    }
  }

  // 5. แนวรั้วรอบโครงการตามขอบเขตที่ดินในผัง PDF
  // ขอบโซนเหนือ-ตะวันตก
  for (let x = 1; x <= 8; x++) add('fence', x, 0);
  for (let y = 0; y <= 11; y++) add('fence', 1, y);
  for (let x = 1; x <= 8; x++) add('fence', x, 11);
  // ขอบด้านตะวันออกเฉียงเหนือและโซนกลาง
  for (let y = 0; y <= 3; y++) add('fence', 9, y);
  for (let x = 9; x <= 12; x++) add('fence', x, 3);
  for (let y = 3; y <= 6; y++) add('fence', 12, y);
  for (let x = 12; x <= 19; x++) add('fence', x, 6);
  // ขอบด้านตะวันออกและทิศใต้โซนล่าง
  for (let y = 6; y <= 11; y++) add('fence', 19, y);
  for (let x = 19; x <= 23; x++) add('fence', x, 12);
  for (let y = 12; y <= 15; y++) add('fence', 23, y);
  for (let x = 9; x <= 13; x++) add('fence', x, 10);
  for (let y = 10; y <= 14; y++) add('fence', 9, y);
  for (let x = 9; x <= 15; x++) add('fence', x, 15);

  return { version: 1, cols: 24, rows: 16, cells };
}

export interface DemoScaleSettings {
  scaleRatio: number;         // เช่น 750 (มาตราส่วน 1:750)
  cellLengthM: number;        // ระยะมาตรฐานต่อ 1 ช่องตาราง (เช่น 12.50 เมตร ตามหน้ากว้างแปลงมาตรฐาน)
  mainRoadWidthM: number;     // ความกว้างถนนทางเข้าหลัก (9.00 เมตร)
  subRoadWidthM: number;      // ความกว้างถนนซอย/ถนนเมนในโครงการ (8.00 เมตร)
  walkwayWidthM: number;      // ความกว้างทางเท้าต่อฝั่ง (1.50 เมตร)
  manholeIntervalM: number;   // ระยะห่างบ่อพักท่อใยหิน (ทุก 12.50 เมตร)
  poleIntervalM: number;      // ระยะห่างเสาไฟฟ้ามาตรฐาน (ทุก 25.00 เมตร)
}

export const DEFAULT_DEMO_SCALE_SETTINGS: DemoScaleSettings = {
  scaleRatio: 750,
  cellLengthM: 12.5,
  mainRoadWidthM: 9.0,
  subRoadWidthM: 8.0,
  walkwayWidthM: 1.5,
  manholeIntervalM: 12.5,
  poleIntervalM: 25.0,
};

export interface DemoProjectMetrics {
  isPdfMasterPlan: boolean;
  scaleRatio: number;
  cellLengthM: number;
  plotCount: number;
  pdfPlotCount: number;
  totalPlotAreaSqWa: number;
  totalPlotAreaSqM: number;
  totalPlotFrontageM: number;
  earthworkAreaSqM: number;
  publicParkAreaSqWa: number;
  roadLengthM: number;
  mainRoad9mLengthM: number;
  subRoad8mLengthM: number;
  roadAreaSqM: number;
  roadAreaSqWa: number;
  walkwayLengthM: number;
  walkwayAreaSqM: number;
  drainageLengthM: number;
  drainagePipeSections1m: number;
  manholeCount: number;
  waterPipeLengthM: number;
  waterMeterTapCount: number;
  electricLineLengthM: number;
  poleCount: number;
  recommendedPoleCount: number;
  fenceLengthM: number;
}

/**
 * คำนวณระยะทางและปริมาณงานวิศวกรรมจากผัง Demo โดยอ้างอิงระยะจริงจาก PDF (มาตราส่วน 1:750)
 */
export function calculateDemoProjectMetrics(
  layout: DemoLayout,
  customScale?: Partial<DemoScaleSettings>,
): DemoProjectMetrics {
  const scale: DemoScaleSettings = { ...DEFAULT_DEMO_SCALE_SETTINGS, ...customScale };
  const scaleFactor = scale.cellLengthM / DEFAULT_DEMO_SCALE_SETTINGS.cellLengthM;

  const pdfPlotNos = new Set<number>();
  let nonPdfPlotCells = 0;
  let earthworkCells = 0;
  let parkCells = 0;
  let road9mCells = 0;
  let road8mCells = 0;
  let walkwayCells = 0;
  let drainageCells = 0;
  let waterCells = 0;
  let electricCells = 0;
  let poleCells = 0;
  let fenceCells = 0;

  const plotCoords = new Set<string>();
  const waterCoords = new Set<string>();

  for (const cell of layout.cells) {
    if (cell.kind === 'plot') {
      plotCoords.add(`${cell.x}:${cell.y}`);
      const match = /^pdf-plot-(\d+)$/.exec(cell.id);
      if (match) {
        const no = Number(match[1]);
        if (PDF_PLOT_BY_NUMBER.has(no)) {
          pdfPlotNos.add(no);
          continue;
        }
      }
      const byCoord = PDF_PLOT_BY_COORD.get(`${cell.x}:${cell.y}`);
      if (byCoord && cell.id.startsWith('pdf-')) {
        pdfPlotNos.add(byCoord.plotNo);
      } else {
        nonPdfPlotCells++;
      }
    } else if (cell.kind === 'earthwork') {
      earthworkCells++;
      if (cell.id.startsWith('pdf-park-')) parkCells++;
    } else if (cell.kind === 'road') {
      if (cell.id.startsWith('pdf-road-9m-') || cell.id.startsWith('pdf-gate-')) {
        road9mCells++;
      } else {
        road8mCells++;
      }
    } else if (cell.kind === 'walkway') {
      walkwayCells++;
    } else if (cell.kind === 'drainage') {
      drainageCells++;
    } else if (cell.kind === 'water') {
      waterCells++;
      waterCoords.add(`${cell.x}:${cell.y}`);
    } else if (cell.kind === 'electric') {
      electricCells++;
    } else if (cell.kind === 'pole') {
      poleCells++;
    } else if (cell.kind === 'fence') {
      fenceCells++;
    }
  }

  const isPdfMasterPlan = pdfPlotNos.size > 0;

  // คำนวณจำนวนแปลง เนื้อที่ขาย และหน้ากว้างแปลงรวม
  let pdfAreaSqWa = 0;
  let pdfFrontageM = 0;
  for (const no of pdfPlotNos) {
    const spec = PDF_PLOT_BY_NUMBER.get(no);
    if (spec) {
      pdfAreaSqWa += spec.areaSqWa * scaleFactor * scaleFactor;
      pdfFrontageM += spec.frontageM * scaleFactor;
    }
  }

  // สำหรับแปลงที่วาดเองนอกเหนือจาก PDF (เช่น บล็อก 4x4 = 16 ช่อง ต่อ 1 หลัง)
  const customPlotBlocksCount = nonPdfPlotCells > 0 ? Math.max(1, Math.round(nonPdfPlotCells / 16)) : 0;
  const customPlotAreaSqWa = customPlotBlocksCount * 52.0 * scaleFactor * scaleFactor;
  const customPlotFrontageM = customPlotBlocksCount * scale.cellLengthM;

  const plotCount = pdfPlotNos.size + customPlotBlocksCount;
  // ถ้านำเข้าครบทั้ง 80 แปลงตาม PDF และสเกล 100% ให้ใช้ค่าตรงตามตาราง Land Utilization (4,947.3 ตร.ว.)
  const totalPlotAreaSqWa = Number(
    (pdfPlotNos.size === 80 && customPlotBlocksCount === 0 && Math.abs(scaleFactor - 1) < 1e-6
      ? PDF_LAND_UTILIZATION.saleableAreaSqWa
      : pdfAreaSqWa + customPlotAreaSqWa
    ).toFixed(1),
  );
  const totalPlotAreaSqM = Number((totalPlotAreaSqWa * 4).toFixed(1));
  const totalPlotFrontageM = Number((pdfFrontageM + customPlotFrontageM).toFixed(2));

  // คำนวณระยะทางถนน คสล. และพื้นที่ผิวจราจร
  const mainRoad9mLengthM = Number((road9mCells * scale.cellLengthM).toFixed(1));
  const subRoad8mLengthM = Number((road8mCells * scale.cellLengthM).toFixed(1));
  const roadLengthM = Number((mainRoad9mLengthM + subRoad8mLengthM).toFixed(1));

  const rawRoadAreaSqM =
    mainRoad9mLengthM * scale.mainRoadWidthM + subRoad8mLengthM * scale.subRoadWidthM;
  const roadAreaSqM = Number(rawRoadAreaSqM.toFixed(1));
  const roadAreaSqWa = Number((roadAreaSqM / 4).toFixed(1));

  // คำนวณความยาวทางเท้า (ขนาบสองฝั่งถนน หรือตามช่อง walkway)
  const walkwayLengthM = Number(
    ((isPdfMasterPlan ? walkwayCells * scale.cellLengthM * 1.65 : walkwayCells * scale.cellLengthM)).toFixed(1),
  );
  const walkwayAreaSqM = Number((walkwayLengthM * scale.walkwayWidthM).toFixed(1));

  // คำนวณท่อใยหิน/ระบายน้ำ และบ่อพัก
  const drainageLengthM = Number(
    ((isPdfMasterPlan ? drainageCells * scale.cellLengthM * 1.65 : drainageCells * scale.cellLengthM)).toFixed(1),
  );
  const drainagePipeSections1m = Math.ceil(drainageLengthM);
  const manholeCount = drainageLengthM > 0 ? Math.max(1, Math.ceil(drainageLengthM / scale.manholeIntervalM) + 4) : 0;

  // คำนวณท่อประปา และหัวต่อมิเตอร์น้ำเข้าบ้าน
  const waterPipeLengthM = Number((waterCells * scale.cellLengthM).toFixed(1));
  let servedPlots = 0;
  if (waterCells > 0) {
    if (isPdfMasterPlan && waterCells >= 40) {
      servedPlots = plotCount;
    } else {
      for (const coord of plotCoords) {
        const [px, py] = coord.split(':').map(Number);
        const nearWater =
          waterCoords.has(`${px}:${py}`) ||
          waterCoords.has(`${px}:${py - 1}`) ||
          waterCoords.has(`${px}:${py + 1}`) ||
          waterCoords.has(`${px - 1}:${py}`) ||
          waterCoords.has(`${px + 1}:${py}`);
        if (nearWater) servedPlots++;
      }
      if (servedPlots === 0 && plotCount > 0) {
        servedPlots = Math.min(plotCount, Math.ceil(waterCells / 2));
      }
    }
  }

  // คำนวณแนวสายไฟฟ้า เสาไฟ และรั้วโครงการ
  const electricLineLengthM = Number((electricCells * scale.cellLengthM).toFixed(1));
  const recommendedPoleCount =
    electricLineLengthM > 0 ? Math.max(poleCells, Math.ceil(electricLineLengthM / scale.poleIntervalM)) : poleCells;

  const fenceLengthM = Number(
    (isPdfMasterPlan && fenceCells >= 60 && Math.abs(scaleFactor - 1) < 1e-6
      ? PDF_LAND_UTILIZATION.perimeterFenceSurveyM
      : fenceCells * scale.cellLengthM
    ).toFixed(1),
  );

  const publicParkAreaSqWa = Number(
    (parkCells > 0 ? (parkCells / 3) * PDF_LAND_UTILIZATION.publicParkAreaSqWa * scaleFactor * scaleFactor : 0).toFixed(1),
  );
  const earthworkAreaSqM = Number(
    (totalPlotAreaSqM + publicParkAreaSqWa * 4 + Math.max(0, earthworkCells - pdfPlotNos.size - parkCells) * 50).toFixed(1),
  );

  return {
    isPdfMasterPlan,
    scaleRatio: scale.scaleRatio,
    cellLengthM: scale.cellLengthM,
    plotCount,
    pdfPlotCount: pdfPlotNos.size,
    totalPlotAreaSqWa,
    totalPlotAreaSqM,
    totalPlotFrontageM,
    earthworkAreaSqM,
    publicParkAreaSqWa,
    roadLengthM,
    mainRoad9mLengthM,
    subRoad8mLengthM,
    roadAreaSqM,
    roadAreaSqWa,
    walkwayLengthM,
    walkwayAreaSqM,
    drainageLengthM,
    drainagePipeSections1m,
    manholeCount,
    waterPipeLengthM,
    waterMeterTapCount: servedPlots,
    electricLineLengthM,
    poleCount: poleCells,
    recommendedPoleCount,
    fenceLengthM,
  };
}

export interface DemoDistanceMeasurement {
  from: { x: number; y: number; label: string };
  to: { x: number; y: number; label: string };
  dxCells: number;
  dyCells: number;
  straightDistanceM: number;
  routeDistanceM: number;
  estimatedPipeSections1m: number;
  estimatedManholes: number;
  estimatedElectricPoles: number;
}

/**
 * คำนวณระยะทางระหว่างจุด A ไปจุด B บนผังโครงการ (ทั้งแนวตรงและแนวเดินท่อ/ถนน)
 */
export function measureDemoGridDistance(
  from: { x: number; y: number; label?: string },
  to: { x: number; y: number; label?: string },
  customScale?: Partial<DemoScaleSettings>,
): DemoDistanceMeasurement {
  const scale: DemoScaleSettings = { ...DEFAULT_DEMO_SCALE_SETTINGS, ...customScale };
  const dxCells = Math.abs(to.x - from.x);
  const dyCells = Math.abs(to.y - from.y);
  const straightCells = Math.hypot(dxCells, dyCells);
  const routeCells = dxCells + dyCells;

  const straightDistanceM = Number((straightCells * scale.cellLengthM).toFixed(2));
  const routeDistanceM = Number((routeCells * scale.cellLengthM).toFixed(2));

  return {
    from: { x: from.x, y: from.y, label: from.label ?? `(${from.x + 1}, ${from.y + 1})` },
    to: { x: to.x, y: to.y, label: to.label ?? `(${to.x + 1}, ${to.y + 1})` },
    dxCells,
    dyCells,
    straightDistanceM,
    routeDistanceM,
    estimatedPipeSections1m: Math.ceil(routeDistanceM),
    estimatedManholes: routeDistanceM > 0 ? Math.max(2, Math.ceil(routeDistanceM / scale.manholeIntervalM) + 1) : 0,
    estimatedElectricPoles: routeDistanceM > 0 ? Math.max(2, Math.ceil(routeDistanceM / scale.poleIntervalM) + 1) : 0,
  };
}

/** Synthetic draft coordinates only: the grid does not imply surveyed metres. */
export function createDemoLayout(): DemoLayout {
  const cells: DemoCell[] = [];
  const seen = new Set<string>();
  const add = (kind: DemoCellKind, x: number, y: number) => {
    const key = `${kind}:${x}:${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ id: `${kind}-${x}-${y}`, x, y, kind });
  };

  // ขั้นที่ 1: งานถมดิน และ วางผังแปลงบ้าน (A1-A4 ฝั่งเหนือ y=2..5, B1-B4 ฝั่งใต้ y=10..13 ติดทางเท้าพอดี)
  for (let x = 2; x <= 21; x++) {
    for (const y of [2, 3, 4, 5, 10, 11, 12, 13]) add('earthwork', x, y);
  }
  for (const startX of [2, 7, 12, 17]) {
    for (let x = startX; x < startX + 4; x++) {
      for (const y of [2, 3, 4, 5]) add('plot', x, y);
      for (const y of [10, 11, 12, 13]) add('plot', x, y);
    }
  }

  // ขั้นที่ 2: ถนนหลัก 2 เลน (y=7..8) และทางเท้าขนาบ 2 ฝั่ง (y=6 คั่นหน้าบ้านฝั่งเหนือ, y=9 คั่นหน้าบ้านฝั่งใต้)
  for (let x = 2; x <= 21; x++) {
    for (const y of [7, 8]) add('road', x, y);
    for (const y of [6, 9]) add('walkway', x, y);
  }

  // ขั้นที่ 3: งานวางท่อใยหิน/ระบายน้ำ และ ท่อประปา วิ่งคู่ขนานอยู่ในแนวทางเท้าทั้ง 2 ฝั่ง (+ ท่อลอดข้ามถนนที่ x=2..3)
  for (let x = 2; x <= 21; x++) {
    for (const y of [6, 9]) {
      add('drainage', x, y);
      add('water', x, y);
    }
  }
  for (const y of [7, 8]) {
    add('drainage', 2, y);
    add('water', 3, y);
  }

  // ขั้นที่ 4: แนวสายไฟฟ้า + เสาไฟตามแนวทางเท้าหน้าบ้าน และรั้วรอบโครงการ
  for (let x = 2; x <= 21; x++) {
    for (const y of [6, 9]) add('electric', x, y);
  }
  for (const x of [2, 6, 11, 16, 21]) {
    for (const y of [6, 9]) add('pole', x, y);
  }
  for (let x = 1; x <= 22; x++) for (const y of [1, 14]) add('fence', x, y);
  for (let y = 2; y <= 13; y++) for (const x of [1, 22]) add('fence', x, y);

  return { version: 1, cols: 24, rows: 16, cells };
}

function databaseError(error: unknown): never {
  const code = record(error) ? error.code : undefined;
  if (['PGRST202', 'PGRST205', '42P01', '42703', '42883'].includes(String(code))) {
    throw new Error('ระบบ Demo ยังไม่ได้ติดตั้งฐานข้อมูล กรุณาติดตั้ง migration สำหรับโครงการ Demo');
  }
  if (['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(String(code))) {
    throw new Error('เฉพาะ Admin ที่เข้าสู่ระบบเท่านั้นที่เข้าถึงโครงการ Demo ได้');
  }
  throw new Error('ดำเนินการกับโครงการ Demo ไม่สำเร็จ กรุณาลองใหม่หรือโหลดรายการอีกครั้ง');
}

async function requireAdmin() {
  const actor = await readTrustedActor(supabase);
  if (actor.role !== 'Admin') throw new Error('เฉพาะ Admin เท่านั้นที่เข้าถึงโครงการ Demo ได้');
  const result = await supabase.auth.getSession();
  const session = result.data.session;
  if (result.error || !session || session.user.id !== actor.authUserId) throw new Error(changedSession);
  return { userId: actor.authUserId, token: session.access_token };
}
async function checkSession(expected: { userId: string; token: string }) {
  const result = await supabase.auth.getSession();
  if (result.error || result.data.session?.user.id !== expected.userId
    || result.data.session.access_token !== expected.token) throw new Error(changedSession);
}

export async function listDemoProjects(): Promise<DemoProject[]> {
  const session = await requireAdmin();
  const result = await supabase.from(table).select(projection).order('created_at', { ascending: false }).order('id').limit(201);
  await checkSession(session);
  if (result.error) databaseError(result.error);
  if (!Array.isArray(result.data)) throw new Error(invalidData);
  if (result.data.length > 200) throw new Error('มีโครงการ Demo มากกว่า 200 โครงการ กรุณาให้ผู้ดูแลจัดการรายการก่อนเปิดใช้งาน');
  return result.data.map(parseDemoProject);
}

export async function createDemoProject(
  name: string,
  requestId: string,
  options?: { empty?: boolean; pdfMasterPlan?: boolean },
): Promise<DemoProject> {
  const cleanName = validateDemoProjectName(name);
  if (!uuid.test(requestId)) throw new Error(invalidData);
  const session = await requireAdmin();
  const layout = options?.empty
    ? createEmptyDemoLayout()
    : options?.pdfMasterPlan
      ? createPdfMasterPlanLayout()
      : createDemoLayout();
  const result = await supabase.from(table).insert({ id: requestId, name: cleanName, layout_data: layout }).select(projection).single();
  await checkSession(session);
  if (result.error?.code === '23505') {
    // Retry the same create command after an uncertain network result, never overwrite.
    const existing = await supabase.from(table).select(projection).eq('id', requestId).maybeSingle();
    await checkSession(session);
    if (existing.error) databaseError(existing.error);
    const project = parseDemoProject(existing.data);
    if (project.created_by !== session.userId || project.name !== cleanName
      || project.revision !== 1 || JSON.stringify(project.layout_data) !== JSON.stringify(layout)) {
      throw new Error('คำขอสร้าง Demo นี้ถูกใช้แล้ว กรุณาโหลดรายการก่อนสร้างใหม่');
    }
    return project;
  }
  if (result.error) databaseError(result.error);
  const project = parseDemoProject(result.data);
  if (project.id !== requestId || project.name !== cleanName || project.created_by !== session.userId) throw new Error(invalidData);
  return project;
}

export async function saveDemoProject(project: DemoProject, layout: DemoLayout): Promise<DemoProject> {
  const current = parseDemoProject(project);
  const nextLayout = parseDemoLayout(layout);
  const session = await requireAdmin();
  const result = await supabase.from(table).update({ layout_data: nextLayout })
    .eq('id', current.id).eq('revision', current.revision).select(projection).maybeSingle();
  await checkSession(session);
  if (result.error) databaseError(result.error);
  if (!result.data) throw new Error('โครงการ Demo ถูกแก้ไขแล้วหรือสิทธิ์เปลี่ยน กรุณาโหลดใหม่ก่อนบันทึก');
  const saved = parseDemoProject(result.data);
  if (saved.id !== current.id || saved.revision !== current.revision + 1) throw new Error(invalidData);
  return saved;
}
