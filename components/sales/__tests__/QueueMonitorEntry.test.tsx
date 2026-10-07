import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../CentralLeadsView', () => ({ default: ({ queueMonitorEnabled }: { queueMonitorEnabled: boolean }) => <p>{queueMonitorEnabled ? 'monitor enabled' : 'monitor disabled'}</p> }));
import Page from '@/app/sales-crm/page';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED',
    'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED', 'SALES_CRM_QUEUE_MONITOR_ENABLED'];
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
describe('central page queue monitor entry', () => {
    it.each(flags)('does not expose the entry without exact %s=true', flag => {
        for (const name of flags) vi.stubEnv(name, 'true');
        vi.stubEnv(flag, 'TRUE'); render(<Page />); expect(screen.getByText('monitor disabled')).toBeInTheDocument();
    });
    it('exposes only the gated reader prop without enabling processing', () => {
        for (const name of flags) vi.stubEnv(name, 'true');
        vi.stubEnv('SALES_CRM_SLA_PROCESSING_ENABLED', 'false'); render(<Page />);
        expect(screen.getByText('monitor enabled')).toBeInTheDocument();
    });
});
