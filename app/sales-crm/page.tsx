import CentralLeadsView from '@/components/sales/CentralLeadsView';
import { projectSalesEnabled, salesReportsEnabled } from '@/lib/sales/projectSalesFlags';
import { bookingsEnabled } from '@/lib/sales/bookingServer';
import { extendedSalesReleaseAllowed } from '@/lib/sales/releaseScope';

export const metadata = {
  title: 'Lead ส่วนกลาง | BuildTrack',
  description: 'รับ Lead ส่วนกลางและดูความสนใจแยกตามโครงการ',
};

export default function CentralSalesPage() {
  const leadWorkEnabled = extendedSalesReleaseAllowed() && process.env.SALES_CRM_V2_ENABLED === 'true' && process.env.SALES_CRM_LEAD_WORK_ENABLED === 'true';
  const workScheduleEnabled = leadWorkEnabled && process.env.SALES_CRM_LIFECYCLE_ENABLED === 'true' && process.env.SALES_CRM_SCHEDULE_ENABLED === 'true';
  const notificationsEnabled = workScheduleEnabled && process.env.SALES_CRM_NOTIFICATIONS_ENABLED === 'true';
  const slaPreviewEnabled = notificationsEnabled && process.env.SALES_CRM_SLA_PREVIEW_ENABLED === 'true';
  const queueMonitorEnabled = slaPreviewEnabled && process.env.SALES_CRM_QUEUE_MONITOR_ENABLED === 'true';
  const bookingEnabled = bookingsEnabled();
  return <CentralLeadsView leadWorkEnabled={leadWorkEnabled} workScheduleEnabled={workScheduleEnabled} notificationsEnabled={notificationsEnabled} slaPreviewEnabled={slaPreviewEnabled} queueMonitorEnabled={queueMonitorEnabled} bookingEnabled={bookingEnabled} projectSalesEnabled={projectSalesEnabled()} reportsEnabled={salesReportsEnabled()} />;
}
