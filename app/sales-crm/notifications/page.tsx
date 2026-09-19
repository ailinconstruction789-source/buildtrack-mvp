import NotificationsView from '@/components/sales/NotificationsView';

export const metadata = { title: 'การแจ้งเตือนฝ่ายขาย | BuildTrack', description: 'แจ้งเตือนงานติดตามที่ส่งถึงผู้ใช้งานปัจจุบัน' };

export default function NotificationsPage() {
    if (process.env.SALES_CRM_V2_ENABLED !== 'true' || process.env.SALES_CRM_LEAD_WORK_ENABLED !== 'true'
        || process.env.SALES_CRM_LIFECYCLE_ENABLED !== 'true' || process.env.SALES_CRM_SCHEDULE_ENABLED !== 'true'
        || process.env.SALES_CRM_NOTIFICATIONS_ENABLED !== 'true') {
        return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังไม่เปิดระบบแจ้งเตือนฝ่ายขาย</h1>
            <p>หน้านี้ยังไม่อ่านแจ้งเตือนหรือบันทึกว่าอ่านแล้ว ต้องตรวจรับฐานข้อมูล สิทธิ์ และการคำนวณตามเวรก่อนเปิดใช้งาน</p>
            <p className="text-sm text-slate-600">ไม่มีการเปิดฟีเจอร์หรือส่งแจ้งเตือนให้อัตโนมัติ</p></main>;
    }
    return <NotificationsView />;
}
