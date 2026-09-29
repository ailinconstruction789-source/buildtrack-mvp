import { bookingUuid, parseBookingInput, type BookingInput } from './bookingContracts';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:booking-pending:v1';
export class BookingPendingError extends Error {
  constructor() { super('ตรวจหรือเก็บคำขอค้างไม่ได้ กรุณาหยุดบันทึกและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่'); this.name = 'BookingPendingError'; }
}
export const bookingPendingKey = (actorUserId: string) => `${PREFIX}:${bookingUuid(actorUserId)}`;
const storage = (target?: PendingStorage) => target ?? window.sessionStorage;

/** One command per actor/tab, not per customer: switching customers cannot hide a
 * pending write. No tokens or snapshots; new-customer details live in this session
 * receipt only until resolution. Every recovered write-ahead record is uncertain. */
export function readBookingPending(actor: string, target?: PendingStorage): BookingInput | null {
  try {
    const raw = storage(target).getItem(bookingPendingKey(actor));
    if (raw === null) return null;
    if (raw.length > 32768) throw new BookingPendingError();
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 4
      || record.version !== 1 || record.actorUserId !== bookingUuid(actor) || record.uncertain !== true) throw new BookingPendingError();
    return parseBookingInput(record.input);
  } catch { throw new BookingPendingError(); }
}
export function writeBookingPending(actor: string, input: BookingInput, target?: PendingStorage): BookingInput {
  try {
    const store = storage(target), normalized = parseBookingInput(input), previous = readBookingPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new BookingPendingError();
    store.setItem(bookingPendingKey(actor), JSON.stringify({ version: 1, actorUserId: bookingUuid(actor), uncertain: true, input: normalized }));
    if (JSON.stringify(readBookingPending(actor, store)) !== JSON.stringify(normalized)) throw new BookingPendingError();
    return normalized;
  } catch { throw new BookingPendingError(); }
}
export function clearBookingPending(actor: string, input: BookingInput, target?: PendingStorage): void {
  try {
    const store = storage(target), previous = readBookingPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parseBookingInput(input))) throw new BookingPendingError();
    store.removeItem(bookingPendingKey(actor));
    if (store.getItem(bookingPendingKey(actor)) !== null) throw new BookingPendingError();
  } catch { throw new BookingPendingError(); }
}
