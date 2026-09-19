import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { view } = vi.hoisted(() => ({ view: vi.fn() }));
vi.mock('../WorkScheduleView', () => ({ default: () => { view(); return <p>Admin schedule view</p>; } }));
import Page from '@/app/sales-crm/work-schedule/page';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED'];
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('private schedule page gates', () => {
    it.each(flags)('does not mount an auth/read client unless %s is exactly true', flag => {
        for (const name of flags) vi.stubEnv(name, 'true'); vi.stubEnv(flag, 'TRUE'); render(<Page />);
        expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด'); expect(view).not.toHaveBeenCalled();
    });
    it('mounts the guarded Admin reader only with all four flags', () => {
        for (const flag of flags) vi.stubEnv(flag, 'true'); render(<Page />); expect(view).toHaveBeenCalledOnce();
    });
});
