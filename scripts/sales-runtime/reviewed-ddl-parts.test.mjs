import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewedDdlStatements,splitReviewedDdl} from './reviewed-ddl-parts.mjs';
test('keeps nested DO and function semicolons inside one top-level statement',()=>{
 const s="BEGIN; CREATE FUNCTION p() RETURNS text AS $$BEGIN RETURN 'x;'; END;$$ LANGUAGE plpgsql; DO $x$ BEGIN PERFORM 1; END; $x$; COMMIT;";
 const parsed=reviewedDdlStatements(s);assert.equal(parsed.length,4);
 const chunks=splitReviewedDdl(s,30);assert.equal(chunks.length,2);
 assert.ok(chunks[0].includes("RETURN 'x;'; END;$$"));assert.ok(chunks[1].includes('PERFORM 1; END; $x$;'));
});
test('ignores semicolons in comments, quoted identifiers and escaped text',()=>{
 const s='BEGIN; /* outer; /* inner; */ */ CREATE TABLE "x;"(v text DEFAULT E\'a\\\';b\'); -- comment;\nCOMMIT;';
 assert.equal(reviewedDdlStatements(s).length,3);assert.equal(splitReviewedDdl(s).length,1);
});
test('refuses business DML or owner contexts across split transactions',()=>{
 for(const s of ['BEGIN; UPDATE public.sales SET x=1; COMMIT;','BEGIN; SELECT 1; COMMIT;','BEGIN; DO $$BEGIN PERFORM sales_operator_private.begin_metadata(); END;$$; COMMIT;'])assert.throws(()=>splitReviewedDdl(s));
});
test('refuses malformed literals and external psql commands',()=>{
 for(const s of ["BEGIN; SELECT 'x;COMMIT;",'BEGIN;\\connect other\nCOMMIT;'])assert.throws(()=>splitReviewedDdl(s));
});
