import SlaProcessingView from '@/components/sales/SlaProcessingView';

export const metadata = { title: 'ประมวลผลและตรวจใบรับ SLA | BuildTrack', description: 'Admin ตรวจใบรับและยืนยันประมวลผลติดต่อครั้งแรกทีละงาน' };

export default function SlaProcessingPage() {
    // Read/recovery remains possible with the seventh processing switch OFF.
    // The context API and POST independently enforce trusted role and DB gates.
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true' || process.env.SALES_CRM_SLA_PREVIEW_ENABLED !== 'true') {
        return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดหน้าประมวลผลและตรวจใบรับ</h1>
            <p>ต้องตรวจรับฐานข้อมูลและสิทธิ์ Admin ก่อน หน้านี้ยังไม่อ่านข้อมูลหรือส่งคำสั่ง</p>
            <p className="text-sm text-slate-600">ไม่มีการเปิดสวิตช์ ติดตั้ง SQL หรือส่งแจ้งเตือนให้อัตโนมัติ</p></main>;
    }
    return <SlaProcessingView />;
}
