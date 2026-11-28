import { supabase } from '@/lib/supabase';
import { canEditSalesRole } from './leadStage';
import { broadcastSalesSync, type SalesSyncDetail } from './salesSyncBroadcast';
import type { RentalProgramType } from '@/types/sales';

export type SalesTxErrorCode =
  | 'SALES_TX_AUTH_REQUIRED'
  | 'SALES_TX_FORBIDDEN'
  | 'SALES_TX_INVALID_INPUT'
  | 'SALES_TX_PROJECT_UNAVAILABLE'
  | 'SALES_TX_PROJECT_MISMATCH'
  | 'SALES_TX_LEAD_NOT_FOUND'
  | 'SALES_TX_CONTRACT_NOT_FOUND'
  | 'SALES_TX_PLOT_NOT_FOUND'
  | 'SALES_TX_PLOT_AMBIGUOUS'
  | 'SALES_TX_PLOT_UNAVAILABLE'
  | 'SALES_TX_PLOT_HELD_BY_OTHER'
  | 'SALES_TX_IDENTITY_MISMATCH'
  | 'SALES_TX_STALE_STATE'
  | 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL'
  | 'SALES_TX_ALREADY_CANCELLED'
  | 'SALES_TX_IDEMPOTENCY_CONFLICT'
  | 'SALES_TX_CONFLICT'
  | 'SALES_TX_RPC_NOT_INSTALLED'
  | 'SALES_TX_UNKNOWN';

export class SalesTxError extends Error {
  readonly code: SalesTxErrorCode;
  readonly isStaleState: boolean;
  readonly isAlreadyCancelled: boolean;
  readonly isRetryable: boolean;
  readonly rawMessage: string;

  constructor(
    code: SalesTxErrorCode,
    message: string,
    opts?: {
      isStaleState?: boolean;
      isAlreadyCancelled?: boolean;
      isRetryable?: boolean;
      rawMessage?: string;
    }
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'SalesTxError';
    this.code = code;
    this.isStaleState = Boolean(opts?.isStaleState);
    this.isAlreadyCancelled = Boolean(opts?.isAlreadyCancelled);
    this.isRetryable = Boolean(opts?.isRetryable);
    this.rawMessage = opts?.rawMessage || message;
  }
}

export function createTxRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new SalesTxError(
    'SALES_TX_INVALID_INPUT',
    'ไม่สามารถสร้างรหัสคำขอธุรกรรม (requestId) ได้ กรุณาใช้เบราว์เซอร์ที่รองรับ Web Crypto API'
  );
}

export function isAdminWriteRole(role: unknown): boolean {
  if (typeof role !== 'string') return false;
  const normalized = role.trim().toLowerCase();
  return normalized === 'admin' || normalized === 'administrator' || normalized === 'superadmin';
}

function assertSalesWriteRole(actorRole: unknown): void {
  if (actorRole !== undefined && !canEditSalesRole(actorRole)) {
    throw new SalesTxError(
      'SALES_TX_FORBIDDEN',
      'บัญชีของคุณมีสิทธิ์ดูข้อมูลอย่างเดียว ไม่สามารถทำรายการแก้ไขได้'
    );
  }
}

function assertAdminWriteRole(actorRole: unknown): void {
  if (!isAdminWriteRole(actorRole)) {
    throw new SalesTxError(
      'SALES_TX_FORBIDDEN',
      'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถดำเนินการปลดแปลง Legacy หรือลบข้อมูลได้'
    );
  }
}

function extractRawErrorText(error: unknown): { code: string; message: string } {
  if (!error) return { code: '', message: '' };
  if (error instanceof SalesTxError) {
    return { code: error.code, message: error.rawMessage };
  }
  if (error instanceof Error) {
    return { code: '', message: error.message || '' };
  }
  const obj = error as Record<string, unknown>;
  const code = typeof obj.code === 'string' ? obj.code : '';
  const parts = [obj.message, obj.details, obj.hint]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return { code, message: parts.join(' | ') };
}

