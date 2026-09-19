import SlaPreviewView from '@/components/sales/SlaPreviewView';

export const metadata = { title: 'ตรวจแผนแจ้งเตือน | BuildTrack', description: 'Admin ตรวจการคำนวณ SLA ติดต่อครั้งแรกแบบไม่บันทึกและไม่ส่ง' };

export default function SlaPreviewPage() {
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true' || process.env.SALES_CRM_SLA_PREVIEW_ENABLED !== 'true') {
        return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดหน้าตรวจแผนแจ้งเตือน</h1>
            <p>ต้องตรวจรับฐานข้อมูลและสิทธิ์ Admin ก่อน หน้านี้ยังไม่อ่านข้อมูลหรือคำนวณจากฐาน</p>
            <p className="text-sm text-slate-600">ไม่มีการเปิดฟีเจอร์ ส่งแจ้งเตือน หรือเปลี่ยนกำหนดงานให้อัตโนมัติ</p></main>;
    }
    return <SlaPreviewView />;
}
