import QueueMonitorView from '@/components/sales/QueueMonitorView';
import { extendedSalesReleaseAllowed } from '@/lib/sales/releaseScope';

export const metadata = { title: 'ตรวจคิวแจ้งเตือน | BuildTrack', description: 'Admin อ่านสถานะคิวติดต่อครั้งแรกและหลักฐานที่ต้องตรวจ โดยไม่สั่งประมวลผล' };

export default function QueueMonitorPage() {
    if (!extendedSalesReleaseAllowed() || process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true' || process.env.SALES_CRM_SLA_PREVIEW_ENABLED !== 'true'
        || process.env.SALES_CRM_QUEUE_MONITOR_ENABLED !== 'true') {
        return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดหน้าตรวจคิวแจ้งเตือน</h1>
            <p>ต้องตรวจรับฐานข้อมูลและสิทธิ์ Admin ก่อน หน้านี้ยังไม่อ่านข้อมูลคิว</p>
            <p className="text-sm text-slate-600">ไม่มีการเปิดฟีเจอร์ ส่งแจ้งเตือน ลองใหม่ หรือปลดล็อกให้อัตโนมัติ</p></main>;
    }
    return <QueueMonitorView />;
}
