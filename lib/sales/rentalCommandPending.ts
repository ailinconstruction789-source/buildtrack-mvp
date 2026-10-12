import { bookingUuid } from './bookingContracts';
import { parseRentalCommandInput, type RentalCommandInput } from './rentalCommandContracts';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:rental-command-pending:v1';
export class RentalCommandPendingError extends Error {
  constructor() { super('ตรวจหรือเก็บคำขอค้างไม่ได้ กรุณาหยุดบันทึกและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่'); this.name = 'RentalCommandPendingError'; }
}
export const rentalCommandPendingKey = (actor: string) => `${PREFIX}:${bookingUuid(actor)}`;
const storage = (target?: PendingStorage) => target ?? window.sessionStorage;
/** One immutable write-ahead command per actor/tab, not per contract. No tokens or snapshots. */
export function readRentalCommandPending(actor: string, target?: PendingStorage): RentalCommandInput | null {
  try {
    const raw = storage(target).getItem(rentalCommandPendingKey(actor)); if (raw === null) return null;
    if (raw.length > 32768) throw new RentalCommandPendingError();
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 4
      || record.version !== 1 || record.actorUserId !== bookingUuid(actor) || record.uncertain !== true) throw new RentalCommandPendingError();
    return parseRentalCommandInput(record.input);
  } catch { throw new RentalCommandPendingError(); }
}
export function writeRentalCommandPending(actor: string, input: RentalCommandInput, target?: PendingStorage): RentalCommandInput {
  try {
    const store = storage(target), normalized = parseRentalCommandInput(input), previous = readRentalCommandPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new RentalCommandPendingError();
    store.setItem(rentalCommandPendingKey(actor), JSON.stringify({ version: 1, actorUserId: bookingUuid(actor), uncertain: true, input: normalized }));
    if (JSON.stringify(readRentalCommandPending(actor, store)) !== JSON.stringify(normalized)) throw new RentalCommandPendingError();
    return normalized;
  } catch { throw new RentalCommandPendingError(); }
}
export function clearRentalCommandPending(actor: string, input: RentalCommandInput, target?: PendingStorage): void {
  try {
    const store = storage(target), previous = readRentalCommandPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parseRentalCommandInput(input))) throw new RentalCommandPendingError();
    store.removeItem(rentalCommandPendingKey(actor));
    if (store.getItem(rentalCommandPendingKey(actor)) !== null) throw new RentalCommandPendingError();
  } catch { throw new RentalCommandPendingError(); }
}
