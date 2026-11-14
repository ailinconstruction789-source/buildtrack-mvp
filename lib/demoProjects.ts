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
  options?: { empty?: boolean },
): Promise<DemoProject> {
  const cleanName = validateDemoProjectName(name);
  if (!uuid.test(requestId)) throw new Error(invalidData);
  const session = await requireAdmin();
  const layout = options?.empty ? createEmptyDemoLayout() : createDemoLayout();
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
