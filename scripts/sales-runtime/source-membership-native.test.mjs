import test from 'node:test';
import assert from 'node:assert/strict';
import {runSourceMembershipSelectParity} from './source-membership.mjs';
const admin='a0000000-0000-4000-8000-000000000001',sales='b0000000-0000-4000-8000-000000000001';
const adminSession='c0000000-0000-4000-8000-000000000001',salesSession='d0000000-0000-4000-8000-000000000001';
function mockReadOnlyQuery(){
 const calls=[];
 const query=async sql=>{
  calls.push(sql);
  if(sql.includes('current_database()'))return 't';
  if(sql.includes('SELECT EXISTS(SELECT 1 FROM customer_source_membership_private.head)'))return 't';
  if(sql.includes("jsonb_build_object('customers',(SELECT"))return '{"customers":["fixture-customer"],"interests":["fixture-interest"],"sales":["fixture-sale"]}';
  if(sql.includes("jsonb_build_object('customers',has_table_privilege"))return '{"customers":false,"interests":false,"sales":true}';
  if(sql.includes('DISTINCT ON(role)'))return JSON.stringify([{userId:admin,role:'admin'},{userId:sales,role:'sales'}]);
  if(sql.includes('SET LOCAL ROLE authenticated;')){
   if(sql.includes('SELECT public.crm_v2_role()'))return sql.includes(admin)?'admin':'sales';
   if(sql.includes('FROM public.sales_customers')||sql.includes('FROM public.lead_project_interests'))throw Error('permission denied for table');
   if(sql.includes('FROM public.sales;'))return '["fixture-sale"]';
  }
  if(sql.includes('has_function_privilege')||sql.includes('has_table_privilege'))return 't';
  if(sql.includes('assert_catalog'))return '';
  throw Error('Unexpected test query');
 };
 return {query,calls};
}
test('owned parity checks retain actual missing Customer/Interest SELECT grants instead of granting access',async()=>{
 const {query,calls}=mockReadOnlyQuery(),report={results:{}};
 const result=await runSourceMembershipSelectParity({query,report});
 assert.deepEqual(result.selectGrants,{customers:false,interests:false,sales:true});
 assert.equal(result.cases.filter(label=>label.includes('missing table grant')).length,4);
 assert.deepEqual(result.missingSessionRoles,['admin','sales']);
 assert.equal(result.ownerRoleCovered,false);
 assert.deepEqual(result.sessionsValidated,[]);
 assert.ok(calls.every(sql=>!/(?:GRANT|UPDATE|INSERT|DELETE)\b/.test(sql)));
});
test('supplied synthetic sessions are passed with matching subjects and validated without role mutation',async()=>{
 const {query,calls}=mockReadOnlyQuery(),report={results:{}};
 const result=await runSourceMembershipSelectParity({query,report,sessionIds:new Map([[admin,adminSession],['sales',salesSession]])});
 assert.deepEqual(result.sessionsValidated,['admin','sales']);
 assert.deepEqual(result.missingSessionRoles,[]);
 for(const sql of calls.filter(s=>s.includes('SET LOCAL ROLE authenticated;'))){
  assert.ok(sql.includes('session_id'));
  assert.ok(sql.includes(sql.includes(admin)?adminSession:salesSession));
 }
 assert.equal(report.results.sourceMembershipSelectParityPhases.length,1);
});
