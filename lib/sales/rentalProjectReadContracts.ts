import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseTransferDate } from './postBookingContracts';
import type { CrmRole } from './workflow';
import type { RentalProgram } from './rentalCommandContracts';

export interface RentalProjectRow {
  contractId:string; customerId:string; interestId:string; ownerUserId:string; projectName:string; plotId:string;
  customerName:string; customerPhone:string|null; programType:RentalProgram; status:'active'|'renewed'|'converted'|'ended';
  revision:string; startDate:string; endDate:string; endedDate:string|null; convertedSaleId:string|null;
}
export interface RentalProjectPage { projectName:string; actor:{userId:string;role:CrmRole}; snapshotRevision:string; page:number; hasMore:boolean; rows:RentalProjectRow[] }
const invalid=():never=>{throw new Error('ข้อมูลสัญญาเช่าโครงการไม่ครบหรือไม่ตรงกัน กรุณาโหลดใหม่');};
const exact=(r:Record<string,unknown>,keys:string[])=>{if(Object.keys(r).length!==keys.length||keys.some(key=>!Object.hasOwn(r,key)))invalid();};
const line=(v:unknown):string=>{
  if(typeof v!=='string'||!v.trim()||Array.from(v.trim()).length>300||Array.from(v).some(c=>{const n=c.charCodeAt(0);return n<32||(n>=127&&n<=159)||n===0x2028||n===0x2029||(c.length===1&&n>=0xd800&&n<=0xdfff);}))return invalid();
  return v;
};
const uuid=(v:unknown)=>{try{return bookingUuid(v);}catch{return invalid();}};
const day=(v:unknown)=>{try{return parseTransferDate(v);}catch{return invalid();}};
const page=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<100?v:invalid();
const choice=<T extends string>(v:unknown,values:readonly T[]):T=>typeof v==='string'&&values.includes(v as T)?v as T:invalid();
export function parseRentalProjectPage(value:unknown,scope:{projectName:string;page:number}):RentalProjectPage {
  const r=bookingRecord(value);exact(r,['projectName','actor','snapshotRevision','page','hasMore','rows']);
  const a=bookingRecord(r.actor);exact(a,['userId','role']);
  if(!Array.isArray(r.rows)||r.rows.length>50||typeof r.hasMore!=='boolean'||(r.hasMore&&r.rows.length!==50)||typeof r.snapshotRevision!=='string'||! /^[0-9a-f]{32}$/.test(r.snapshotRevision))return invalid();
  const result:RentalProjectPage={projectName:line(r.projectName),actor:{userId:uuid(a.userId),role:choice(a.role,['sales','admin','owner'])},snapshotRevision:r.snapshotRevision,page:page(r.page),hasMore:r.hasMore,
    rows:r.rows.map(value=>{
      const row=bookingRecord(value);exact(row,['contractId','customerId','interestId','ownerUserId','projectName','plotId','customerName','customerPhone','programType','status','revision','startDate','endDate','endedDate','convertedSaleId']);
      const parsed:RentalProjectRow={contractId:uuid(row.contractId),customerId:uuid(row.customerId),interestId:uuid(row.interestId),ownerUserId:uuid(row.ownerUserId),projectName:line(row.projectName),plotId:line(row.plotId),customerName:line(row.customerName),customerPhone:row.customerPhone===null?null:line(row.customerPhone),
        programType:choice(row.programType,['program_a','program_b','program_c']),status:choice(row.status,['active','renewed','converted','ended']),revision:uuid(row.revision),startDate:day(row.startDate),endDate:day(row.endDate),endedDate:row.endedDate===null?null:day(row.endedDate),convertedSaleId:row.convertedSaleId===null?null:uuid(row.convertedSaleId)};
      if(parsed.projectName!==scope.projectName||parsed.endDate<parsed.startDate||(parsed.endedDate!==null&&parsed.endedDate<parsed.startDate)
        ||(['ended','converted'].includes(parsed.status))!==(parsed.endedDate!==null)||(parsed.status==='converted')!==(parsed.convertedSaleId!==null))return invalid();
      return parsed;
    })};
  if(result.projectName!==scope.projectName||result.page!==page(scope.page)||new Set(result.rows.map(row=>row.contractId)).size!==result.rows.length)return invalid();
  return result;
}
