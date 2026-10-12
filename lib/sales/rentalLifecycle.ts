import { parseTransferDate } from './postBookingContracts';
/** Calendar months, clamped to the last valid day; January 31 + 1 is February 28/29. */
export function extendRentalLeaseEnd(end: string, months: number): string {
  parseTransferDate(end);
  if (!Number.isSafeInteger(months) || months < 1 || months > 120) throw new Error('ระยะเวลาต่อสัญญาต้องเป็นจำนวนเต็ม 1–120 เดือน');
  const [year, month, day] = end.split('-').map(Number);
  const index = year * 12 + month - 1 + months;
  const nextYear = Math.floor(index / 12), nextMonth = index % 12 + 1;
  const last = [31, nextYear % 4 === 0 && (nextYear % 100 !== 0 || nextYear % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][nextMonth - 1];
  return parseTransferDate(`${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`);
}
export function rentalLifecycleActions(status: string): readonly ('renew' | 'convert_to_buy' | 'move_out')[] {
  return ['Active', 'Renewed'].includes(status) ? ['renew', 'convert_to_buy', 'move_out'] : [];
}
