/** Verified foreign keys for a trusted projection, not permission to read these tables directly. */
export const SALE_CUSTOMER_RELATION = 'crm_interest:lead_project_interests!sales_project_interest_id_fkey(id,customer_id,crm_customer:sales_customers!lead_project_interests_customer_id_fkey(id,customer_name,phone))';
// Real catalog review: anon/authenticated lack SELECT on the CRM interest/customer tables.
// Keep native reads on the permitted tables until a trusted profile reader is integrated.
export const SALES_WITH_CUSTOMER_SELECT = '*, plots(*)';
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Unknown or RLS-hidden relationships stay unknown; names never establish a link. */
export function crmSaleCustomer(row: Record<string, unknown>): { id: string; name: string; phone: string } | null {
  const interest = record(row.crm_interest), customer = record(interest?.crm_customer);
  if (!row.project_interest_id || interest?.id !== row.project_interest_id || !customer || !interest?.customer_id
    || customer.id !== interest.customer_id || typeof customer.id !== 'string' || !customer.id) return null;
  return { id: customer.id, name: typeof customer.customer_name === 'string' ? customer.customer_name : '',
    phone: typeof customer.phone === 'string' ? customer.phone : '' };
}
