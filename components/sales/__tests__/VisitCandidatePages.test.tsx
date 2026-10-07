import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const { mounted } = vi.hoisted(() => ({ mounted: vi.fn() }));
vi.mock('../NotificationsView', () => ({ default: () => { mounted(); return null; } }));
vi.mock('../WorkScheduleView', () => ({ default: () => { mounted(); return null; } }));
vi.mock('../SlaPreviewView', () => ({ default: () => { mounted(); return null; } }));
vi.mock('../SlaProcessingView', () => ({ default: () => { mounted(); return null; } }));
vi.mock('../QueueMonitorView', () => ({ default: () => { mounted(); return null; } }));
import Notifications from '@/app/sales-crm/notifications/page';
import Schedule from '@/app/sales-crm/work-schedule/page';
import Preview from '@/app/sales-crm/sla-preview/page';
import Processing from '@/app/sales-crm/sla-processing/page';
import Queue from '@/app/sales-crm/queue-monitor/page';

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); });
const pages = [Notifications, Schedule, Preview, Processing, Queue];
it.each(['central_booking', 'central_visits', 'unknown_scope'])('does not mount deferred readers for %s even with all switches on', scope => {
  for (const flag of ['V2', 'LEAD_WORK', 'LIFECYCLE', 'SCHEDULE', 'NOTIFICATIONS', 'SLA_PREVIEW', 'SLA_PROCESSING', 'SLA_CYCLE', 'QUEUE_MONITOR']) vi.stubEnv(`SALES_CRM_${flag}_ENABLED`, 'true');
  vi.stubEnv('SALES_CRM_RELEASE_SCOPE', scope);
  for (const Page of pages) {
    render(<Page />); expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
    expect(mounted).not.toHaveBeenCalled(); cleanup();
  }
});
