import { bookingUuid } from './bookingContracts';
import { parseCustomerDealEditInput, type CustomerDealEditInput } from './customerDealEditContracts';

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:customer-deal-details-pending:v1';
export class CustomerDealEditPendingError extends Error {
  constructor() { super('ตรวจหรือเก็บคำขอค้างไม่ได้ กรุณาหยุดบันทึกและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่'); this.name = 'CustomerDealEditPendingError'; }
}
export const customerDealEditPendingKey = (actor: string) => `${PREFIX}:${bookingUuid(actor)}`;
const storage = (target?: PendingStorage) => target ?? window.sessionStorage;
/** One immutable write-ahead command per actor/tab, not per sale. No tokens or snapshots. */
export function readCustomerDealEditPending(actor: string, target?: PendingStorage): CustomerDealEditInput | null {
  try {
    const raw = storage(target).getItem(customerDealEditPendingKey(actor)); if (raw === null) return null;
    if (raw.length > 32768) throw new CustomerDealEditPendingError();
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 4
      || record.version !== 1 || record.actorUserId !== bookingUuid(actor) || record.uncertain !== true) throw new CustomerDealEditPendingError();
    return parseCustomerDealEditInput(record.input);
  } catch { throw new CustomerDealEditPendingError(); }
}
export function writeCustomerDealEditPending(actor: string, input: CustomerDealEditInput, target?: PendingStorage): CustomerDealEditInput {
  try {
    const store = storage(target), normalized = parseCustomerDealEditInput(input), previous = readCustomerDealEditPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new CustomerDealEditPendingError();
    store.setItem(customerDealEditPendingKey(actor), JSON.stringify({ version: 1, actorUserId: bookingUuid(actor), uncertain: true, input: normalized }));
    if (JSON.stringify(readCustomerDealEditPending(actor, store)) !== JSON.stringify(normalized)) throw new CustomerDealEditPendingError();
    return normalized;
  } catch { throw new CustomerDealEditPendingError(); }
}
export function clearCustomerDealEditPending(actor: string, input: CustomerDealEditInput, target?: PendingStorage): void {
  try {
    const store = storage(target), previous = readCustomerDealEditPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parseCustomerDealEditInput(input))) throw new CustomerDealEditPendingError();
    store.removeItem(customerDealEditPendingKey(actor));
    if (store.getItem(customerDealEditPendingKey(actor)) !== null) throw new CustomerDealEditPendingError();
  } catch { throw new CustomerDealEditPendingError(); }
}
