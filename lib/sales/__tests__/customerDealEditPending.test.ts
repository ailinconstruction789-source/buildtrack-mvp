// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {readCustomerDealEditPending,writeCustomerDealEditPending,clearCustomerDealEditPending,customerDealEditPendingKey} from '../customerDealEditPending';
import {editId,editInput} from './customerDealEditFixtures';
function storage(){const values=new Map<string,string>();return{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};}
describe('immutable correction write-ahead command',()=>{
  it('retains explicit nulls, exact cents and original request under actor scope',()=>{
    const store=storage(),input=editInput();writeCustomerDealEditPending(editId(6),input,store);
    expect(readCustomerDealEditPending(editId(6),store)).toEqual(input);expect(readCustomerDealEditPending(editId(99),store)).toBeNull();
    expect(store.getItem(customerDealEditPendingKey(editId(6)))).not.toMatch(/token|sourceName|snapshot/);
    clearCustomerDealEditPending(editId(6),input,store);expect(readCustomerDealEditPending(editId(6),store)).toBeNull();
  });
  it.each([{requestId:editId(99)},{saleId:editId(99)},{reason:'different'},{profile:null}])('refuses replacement and wrong-command deletion %j',patch=>{
    const store=storage(),input=editInput();writeCustomerDealEditPending(editId(6),input,store);
    expect(()=>writeCustomerDealEditPending(editId(6),{...input,...patch},store)).toThrow();
    expect(()=>clearCustomerDealEditPending(editId(6),{...input,...patch},store)).toThrow();expect(readCustomerDealEditPending(editId(6),store)).toEqual(input);
  });
  it('stops when storage is corrupt or unavailable rather than losing an uncertain command',()=>{
    const store=storage();store.setItem(customerDealEditPendingKey(editId(6)),'broken');expect(()=>readCustomerDealEditPending(editId(6),store)).toThrow();
    expect(()=>writeCustomerDealEditPending(editId(6),editInput(),{...store,setItem:()=>{throw new Error('denied');}})).toThrow();
  });
});
