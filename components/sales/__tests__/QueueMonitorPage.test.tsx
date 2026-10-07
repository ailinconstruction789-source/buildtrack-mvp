import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { view } = vi.hoisted(() => ({ view: vi.fn() }));
vi.mock('../QueueMonitorView', () => ({ default: () => { view(); return <p>Read-only Admin queue</p>; } }));
import Page from '@/app/sales-crm/queue-monitor/page';

const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED',
    'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED', 'SALES_CRM_QUEUE_MONITOR_ENABLED'];
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('Admin queue monitor page gates', () => {
    it.each(flags)('does not mount the auth/reader without exact %s=true', flag => {
        for (const name of flags) vi.stubEnv(name, 'true');
        vi.stubEnv(flag, 'TRUE'); render(<Page />);
        expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิดหน้าตรวจคิว');
        expect(view).not.toHaveBeenCalled();
    });
    it('is off with every gate missing and performs no implicit setup', () => {
        for (const name of flags) vi.stubEnv(name, undefined);
        render(<Page />); expect(view).not.toHaveBeenCalled();
        expect(screen.getByText(/ยังไม่อ่านข้อมูลคิว/)).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
    it('mounts only the read-only Admin reader with all seven gates, even with writers off', () => {
        for (const name of flags) vi.stubEnv(name, 'true');
        for (const name of ['SALES_CRM_SLA_PROCESSING_ENABLED', 'SALES_CRM_SLA_CYCLE_ENABLED', 'SALES_CRM_SLA_WORKER_ENABLED', 'SALES_CRM_SLA_DISPATCHER_ENABLED', 'SALES_CRM_SLA_BURST_ENABLED']) vi.stubEnv(name, 'false');
        render(<Page />); expect(view).toHaveBeenCalledOnce();
    });
});
