import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SalesMap, { matchingMapCustomer } from '../SalesMap';

const fixture = vi.hoisted(() => ({ plots: [{ id: 'P1', plot_name: '5', project_name: 'ไอลิน6', has_customer: true }] }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const result = { data: table === 'projects' ? { layout_data: [{ type: 'config', cols: 2, rows: 2 }, { type: 'plot', plotId: 'AL6-05', x: 0, y: 0 }] }
    : table === 'plots' ? fixture.plots : [], error: null };
  const chain = { select: () => chain, eq: () => chain, ilike: () => chain, not: () => chain,
    order: () => chain, maybeSingle: async () => result,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  return chain;
} } }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({ isSampleHouse: () => false,
  fetchTodayInspectionStatus: async () => null, fetchTodayInspectionMap: async () => ({}) }));
afterEach(cleanup);
const row = { id: 'S1', saleId: 'S1', leadId: 'L1', project_name: 'ไอลิน6', plot: 'P1', status: 'Reserved', bookingDate: '2026-10-09' };

describe('native project map customer identity', () => {
  it('passes the exact linked customer object to the existing inline update entry', async () => {
    const clicked = vi.fn();
    render(<SalesMap projectName="ไอลิน6" leads={[row]} onPlotClick={clicked} />);
    fireEvent.click(await screen.findByText('AL6-05'));
    expect(clicked).toHaveBeenCalledWith('AL6-05', 'Reserved', row);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('resolves only this project prefix and confirmed leading zero plot labels', () => {
    expect(matchingMapCustomer('AL6-05', 'ไอลิน6', fixture.plots, [row])).toBe(row);
    expect(matchingMapCustomer('AL4-05', 'ไอลิน6', fixture.plots, [row])).toBeNull();
  });
  it('does not let a same plot label overwrite a different explicit plot ID', () => {
    expect(matchingMapCustomer('P1', 'ไอลิน6', fixture.plots, [{ ...row, plot: 'P2', plotName: '5' }])).toBeNull();
    expect(matchingMapCustomer('P1', 'ไอลิน6', fixture.plots, [{ ...row, interested_plot_id: 'P2', plotName: '5' }])).toBeNull();
  });
  it('does not guess between two distinct plot IDs that normalize to the same label', () => {
    const plots = [...fixture.plots, { id: 'P2', plot_name: '05' }];
    expect(matchingMapCustomer('AL6-05', 'ไอลิน6', plots, [row])).toBeNull();
    expect(matchingMapCustomer('P1', 'ไอลิน6', plots, [row])).toBe(row);
  });
  it('does not select a customer from another project with the same label', () => {
    expect(matchingMapCustomer('P1', 'ไอลิน6', fixture.plots, [{ ...row, project_name: 'ไอลิน4', plot: 'P1', plotName: '5' }])).toBeNull();
  });
  it('selects the latest actual booking instead of prioritizing an older transferred customer', () => {
    const previous = { ...row, id: 'old', status: 'Transferred', bookingDate: '2025-10-09' };
    expect(matchingMapCustomer('P1', 'ไอลิน6', fixture.plots, [previous, row])).toBe(row);
    expect(matchingMapCustomer('P1', 'ไอลิน6', fixture.plots, [row, previous])).toBe(row);
  });
  it.each(['Cancelled', 'Lost', 'Visit', 'Rejected'])('does not reopen %s as the current plot customer', status => {
    expect(matchingMapCustomer('P1', 'ไอลิน6', fixture.plots, [{ ...row, status }])).toBeNull();
  });
  it('retains source order when actual booking timestamps are unknown', () => {
    const first = { ...row, bookingDate: '' }, second = { ...row, id: 'second', bookingDate: '' };
    expect(matchingMapCustomer('P1', 'ไอลิน6', fixture.plots, [first, second])).toBe(first);
  });
});
