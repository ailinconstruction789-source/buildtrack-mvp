import CentralLeadsView from '@/components/sales/CentralLeadsView';

export const metadata = {
  title: 'Lead ส่วนกลาง | BuildTrack',
  description: 'รับ Lead ส่วนกลางและดูความสนใจแยกตามโครงการ',
};

export default function CentralSalesPage() {
  const leadWorkEnabled = process.env.SALES_CRM_V2_ENABLED === 'true' && process.env.SALES_CRM_LEAD_WORK_ENABLED === 'true';
  const workScheduleEnabled = leadWorkEnabled && process.env.SALES_CRM_LIFECYCLE_ENABLED === 'true' && process.env.SALES_CRM_SCHEDULE_ENABLED === 'true';
  const notificationsEnabled = workScheduleEnabled && process.env.SALES_CRM_NOTIFICATIONS_ENABLED === 'true';
  const slaPreviewEnabled = notificationsEnabled && process.env.SALES_CRM_SLA_PREVIEW_ENABLED === 'true';
  return <CentralLeadsView leadWorkEnabled={leadWorkEnabled} workScheduleEnabled={workScheduleEnabled} notificationsEnabled={notificationsEnabled} slaPreviewEnabled={slaPreviewEnabled} />;
}
