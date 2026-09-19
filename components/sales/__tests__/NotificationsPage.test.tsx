import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { view } = vi.hoisted(() => ({ view: vi.fn() }));
vi.mock('../NotificationsView', () => ({ default: () => { view(); return <p>Own inbox</p>; } }));
import Page from '@/app/sales-crm/notifications/page';
const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED', 'SALES_CRM_SCHEDULE_ENABLED', 'SALES_CRM_NOTIFICATIONS_ENABLED'];
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('notification page fail-closed gates', () => {
    it.each(flags)('does not mount the reader when %s is not exactly true', flag => {
        for (const name of flags) vi.stubEnv(name, 'true');
        vi.stubEnv(flag, 'TRUE'); render(<Page />);
        expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิด');
        expect(view).not.toHaveBeenCalled();
    });
    it('only mounts the own inbox when all five gates are enabled', () => {
        for (const name of flags) vi.stubEnv(name, 'true');
        render(<Page />); expect(view).toHaveBeenCalledOnce();
    });
});
