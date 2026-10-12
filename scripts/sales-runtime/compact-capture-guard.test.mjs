import test from 'node:test';
import assert from 'node:assert/strict';
import {compactCaptureGuard,captureFingerprintReadSql} from './compact-capture-guard.mjs';
const capture={purpose:'owned-fixture',capturedAt:'old',customers:[{id:'1',name:"O'Connor"}],sales:[]};
const literal="'"+JSON.stringify({...capture,capturedAt:undefined}).replaceAll("'","''")+"'::jsonb";
const mainSql=`BEGIN;SELECT before_guard();DO $$BEGIN IF initial-'capturedAt' IS DISTINCT FROM ${literal} THEN RAISE EXCEPTION 'FULL_REPLACEMENT_CAPTURE_DRIFT'; END IF;PERFORM real_guards();END;$$;COMMIT;`;
test('retains every transaction byte except exact capture representation and keeps its denial',()=>{
 const r=compactCaptureGuard({plan:{capture,mainSql},freshCapture:{...capture,capturedAt:'new'},captureSha256:'a'.repeat(64)});
 assert.ok(r.sql.includes('PERFORM real_guards()'));assert.ok(r.sql.includes('SELECT before_guard()'));
 assert.ok(r.sql.includes("RAISE EXCEPTION 'FULL_REPLACEMENT_CAPTURE_DRIFT'"));assert.ok(r.sql.endsWith('COMMIT;'));
 assert.equal(r.executed,false);
});
test('rejects changed data even with a supplied fresh hash',()=>{
 assert.throws(()=>compactCaptureGuard({plan:{capture,mainSql},freshCapture:{...capture,customers:[{id:'2'}]},captureSha256:'a'.repeat(64)}),/Fresh capture/);
});
test('rejects missing or repeated guard and invalid fingerprints',()=>{
 for(const sql of [mainSql.replace('IS DISTINCT FROM','='),mainSql+mainSql])assert.throws(()=>compactCaptureGuard({plan:{capture,mainSql:sql},freshCapture:capture,captureSha256:'a'.repeat(64)}));
 assert.throws(()=>compactCaptureGuard({plan:{capture,mainSql},freshCapture:capture,captureSha256:'bad'}));
});
test('fingerprint is computed by PostgreSQL over the exact same timestamp-free JSONB capture',()=>{
 assert.match(captureFingerprintReadSql('production-target'),/sha256\(convert_to\(\(value-'capturedAt'\)::text,'UTF8'\)\)/);
 assert.throws(()=>captureFingerprintReadSql('any'));
});
