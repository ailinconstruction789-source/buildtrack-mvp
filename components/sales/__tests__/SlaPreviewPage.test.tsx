import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { view } = vi.hoisted(() => ({ view: vi.fn() }));
vi.mock('../SlaPreviewView', () => ({ default: () => { view(); return <p>Admin dry run</p>; } }));
import Page from '@/app/sales-crm/sla-preview/page';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED', 'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED'];
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('Admin SLA preview page gates', () => {
    it.each(flags)('does not mount the auth/reader without exact %s=true', flag => {
        for (const name of flags) vi.stubEnv(name, 'true'); vi.stubEnv(flag, 'TRUE'); render(<Page />);
        expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด'); expect(view).not.toHaveBeenCalled();
    });
    it('mounts the read-only Admin preview only with all six gates', () => {
        for (const name of flags) vi.stubEnv(name, 'true'); render(<Page />); expect(view).toHaveBeenCalledOnce();
    });
});
