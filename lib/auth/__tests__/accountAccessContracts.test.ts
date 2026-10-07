import { describe,it,expect } from 'vitest';
import { parseAccessQuery,parseAccessSnapshot } from '../accountAccessContracts';
import { aid,scope,snapshot } from './accountAccessFixtures';
describe('read-only account access contract',()=>{
  it('normalizes filters and copies only explicitly allowed fields',()=>{
    expect(parseAccessQuery('http://local/?query=%20Sales%20&status=active')).toEqual({page:0,query:'Sales',status:'active'});
    const value=snapshot();
    const parsed=parseAccessSnapshot({...value,email:'private',accounts:value.accounts.map(row=>({...row,pin:'private',metadata:{role:'Admin'}}))},aid(1),scope);
    expect(parsed).toEqual(value); expect(JSON.stringify(parsed)).not.toContain('private');
  });
  it.each(['page=-1','page=01','page=10001','page=1&page=2','actor=Admin','status=bad','query=%00',`query=${'x'.repeat(81)}`])('rejects query %s',query=>{
    expect(()=>parseAccessQuery(`http://local/?${query}`)).toThrow();
  });
  it.each([{actorId:aid(9)},{total:2},{page:1},{query:'wrong'},{generatedAt:'bad'},{pageSize:100},{contract:'wrong'}])('rejects mismatched snapshot %j',change=>{
    expect(()=>parseAccessSnapshot({...snapshot(),...change},aid(1),scope)).toThrow();
  });
  it('rejects duplicate rows, truncated pages and impossible active/suspension combinations',()=>{
    const value=snapshot();
    for (const accounts of [[value.accounts[0],value.accounts[0]],[{...value.accounts[0],status:'active'}],
      [{...value.accounts[0],authStatus:'banned'}],[{...value.accounts[0],lastSuspension:null}]]) {
      expect(()=>parseAccessSnapshot({...value,total:accounts.length,accounts},aid(1),scope)).toThrow();
    }
    expect(()=>parseAccessSnapshot({...value,total:26},aid(1),scope)).toThrow();
  });
});
