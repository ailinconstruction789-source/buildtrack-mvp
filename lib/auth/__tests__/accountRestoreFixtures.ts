import {aid} from './accountAccessFixtures';
import type {RestoreRequest,RestoreReceipt} from '../accountRestoreContracts';
export const command=(patch:Partial<RestoreRequest>={}):RestoreRequest=>({requestId:aid(99),actorId:aid(1),userId:aid(2),expectedRevision:1,
  expectedUsername:'Sales สมมติ',reason:'ตรวจตัวตนและความพร้อมแล้ว',confirmed:true,...patch});
export const receipt=(patch:Partial<RestoreReceipt>={}):RestoreReceipt=>({contract:'buildtrack.account-restore.v1',requestId:aid(99),actorId:aid(1),userId:aid(2),reviewedRevision:2,reviewedAt:'2026-09-25T08:00:00Z',...patch});
