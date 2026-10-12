// Shrinks the approved whole transaction without dropping its capture guard.
// The server supplies SHA256 of its exact JSONB text; a full fresh capture must
// first match the approved one. Native proof rehearses commit and recovery.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fullCanonicalCaptureQuery} from '../sales-import/prepare-full-canonical-payload.mjs';
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const withoutTime=capture=>{const copy={...capture};delete copy.capturedAt;return copy;};
export function captureFingerprintReadSql(purpose){
 assert.ok(['owned-fixture','production-target'].includes(purpose));
 return `WITH captured(value) AS (${fullCanonicalCaptureQuery(purpose).replace(/;\s*$/,'')})
 SELECT jsonb_build_object('capture',value,'captureSha256',encode(sha256(convert_to((value-'capturedAt')::text,'UTF8')),'hex')) FROM captured;`;
}
export function compactCaptureGuard({plan,freshCapture,captureSha256}){
 assert.match(captureSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(withoutTime(freshCapture),withoutTime(plan.capture),'Fresh capture must match every approved value before compacting');
 const original=`IF initial-'capturedAt' IS DISTINCT FROM ${q(JSON.stringify(withoutTime(plan.capture)))}::jsonb THEN RAISE EXCEPTION 'FULL_REPLACEMENT_CAPTURE_DRIFT'; END IF;`;
 assert.equal(plan.mainSql.split(original).length-1,1,'Exact single capture guard required');
 const replacement=`IF encode(sha256(convert_to((initial-'capturedAt')::text,'UTF8')),'hex') IS DISTINCT FROM ${q(captureSha256)} THEN RAISE EXCEPTION 'FULL_REPLACEMENT_CAPTURE_DRIFT'; END IF;`;
 const sql=plan.mainSql.replace(original,replacement);
 assert.equal(sql.replace(replacement,original),plan.mainSql,'Every other transaction byte must remain unchanged');
 return {sql,originalSqlSha256:createHash('sha256').update(plan.mainSql).digest('hex'),sqlSha256:createHash('sha256').update(sql).digest('hex'),captureSha256,
  change:'exact full capture comparison becomes SHA256 comparison of PostgreSQL JSONB; fresh full-value parity required',executed:false};
}