export function translateSalesTxError(error: unknown): SalesTxError {
  if (error instanceof SalesTxError) return error;
  const { code, message } = extractRawErrorText(error);
  const haystack = `${code} ${message}`;

  if (haystack.includes('SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL')) {
    return new SalesTxError(
      'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL',
      'สัญญานี้เปลี่ยนเป็นสัญญาเช่าที่มีผลบังคับใช้ (Active) แล้ว ไม่สามารถยกเลิกด้วยคำสั่งยกเลิกจองเช่าได้ กรุณาโหลดข้อมูลใหม่และใช้เมนูจัดการสัญญาเช่า',
      { isStaleState: true, rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_ALREADY_CANCELLED')) {
    return new SalesTxError(
      'SALES_TX_ALREADY_CANCELLED',
      'รายการนี้ถูกยกเลิกไปแล้ว กรุณาโหลดข้อมูลใหม่',
      { isStaleState: true, isAlreadyCancelled: true, rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_STALE_STATE')) {
    return new SalesTxError(
      'SALES_TX_STALE_STATE',
      'ข้อมูลรายการนี้มีการเปลี่ยนแปลงระหว่างเปิดหน้าจอ (เช่น เปลี่ยนจากรอทำสัญญาเป็นทำสัญญาแล้ว) กรุณาโหลดข้อมูลใหม่ก่อนทำรายการ',
      { isStaleState: true, rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_PLOT_HELD_BY_OTHER')) {
    return new SalesTxError(
      'SALES_TX_PLOT_HELD_BY_OTHER',
      'แปลงนี้มีลูกค้ารายอื่นถือสิทธิ์ซื้อหรือเช่าอยู่ ไม่สามารถปลดแปลงได้',
      { rawMessage: message }
    );
  }
  if (
    haystack.includes('SALES_TX_PLOT_UNAVAILABLE') ||
    haystack.includes('SALES_TX_PLOT_HELD_BY_RENTAL') ||
    haystack.includes('SALES_TX_PLOT_HELD_BY_SALE') ||
    code === '23505'
  ) {
    return new SalesTxError(
      'SALES_TX_PLOT_UNAVAILABLE',
      'แปลงนี้ถูกจองหรือมีลูกค้ารายอื่นถือสิทธิ์อยู่แล้ว กรุณาโหลดข้อมูลใหม่หรือเลือกแปลงอื่น',
      { rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_IDEMPOTENCY_CONFLICT')) {
    return new SalesTxError(
      'SALES_TX_IDEMPOTENCY_CONFLICT',
      'คำขอเดิมถูกใช้งานกับข้อมูลชุดอื่นแล้ว กรุณาตรวจสอบข้อมูลหรือเปิดหน้าต่างใหม่ก่อนลองอีกครั้ง',
      { rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_AUTH_REQUIRED')) {
    return new SalesTxError(
      'SALES_TX_AUTH_REQUIRED',
      'เซสชันการเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่',
      { rawMessage: message }
    );
  }
  if (
    haystack.includes('SALES_TX_FORBIDDEN') ||
    haystack.includes('EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED') ||
    code === '42501'
  ) {
    return new SalesTxError(
      'SALES_TX_FORBIDDEN',
      'คุณไม่มีสิทธิ์ทำรายการนี้ หรือคำสั่งไม่ได้รับอนุญาตจากระบบป้องกันสต็อกแปลง',
      { rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_PROJECT_UNAVAILABLE') || haystack.includes('SALES_TX_PROJECT_MISMATCH')) {
    return new SalesTxError(
      'SALES_TX_PROJECT_MISMATCH',
      'โครงการไม่พร้อมใช้งานหรือโครงการของข้อมูลไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง',
      { rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_PLOT_AMBIGUOUS')) {
    return new SalesTxError(
      'SALES_TX_PLOT_AMBIGUOUS',
      'พบชื่อแปลงซ้ำในโครงการ กรุณาตรวจสอบรหัสแปลงก่อนทำรายการ',
      { rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_PLOT_NOT_FOUND')) {
    return new SalesTxError(
      'SALES_TX_PLOT_NOT_FOUND',
      'ไม่พบข้อมูลแปลงในโครงการที่เลือก',
      { rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_LEAD_NOT_FOUND')) {
    return new SalesTxError(
      'SALES_TX_LEAD_NOT_FOUND',
      'ไม่พบข้อมูลลูกค้าในระบบ กรุณาโหลดข้อมูลใหม่',
      { isStaleState: true, rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_CONTRACT_NOT_FOUND')) {
    return new SalesTxError(
      'SALES_TX_CONTRACT_NOT_FOUND',
      'ไม่พบข้อมูลสัญญาเช่าในระบบ กรุณาโหลดข้อมูลใหม่',
      { isStaleState: true, rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_IDENTITY_MISMATCH') || haystack.includes('SALES_TX_CONFLICT')) {
    return new SalesTxError(
      'SALES_TX_CONFLICT',
      'สถานะข้อมูลลูกค้า สัญญา หรือแปลงขัดแย้งกัน ไม่สามารถทำรายการได้ กรุณาโหลดข้อมูลใหม่และตรวจสอบ',
      { isStaleState: true, rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_CANCEL_REASON_REQUIRED')) {
    return new SalesTxError(
      'SALES_TX_INVALID_INPUT',
      'กรุณาระบุเหตุผลในการยกเลิกการจองเช่า',
      { rawMessage: message }
    );
  }
  if (haystack.includes('SALES_TX_INVALID_INPUT')) {
    return new SalesTxError(
      'SALES_TX_INVALID_INPUT',
      'ข้อมูลที่กรอกไม่ครบถ้วนหรือไม่ถูกต้อง กรุณาตรวจสอบข้อมูลอีกครั้ง',
      { rawMessage: message }
    );
  }
  if (
    code === 'PGRST202' ||
    code === '42883' ||
    haystack.includes('Could not find the function') ||
    haystack.includes('does not exist')
  ) {
    return new SalesTxError(
      'SALES_TX_RPC_NOT_INSTALLED',
      'คำสั่งธุรกรรมฐานข้อมูลสำหรับรายการนี้ยังไม่ถูกติดตั้ง กรุณาติดต่อ Admin เพื่อตรวจสอบ migration (ระบบจะไม่แก้สต็อกแปลงโดยตรงแทน)',
      { rawMessage: message }
    );
  }

  const isTransient =
    /network|fetch|timeout|503|502|504|connection/i.test(haystack);

  return new SalesTxError(
    'SALES_TX_UNKNOWN',
    message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง',
    { isRetryable: isTransient, rawMessage: message }
  );
}

async function invokeSalesTxRpc<TResponse extends { command: string }>(
  rpcName: string,
  expectedCommand: string,
  requestId: string,
  payload: Record<string, unknown>,
  syncEventType?: SalesSyncDetail['type']
): Promise<TResponse> {
  if (!requestId || typeof requestId !== 'string') {
    throw new SalesTxError('SALES_TX_INVALID_INPUT', 'ไม่พบรหัสคำขอธุรกรรม (requestId)');
  }

  const rpcFn = (supabase as unknown as { rpc?: (...args: any[]) => Promise<{ data: any; error: any }> }).rpc;
  if (typeof rpcFn !== 'function') {
    throw new SalesTxError(
      'SALES_TX_RPC_NOT_INSTALLED',
      'Supabase client ไม่รองรับการเรียกคำสั่ง RPC ในสภาพแวดล้อมนี้'
    );
  }

  let res: { data: any; error: any };
  try {
    res = await rpcFn.call(supabase, rpcName, {
      p_request_id: requestId,
      p_payload: payload,
    });
  } catch (err) {
    throw translateSalesTxError(err);
  }

  if (res?.error) {
    throw translateSalesTxError(res.error);
  }

  const data = Array.isArray(res?.data) ? res.data[0] : res?.data;
  if (!data || typeof data !== 'object' || data.command !== expectedCommand) {
    throw new SalesTxError(
      'SALES_TX_UNKNOWN',
      'ไม่ได้รับผลลัพธ์ยืนยันธุรกรรมที่ถูกต้องจากฐานข้อมูล กรุณาโหลดข้อมูลใหม่เพื่อตรวจสอบก่อนลองอีกครั้ง',
      { isRetryable: true }
    );
  }

  if (syncEventType && typeof window !== 'undefined') {
    broadcastSalesSync({
      type: syncEventType,
      leadId: (data as any).leadId ?? (payload.leadId as string | null) ?? null,
      saleId: (data as any).saleId ?? null,
      plotId: (data as any).plotId ?? (payload.plotId as string | null) ?? null,
      projectName: (data as any).projectName ?? (payload.projectName as string | null) ?? null,
      timestamp: Date.now(),
    });
  }

  return data as TResponse;
}

// -----------------------------------------------------------------------------
// 1. Book Rental (PendingContract)
// -----------------------------------------------------------------------------
export interface BookRentalTxInput {
  requestId: string;
  actorRole?: unknown;
  projectName: string;
  plotId: string;
  programType: RentalProgramType;
  tenantName: string;
  tenantPhone?: string | null;
  agentName?: string | null;
  notes?: string | null;
  leadId?: string | null;
  expectedLeadRevision?: string | null;
  expectedLeadUpdatedAt?: string | null;
  monthlyRent: number;
  securityDeposit: number;
  savingsPerMonth?: number;
  basePrice?: number;
  bookingAmount: number;
  bookingDate?: string | null;
  startDate?: string | null;
  durationMonths?: number;
}

export interface BookRentalTxResult {
  requestId: string;
  command: 'rental_book';
  leadId: string;
  contractId: string;
  plotId: string;
  projectName: string;
  rentalStatus: 'PendingContract';
  leadRevision?: string;
  contractRevision?: string;
  replayed?: boolean;
}

export async function bookRentalTx(input: BookRentalTxInput): Promise<BookRentalTxResult> {
  assertSalesWriteRole(input.actorRole);
  return invokeSalesTxRpc<BookRentalTxResult>(
    'sales_tx_book_rental',
    'rental_book',
    input.requestId,
    {
      projectName: input.projectName,
      plotId: input.plotId,
      programType: input.programType,
      tenantName: input.tenantName.trim(),
      tenantPhone: input.tenantPhone?.trim() || null,
      agentName: input.agentName?.trim() || null,
      notes: input.notes?.trim() || null,
      leadId: input.leadId || null,
      expectedLeadRevision: input.expectedLeadRevision || null,
      expectedLeadUpdatedAt: input.expectedLeadUpdatedAt || null,
      monthlyRent: input.monthlyRent,
      securityDeposit: input.securityDeposit,
      savingsPerMonth: input.savingsPerMonth ?? 0,
      basePrice: input.basePrice ?? 0,
      bookingAmount: input.bookingAmount,
      bookingDate: input.bookingDate || null,
      startDate: input.startDate || null,
      durationMonths: input.durationMonths ?? 12,
    },
    'rental_booking_saved'
  );
}

// -----------------------------------------------------------------------------
// 2. Sign Rental Contract (from PendingContract OR direct contract)
// -----------------------------------------------------------------------------
export interface SignRentalContractTxInput {
  requestId: string;
  actorRole?: unknown;
  projectName: string;
  plotId: string;
  programType: RentalProgramType;
  tenantName: string;
  tenantPhone?: string | null;
  agentName?: string | null;
  notes?: string | null;
  leadId?: string | null;
  contractId?: string | null;
  expectedLeadRevision?: string | null;
  expectedContractRevision?: string | null;
  expectedLeadUpdatedAt?: string | null;
  monthlyRent: number;
  securityDeposit: number;
  advanceRent: number;
  savingsPerMonth?: number;
  basePrice?: number;
  bookingAmount?: number;
  bookingDate?: string | null;
  contractDate?: string | null;
  startDate: string;
  durationMonths: number;
}

export interface SignRentalContractTxResult {
  requestId: string;
  command: 'rental_sign_contract';
  leadId: string;
  contractId: string;
  plotId: string;
  projectName: string;
  rentalStatus: 'Active';
  leadRevision?: string;
  contractRevision?: string;
  replayed?: boolean;
}

export async function signRentalContractTx(
  input: SignRentalContractTxInput
): Promise<SignRentalContractTxResult> {
  assertSalesWriteRole(input.actorRole);
  return invokeSalesTxRpc<SignRentalContractTxResult>(
    'sales_tx_sign_rental_contract',
    'rental_sign_contract',
    input.requestId,
    {
      projectName: input.projectName,
      plotId: input.plotId,
      programType: input.programType,
      tenantName: input.tenantName.trim(),
      tenantPhone: input.tenantPhone?.trim() || null,
      agentName: input.agentName?.trim() || null,
      notes: input.notes?.trim() || null,
      leadId: input.leadId || null,
      contractId: input.contractId || null,
      expectedLeadRevision: input.expectedLeadRevision || null,
      expectedContractRevision: input.expectedContractRevision || null,
      expectedLeadUpdatedAt: input.expectedLeadUpdatedAt || null,
      monthlyRent: input.monthlyRent,
      securityDeposit: input.securityDeposit,
      advanceRent: input.advanceRent,
      savingsPerMonth: input.savingsPerMonth ?? 0,
      basePrice: input.basePrice ?? 0,
      bookingAmount: input.bookingAmount ?? 0,
      bookingDate: input.bookingDate || null,
      contractDate: input.contractDate || null,
      startDate: input.startDate,
      durationMonths: input.durationMonths,
    },
    'rental_contract_saved'
  );
}

// -----------------------------------------------------------------------------
// 3. Cancel Rental Booking (PendingContract ONLY — NEVER Active/Renewed)
// -----------------------------------------------------------------------------
export interface CancelRentalBookingTxInput {
  requestId: string;
  actorRole?: unknown;
  leadId: string;
  contractId?: string | null;
  expectedLeadRevision?: string | null;
  expectedContractRevision?: string | null;
  expectedLeadUpdatedAt?: string | null;
  reason?: string | null;
}

export interface CancelRentalBookingTxResult {
  requestId: string;
  command: 'rental_cancel_booking';
  leadId: string;
  contractId?: string | null;
  plotId?: string | null;
  plotReleased: boolean;
  rentalStatus: 'Cancelled';
  leadRevision?: string;
  replayed?: boolean;
}

export async function cancelRentalBookingTx(
  input: CancelRentalBookingTxInput
): Promise<CancelRentalBookingTxResult> {
  assertSalesWriteRole(input.actorRole);
  const trimmedReason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!trimmedReason) {
    throw new SalesTxError(
      'SALES_TX_INVALID_INPUT',
      'กรุณาระบุเหตุผลในการยกเลิกการจองเช่า'
    );
  }
  return invokeSalesTxRpc<CancelRentalBookingTxResult>(
    'sales_tx_cancel_rental_booking',
    'rental_cancel_booking',
    input.requestId,
    {
      leadId: input.leadId,
      contractId: input.contractId || null,
      expectedLeadRevision: input.expectedLeadRevision || null,
      expectedContractRevision: input.expectedContractRevision || null,
      expectedLeadUpdatedAt: input.expectedLeadUpdatedAt || null,
      reason: trimmedReason,
    },
    'rental_booking_cancelled'
  );
}

// -----------------------------------------------------------------------------
// 4. Move Out / End Active Rental Contract
// -----------------------------------------------------------------------------
export interface MoveOutRentalTxInput {
  requestId: string;
  actorRole?: unknown;
  contractId: string;
  leadId?: string | null;
  expectedContractRevision?: string | null;
  expectedLeadRevision?: string | null;
  moveOutDate: string;
  utilityDeduction?: number;
  damageDeduction?: number;
  cleaningDeduction?: number;
  notes?: string | null;
}

export interface MoveOutRentalTxResult {
  requestId: string;
  command: 'rental_move_out';
  contractId: string;
  leadId?: string | null;
  plotId: string;
  depositRefunded: number;
  plotReleased: boolean;
  rentalStatus: 'MovedOut';
  contractRevision?: string;
  leadRevision?: string | null;
  replayed?: boolean;
}

export async function moveOutRentalTx(
  input: MoveOutRentalTxInput
): Promise<MoveOutRentalTxResult> {
  assertSalesWriteRole(input.actorRole);
  return invokeSalesTxRpc<MoveOutRentalTxResult>(
    'sales_tx_move_out_rental',
    'rental_move_out',
    input.requestId,
    {
      contractId: input.contractId,
      leadId: input.leadId || null,
      expectedContractRevision: input.expectedContractRevision || null,
      expectedLeadRevision: input.expectedLeadRevision || null,
      moveOutDate: input.moveOutDate,
      utilityDeduction: input.utilityDeduction ?? 0,
      damageDeduction: input.damageDeduction ?? 0,
      cleaningDeduction: input.cleaningDeduction ?? 0,
      notes: input.notes?.trim() || null,
    },
    'rental_moved_out'
  );
}

// -----------------------------------------------------------------------------
// 5. Convert Active Rental to Purchase (Atomic Handover, Zero Vacant Gap)
// -----------------------------------------------------------------------------
export interface ConvertRentalToBuyTxInput {
  requestId: string;
  actorRole?: unknown;
  contractId: string;
  leadId?: string | null;
  expectedContractRevision?: string | null;
  expectedLeadRevision?: string | null;
  purchaseDate: string;
  finalPurchasePrice: number;
  appliedBookingCredit: number;
  paymentMethod?: 'mortgage' | 'cash';
  closingAgent?: string | null;
  notes?: string | null;
}

export interface ConvertRentalToBuyTxResult {
  requestId: string;
  command: 'rental_convert_to_buy';
  contractId: string;
  leadId: string;
  saleId: string;
  plotId: string;
  finalPurchasePrice: number;
  appliedBookingCredit: number;
  rentalStatus: 'ConvertedToBuy';
  contractRevision?: string;
  leadRevision?: string;
  replayed?: boolean;
}

export async function convertRentalToBuyTx(
  input: ConvertRentalToBuyTxInput
): Promise<ConvertRentalToBuyTxResult> {
  assertSalesWriteRole(input.actorRole);
  return invokeSalesTxRpc<ConvertRentalToBuyTxResult>(
    'sales_tx_convert_rental_to_buy',
    'rental_convert_to_buy',
    input.requestId,
    {
      contractId: input.contractId,
      leadId: input.leadId || null,
      expectedContractRevision: input.expectedContractRevision || null,
      expectedLeadRevision: input.expectedLeadRevision || null,
      purchaseDate: input.purchaseDate,
      finalPurchasePrice: input.finalPurchasePrice,
      appliedBookingCredit: input.appliedBookingCredit,
      paymentMethod: input.paymentMethod || 'mortgage',
      closingAgent: input.closingAgent?.trim() || null,
      notes: input.notes?.trim() || null,
    },
    'rental_converted_to_buy'
  );
}

// -----------------------------------------------------------------------------
// 6. Release Legacy Plot (Admin-Only, Guard-Approved Single-Plot Remediation)
// -----------------------------------------------------------------------------
export interface ReleaseLegacyPlotTxInput {
  requestId: string;
  actorRole?: unknown;
  projectName: string;
  plotId: string;
  expectedHasCustomer: boolean;
  expectedSaleStatus: string;
  reason: string;
  leadId?: string | null;
}

export interface ReleaseLegacyPlotTxResult {
  requestId: string;
  command: 'legacy_plot_release';
  plotId: string;
  projectName: string;
  previousSaleStatus?: string | null;
  previousHasCustomer: boolean;
  plotReleased: boolean;
  alreadyVacant: boolean;
  replayed?: boolean;
}

export async function releaseLegacyPlotTx(
  input: ReleaseLegacyPlotTxInput
): Promise<ReleaseLegacyPlotTxResult> {
  assertAdminWriteRole(input.actorRole);
  return invokeSalesTxRpc<ReleaseLegacyPlotTxResult>(
    'sales_tx_release_legacy_plot',
    'legacy_plot_release',
    input.requestId,
    {
      projectName: input.projectName,
      plotId: input.plotId,
      expectedHasCustomer: input.expectedHasCustomer,
      expectedSaleStatus: input.expectedSaleStatus,
      reason: input.reason.trim(),
      leadId: input.leadId || null,
    },
    'plot_updated'
  );
}
