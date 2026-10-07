import { bookingRecord, bookingUuid } from './bookingContracts';
import type { CrmRole } from './workflow';

export const PROJECT_INTERESTS_CONTRACT_VERSION = 'project_interests_v1';
export const PROJECT_INTERESTS_MAX_BYTES = 16384;
export interface ProjectInterestInput {
  requestId: string; customerId: string; expectedCustomerRevision: string; projectName: string; plotId: string | null; reason: string;
}
export interface ProjectInterestResult {
  requestId: string; customerId: string; interestId: string; interestRevision: string; ownerUserId: string;
  projectName: string; plotId: string | null; eventId: string; replayed: boolean;
}
export interface ProjectInterestsScope { customerId: string; page: number }
export interface ProjectInterestsSnapshot {
  actor: { userId: string; role: CrmRole };
  customer: { id: string; name: string; ownerUserId: string; revision: string; intakeStatus: string; canAdd: boolean };
  projects: { name: string }[]; projectsHasMore: boolean;
  interests: { id: string; projectName: string; ownerUserId: string; revision: string; status: string; plotId: string | null }[];
  page: number; hasMore: boolean;
}
export class ProjectInterestsInputError extends Error {
  constructor(message = 'ข้อมูลโครงการที่สนใจไม่ถูกต้อง กรุณาตรวจสอบ') { super(message); this.name = 'ProjectInterestsInputError'; }
}
const invalid = (message?: string): never => { throw new ProjectInterestsInputError(message); };
const rec = (value: unknown) => { try { return bookingRecord(value); } catch { return invalid(); } };
const uuid = (value: unknown) => { try { return bookingUuid(value); } catch { return invalid('รหัสอ้างอิงไม่ถูกต้อง'); } };
function exact(raw: Record<string, unknown>, keys: string[]) {
  if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) invalid();
}
function line(value: unknown, max: number, trim = false): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).some(char => {
    const code = char.charCodeAt(0);
    return code <= 31 || code >= 127 && code <= 159 || code === 0x2028 || code === 0x2029 || char.length === 1 && code >= 0xd800 && code <= 0xdfff;
  })) return invalid('กรุณาระบุข้อความบรรทัดเดียวที่ถูกต้อง');
  const result = trim ? value.trim() : value;
  if (Array.from(result).length > max) invalid('ข้อความยาวเกินกำหนด');
  return result;
}
const plot = (value: unknown) => value === null ? null : line(value, 255);
const bool = (value: unknown) => typeof value === 'boolean' ? value : invalid();
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : invalid();
}
// Read projection only. Do not add historical unknown to command-input statuses.
const interestStates = ['new', 'contacted', 'considering', 'follow_up', 'nurture', 'lost', 'legacy_unclassified'] as const;
const pageNumber = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000 ? value : invalid();
export function parseProjectInterestsScope(value: unknown): ProjectInterestsScope {
  const raw = rec(value); exact(raw, ['customerId', 'page']); return { customerId: uuid(raw.customerId), page: pageNumber(raw.page) };
}
export function parseProjectInterestsQuery(url: string): ProjectInterestsScope {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) if (!['customerId', 'page'].includes(key) || params.getAll(key).length !== 1) invalid();
  const page = params.get('page') ?? '0'; if (!/^(0|[1-9]\d{0,5})$/.test(page)) invalid();
  return parseProjectInterestsScope({ customerId: params.get('customerId'), page: Number(page) });
}
export function parseProjectInterestsPageQuery(value: Record<string, string | string[] | undefined>): string {
  exact(value, ['customerId']); return uuid(value.customerId);
}
export function parseProjectInterestInput(value: unknown): ProjectInterestInput {
  const raw = rec(value); exact(raw, ['requestId', 'customerId', 'expectedCustomerRevision', 'projectName', 'plotId', 'reason']);
  return { requestId: uuid(raw.requestId), customerId: uuid(raw.customerId), expectedCustomerRevision: uuid(raw.expectedCustomerRevision),
    projectName: line(raw.projectName, 200), plotId: plot(raw.plotId), reason: line(raw.reason, 1000, true) };
}
export function parseProjectInterestResult(value: unknown, input: ProjectInterestInput): ProjectInterestResult {
  const raw = rec(value);
  const result: ProjectInterestResult = { requestId: uuid(raw.requestId), customerId: uuid(raw.customerId), interestId: uuid(raw.interestId),
    interestRevision: uuid(raw.interestRevision), ownerUserId: uuid(raw.ownerUserId), projectName: line(raw.projectName, 200),
    plotId: plot(raw.plotId), eventId: uuid(raw.eventId), replayed: bool(raw.replayed) };
  if (result.requestId !== input.requestId || result.customerId !== input.customerId || result.projectName !== input.projectName || result.plotId !== input.plotId) invalid();
  return result;
}
export function parseProjectInterestsSnapshot(value: unknown, expected: ProjectInterestsScope): ProjectInterestsSnapshot {
  const raw = rec(value), actor = rec(raw.actor), customer = rec(raw.customer);
  const result: ProjectInterestsSnapshot = {
    actor: { userId: uuid(actor.userId), role: choice(actor.role, ['sales', 'admin', 'owner']) },
    customer: { id: uuid(customer.id), name: line(customer.name, 200), ownerUserId: uuid(customer.ownerUserId), revision: uuid(customer.revision),
      intakeStatus: choice(customer.intakeStatus, ['new', 'contacted', 'following_up', 'nurture', 'lost', 'legacy_unclassified']), canAdd: bool(customer.canAdd) },
    projects: [], projectsHasMore: bool(raw.projectsHasMore), interests: [], page: pageNumber(raw.page), hasMore: bool(raw.hasMore),
  };
  if (result.customer.id !== expected.customerId || result.page !== expected.page
    || result.customer.canAdd && (result.actor.role === 'owner' || result.customer.intakeStatus === 'lost'
      || result.actor.role === 'sales' && result.actor.userId !== result.customer.ownerUserId)) invalid();
  if (!Array.isArray(raw.projects) || raw.projects.length > 200 || result.projectsHasMore && raw.projects.length !== 200
    || !Array.isArray(raw.interests) || raw.interests.length > 50 || result.hasMore && raw.interests.length !== 50) invalid();
  result.projects = (raw.projects as unknown[]).map(value => ({ name: line(rec(value).name, 200) }));
  result.interests = (raw.interests as unknown[]).map(value => {
    const item = rec(value); return { id: uuid(item.id), projectName: line(item.projectName, 200), ownerUserId: uuid(item.ownerUserId),
      revision: uuid(item.revision), status: choice(item.status, interestStates), plotId: plot(item.plotId) };
  });
  if (new Set(result.projects.map(item => item.name)).size !== result.projects.length
    || new Set(result.interests.map(item => item.id)).size !== result.interests.length
    || new Set(result.interests.map(item => item.projectName)).size !== result.interests.length
    || result.projects.some(project => result.interests.some(interest => interest.projectName === project.name))) invalid();
  return result;
}
