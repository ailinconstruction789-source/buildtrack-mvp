/** Read-only provenance; archive UUIDs are identities, never inferred links. */
export const WORKSPACE_READ_CONTRACT_VERSION = 'source_membership_workspace_v1';
export interface SourceMembershipMetadata { active: boolean; revisionId: string | null; originalLegacyLeadIds: string[]; legacyScopeIncluded?: boolean }
export interface WorkspaceHistoryMetadata { sourceKind?: 'reviewed_import' | 'native'; visitHistoryDate?: string | null }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export function parseSourceMembershipMetadata(value: unknown): SourceMembershipMetadata | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid workspace source metadata');
  const row = value as Record<string, unknown>;
  if (typeof row.active !== 'boolean' || !Array.isArray(row.originalLegacyLeadIds) || row.originalLegacyLeadIds.length > 10000
    || row.originalLegacyLeadIds.some(id => !uuid(id)) || new Set(row.originalLegacyLeadIds).size !== row.originalLegacyLeadIds.length
    || (row.active ? !uuid(row.revisionId) : row.revisionId !== null || row.originalLegacyLeadIds.length !== 0)) throw Error('Invalid workspace source metadata');
  if (row.legacyScopeIncluded !== undefined && (typeof row.legacyScopeIncluded !== 'boolean'
    || (row.legacyScopeIncluded && !row.active) || (!row.legacyScopeIncluded && row.originalLegacyLeadIds.length !== 0))) throw Error('Invalid workspace archive scope');
  return { active: row.active, revisionId: row.revisionId as string | null, originalLegacyLeadIds: [...row.originalLegacyLeadIds] as string[],
    ...(row.legacyScopeIncluded === undefined ? {} : { legacyScopeIncluded: row.legacyScopeIncluded as boolean }) };
}
export function parseWorkspaceDay(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw Error('Invalid workspace evidence day');
  return value;
}
export function parseWorkspaceHistoryMetadata(row: Record<string, unknown>): WorkspaceHistoryMetadata {
  if (row.sourceKind === undefined && row.visitHistoryDate === undefined) return {};
  if (!['reviewed_import', 'native'].includes(String(row.sourceKind)) || !Object.hasOwn(row, 'visitHistoryDate')) throw Error('Invalid workspace history provenance');
  return { sourceKind: row.sourceKind as 'reviewed_import' | 'native', visitHistoryDate: parseWorkspaceDay(row.visitHistoryDate) };
}
