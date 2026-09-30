/** Server-only release boundary. Dependency flags are not permission to expose unfinished workflows. */
export function centralBookingReleaseAllowed(): boolean {
  const scope = process.env.SALES_CRM_RELEASE_SCOPE;
  return !scope || scope === 'central_booking' || scope === 'central_visits';
}

/** Local candidate boundary: activation still requires each workflow flag and database capability. */
export function visitWorkflowReleaseAllowed(): boolean {
  const scope = process.env.SALES_CRM_RELEASE_SCOPE;
  return !scope || scope === 'central_visits';
}

/** An explicit bounded release keeps all optional workflows closed. Unknown values fail closed. */
export function extendedSalesReleaseAllowed(): boolean {
  return !process.env.SALES_CRM_RELEASE_SCOPE;
}
