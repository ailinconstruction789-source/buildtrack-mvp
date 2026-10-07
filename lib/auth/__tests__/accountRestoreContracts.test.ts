import {describe,it,expect} from 'vitest';
import {parseRestoreRequest,parseRestoreReceipt} from '../accountRestoreContracts';
import {command,receipt} from './accountRestoreFixtures';
import {aid} from './accountAccessFixtures';
describe('bounded Sales restoration contracts',()=>{
  it('normalizes only reason and UUID casing, not identity label',()=>{
    expect(parseRestoreRequest(command({reason:'  ตรวจสอบตัวตนแล้ว  '})).reason).toBe('ตรวจสอบตัวตนแล้ว');
    expect(parseRestoreRequest(command({expectedUsername:' exact label '})).expectedUsername).toBe(' exact label ');
  });
  it.each([{role:'Admin'},{enabled:true},{confirmed:false},{reason:'short'},{reason:'x'.repeat(501)},
    {reason:'aaaaaaaa\n'},{userId:aid(1)},{requestId:'bad'},{expectedRevision:0},{expectedRevision:Number.MAX_SAFE_INTEGER},{expectedUsername:''}])('rejects unexpected control/input %j',patch=>{
    expect(()=>parseRestoreRequest({...command(),...patch})).toThrow();
  });
  it('allowlists receipt and never treats it as current authority',()=>{
    expect(parseRestoreReceipt({...receipt(),email:'secret',active:true},command())).toEqual(receipt());
  });
  it.each([{actorId:aid(3)},{userId:aid(3)},{requestId:aid(3)},{reviewedRevision:3},{reviewedAt:'bad'}])('rejects unrelated receipt %j',patch=>{
    expect(()=>parseRestoreReceipt({...receipt(),...patch},command())).toThrow('ยังยืนยันผลไม่ได้');
  });
});
