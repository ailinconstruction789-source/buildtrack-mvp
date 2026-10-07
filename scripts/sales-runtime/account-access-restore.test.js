import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {accountAccessRestorePath,accountAccessRestoreTestBody,runAccountAccessRestore} from './account-access-restore.mjs';
const source=readFileSync(accountAccessRestorePath,'utf8');
describe('isolated restoration draft safety',()=>{
  it('only transforms guarded draft in memory',()=>{expect(accountAccessRestoreTestBody(source)).toMatch(/COMMIT;\s*$/);expect(source).toMatch(/ROLLBACK;\s*$/);});
  it.each([source.replace('ROLLBACK;','COMMIT;'),source.replace('requires isolated Auth verification','changed'),source+'\n\\connect production',source+'\nALTER SYSTEM SET work_mem=1;'])('rejects unsafe source',value=>{expect(()=>accountAccessRestoreTestBody(value)).toThrow();});
  it('never installs on unproven runtime',async()=>{const query=vi.fn().mockResolvedValue('f');await expect(runAccountAccessRestore({query,source})).rejects.toThrow();expect(query).toHaveBeenCalledOnce();});
  it('has no Auth/business writes and retains fixed Sales role',()=>{
    expect(source).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:auth\.|public\.)/i);
    expect(source).toContain("v_auth.email,'Sales',true,false");expect(source).toContain('SECURITY INVOKER');
    expect(source.indexOf('pg_advisory_xact_lock')).toBeLessThan(source.indexOf('v_actor:=account_security_private.current_actor()'));
  });
});
