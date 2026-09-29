import { isCentralUuid, parseCentralCreateInput, type CentralCreateInput } from './centralContracts';
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'buildtrack:central-intake-pending:v1';
export class CentralPendingError extends Error {
  constructor() { super('ตรวจหรือเก็บคำขอ Lead ค้างไม่ได้ กรุณาหยุดและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือสร้างคำขอใหม่'); this.name = 'CentralPendingError'; }
}
export function centralPendingKey(actor: string): string {
  if (!isCentralUuid(actor)) throw new CentralPendingError();
  return `${PREFIX}:${actor.toLowerCase()}`;
}
const storage = (target?: PendingStorage) => target ?? window.sessionStorage;
/** One immutable write-ahead command per actor/tab; no token or full customer snapshot. */
export function readCentralPending(actor: string, target?: PendingStorage): CentralCreateInput | null {
  try {
    const raw = storage(target).getItem(centralPendingKey(actor)); if (raw === null) return null;
    if (raw.length > 32768) throw new CentralPendingError();
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 4
      || record.version !== 1 || record.actorUserId !== actor.toLowerCase() || record.uncertain !== true) throw new CentralPendingError();
    return parseCentralCreateInput(record.input);
  } catch { throw new CentralPendingError(); }
}
export function writeCentralPending(actor: string, input: CentralCreateInput, target?: PendingStorage): CentralCreateInput {
  try {
    const store = storage(target), normalized = parseCentralCreateInput(input), previous = readCentralPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new CentralPendingError();
    store.setItem(centralPendingKey(actor), JSON.stringify({ version: 1, actorUserId: actor.toLowerCase(), uncertain: true, input: normalized }));
    if (JSON.stringify(readCentralPending(actor, store)) !== JSON.stringify(normalized)) throw new CentralPendingError();
    return normalized;
  } catch { throw new CentralPendingError(); }
}
export function clearCentralPending(actor: string, input: CentralCreateInput, target?: PendingStorage): void {
  try {
    const store = storage(target), previous = readCentralPending(actor, store);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parseCentralCreateInput(input))) throw new CentralPendingError();
    store.removeItem(centralPendingKey(actor));
    if (store.getItem(centralPendingKey(actor)) !== null) throw new CentralPendingError();
  } catch { throw new CentralPendingError(); }
}
