import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { view } = vi.hoisted(() => ({ view: vi.fn() }));
vi.mock('../SlaProcessingView', () => ({ default: () => { view(); return <p>Admin receipt and explicit processing view</p>; } }));
import Page from '@/app/sales-crm/sla-processing/page';

const flags = ['SALES_CRM_V2_ENABLED', 'SALES_CRM_LEAD_WORK_ENABLED', 'SALES_CRM_LIFECYCLE_ENABLED',
    'SALES_CRM_SCHEDULE_ENABLED', 'SALES_CRM_NOTIFICATIONS_ENABLED', 'SALES_CRM_SLA_PREVIEW_ENABLED'];
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('Admin processing page keeps read recovery separate from the seventh write gate', () => {
    it.each(flags)('does not mount any reader or processing control without exact %s=true', flag => {
        for (const name of flags) vi.stubEnv(name, 'true');
        vi.stubEnv('SALES_CRM_SLA_PROCESSING_ENABLED', 'true'); vi.stubEnv(flag, 'TRUE');
        render(<Page />); expect(view).not.toHaveBeenCalled();
        expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิดหน้าประมวลผลและตรวจใบรับ');
        expect(screen.getByText(/หน้านี้ยังไม่อ่านข้อมูลหรือส่งคำสั่ง/)).toBeInTheDocument();
    });

    it.each(['false', 'TRUE', '', undefined])('mounts read recovery with all six gates even when the processing flag is %s', processing => {
        for (const name of flags) vi.stubEnv(name, 'true');
        vi.stubEnv('SALES_CRM_SLA_PROCESSING_ENABLED', processing);
        render(<Page />); expect(view).toHaveBeenCalledOnce();
        expect(screen.getByText('Admin receipt and explicit processing view')).toBeInTheDocument();
    });

    it('mounts the same authenticated view with all seven gates, without page-level processing', () => {
        for (const name of flags) vi.stubEnv(name, 'true');
        vi.stubEnv('SALES_CRM_SLA_PROCESSING_ENABLED', 'true'); render(<Page />);
        expect(view).toHaveBeenCalledOnce();
    });
});
