// Bounded mechanical release preparation. No commit, push, network or SQL.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { VISIT_BASELINE, VISIT_OVERLAY } from './visit-selection.mjs';
const root = 'D:/buildtrack/buildtrack-mvp-main';
const destination = 'C:/Users/HUAWEI/.codex/worktrees/account-guard-release/buildtrack-mvp-main';
const patchExe = 'C:/Users/HUAWEI/AppData/Local/OpenAI/Codex/bin/faa963e871dd422c/codex.exe';
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${destination}`, '-C', destination, ...args], {encoding:'utf8'});
const report = JSON.parse(readFileSync(join(root,'.next/release-check/app-cBYCJY/release-report.json'),'utf8'));
const normalized = text => text.replaceAll('\r\n','\n');
assert.equal(git('rev-parse','HEAD').trim(),VISIT_BASELINE);
assert.equal(report.status,'passed');
assert.equal(report.sourceFilesUnchanged,true);
const changed = [...git('diff','--name-only').trim().split('\n'), ...git('ls-files','--others','--exclude-standard').trim().split('\n')].filter(Boolean);
assert.ok(changed.every(path=>VISIT_OVERLAY.includes(path)), 'Unrelated worktree changes');
for (const path of VISIT_OVERLAY) {
  const source=readFileSync(join(root,path),'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),report.overlayHashes[path],`Source changed: ${path}`);
  if (changed.includes(path)) assert.equal(normalized(readFileSync(join(destination,path),'utf8')),normalized(source),`Unexpected existing edit: ${path}`);
}
function patch(body) {
  execFileSync(patchExe,['--codex-run-as-apply-patch',`*** Begin Patch\n${body}\n*** End Patch`],{encoding:'utf8',maxBuffer:1024*1024,windowsHide:true});
}
for (const path of VISIT_OVERLAY) {
  const target=join(destination,path).replaceAll('\\','/');
  const source=normalized(readFileSync(join(root,path),'utf8'));
  const old=existsSync(target)?normalized(readFileSync(target,'utf8')):null;
  if(old===source)continue;
  const newer=source.replace(/\n$/,'').split('\n');
  if(old===null){
    let offset=0;
    while(offset<newer.length){
      let end=offset, size=0;
      while(end<newer.length && size+newer[end].length<11000){size+=newer[end].length+2;end++;}
      assert.ok(end>offset,'Unusually long source line');
      if(offset===0)patch(`*** Add File: ${target}\n${newer.slice(offset,end).map(line=>'+'+line).join('\n')}`);
      else patch(`*** Update File: ${target}\n@@\n${newer.slice(Math.max(0,offset-5),offset).map(line=>' '+line).join('\n')}\n${newer.slice(offset,end).map(line=>'+'+line).join('\n')}\n*** End of File`);
      offset=end;
    }
  } else {
    // Existing files use git's read-only diff solely to obtain narrow patch hunks.
    let diff='';
    try {diff=execFileSync('git',['diff','--no-index','--',target,join(root,path)],{encoding:'utf8',maxBuffer:16*1024*1024});}
    catch(error){if(error.status!==1)throw error;diff=error.stdout;}
    const lines=normalized(diff).split('\n');
    const start=lines.findIndex(line=>line.startsWith('@@'));
    assert.ok(start>=0,`Missing diff: ${path}`);
    const hunks=lines.slice(start).filter(line=>!line.startsWith('\\ No newline')).join('\n').trimEnd().replace(/^@@.*@@.*$/gm,'@@');
    assert.ok(hunks.length<26000,`Oversized existing-file patch: ${path}`);
    patch(`*** Update File: ${target}\n${hunks}`);
  }
  assert.equal(normalized(readFileSync(target,'utf8')),source,`Copy mismatch: ${path}`);
  console.log(`Verified ${path}`);
}
console.log(`Prepared ${VISIT_OVERLAY.length} manifest files; no commit/push performed.`);
