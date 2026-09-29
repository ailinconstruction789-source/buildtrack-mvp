import { EMPTY_CENTRAL_SEARCH, type CentralSearchFilters, type CentralSnapshot } from './centralContracts';

export type CentralTrackerCustomer = CentralSnapshot['customers'][number];
export type CentralTrackerFilters = CentralSearchFilters;
export const EMPTY_TRACKER_FILTERS = EMPTY_CENTRAL_SEARCH;

export const TRACKER_STATUS_LABELS: Readonly<Record<string, string>> = {
  new: 'Lead ใหม่', contacted: 'ติดต่อแล้ว', considering: 'กำลังพิจารณา',
  follow_up: 'อยู่ระหว่างติดตาม', nurture: 'พักติดตาม', lost: 'Lost ก่อนจอง', legacy_unclassified: 'ไม่ทราบสถานะ (ข้อมูลเก่า)',
};
export const trackerStatus = (status: string) => status === 'following_up' ? 'follow_up' : status;
export const trackerStatusLabel = (status: string) => TRACKER_STATUS_LABELS[trackerStatus(status)] ?? 'ไม่ทราบสถานะ';

/** Filter only the bounded snapshot. Never merge customer IDs by name/phone,
 * and never infer a booking from the old visit-driven workspaceState flag. */
export function filterCentralTracker(customers: readonly CentralTrackerCustomer[], filters: CentralTrackerFilters): CentralTrackerCustomer[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return customers.filter(customer => {
    if (filters.unassignedOnly && customer.interests.length) return false;
    if (filters.channel && customer.channel !== filters.channel) return false;
    if (query && ![customer.name, customer.phone, customer.notes,
      ...customer.interests.flatMap(interest => [interest.projectName, interest.plotId])]
      .filter(value => value !== null).join(' ').toLocaleLowerCase().includes(query)) return false;

    const matchesScope = (owner: string, status: string) =>
      (!filters.owner || owner === filters.owner) && (!filters.status || trackerStatus(status) === filters.status);
    if (!filters.project && matchesScope(customer.ownerUserId, customer.intakeStatus)) return true;
    // Project, owner and status must match the SAME interest, not different projects.
    return customer.interests.some(interest => (!filters.project || interest.projectName === filters.project)
      && matchesScope(interest.ownerUserId, interest.engagementStatus));
  });
}
