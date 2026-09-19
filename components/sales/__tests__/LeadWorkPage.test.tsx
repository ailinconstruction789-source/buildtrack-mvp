import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeadWorkScope } from '@/lib/sales/leadWorkReadContracts';

const { view, lifecycleFlag } = vi.hoisted(() => ({ view: vi.fn(), lifecycleFlag: vi.fn() }));
vi.mock('../LeadWorkView', () => ({ default: ({ scope, lifecycleEnabled }: { scope: LeadWorkScope; lifecycleEnabled?: boolean }) => {
  view(scope);
  lifecycleFlag(lifecycleEnabled);
  return <p>scoped client view</p>;
} }));
import Page from '@/app/sales-crm/[customerId]/page';

const CUSTOMER = '00000000-0000-4000-8000-000000000001';
const INTEREST = '00000000-0000-4000-8000-000000000002';
const props = (query: Record<string, string | string[] | undefined> = {}, customerId = CUSTOMER) => ({
  params: Promise.resolve({ customerId }), searchParams: Promise.resolve(query),
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

// Unit-test the resolved server boundary, not Next's async-RSC rendering protocol.
describe('lead-work page boundary', () => {
  it.each(['', 'false', 'TRUE', 'true'])('only enables lifecycle UI for an explicit private true flag (%s)', async flag => {
    vi.stubEnv('SALES_CRM_V2_ENABLED', 'true'); vi.stubEnv('SALES_CRM_LEAD_WORK_ENABLED', 'true');
    vi.stubEnv('SALES_CRM_LIFECYCLE_ENABLED', flag);
    render(await Page(props()));
    expect(lifecycleFlag).toHaveBeenCalledWith(flag === 'true');
  });
  it.each([['', ''], ['true', 'false'], ['false', 'true'], ['TRUE', 'true']])(
    'does not mount the auth/read client while central=%s work=%s', async (central, work) => {
      vi.stubEnv('SALES_CRM_V2_ENABLED', central); vi.stubEnv('SALES_CRM_LEAD_WORK_ENABLED', work);
      render(await Page(props()));
      expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิดงานติดตามลูกค้า');
      expect(view).not.toHaveBeenCalled();
    },
  );
  it.each([{}, { interestId: INTEREST }])('resolves awaited route inputs into the exact scope %j', async query => {
    vi.stubEnv('SALES_CRM_V2_ENABLED', 'true'); vi.stubEnv('SALES_CRM_LEAD_WORK_ENABLED', 'true');
    render(await Page(props(query)));
    expect(view).toHaveBeenCalledWith({ customerId: CUSTOMER, interestId: query.interestId ?? null });
  });
  it.each([{ interestId: '' }, { interestId: 'bad' }, { interestId: [INTEREST, INTEREST] }, { owner: CUSTOMER }])(
    'blocks ambiguous/injected query %j before mounting a client', async query => {
      vi.stubEnv('SALES_CRM_V2_ENABLED', 'true'); vi.stubEnv('SALES_CRM_LEAD_WORK_ENABLED', 'true');
      render(await Page(props(query)));
      expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์งานติดตามไม่ถูกต้อง');
      expect(view).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed customer IDs instead of passing them to a data fetch', async () => {
    vi.stubEnv('SALES_CRM_V2_ENABLED', 'true'); vi.stubEnv('SALES_CRM_LEAD_WORK_ENABLED', 'true');
    render(await Page(props({}, `${CUSTOMER}\n`)));
    expect(view).not.toHaveBeenCalled();
    expect(screen.getByRole('heading')).toHaveTextContent('ลิงก์งานติดตามไม่ถูกต้อง');
  });
});
