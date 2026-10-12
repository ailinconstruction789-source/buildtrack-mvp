import { describe, expect, it } from 'vitest';
import { crmSaleCustomer, SALES_WITH_CUSTOMER_SELECT } from '../saleCustomer';
const row = { project_interest_id: 'I1', crm_interest: { id: 'I1', customer_id: 'C1', crm_customer: { id: 'C1', customer_name: 'Canonical fixture', phone: 'canonical-phone' } } };
describe('canonical CRM customer relationship projection', () => {
  it('does not expand native browser queries into protected CRM tables', () => {
    expect(SALES_WITH_CUSTOMER_SELECT).toBe('*, plots(*)');
  });
  it('reads customer identity and contact through the exact interest/customer foreign keys', () => {
    expect(crmSaleCustomer(row)).toEqual({ id: 'C1', name: 'Canonical fixture', phone: 'canonical-phone' });
  });
  it.each([
    {}, { ...row, project_interest_id: 'OTHER' }, { ...row, crm_interest: null },
    { ...row, crm_interest: [row.crm_interest] },
    { ...row, crm_interest: { ...row.crm_interest, customer_id: 'OTHER' } },
    { ...row, crm_interest: { ...row.crm_interest, crm_customer: null } },
    { ...row, crm_interest: { ...row.crm_interest, crm_customer: [row.crm_interest.crm_customer] } },
  ])('does not substitute another or unreadable relationship: %j', value => {
    expect(crmSaleCustomer(value)).toBeNull();
  });
});
