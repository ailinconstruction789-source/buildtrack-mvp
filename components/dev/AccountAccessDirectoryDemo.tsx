'use client';

import AccountAccessView from '@/components/admin/AccountAccessView';
import { useState } from 'react';
import type { AccountAccessApi } from '@/lib/auth/accountAccessClient';
import { ACCESS_STATES, parseAccessSnapshot, type AccessAccount } from '@/lib/auth/accountAccessContracts';
import { parseRestoreRequest, RestoreError, type RestoreApi, type RestoreReceipt } from '@/lib/auth/accountRestoreContracts';

const id=(n:number)=>`d0250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at='2026-09-25T06:00:00Z';
const accounts:AccessAccount[]=ACCESS_STATES.map((status,index)=>({
  userId:id(index+2),username:`Sales ตัวอย่าง ${String.fromCharCode(65+index)}`,revision:1,reviewedAt:at,
  authStatus:status==='auth_unavailable'?'banned':'available',status,
  lastSuspension:['awaiting_review','auth_unavailable'].includes(status)?{revision:1,reason:'auth_banned',at}:null,
}));
// No runtime dependency on accountAccessClient or the Supabase SDK. Every row is synthetic.
function createDemo() {
  const rows=structuredClone(accounts), receipts=new Map<string,{payload:string;receipt:RestoreReceipt}>();
  const api:AccountAccessApi={
  read:async scope=>{
    const filtered=rows.filter(row=>(scope.status==='all'||row.status===scope.status)
      && row.username.toLowerCase().includes(scope.query.toLowerCase()));
    return parseAccessSnapshot({contract:'buildtrack.account-access.v1',actorId:id(1),generatedAt:at,...scope,pageSize:25,
      total:filtered.length,accounts:filtered.slice(scope.page*25,(scope.page+1)*25)},id(1),scope);
  },
  watch:()=>()=>{},
  };
  const restore:RestoreApi=async input=>{
    const command=parseRestoreRequest(input);
    if(command.actorId!==id(1)) throw new RestoreError('FORBIDDEN');
    const prior=receipts.get(command.requestId),payload=JSON.stringify(command);
    if(prior){if(prior.payload!==payload)throw new RestoreError('REQUEST_CONFLICT');return prior.receipt;}
    const row=rows.find(item=>item.userId===command.userId);
    if(!row || row.status!=='awaiting_review' || row.revision!==command.expectedRevision || row.username!==command.expectedUsername) throw new RestoreError('STATE_CHANGED');
    row.revision++;row.status='active';row.reviewedAt=new Date().toISOString();
    const receipt:RestoreReceipt={contract:'buildtrack.account-restore.v1',requestId:command.requestId,actorId:id(1),
      userId:row.userId,reviewedRevision:row.revision,reviewedAt:row.reviewedAt};
    receipts.set(command.requestId,{payload,receipt});return receipt;
  };
  return {api,restore};
}
export default function AccountAccessDirectoryDemo() {
  const [demo]=useState(createDemo);
  return <AccountAccessView api={demo.api} restore={demo.restore}/>;
}
