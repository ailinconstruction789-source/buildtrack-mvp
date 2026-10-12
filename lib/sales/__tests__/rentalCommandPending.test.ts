// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {readRentalCommandPending,writeRentalCommandPending,clearRentalCommandPending,rentalCommandPendingKey} from '../rentalCommandPending';
import {rentalId,rentalInput} from './rentalCommandFixtures';
import {parseRentalCommandInput} from '../rentalCommandContracts';
function storage(){const values=new Map<string,string>();return{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};}
describe('immutable rental write-ahead command',()=>{
  it('retains explicit nulls, exact cents and original request under actor scope',()=>{
    const store=storage(),input=rentalInput();writeRentalCommandPending(rentalId(6),input,store);
    expect(readRentalCommandPending(rentalId(6),store)).toEqual(input);expect(readRentalCommandPending(rentalId(99),store)).toBeNull();
    expect(store.getItem(rentalCommandPendingKey(rentalId(6)))).not.toMatch(/token|snapshotName|snapshot/);
    clearRentalCommandPending(rentalId(6),input,store);expect(readRentalCommandPending(rentalId(6),store)).toBeNull();
  });
  it.each([{requestId:rentalId(99)},{contractId:rentalId(99)},{reason:'different'},{renewalMonths:24}])('refuses replacement and wrong-command deletion %j',patch=>{
    const store=storage(),input=rentalInput();writeRentalCommandPending(rentalId(6),input,store);
    const changed=parseRentalCommandInput({...input,...patch});
    expect(()=>writeRentalCommandPending(rentalId(6),changed,store)).toThrow();
    expect(()=>clearRentalCommandPending(rentalId(6),changed,store)).toThrow();expect(readRentalCommandPending(rentalId(6),store)).toEqual(input);
  });
  it('stops when storage is corrupt or unavailable rather than losing an uncertain command',()=>{
    const store=storage();store.setItem(rentalCommandPendingKey(rentalId(6)),'broken');expect(()=>readRentalCommandPending(rentalId(6),store)).toThrow();
    expect(()=>writeRentalCommandPending(rentalId(6),rentalInput(),{...store,setItem:()=>{throw new Error('denied');}})).toThrow();
  });
});
