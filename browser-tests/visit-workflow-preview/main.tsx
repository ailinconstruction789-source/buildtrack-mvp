import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import VisitsWorkspace from '../../components/sales/VisitsWorkspace';
import VisitSopWorkspace from '../../components/sales/VisitSopWorkspace';
import VisitFollowUpWorkspace from '../../components/sales/VisitFollowUpWorkspace';
import CustomerVoicesWorkspace from '../../components/sales/CustomerVoicesWorkspace';
import CustomerVoicePublic from '../../components/sales/CustomerVoicePublic';
import { state, scope, visitsHref, changeRole, reset, visitsApi, sopApi, followUpApi, voiceApi, publicApi, type FixtureRole } from './fixture';
import '../../app/globals.css';
const query = new URLSearchParams(location.search), path = location.pathname;
function App() {
  const [, refresh] = useState(0);
  useEffect(() => { const changed = () => refresh(value => value + 1); window.addEventListener('synthetic-fixture-change', changed); return () => window.removeEventListener('synthetic-fixture-change', changed); }, []);
  return <><aside className="m-3 space-y-3 rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-slate-900">
    <h1 className="font-bold">SYNTHETIC PREVIEW — ข้อมูลจำลองในเครื่องเท่านั้น</h1>
    <p>ใช้หน้าจอจริงกับ API จำลอง ไม่เชื่อม Supabase ไม่ใช่การรับรองสิทธิ์หรือ SQL จริง · จำกัดทดสอบหนึ่งลูกค้า / หนึ่งรอบเข้าชม</p>
    <div className="flex flex-wrap items-center gap-4"><label>บทบาทจำลอง <select aria-label="บทบาทจำลอง" value={state.role} onChange={e => changeRole(e.target.value as FixtureRole)} className="rounded border bg-white p-2">
      <option value="sales">Sales เจ้าของงาน</option><option value="admin">Admin</option><option value="owner">Owner</option><option value="other_sales">Sales คนอื่น</option>
    </select></label><a href={visitsHref} className="text-blue-800 underline">กลับเส้นทางทดสอบนัดหมาย</a><button className="rounded border p-2" onClick={reset}>เริ่มข้อมูลจำลองรอบใหม่</button></div>
    <p className="text-sm">ลำดับ: สร้างนัด → เตรียม SOP A → เช็คอิน → เริ่มพาชม → กำหนดติดตาม → ปิด SOP C → ออก QR → เปิดลิงก์และตอบคะแนน 8 ด้าน → กลับตรวจ Visit สำเร็จ</p>
    {state.token && path !== '/customer-voices' && <a className="inline-block text-blue-800 underline" href={`/customer-voices#token=${state.token.token}`}>เปิดแบบสอบถามจำลอง</a>}
  </aside>
    {path === '/sales-crm/sop' ? <VisitSopWorkspace anchor={{ ...scope, appointmentId: query.get('appointmentId'), visitId: query.get('visitId') }} api={sopApi} followUpEnabled />
      : path === '/sales-crm/visit-follow-up' ? <VisitFollowUpWorkspace scope={scope} api={followUpApi} />
      : path === '/sales-crm/customer-voices' && query.get('visitId') ? <CustomerVoicesWorkspace scope={{ ...scope, visitId: query.get('visitId')! }} api={voiceApi} />
      : path === '/customer-voices' ? <CustomerVoicePublic api={publicApi} />
      : <VisitsWorkspace {...scope} api={visitsApi} sopEnabled voicesEnabled />}
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
