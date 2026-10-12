import assert from 'node:assert/strict';
import test from 'node:test';
import {readWorkspacePages,runCanonicalWorkspaceReadChecks,workspaceGuardSql} from '../canonical-workspace-read.mjs';
const actor = {userId:'18000000-0000-4000-8000-000000000001',role:'admin'};
const page = (number,rows,hasMore = false) => ({wrapper:{actor,page:number,hasMore,customers:rows,sourceMembership:{active:true}},original:{customers:rows}});
const read = pages => async number => pages[number];
test('fully reads beyond one page and preserves all independent identities',async()=>{
 const rows = Array.from({length:50},(_,i)=>({id:String(i)}));
 const result = await readWorkspacePages({read:read([page(0,rows,true),page(1,[{id:'50'}])]),key:'customers',idKey:'id',actor});
 assert.equal(result.rows.length,51);assert.equal(result.pages,2);
});
test('never silently succeeds when the full reader exceeds its explicit bound',async()=>{
 await assert.rejects(readWorkspacePages({read:read([page(0,Array.from({length:50},(_,i)=>({id:String(i)})),true)]),key:'customers',idKey:'id',actor,maxPages:1}),/WORKSPACE_PAGINATION_LIMIT/);
});
test('rejects short continuing pages',async()=>{
 await assert.rejects(readWorkspacePages({read:read([page(0,[{id:'1'}],true)]),key:'customers',idKey:'id',actor}),/WORKSPACE_SHORT_CONTINUING_PAGE/);
});
test('rejects repeated identities on separate pages',async()=>{
 const rows=Array.from({length:50},(_,i)=>({id:String(i)}));
 await assert.rejects(readWorkspacePages({read:read([page(0,rows,true),page(1,[{id:'0'}])]),key:'customers',idKey:'id',actor}),/WORKSPACE_DUPLICATE_ID/);
});
test('rejects actor drift without returning partial data',async()=>{
 const p=page(0,[{id:'1'}]);p.wrapper.actor={...actor,userId:'other'};
 await assert.rejects(readWorkspacePages({read:read([p]),key:'customers',idKey:'id',actor}),/WORKSPACE_ACTOR_CHANGED/);
});
test('rejects wrapper IDs reordered from the original authorized reader',async()=>{
 const p=page(0,[{id:'1'},{id:'2'}]);p.original.customers=[{id:'2'},{id:'1'}];
 await assert.rejects(readWorkspacePages({read:read([p]),key:'customers',idKey:'id',actor}),/WORKSPACE_ORIGINAL_ID_ORDER_CHANGED/);
});
test('requires active reviewed membership even on empty pages',async()=>{
 const p=page(0,[]);p.wrapper.sourceMembership.active=false;
 await assert.rejects(readWorkspacePages({read:read([p]),key:'customers',idKey:'id',actor}),/WORKSPACE_MEMBERSHIP_REQUIRED/);
});
test('owned guard stops before any actor or private business query on foreign database',async()=>{
 const calls=[];
 await assert.rejects(runCanonicalWorkspaceReadChecks({query:async sql=>{calls.push(sql);return 'f';},claims:'SET LOCAL request.jwt.claims',report:{results:{}}}),/Owned loopback fixture required/);
 assert.deepEqual(calls,[workspaceGuardSql]);
});
