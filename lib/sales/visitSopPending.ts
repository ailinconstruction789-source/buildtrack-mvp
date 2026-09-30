import { bookingUuid } from './bookingContracts';
import { parseVisitSopInput, type VisitSopInput } from './visitSopContracts';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:visit-sop-pending:v1';
export class VisitSopPendingError extends Error {
  constructor() { super('ตรวจหรือเก็บคำขอ SOP ค้างไม่ได้ กรุณาหยุดและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือสร้างคำขอใหม่'); this.name = 'VisitSopPendingError'; }
}
export const visitSopPendingKey = (actor: string) => `${PREFIX}:${bookingUuid(actor)}`;
const storage = (target?: PendingStorage) => target ?? window.sessionStorage;
function immutable(input: VisitSopInput): VisitSopInput {
  if (input.command === 'save_stage' || input.command === 'complete_stage') {
    for (const answer of input.answers) Object.freeze(answer);
    Object.freeze(input.answers); if (input.recap) Object.freeze(input.recap);
  } return Object.freeze(input);
}
/** One deep-frozen write-ahead command per actor/tab. No token or snapshot;
 * checklist/recap evidence exists in session storage only until resolution. */
export function readVisitSopPending(actor: string, target?: PendingStorage): VisitSopInput | null {
  try {
    const raw = storage(target).getItem(visitSopPendingKey(actor)); if (raw === null) return null;
    if (raw.length > 131072) throw new VisitSopPendingError();
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 4
      || record.version !== 1 || record.actorUserId !== bookingUuid(actor) || record.uncertain !== true) throw new VisitSopPendingError();
    return immutable(parseVisitSopInput(record.input));
  } catch { throw new VisitSopPendingError(); }
}
export function writeVisitSopPending(actor: string, input: VisitSopInput, target?: PendingStorage): VisitSopInput {
  try {
    const store = storage(target), normalized = parseVisitSopInput(input), previous = readVisitSopPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new VisitSopPendingError();
    store.setItem(visitSopPendingKey(actor), JSON.stringify({ version: 1, actorUserId: bookingUuid(actor), uncertain: true, input: normalized }));
    if (JSON.stringify(readVisitSopPending(actor, store)) !== JSON.stringify(normalized)) throw new VisitSopPendingError();
    return immutable(normalized);
  } catch { throw new VisitSopPendingError(); }
}
export function clearVisitSopPending(actor: string, input: VisitSopInput, target?: PendingStorage): void {
  try {
    const store = storage(target), previous = readVisitSopPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parseVisitSopInput(input))) throw new VisitSopPendingError();
    store.removeItem(visitSopPendingKey(actor)); if (store.getItem(visitSopPendingKey(actor)) !== null) throw new VisitSopPendingError();
  } catch { throw new VisitSopPendingError(); }
}
