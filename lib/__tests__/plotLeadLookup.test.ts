import { describe, expect, it } from 'vitest';
import { buildPlotLeadLookup, orderPlotMatchingLeads, type PlotLeadLookupInput, type PlotLeadMatchInput } from '../plotLeadLookup';
import { normalizeProjectName } from '../salesImportHelper';

interface LeadFixture extends PlotLeadMatchInput {
  id: string;
  customer_name?: string;
}

// Baseline copied from the previous hook: performance changes must not change
// which original row supplies the displayed customer, dates or sale status.
function legacyMatch(leads: readonly LeadFixture[], plot: PlotLeadLookupInput): LeadFixture | null {
  const clean = (name: string) => name.replace(/^(AL\d+|YR|K\d+พิเศษ|K\d+|ไอลิน\s*\d+|โยริว|กานต์รวี\s*\d+)-?/i, '')
    .replace(/^0+/, '').trim();
  const projectName = normalizeProjectName(plot.project_name ?? undefined);
  const plotName = clean(plot.plot_name || plot.id || '');
  const matches = leads.filter(lead => {
    if (lead.status === 'Cancelled' || lead.status === 'Lost') return false;
    if (normalizeProjectName(lead.project_name ?? undefined) !== projectName) return false;
    if (lead.interested_plot_id === plot.id) return true;
    const leadName = clean(lead.interested_plot_name || '');
    return Boolean(plotName && leadName && leadName === plotName);
  });
  return matches.find(lead => lead.status === 'Transferred')
    || matches.find(lead => lead.status === 'Contracted')
    || matches.find(lead => lead.status === 'Reserved' || lead.status === 'Booked' || lead.booking_date)
    || matches[matches.length - 1] || null;
}

const plot: PlotLeadLookupInput = { id: 'P1', plot_name: 'AL6-007', project_name: 'ไอลิน6' };
const lead = (id: string, status: string, extra: Partial<LeadFixture> = {}): LeadFixture => ({
  id, status, project_name: 'AL6', interested_plot_id: 'P1', customer_name: id, ...extra,
});

