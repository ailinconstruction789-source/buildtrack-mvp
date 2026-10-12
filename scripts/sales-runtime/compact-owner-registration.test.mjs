import test from 'node:test';
import assert from 'node:assert/strict';
import {compactOwnerRegistration} from './compact-owner-registration.mjs';
const query=literal=>`WITH registered AS (SELECT sales_operator_private.register_job(${literal},sales_operator_private.digest(${literal})) AS id)
 SELECT jsonb_build_object('jobId',id,'payloadSha256',sales_operator_private.digest(${literal})) FROM registered;`;
test('retains approved escaped JSON bytes exactly once and the same register/digest functions',()=>{
 const literal=`'{"name":"O''Connor","note":"x; -- z"}'::jsonb`;
 const out=compactOwnerRegistration(query(literal));assert.equal(out.split(literal).length-1,1);
 assert.match(out,/register_job\(value,sales_operator_private.digest\(value\)\)/);
 assert.match(out,/payloadSha256',sales_operator_private.digest\(value\)/);
});
test('refuses mismatched copies, extra SQL, altered digests or functions',()=>{
 const s=query("'{}'::jsonb");for(const altered of [s+' SELECT 1;',s.replace('register_job','another'),s.replace("digest('{}'::jsonb)","digest('{\"changed\":true}'::jsonb)"),s.replace(/FROM registered;/,'FROM public.sales;')])assert.throws(()=>compactOwnerRegistration(altered));
});
