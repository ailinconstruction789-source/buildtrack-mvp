export const EXCEL_FOREMAN_TASKS = ['งานติดตั้งสุขภัณฑ์', 'งานติดตั้งถังเก็บน้ำ และ ปั้มน้ำ', 'งานปูหญ้า', 'งานทำทรายล้าง', 'งานทาสีเก็บรายละเอียด'] as const;
export type ExcelInspectionStatus = 'pending' | 'scheduled' | 'passed' | 'failed';
export interface ExcelHouseInspection { date: string | null; status: ExcelInspectionStatus | null }
export interface ExcelHouseDetails {
  imageUrl: string | null; houseType: string | null; overallProgress: number | null;
  tasks: { name: string; progress: number | null; excluded: boolean | null }[];
  inspections: [ExcelHouseInspection, ExcelHouseInspection];
}
const bad = (): never => { throw new Error('ข้อมูลบ้านไม่ครบหรือไม่ตรงกัน กรุณาโหลดใหม่'); };
export function houseRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad();
}
export function houseProgress(value: unknown): number | null {
  return value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : bad();
}
/** Never permit executable, local-file, credential-bearing or protocol-relative image URLs. */
export function safeHouseImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || value !== value.trim()) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function houseInspectionStatus(value: unknown): ExcelInspectionStatus | null {
  return ['pending', 'scheduled', 'passed', 'failed'].includes(String(value)) ? value as ExcelInspectionStatus : null;
}
export function parseExcelHouseDetails(value: unknown): ExcelHouseDetails {
  const row = houseRecord(value);
  if (row.houseType !== null && (typeof row.houseType !== 'string' || !row.houseType.trim() || row.houseType.length > 300)) bad();
  if (!Array.isArray(row.tasks) || row.tasks.length !== EXCEL_FOREMAN_TASKS.length || !Array.isArray(row.inspections) || row.inspections.length !== 2) return bad();
  const tasks = row.tasks.map((value, index) => {
    const task = houseRecord(value);
    if (task.name !== EXCEL_FOREMAN_TASKS[index] || !(task.excluded === null || typeof task.excluded === 'boolean')) return bad();
    const progress = houseProgress(task.progress);
    if (task.excluded === true && progress !== null) bad();
    return { name: task.name as string, progress, excluded: task.excluded as boolean | null };
  });
  const inspections = row.inspections.map(value => {
    const entry = houseRecord(value);
    if (entry.date !== null && (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(Date.parse(entry.date)) || new Date(entry.date).toISOString().slice(0, 10) !== entry.date)) bad();
    if (entry.status !== null && houseInspectionStatus(entry.status) === null) bad();
    return { date: entry.date as string | null, status: entry.status as ExcelInspectionStatus | null };
  }) as ExcelHouseDetails['inspections'];
  return { imageUrl: safeHouseImage(row.imageUrl), houseType: row.houseType as string | null, overallProgress: houseProgress(row.overallProgress), tasks, inspections };
}
