import type { AccessQuery, AccessSnapshot } from '../accountAccessContracts';
export const aid=(n:number)=>`a0250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const scope: AccessQuery={page:0,query:'',status:'all'};
export const snapshot=(change: Partial<AccessSnapshot>={}):AccessSnapshot=>({
  contract:'buildtrack.account-access.v1',actorId:aid(1),generatedAt:'2026-09-25T06:00:00Z',...scope,pageSize:25,total:1,
  accounts:[{userId:aid(2),username:'Sales สมมติ',revision:1,reviewedAt:'2026-09-24T06:00:00Z',authStatus:'available',status:'awaiting_review',
    lastSuspension:{revision:1,reason:'auth_banned',at:'2026-09-25T05:00:00Z'}}],...change,
});
