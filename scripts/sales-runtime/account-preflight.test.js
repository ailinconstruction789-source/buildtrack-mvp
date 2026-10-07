// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {accountPreflightPath,assertAccountPreflightSource,runAccountPreflight} from './account-preflight.mjs';
const source=readFileSync(accountPreflightPath,'utf8');
describe('catalog-only preflight source',()=>{
  it('keeps a read-only transaction, timeouts and rollback',()=>{expect(assertAccountPreflightSource(source)).toBe(source);});
  it.each([
    source.replace('BEGIN READ ONLY;','BEGIN;'),source.replace('ROLLBACK;','COMMIT;'),
    source+'\n\\connect production',source.replace('ROLLBACK;','SELECT public.app_current_actor(); ROLLBACK;'),
    source.replace('ROLLBACK;','UPDATE public.users SET role=role; ROLLBACK;'),
    source.replace("SET LOCAL lock_timeout = '2s';",''),
  ])('rejects unexpected or mutable report',changed=>{expect(()=>assertAccountPreflightSource(changed)).toThrow();});
  it('never compiles a report against an unverified test target',async()=>{
    const query=vi.fn().mockResolvedValue('f');await expect(runAccountPreflight({query,source,stage:'empty'})).rejects.toThrow();expect(query).toHaveBeenCalledOnce();
  });
  it('does not read account/customer rows or print function bodies',()=>{
    expect(source).not.toMatch(/\b(?:FROM|JOIN)\s+(?:public|auth|sales_private|account_security_private)\./i);
    expect(source).toContain("'definitionHash',pg_catalog.md5(pg_catalog.pg_get_functiondef(f.oid))");
    expect(source).toContain("'deploymentApproval','NOT_GRANTED'");expect(source).toContain('UNKNOWN_VERIFY_DASHBOARD_AND_POSTGREST_CONFIGURATION');
  });
});
