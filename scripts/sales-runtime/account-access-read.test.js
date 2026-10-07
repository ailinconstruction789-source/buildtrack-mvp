import { readFileSync } from 'node:fs';
import { describe,it,expect,vi } from 'vitest';
import { accountAccessReadPath,accountAccessReadTestBody,runAccountAccessRead } from './account-access-read.mjs';
const source=readFileSync(accountAccessReadPath,'utf8');
describe('isolated account reader SQL',()=>{
  it('transforms only the exact guarded draft in memory',()=>{
    expect(accountAccessReadTestBody(source)).toMatch(/COMMIT;\s*$/);
    expect(source).toMatch(/ROLLBACK;\s*$/);expect(source).toContain('DESIGN ONLY');
  });
  it.each([source.replace('ROLLBACK;','COMMIT;'),source.replace('requires reviewed security cutover','changed'),source+'\n\\connect production',source+'\nALTER SYSTEM SET work_mem=1;'])('rejects malformed wrapper',value=>{
    expect(()=>accountAccessReadTestBody(value)).toThrow();
  });
  it('reader contains no business/Auth DML or secret projections',()=>{
    const body=source.split('AS $reader$')[1].split('$reader$;')[0];
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(body).not.toMatch(/raw_user_meta_data|raw_app_meta_data|encrypted_password|\.email|\bpin\b/);
    expect(source).toContain('STABLE SECURITY DEFINER SET search_path=');expect(source).toContain('SECURITY INVOKER');
  });
  it('refuses an unproven runtime before installing anything',async()=>{
    const query=vi.fn().mockResolvedValue('f');await expect(runAccountAccessRead({query,source})).rejects.toThrow();expect(query).toHaveBeenCalledOnce();
  });
});
