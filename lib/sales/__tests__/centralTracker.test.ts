import { describe, expect, it } from 'vitest';
import { EMPTY_TRACKER_FILTERS, filterCentralTracker, trackerStatusLabel, type CentralTrackerCustomer } from '../centralTracker';

const customer: CentralTrackerCustomer = {
  id: 'customer-1', name: 'ลูกค้าเดิม', phone: null, notes: 'ต้องการบ้านมุม', channel: 'โทร',
  ownerUserId: 'sales-a', intakeStatus: 'new', leadCreatedAt: null,
  interests: [
    { id: 'interest-a', projectName: 'A', ownerUserId: 'sales-a', engagementStatus: 'considering', workspaceState: 'project_active', plotId: 'A-01' },
    { id: 'interest-b', projectName: 'B', ownerUserId: 'sales-b', engagementStatus: 'follow_up', workspaceState: 'central_interest', plotId: null },
  ],
};
const unassigned: CentralTrackerCustomer = { ...customer, id: 'customer-2', interests: [], intakeStatus: 'following_up' };
const ids = (items: readonly CentralTrackerCustomer[]) => items.map(item => item.id);

describe('central tracker projection (no writes or customer merging)', () => {
  it('shows all customer IDs regardless of workspace flags and keeps equal names/phones separate', () => {
    const samePhone = { ...customer, id: 'customer-3' };
    expect(ids(filterCentralTracker([customer, unassigned, samePhone], EMPTY_TRACKER_FILTERS))).toEqual(['customer-1', 'customer-2', 'customer-3']);
  });
  it('returns one customer row for multiple matching project interests', () => {
    expect(ids(filterCentralTracker([customer, unassigned], { ...EMPTY_TRACKER_FILTERS, project: 'B' }))).toEqual(['customer-1']);
  });
  it('matches project, owner and status on the same interest, not across different projects', () => {
    expect(filterCentralTracker([customer], { ...EMPTY_TRACKER_FILTERS, project: 'A', owner: 'sales-b' })).toEqual([]);
    expect(filterCentralTracker([customer], { ...EMPTY_TRACKER_FILTERS, project: 'A', status: 'follow_up' })).toEqual([]);
    expect(filterCentralTracker([customer], { ...EMPTY_TRACKER_FILTERS, owner: 'sales-b', status: 'considering' })).toEqual([]);
    expect(ids(filterCentralTracker([customer], { ...EMPTY_TRACKER_FILTERS, project: 'B', owner: 'sales-b', status: 'follow_up' }))).toEqual(['customer-1']);
  });
  it('finds central ownership and status independently when no project is selected', () => {
    expect(ids(filterCentralTracker([customer, unassigned], { ...EMPTY_TRACKER_FILTERS, owner: 'sales-a', status: 'new' }))).toEqual(['customer-1']);
    expect(ids(filterCentralTracker([unassigned], { ...EMPTY_TRACKER_FILTERS, status: 'follow_up' }))).toEqual(['customer-2']);
  });
  it('filters unassigned and channel without guessing unknown channels', () => {
    expect(ids(filterCentralTracker([customer, unassigned], { ...EMPTY_TRACKER_FILTERS, unassignedOnly: true }))).toEqual(['customer-2']);
    expect(filterCentralTracker([{ ...customer, channel: null }], { ...EMPTY_TRACKER_FILTERS, channel: 'Walk in' })).toEqual([]);
    expect(filterCentralTracker([customer], { ...EMPTY_TRACKER_FILTERS, channel: 'โทร' })).toHaveLength(1);
  });
  it.each(['ลูกค้า', 'บ้านมุม', 'a-01', ' B '])('searches names, notes, plots and projects: %s', search => {
    expect(filterCentralTracker([customer], { ...EMPTY_TRACKER_FILTERS, search })).toHaveLength(1);
  });
  it('does not fabricate a phone or match the literal null for historical customers', () => {
    expect(filterCentralTracker([customer], { ...EMPTY_TRACKER_FILTERS, search: 'null' })).toEqual([]);
    expect(filterCentralTracker([customer], { ...EMPTY_TRACKER_FILTERS, search: '0000000000' })).toEqual([]);
    expect(filterCentralTracker([{ ...customer, phone: '0812345678' }], { ...EMPTY_TRACKER_FILTERS, search: '1234' })).toHaveLength(1);
  });
  it('does not interpret a historical active workspace or unknown status as a booking', () => {
    expect(trackerStatusLabel('following_up')).toBe(trackerStatusLabel('follow_up'));
    expect(trackerStatusLabel('project_active')).toBe('ไม่ทราบสถานะ');
    expect(trackerStatusLabel('unknown')).toBe('ไม่ทราบสถานะ');
    expect(customer.interests[0].workspaceState).toBe('project_active');
  });
});
