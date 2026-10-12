import React, { Suspense } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({read:vi.fn(),context:vi.fn(),editor:vi.fn(),write:vi.fn()}));
vi.mock('next/dynamic',()=>({default:(loader:()=>Promise<{default:React.ComponentType}>)=>{
  const Component=React.lazy(loader);return(props:Record<string,unknown>)=><Suspense fallback={<p>Loading fixture component</p>}><Component {...props}/></Suspense>;
}}));
vi.mock('../CustomerDealDetailsEditor',()=>({default:(props:{saleId:string;projectName:string;currentUserId:string;onSaved:()=>void;onBusyChange:(v:boolean)=>void})=>{
  mocks.editor(props);return <section aria-label="Fixture atomic editor"><button onClick={()=>props.onBusyChange(true)}>Fixture uncertain</button><button onClick={props.onSaved}>Fixture receipt</button></section>;
}}));
vi.mock('@/lib/sales/customerDealReadClient',()=>({customerDealReadApi:{read:mocks.context}}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,neq:()=>q,limit:()=>q,single:()=>mocks.read(table),update:mocks.write,
    then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(mocks.read(table)).then(resolve)};return q;
}}}));
import SalesDealStatusModal from '../SalesDealStatusModal';
const saleId='21000000-0000-4000-8000-000000000001';
const actorId='21000000-0000-4000-8000-000000000006';
const publicSale={id:saleId,lead_id:'L1',project_interest_id:'I1',crm_stage:'booked',payment_method:'mortgage',contract_status:'Reserved'};
beforeEach(()=>{
 vi.clearAllMocks();mocks.read.mockImplementation(async(table:string)=>({data:table==='leads'?{id:'L1',status:'Booked'}:publicSale,error:null}));
 mocks.context.mockResolvedValue({actor:{userId:actorId,role:'sales'},customer:{name:'Canonical customer',phone:null},
  deal:{id:saleId,stage:'booked',salePrice:2500000,bankName:null,paymentMethod:'mortgage'},history:[],detailsEditingAvailable:true});
});
afterEach(cleanup);
describe('Lead and Map CRM details entry',()=>{
 it.each(['lead','map'])('opens the same exact CRM editor from %s without direct writes',async path=>{
  const saved=vi.fn(),close=vi.fn();
  render(<SalesDealStatusModal lead={{leadId:path==='lead'?'L1':null,saleId,status:'Booked',project_name:'Project A'}}
   currentUser={{id:actorId,role:'Sales'}} onClose={close} onSaved={saved}/>);
  fireEvent.click(await screen.findByRole('button',{name:'แก้ข้อมูลลูกค้า ราคา และธนาคาร'}));
  await screen.findByRole('region',{name:'Fixture atomic editor'});
  expect(mocks.editor).toHaveBeenLastCalledWith(expect.objectContaining({saleId,projectName:'Project A',currentUserId:actorId}));
  fireEvent.click(screen.getByRole('button',{name:'Fixture uncertain'}));await waitFor(()=>expect(screen.getByRole('button',{name:'ปิด'})).toBeDisabled());
  expect(screen.getByRole('button',{name:'ปิดการแก้ข้อมูล'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Fixture receipt'}));expect(saved).toHaveBeenCalledWith('อัปเดตข้อมูลลูกค้าและดีล CRM แล้ว');
  expect(mocks.write).not.toHaveBeenCalled();
 });
 it.each([false,undefined])('keeps unavailable correction entry hidden %s',async available=>{
  const base=await mocks.context();mocks.context.mockResolvedValue({...base,detailsEditingAvailable:available});
  render(<SalesDealStatusModal lead={{saleId,status:'Booked',project_name:'Project A'}} currentUser={{id:actorId,role:'Sales'}} onClose={vi.fn()} onSaved={vi.fn()}/>);
  await screen.findByText('Canonical customer');expect(screen.queryByRole('button',{name:'แก้ข้อมูลลูกค้า ราคา และธนาคาร'})).not.toBeInTheDocument();
  expect(mocks.editor).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();
 });
});
