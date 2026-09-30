'use client';

import { useEffect, useRef, useState } from 'react';
import { excelReportApi, type ExcelReportApi } from '@/lib/sales/excelReportClient';
import type { ExcelReportData } from '@/lib/sales/excelReportContracts';
import CentralExcelReportView from './CentralExcelReportView';

interface Props { surface: 'dashboard' | 'summary'; initialProjectName?: string | null; api?: ExcelReportApi }
export default function CentralExcelReportWorkspace(props: Props) {
  return <ReportSession key={`${props.surface}:${props.initialProjectName ?? ''}`} {...props} />;
}
function ReportSession({ surface, initialProjectName = null, api = excelReportApi }: Props) {
  const [projectName, setProjectName] = useState<string | null>(initialProjectName), [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; data?: ExcelReportData; error?: string }>({ key: -1 });
  const identityEpoch = useRef(0);
  // Read every project once for the report; changing the display filter must not relabel partial data as all-project totals.
  useEffect(() => api.watchIdentity(() => { identityEpoch.current++; setLoaded({ key: -1 }); setRevision(value => value + 1); }), [api]);
  useEffect(() => {
    const controller = new AbortController();
    const epoch = identityEpoch.current;
    api.read(null, controller.signal).then(data => {
      if (!controller.signal.aborted && epoch === identityEpoch.current) setLoaded({ key: revision, data });
    }).catch(() => {
      if (!controller.signal.aborted && epoch === identityEpoch.current) setLoaded({ key: revision, error: 'โหลดรายงานไม่สำเร็จหรือสิทธิ์เปลี่ยนแล้ว กรุณาเข้าสู่ระบบและลองใหม่ ไม่แสดงยอดจากข้อมูลบางส่วน' });
    });
    return () => controller.abort();
  }, [api, revision]);
  const current = loaded.key === revision ? loaded : undefined;
  if (!current) return <p role="status" className="p-8 text-slate-600">กำลังตรวจสิทธิ์และโหลดสรุปจากส่วนกลางให้ครบทุกโครงการ…</p>;
  if (current.error || !current.data) return <section className="p-8"><p role="alert">{current.error}</p><button className="mt-4 underline" onClick={() => setRevision(value => value + 1)}>โหลดรายงานใหม่</button></section>;
  if (projectName !== null && !current.data.projects.some(project => project.map.projectName === projectName)) return <p role="alert" className="p-8">ไม่พบโครงการที่เลือกในสิทธิ์ของบัญชีนี้</p>;
  return <CentralExcelReportView data={current.data} surface={surface} projectName={projectName} onProjectChange={setProjectName} onRefresh={() => setRevision(value => value + 1)} />;
}
