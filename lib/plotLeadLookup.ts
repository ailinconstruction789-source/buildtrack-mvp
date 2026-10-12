import { normalizeProjectName } from './salesNames';

/** Match the shell's SQL order while retaining the Sales Hub's original row order.
 * PostgreSQL timestamps retain microseconds; Date alone would lose that precision.
 */
export function orderPlotMatchingLeads<T extends Record<string, unknown>>(rows: readonly T[]): T[] {
  return rows.map(row => {
    const createdAt = typeof row.created_at === 'string' ? row.created_at : null;
    const fraction = createdAt?.match(/\.(\d+)/)?.[1] || '';
    return { row, time: createdAt === null ? null : Date.parse(createdAt),
      microseconds: Number(fraction.padEnd(6, '0').slice(3, 6)), id: String(row.id || '') };
  }).sort((a, b) => {
    if (a.time === null && b.time !== null) return -1;
    if (a.time !== null && b.time === null) return 1;
    const byDate = (b.time ?? 0) - (a.time ?? 0) || b.microseconds - a.microseconds;
    if (byDate) return byDate;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }).map(entry => entry.row);
}

export interface PlotLeadMatchInput {
  project_name?: string | null;
  interested_plot_id?: string | null;
  interested_plot_name?: string | null;
  status?: string | null;
  booking_date?: string | null;
}

export interface PlotLeadLookupInput {
  id?: string | null;
  plot_name?: string | null;
  project_name?: string | null;
}

interface IndexedLead<T> {
  lead: T;
  position: number;
}

interface LeadCandidates<T> {
  transferred?: IndexedLead<T>;
  contracted?: IndexedLead<T>;
  booked?: IndexedLead<T>;
  last?: IndexedLead<T>;
}

interface ProjectLeadLookup<T> {
  byId: Map<PlotLeadMatchInput['interested_plot_id'], LeadCandidates<T>>;
  byName: Map<string, LeadCandidates<T>>;
}

function cleanPlotName(name: string): string {
  return name.replace(/^(AL\d+|YR|K\d+พิเศษ|K\d+|ไอลิน\s*\d+|โยริว|กานต์รวี\s*\d+)-?/i, '')
    .replace(/^0+/, '').trim();
}

function earlier<T>(a?: IndexedLead<T>, b?: IndexedLead<T>): IndexedLead<T> | undefined {
  if (!a || !b) return a ?? b;
  return a.position <= b.position ? a : b;
}

function later<T>(a?: IndexedLead<T>, b?: IndexedLead<T>): IndexedLead<T> | undefined {
  if (!a || !b) return a ?? b;
  return a.position >= b.position ? a : b;
}

function addCandidate<T extends PlotLeadMatchInput, K>(
  map: Map<K, LeadCandidates<T>>, key: K, candidate: IndexedLead<T>,
): void {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = {};
    map.set(key, bucket);
  }
  const { lead } = candidate;
  if (lead.status === 'Transferred' && !bucket.transferred) bucket.transferred = candidate;
  if (lead.status === 'Contracted' && !bucket.contracted) bucket.contracted = candidate;
  if ((lead.status === 'Reserved' || lead.status === 'Booked' || lead.booking_date) && !bucket.booked) {
    bucket.booked = candidate;
  }
  bucket.last = candidate;
}

/** Index one fetch's leads once; preserve the existing status priority and input order. */
export function buildPlotLeadLookup<T extends PlotLeadMatchInput>(leads: readonly T[]): {
  findForPlot: (plot: PlotLeadLookupInput) => T | null;
} {
  const projects = new Map<string, ProjectLeadLookup<T>>();
  leads.forEach((lead, position) => {
    if (lead.status === 'Cancelled' || lead.status === 'Lost') return;
    const projectName = normalizeProjectName(lead.project_name ?? undefined);
    let project = projects.get(projectName);
    if (!project) {
      project = { byId: new Map(), byName: new Map() };
      projects.set(projectName, project);
    }
    const candidate = { lead, position };
    addCandidate(project.byId, lead.interested_plot_id, candidate);
    const plotName = cleanPlotName(lead.interested_plot_name || '');
    if (plotName) addCandidate(project.byName, plotName, candidate);
  });

  return {
    findForPlot(plot) {
      const project = projects.get(normalizeProjectName(plot.project_name ?? undefined));
      if (!project) return null;
      const byId = project.byId.get(plot.id);
      const plotName = cleanPlotName(plot.plot_name || plot.id || '');
      const byName = plotName ? project.byName.get(plotName) : undefined;
      // ID and name matches form one candidate set. Keep the first row at each
      // priority, and the last matching row for the legacy fallback.
      const selected = earlier(byId?.transferred, byName?.transferred)
        ?? earlier(byId?.contracted, byName?.contracted)
        ?? earlier(byId?.booked, byName?.booked)
        ?? later(byId?.last, byName?.last);
      return selected?.lead ?? null;
    },
  };
}
