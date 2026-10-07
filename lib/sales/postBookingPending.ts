import { bookingUuid } from './bookingContracts';
import { parsePostBookingInput, type PostBookingInput } from './postBookingContracts';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:post-booking-pending:v1';
export class PostBookingPendingError extends Error {
  constructor() { super('ตรวจหรือเก็บคำขอค้างไม่ได้ กรุณาหยุดบันทึกและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่'); this.name = 'PostBookingPendingError'; }
}
export const postBookingPendingKey = (actor: string) => `${PREFIX}:${bookingUuid(actor)}`;
const storage = (target?: PendingStorage) => target ?? window.sessionStorage;
/** One immutable write-ahead command per actor/tab, not per sale. No tokens or snapshots. */
export function readPostBookingPending(actor: string, target?: PendingStorage): PostBookingInput | null {
  try {
    const raw = storage(target).getItem(postBookingPendingKey(actor)); if (raw === null) return null;
    if (raw.length > 32768) throw new PostBookingPendingError();
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 4
      || record.version !== 1 || record.actorUserId !== bookingUuid(actor) || record.uncertain !== true) throw new PostBookingPendingError();
    return parsePostBookingInput(record.input);
  } catch { throw new PostBookingPendingError(); }
}
export function writePostBookingPending(actor: string, input: PostBookingInput, target?: PendingStorage): PostBookingInput {
  try {
    const store = storage(target), normalized = parsePostBookingInput(input), previous = readPostBookingPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new PostBookingPendingError();
    store.setItem(postBookingPendingKey(actor), JSON.stringify({ version: 1, actorUserId: bookingUuid(actor), uncertain: true, input: normalized }));
    if (JSON.stringify(readPostBookingPending(actor, store)) !== JSON.stringify(normalized)) throw new PostBookingPendingError();
    return normalized;
  } catch { throw new PostBookingPendingError(); }
}
export function clearPostBookingPending(actor: string, input: PostBookingInput, target?: PendingStorage): void {
  try {
    const store = storage(target), previous = readPostBookingPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parsePostBookingInput(input))) throw new PostBookingPendingError();
    store.removeItem(postBookingPendingKey(actor));
    if (store.getItem(postBookingPendingKey(actor)) !== null) throw new PostBookingPendingError();
  } catch { throw new PostBookingPendingError(); }
}
