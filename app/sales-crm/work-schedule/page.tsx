import WorkScheduleView from '@/components/sales/WorkScheduleView';

export const metadata = { title: 'จัดเวรฝ่ายขาย | BuildTrack', description: 'Admin จัดเวรฝ่ายขายและเก็บประวัติรุ่นตาราง' };

export default function WorkSchedulePage() {
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true') {
        return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดระบบจัดเวรฝ่ายขาย</h1>
            <p>หน้านี้ยังไม่อ่านหรือบันทึกเวร ต้องตรวจรับฐานข้อมูลและสิทธิ์ก่อนเปิดใช้งาน</p>
            <p className="text-sm text-slate-600">ไม่มีการสร้างเวรเริ่มต้นหรือเปิดระบบให้อัตโนมัติ หากมีคำขอค้างให้ Admin ตรวจรหัสเดิมก่อนเริ่มใหม่</p></main>;
    }
    return <WorkScheduleView />;
}
