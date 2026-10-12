'use client';

import { useEffect, useRef, useState } from 'react';
import { historicalCustomerEvidenceApi, type HistoricalCustomerEvidenceApi } from '@/lib/sales/historicalCustomerEvidenceClient';
import { HISTORICAL_CUSTOMER_EVIDENCE_MAX_PAGE, HISTORICAL_CUSTOMER_EVIDENCE_PAGE_SIZE, type HistoricalCustomerEvidenceSnapshot } from '@/lib/sales/historicalCustomerEvidenceContracts';

interface Props {
  customerId: string;
  expectedActorId: string;
  interestId?: string | null;
  saleId?: string | null;
  api?: HistoricalCustomerEvidenceApi;
}
interface ReadState {
  api: HistoricalCustomerEvidenceApi;
  page: number;
  snapshot?: HistoricalCustomerEvidenceSnapshot;
  error?: string;
}
const labels = { visited: 'เข้าชม', booked: 'จอง', contracted: 'ทำสัญญา', loan_submitted: 'ยื่นกู้', transferred: 'โอน', handover: 'รับมอบบ้าน', cancelled: 'ยกเลิก' };
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm text-blue-800 disabled:cursor-not-allowed disabled:opacity-50';

/** Each source record remains separate: multiple visits or purchases are not merged by name/date. */
export default function HistoricalCustomerEvidence(props: Props) {
  const key = `${props.customerId}:${props.expectedActorId}:${props.interestId ?? ''}:${props.saleId ?? ''}`;
  return <HistoricalEvidenceSession key={key} {...props} />;
}

function HistoricalEvidenceSession({ customerId, expectedActorId, interestId = null, saleId = null, api = historicalCustomerEvidenceApi }: Props) {
  const [opened, setOpened] = useState(false), [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState<ReadState | null>(null), [busy, setBusy] = useState(false), [identityBlocked, setIdentityBlocked] = useState(false);
  const generation = useRef(0), controller = useRef<AbortController | null>(null), reading = useRef(false);
  const snapshot = !identityBlocked && loaded?.api === api && loaded.page === page ? loaded.snapshot : undefined;
  const error = !identityBlocked && loaded?.api === api && loaded.page === page ? loaded.error : undefined;
  useEffect(() => {
    generation.current += 1;
    controller.current?.abort(); reading.current = false; setBusy(false);
    const stop = api.watchIdentity?.(actorId => {
      if (actorId === expectedActorId) return;
      generation.current += 1; controller.current?.abort(); reading.current = false;
      setLoaded(null); setBusy(false); setIdentityBlocked(true);
    });
    return () => { generation.current += 1; controller.current?.abort(); reading.current = false; stop?.(); };
  }, [api, expectedActorId]);

  const read = async (nextPage: number) => {
    if (reading.current || identityBlocked || nextPage < 0 || nextPage > HISTORICAL_CUSTOMER_EVIDENCE_MAX_PAGE) return;
    reading.current = true; setOpened(true); setPage(nextPage); setBusy(true);
    const epoch = ++generation.current, request = new AbortController();
    let invalidScope = false;
    controller.current?.abort(); controller.current = request;
    setLoaded(previous => previous?.api === api && previous.page === nextPage ? { ...previous, error: undefined } : null);
    try {
      const value = await api.read({ customerId, interestId, saleId, page: nextPage }, { signal: request.signal });
      if (epoch !== generation.current || request.signal.aborted) return;
      if (value.actor.userId !== expectedActorId || value.customerId !== customerId || value.interestId !== interestId
        || value.saleId !== saleId || value.page !== nextPage || !value.readOnly || value.records.length > HISTORICAL_CUSTOMER_EVIDENCE_PAGE_SIZE
        || value.records.some(record => record.customerId !== customerId) || new Set(value.records.map(record => record.key)).size !== value.records.length) {
        invalidScope = true;
        throw new Error('ข้อมูลประวัติไม่ตรงกับลูกค้าหรือบัญชีที่กำลังดู กรุณาเปิดรายการใหม่');
      }
      setLoaded({ api, page: nextPage, snapshot: value });
    } catch (failure) {
      if (epoch === generation.current && !request.signal.aborted) setLoaded(previous => ({ api, page: nextPage,
        snapshot: !invalidScope && previous?.api === api && previous.page === nextPage ? previous.snapshot : undefined,
        error: failure instanceof Error ? failure.message : 'โหลดประวัติเดิมไม่ได้' }));
    } finally {
      if (epoch === generation.current) { reading.current = false; setBusy(false); }
    }
  };

  return <section aria-label="ประวัติลูกค้าจากข้อมูลเดิม" className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-bold">ประวัติลูกค้าจากข้อมูลเดิม</h2>
    <p className="text-sm text-slate-600">แยกตามรายการต้นทางและโครงการ ดูได้อย่างเดียว วันที่ที่ไม่ทราบจะไม่ใช้วันอื่นแทน</p>
    {identityBlocked ? <p role="status">บัญชีเปลี่ยนแล้ว จึงซ่อนประวัติเดิม กรุณารอข้อมูลบัญชีล่าสุดก่อนเปิดประวัติอีกครั้ง</p>
      : <>
        {!opened && <button type="button" className={buttonClass} onClick={() => void read(0)}>ดูประวัติเดิม</button>}
        {busy && <p role="status">กำลังอ่านประวัติเดิม…</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{error}</p>}
        {snapshot && <>
          <p className="text-xs text-slate-500">หน้า {page + 1} · ไม่เกิน 50 รายการต่อหน้า</p>
          {!snapshot.records.length && <p>ไม่มีประวัติเดิมในหน้านี้</p>}
          {snapshot.records.map(record => <article key={record.key} aria-label={`ประวัติแถว ${record.sourceRow}`} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <h3 className="font-bold">โครงการ: {record.projectNames.length ? record.projectNames.join(' / ') : 'ไม่ทราบ'}</h3>
            <p className="text-xs text-slate-500">ข้อมูลต้นทางแถว {record.sourceRow}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {record.events.map(event => { const parts = event.date?.split('-');
                return <div key={event.kind}><dt className="text-slate-500">{labels[event.kind]}</dt>
                  <dd>{parts ? `${parts[2]}/${parts[1]}/${Number(parts[0]) + 543}` : 'ไม่ทราบ'}
                    {event.precision === 'day' && <span className="block text-xs text-slate-500">ไม่ทราบเวลา</span>}</dd></div>;
              })}
            </dl>
          </article>)}
        </>}
        {opened && <div className="flex flex-wrap gap-3">
          <button type="button" className={buttonClass} disabled={busy || page === 0} onClick={() => void read(page - 1)}>ประวัติก่อนหน้า</button>
          <button type="button" className={buttonClass} disabled={busy || !snapshot?.hasMore || page === HISTORICAL_CUSTOMER_EVIDENCE_MAX_PAGE} onClick={() => void read(page + 1)}>ประวัติถัดไป</button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void read(page)}>{error ? 'ลองอ่านประวัติอีกครั้ง' : 'อ่านประวัติล่าสุด'}</button>
        </div>}
      </>}
  </section>;
}
