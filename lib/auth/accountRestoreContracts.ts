import { accessUuid, record } from './accountAccessContracts';

export interface RestoreRequest {
  requestId: string; actorId: string; userId: string; expectedRevision: number;
  expectedUsername: string; reason: string; confirmed: true;
}
// Receipt acknowledges a historical decision, not the account's current status.
export interface RestoreReceipt {
  contract: 'buildtrack.account-restore.v1'; requestId: string; actorId: string;
  userId: string; reviewedRevision: number; reviewedAt: string;
}
export type RestoreApi = (request: RestoreRequest) => Promise<RestoreReceipt>;
export const RESTORE_ERRORS = {
  FEATURE_DISABLED: {status:503,message:'ยังไม่เปิดการรับรองสิทธิ์บัญชีจริง'},
  SETUP_REQUIRED: {status:503,message:'ระบบรับรองสิทธิ์ยังติดตั้งไม่ครบ กรุณาติดต่อผู้ดูแล'},
  UNAUTHENTICATED: {status:401,message:'กรุณาเข้าสู่ระบบใหม่ แล้วตรวจรายการก่อนรับรอง'},
  FORBIDDEN: {status:403,message:'เฉพาะ Admin ที่ได้รับสิทธิ์จัดการบัญชีเท่านั้น'},
  INVALID_INPUT: {status:400,message:'ข้อมูลรับรองไม่ถูกต้อง กรุณาตรวจเหตุผลและการยืนยัน'},
  STATE_CHANGED: {status:409,message:'ข้อมูลหรือสิทธิ์เปลี่ยนไปแล้ว กรุณาโหลดรายการใหม่ก่อนรับรอง'},
  REQUEST_CONFLICT: {status:409,message:'หมายเลขคำขอนี้มีข้อมูลไม่ตรงกับคำขอเดิม กรุณาติดต่อผู้ดูแล'},
  RESULT_UNKNOWN: {status:503,message:'ยังยืนยันผลไม่ได้ อย่าสร้างคำขอใหม่ ให้ลองส่งคำขอเดิมซ้ำเพื่อตรวจผล'},
} as const;
export class RestoreError extends Error {
  constructor(readonly code: keyof typeof RESTORE_ERRORS) { super(RESTORE_ERRORS[code].message); }
}
function invalid(): never { throw new RestoreError('INVALID_INPUT'); }
export function parseRestoreRequest(raw: unknown): RestoreRequest {
  if (!record(raw) || Object.keys(raw).sort().join(',')!=='actorId,confirmed,expectedRevision,expectedUsername,reason,requestId,userId'
    || !accessUuid(raw.requestId) || !accessUuid(raw.actorId) || !accessUuid(raw.userId) || raw.actorId.toLowerCase()===raw.userId.toLowerCase()
    || typeof raw.expectedRevision!=='number' || !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision<1 || raw.expectedRevision>=Number.MAX_SAFE_INTEGER
    || typeof raw.expectedUsername!=='string' || !raw.expectedUsername.trim() || raw.expectedUsername.length>500
    || typeof raw.reason!=='string' || raw.reason.trim().length<8 || raw.reason.trim().length>500 || /[\x00-\x1f\x7f]/.test(raw.reason)
    || raw.confirmed!==true) invalid();
  return {requestId:raw.requestId.toLowerCase(),actorId:raw.actorId.toLowerCase(),userId:raw.userId.toLowerCase(),
    expectedRevision:raw.expectedRevision,expectedUsername:raw.expectedUsername,reason:raw.reason.trim(),confirmed:true};
}
export function parseRestoreReceipt(raw: unknown, request: RestoreRequest): RestoreReceipt {
  if (!record(raw) || raw.contract!=='buildtrack.account-restore.v1' || raw.requestId!==request.requestId
    || raw.actorId!==request.actorId || raw.userId!==request.userId || raw.reviewedRevision!==request.expectedRevision+1
    || typeof raw.reviewedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T/.test(raw.reviewedAt) || !Number.isFinite(Date.parse(raw.reviewedAt))) {
    throw new RestoreError('RESULT_UNKNOWN');
  }
  return {contract:'buildtrack.account-restore.v1',requestId:request.requestId,actorId:request.actorId,userId:request.userId,
    reviewedRevision:raw.reviewedRevision,reviewedAt:raw.reviewedAt};
}
