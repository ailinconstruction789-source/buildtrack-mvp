import { bookingUuid } from './bookingContracts';
import { parseProjectInterestInput, type ProjectInterestInput } from './projectInterestsContracts';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:project-interests-pending:v1';
export class ProjectInterestsPendingError extends Error {
  constructor() { super('ตรวจหรือเก็บคำขอเพิ่มโครงการค้างไม่ได้ กรุณาหยุดและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือสร้างคำขอใหม่'); this.name = 'ProjectInterestsPendingError'; }
}
export const projectInterestsPendingKey = (actor: string) => `${PREFIX}:${bookingUuid(actor)}`;
const storage = (target?: PendingStorage) => target ?? window.sessionStorage;
/** One immutable command per actor/tab, across customers. No token or snapshot.
 * Every recovered write-ahead receipt is uncertain, even if closed before send. */
export function readProjectInterestsPending(actor: string, target?: PendingStorage): ProjectInterestInput | null {
  try {
    const raw = storage(target).getItem(projectInterestsPendingKey(actor)); if (raw === null) return null;
    if (raw.length > 32768) throw new ProjectInterestsPendingError();
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 4
      || record.version !== 1 || record.actorUserId !== bookingUuid(actor) || record.uncertain !== true) throw new ProjectInterestsPendingError();
    return Object.freeze(parseProjectInterestInput(record.input));
  } catch { throw new ProjectInterestsPendingError(); }
}
export function writeProjectInterestsPending(actor: string, input: ProjectInterestInput, target?: PendingStorage): ProjectInterestInput {
  try {
    const store = storage(target), normalized = parseProjectInterestInput(input), previous = readProjectInterestsPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new ProjectInterestsPendingError();
    store.setItem(projectInterestsPendingKey(actor), JSON.stringify({ version: 1, actorUserId: bookingUuid(actor), uncertain: true, input: normalized }));
    if (JSON.stringify(readProjectInterestsPending(actor, store)) !== JSON.stringify(normalized)) throw new ProjectInterestsPendingError();
    return Object.freeze(normalized);
  } catch { throw new ProjectInterestsPendingError(); }
}
export function clearProjectInterestsPending(actor: string, input: ProjectInterestInput, target?: PendingStorage): void {
  try {
    const store = storage(target), previous = readProjectInterestsPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parseProjectInterestInput(input))) throw new ProjectInterestsPendingError();
    store.removeItem(projectInterestsPendingKey(actor));
    if (store.getItem(projectInterestsPendingKey(actor)) !== null) throw new ProjectInterestsPendingError();
  } catch { throw new ProjectInterestsPendingError(); }
}
