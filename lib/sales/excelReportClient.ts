import { supabase } from '@/lib/supabase';
import { bookingRecord } from './bookingContracts';
import { projectSalesApi } from './projectSalesClient';
import { centralApi } from './centralClient';
import { parseExcelReportProject, type ExcelReportData } from './excelReportContracts';

export interface ExcelReportApi {
  read(projectName: string | null, signal?: AbortSignal): Promise<ExcelReportData>;
  watchIdentity(onChange: () => void): () => void;
}
const unavailable = () => new Error('โหลดสรุปไม่ครบ กรุณาลองใหม่ — ไม่แสดงยอดจากข้อมูลบางส่วน');
export const excelReportApi: ExcelReportApi = {
  watchIdentity: onChange => centralApi.watchIdentity!(onChange),
  async read(projectName, signal) {
    const before = await supabase.auth.getSession();
    if (before.error || !before.data.session) throw new Error('กรุณาเข้าสู่ระบบก่อนดูรายงาน');
    const identity = before.data.session.user.id, token = before.data.session.access_token;
    const index = await projectSalesApi.read({ projectName: null, tab: 'all', query: '', page: 0 });
    if (index.actor.userId !== identity || index.projects.length > 100 || signal?.aborted) throw unavailable();
    const names = projectName === null ? index.projects.map(project => project.name) : [projectName];
    if (names.some(name => !index.projects.some(project => project.name === name))) throw unavailable();
    const projects: ExcelReportData['projects'] = [];
    // Bounded serial requests: complete project history or no report. No partial-page totals.
    for (const name of names) {
      if (signal?.aborted) throw unavailable();
      const response = await fetch(`/api/sales-crm/excel-report?${new URLSearchParams({ projectName: name })}`, {
        method: 'GET', cache: 'no-store', credentials: 'omit', signal, headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status !== 200) throw unavailable();
      const raw = bookingRecord(await response.json());
      if (!('data' in raw) || 'error' in raw) throw unavailable();
      const project = parseExcelReportProject(raw.data, name);
      if (project.map.actor.userId !== identity || project.map.actor.role !== index.actor.role) throw unavailable();
      projects.push(project);
    }
    const after = await supabase.auth.getSession();
    if (after.error || !after.data.session || after.data.session.user.id !== identity || signal?.aborted) throw unavailable();
    return { projects, loadedAt: new Date().toISOString() };
  },
};
