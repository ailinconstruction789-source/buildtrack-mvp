import type { CustomerHistoryDate } from '@/lib/sales/customerHistory';
const labels = { visited: 'เข้าชม', booked: 'จอง', contracted: 'ทำสัญญา', loan_submitted: 'ยื่นกู้', transferred: 'โอน', handover: 'รับมอบบ้าน', cancelled: 'ยกเลิก' };
/** Unknown dates are explicitly unknown; a row is not proof the step was completed. */
export default function CustomerHistoryTimeline({ history }: { history: CustomerHistoryDate[] }) {
  return <section aria-label="ประวัติวันที่ลูกค้า" className="rounded-xl border border-slate-200 p-3">
    <h3 className="text-sm font-bold mb-2">ประวัติตามข้อมูลที่บันทึก</h3>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      {history.map(item => {
        const parts = item.date?.split('-');
        const date = parts ? `${parts[2]}/${parts[1]}/${Number(parts[0]) + 543}` : 'ไม่มีบันทึกเดิม';
        return <div key={item.event}><dt className="text-slate-500">{labels[item.event]}</dt>
          <dd>{date}{item.precision === 'day' && <span className="block text-xs text-slate-500">ไม่ทราบเวลา</span>}</dd></div>;
      })}
    </dl>
    <p className="mt-2 text-xs text-slate-500">วันที่ที่ไม่มีบันทึกไม่ได้หมายความว่ายังไม่ได้ทำขั้นตอนนั้น</p>
  </section>;
}
