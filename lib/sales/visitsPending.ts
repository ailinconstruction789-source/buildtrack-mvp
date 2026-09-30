import { bookingUuid } from './bookingContracts';
import { parseVisitsInput, type VisitsInput } from './visitsContracts';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:visits-pending:v1';
export class VisitsPendingError extends Error {
  constructor() { super('ตรวจหรือเก็บคำขอค้างไม่ได้ กรุณาหยุดบันทึกและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่'); this.name = 'VisitsPendingError'; }
}
export const visitsPendingKey = (actor: string) => `${PREFIX}:${bookingUuid(actor)}`;
const storage = (target?: PendingStorage) => target ?? window.sessionStorage;
/** One immutable write-ahead command per actor/tab, not per customer or project. No tokens or snapshots. */
export function readVisitsPending(actor: string, target?: PendingStorage): VisitsInput | null {
  try {
    const raw = storage(target).getItem(visitsPendingKey(actor)); if (raw === null) return null;
    if (raw.length > 32768) throw new VisitsPendingError();
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 4
      || record.version !== 1 || record.actorUserId !== bookingUuid(actor) || record.uncertain !== true) throw new VisitsPendingError();
    return parseVisitsInput(record.input);
  } catch { throw new VisitsPendingError(); }
}
export function writeVisitsPending(actor: string, input: VisitsInput, target?: PendingStorage): VisitsInput {
  try {
    const store = storage(target), normalized = parseVisitsInput(input), previous = readVisitsPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new VisitsPendingError();
    store.setItem(visitsPendingKey(actor), JSON.stringify({ version: 1, actorUserId: bookingUuid(actor), uncertain: true, input: normalized }));
    if (JSON.stringify(readVisitsPending(actor, store)) !== JSON.stringify(normalized)) throw new VisitsPendingError();
    return normalized;
  } catch { throw new VisitsPendingError(); }
}
export function clearVisitsPending(actor: string, input: VisitsInput, target?: PendingStorage): void {
  try {
    const store = storage(target), previous = readVisitsPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parseVisitsInput(input))) throw new VisitsPendingError();
    store.removeItem(visitsPendingKey(actor));
    if (store.getItem(visitsPendingKey(actor)) !== null) throw new VisitsPendingError();
  } catch { throw new VisitsPendingError(); }
}