describe('plot lead lookup compatibility', () => {
  it('keeps Sales Hub row order intact while restoring SQL customer-match ordering', () => {
    const rows = [
      { ...lead('b', 'Booked'), created_at: '2026-01-01T00:00:00+00:00' },
      { ...lead('a', 'Booked'), created_at: '2026-01-01T00:00:00+00:00' },
      { ...lead('old', 'Booked'), created_at: '2025-01-01T00:00:00+00:00' },
    ];
    const sorted = orderPlotMatchingLeads(rows);
    expect(sorted.map(row => row.id)).toEqual(['a', 'b', 'old']);
    expect(rows.map(row => row.id)).toEqual(['b', 'a', 'old']);
    expect(buildPlotLeadLookup(sorted).findForPlot(plot)?.id).toBe('a');
  });

  it('retains microsecond precision, timezone equivalence and DESC NULLS FIRST semantics', () => {
    const rows = [
      { id: 'a', created_at: '2026-01-01T00:00:00.123111+00:00' },
      { id: 'z', created_at: '2026-01-01T00:00:00.123222+00:00' },
      { id: 'b', created_at: '2026-01-01T07:00:00.123222+07:00' },
      { id: 'missing-b', created_at: null },
      { id: 'missing-a', created_at: null },
    ];
    expect(orderPlotMatchingLeads(rows).map(row => row.id)).toEqual(['missing-a', 'missing-b', 'b', 'z', 'a']);
  });
  it.each([
    { statuses: ['Reserved', 'Contracted', 'Transferred'], expected: '2' },
    { statuses: ['Reserved', 'Contracted', 'Contracted'], expected: '1' },
    { statuses: ['Follow-up', 'Booked', 'Reserved'], expected: '1' },
    { statuses: ['Follow-up', 'Considering', 'Nurture'], expected: '2' },
    { statuses: ['Transferred', 'Transferred', 'Contracted'], expected: '0' },
  ])('keeps status priority and existing input order for $statuses', ({ statuses, expected }) => {
    const leads = statuses.map((status, index) => lead(String(index), status));
    expect(buildPlotLeadLookup(leads).findForPlot(plot)).toBe(leads[Number(expected)]);
  });

  it('treats a booking date as booked even when the status is different', () => {
    const leads = [lead('dated', 'Follow-up', { booking_date: '2026-10-01' }), lead('reserved', 'Reserved')];
    expect(buildPlotLeadLookup(leads).findForPlot(plot)).toBe(leads[0]);
  });

  it('merges ID and name matches without preferring an ID match or changing their order', () => {
    const leads = [
      lead('name-first', 'Transferred', { interested_plot_id: 'other', interested_plot_name: '0007' }),
      lead('id-second', 'Transferred'),
      lead('both-last', 'Transferred', { interested_plot_name: 'AL6-007' }),
    ];
    const lookup = buildPlotLeadLookup(leads);
    expect(lookup.findForPlot(plot)).toBe(leads[0]);
    expect(lookup.findForPlot({ ...plot, plot_name: '008' })).toBe(leads[1]);
  });

  it('keeps the last fallback row across both ID and name matches', () => {
    const leads = [
      lead('id-first', 'Follow-up'),
      lead('name-last', 'Considering', { interested_plot_id: 'other', interested_plot_name: '0007' }),
    ];
    expect(buildPlotLeadLookup(leads).findForPlot(plot)).toBe(leads[1]);
  });

  it('excludes Cancelled/Lost and isolates the normalized project', () => {
    const leads = [
      lead('cancelled', 'Cancelled'), lead('lost', 'Lost'),
      lead('other-project', 'Transferred', { project_name: 'AL4' }), lead('active', 'Reserved'),
    ];
    expect(buildPlotLeadLookup(leads).findForPlot(plot)).toBe(leads[3]);
    expect(buildPlotLeadLookup(leads.slice(0, 3)).findForPlot(plot)).toBeNull();
  });

  it.each(['AL6-007', 'YR-007', 'K2พิเศษ-007', 'ไอลิน 6-007', 'โยริว-007', 'กานต์รวี 2-007', '0007'])(
    'keeps plot name normalization for %s', name => {
      const row = lead('name', 'Booked', { interested_plot_id: 'other', interested_plot_name: name });
      expect(buildPlotLeadLookup([row]).findForPlot(plot)).toBe(row);
    },
  );

  it('does not match empty normalized names and still accepts an exact ID', () => {
    const row = lead('empty-name', 'Reserved', { interested_plot_name: '000' });
    const lookup = buildPlotLeadLookup([row]);
    expect(lookup.findForPlot({ ...plot, id: 'different', plot_name: '000' })).toBeNull();
    expect(lookup.findForPlot({ ...plot, plot_name: '000' })).toBe(row);
  });

  it('preserves the default project and missing-ID behavior', () => {
    const row = lead('missing', 'Follow-up', { project_name: null, interested_plot_id: undefined });
    expect(buildPlotLeadLookup([row]).findForPlot({ project_name: undefined })).toBe(row);
  });

  it('matches the previous algorithm over mixed projects, aliases, statuses and ID/name collisions', () => {
    const projects = ['AL6', 'ไอลิน6', 'AL4', 'ไอลิน 4', 'custom|project', null];
    const statuses = ['Transferred', 'Contracted', 'Reserved', 'Booked', 'Follow-up', 'Cancelled', 'Lost', 'cancelled'];
    const leads: LeadFixture[] = Array.from({ length: 1200 }, (_, index) => ({
      id: String(index), project_name: projects[index % projects.length],
      interested_plot_id: index % 4 ? `P${index % 120}` : null,
      interested_plot_name: index % 3 ? `AL6-${String(index % 120).padStart(3, '0')}` : '',
      status: statuses[index % statuses.length], booking_date: index % 11 ? null : '2026-10-01',
    }));
    const before = JSON.stringify(leads);
    const lookup = buildPlotLeadLookup(leads);
    for (let index = 0; index < 120; index++) {
      const candidate = { id: `P${index}`, plot_name: String(index), project_name: projects[index % projects.length] };
      expect(lookup.findForPlot(candidate)).toBe(legacyMatch(leads, candidate));
    }
    expect(JSON.stringify(leads)).toBe(before);
  });

  it('normalizes each lead once rather than once for every plot', () => {
    let leadProjectReads = 0;
    const leads = Array.from({ length: 5000 }, (_, index) => ({
      id: String(index), status: 'Reserved', interested_plot_id: `P${index % 500}`,
      get project_name() { leadProjectReads++; return 'AL6'; },
    }));
    const lookup = buildPlotLeadLookup(leads);
    for (let index = 0; index < 500; index++) {
      expect(lookup.findForPlot({ id: `P${index}`, project_name: 'ไอลิน6' })?.id).toBe(String(index));
    }
    expect(leadProjectReads).toBe(5000);
  });
});
