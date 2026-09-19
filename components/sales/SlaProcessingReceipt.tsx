import type { SlaProcessingReason, SlaProcessingResult } from '@/lib/sales/slaProcessingContracts';

export const processingReasons: Record<SlaProcessingReason, string> = {
    SCOPE_CLOSED: 'Lead ปิดหรือถูกรวมแล้ว', LEGACY_REVIEW: 'ข้อมูลเก่าต้องตรวจหลักฐาน',
    OWNER_NOT_READY: 'ผู้ดูแลยังไม่พร้อมหรือไม่ตรงงาน', OWNER_REVIEW: 'ต้องตรวจประวัติเปลี่ยนผู้ดูแลและกติกาเวลา',
    MISSING_CREATION_EVIDENCE: 'หลักฐานเริ่ม Lead ยังไม่ครบ', CONTACT_REVIEW: 'ต้องตรวจหลักฐานติดต่อหรือการแก้ไขหลักฐาน',
    CUSTOMER_POSTPONEMENT: 'ลูกค้าขอติดต่อภายหลัง', EXCEPTION_REVIEW: 'มีข้อยกเว้นที่ต้องตรวจ',
    POLICY_REVIEW: 'ค่าหรือนโยบายยังไม่ตรงรุ่นที่รองรับ', SOURCE_TIME_REVIEW: 'วันเริ่มหรือกำหนดบริการไม่ตรงหลักฐาน',
    MISSING_CALENDAR: 'ยังไม่มีเวรของผู้ดูแล', INVALID_CALENDAR: 'ข้อมูลเวรไม่ถูกต้อง',
    INSUFFICIENT_COVERAGE: 'เวรไม่ครอบคลุมช่วงที่ต้องคำนวณ', STAFF_CALCULATION_REVIEW: 'ต้องตรวจเงื่อนไขคำนวณกำหนด Sales',
    REMINDER_REVIEW: 'หลักฐานแจ้งเตือนยังไม่ครบ', NOT_DUE_YET: 'ยังไม่ถึงเวลาแจ้ง',
    OUTSIDE_WORKING_HOURS: 'ขณะประมวลผลอยู่นอกช่วงทำงานจริง', DUE_SOON: 'เข้าเงื่อนไขเตือนก่อนกำหนด', OVERDUE: 'เข้าเงื่อนไขแจ้งเกินกำหนด',
    WITHDRAWN_NOTIFICATION: 'รหัสแจ้งเตือนตรงกับรายการที่ถอนแล้ว จึงไม่สร้างคืน', CONTACT_PROVEN: 'พิสูจน์การติดต่อสำเร็จจากหลักฐานแล้ว', TASK_CLOSED: 'งานปิดอยู่แล้ว',
};
const outcomes: Record<SlaProcessingResult['outcome'], string> = {
    held: 'พักรอตรวจหลักฐาน', scheduled: 'บันทึกกำหนดแล้ว ยังไม่สร้างแจ้งเตือน', notified: 'สร้างรายการแจ้งเตือนในแอปแล้ว',
    already_notified: 'มีรายการแจ้งเตือนเดิมแล้ว ไม่สร้างซ้ำ', suppressed: 'ระงับการสร้างแจ้งเตือนคืน',
    completed: 'ปิดงานติดต่อครั้งแรกจากหลักฐาน', closed: 'งานปิดอยู่แล้ว ไม่เปิดกลับ',
};
export const processingTime = (value: string) => new Date(value).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium',
});

export default function SlaProcessingReceipt({ receipt, source }: { receipt: SlaProcessingResult; source: 'lookup' | 'command' }) {
    return <section aria-label="ใบรับการประมวลผล" className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-5">
        <header><p className="text-xs font-semibold text-emerald-800">{source === 'lookup' ? 'พบใบรับเดิมจากการอ่านเท่านั้น' : receipt.replayed ? 'ได้รับใบรับเดิมจากคำขอซ้ำ' : 'ได้รับใบรับคำสั่งแล้ว'}</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{outcomes[receipt.outcome]}</h2></header>
        <p className="text-sm text-slate-700">{processingReasons[receipt.reason]}</p>
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">นี่คือผลในอดีต ณ เวลาประมวลผล ไม่รับรองสถานะงานหรือกล่องแจ้งเตือนปัจจุบัน และไม่ใช่ผลประเมิน KPI</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">ประมวลผลเมื่อ (เวลาไทย)</dt><dd title={receipt.processedAt}>{processingTime(receipt.processedAt)}</dd></div>
            <div><dt className="text-xs text-slate-500">กำหนดบริการในใบรับ</dt><dd title={receipt.serviceDueAt}>{processingTime(receipt.serviceDueAt)}</dd></div>
            <div><dt className="text-xs text-slate-500">กำหนด Sales ในใบรับ</dt><dd>{receipt.staffDueAt ? <time dateTime={receipt.staffDueAt} title={receipt.staffDueAt}>{processingTime(receipt.staffDueAt)}</time> : 'ไม่ได้ระบุในใบรับนี้ ไม่ยืนยันว่ากำหนดในงานถูกล้าง'}</dd></div>
            <div><dt className="text-xs text-slate-500">จำนวนแจ้งเตือนที่ถอนในรอบนั้น</dt><dd>{receipt.withdrawnCount}</dd></div>
            <div><dt className="text-xs text-slate-500">รหัสคำขอ</dt><dd className="break-all font-mono text-xs">{receipt.requestId}</dd></div>
            <div><dt className="text-xs text-slate-500">รหัสงาน</dt><dd className="break-all font-mono text-xs">{receipt.taskId}</dd></div>
            {receipt.notificationId && <div><dt className="text-xs text-slate-500">รหัสแจ้งเตือนในอดีต</dt><dd className="break-all font-mono text-xs">{receipt.notificationId}</dd></div>}
            {receipt.completedAt && <div><dt className="text-xs text-slate-500">ติดต่อสำเร็จตามหลักฐาน</dt><dd title={receipt.completedAt}>{processingTime(receipt.completedAt)}</dd></div>}
        </dl>
    </section>;
}
