// Split reviewed DDL at top-level statements, keeping every function/DO body
// intact. This is compilation only, never a connection or execution helper.
import {assertPlainSql} from './safety.mjs';
export function reviewedDdlStatements(source){
 assertPlainSql(source);const masked=source.split('');let at=0;
 const hide=(a,b)=>{for(let i=a;i<b;i++)if(masked[i]!=='\n')masked[i]=' ';};
 while(at<source.length){
  const start=at;
  if(source.startsWith('--',at)){at=source.indexOf('\n',at+2);if(at<0)at=source.length;hide(start,at);continue;}
  if(source.startsWith('/*',at)){let depth=1;at+=2;while(depth){if(source.startsWith('/*',at)){depth++;at+=2;}else if(source.startsWith('*/',at)){depth--;at+=2;}else at++;}hide(start,at);continue;}
  if(source[at]==="'"||source[at]==='"'){
   const mark=source[at++],escaped=mark==="'"&&/[eE]/.test(source[start-1]??'')&&!/[\w$]/.test(source[start-2]??'');
   while(at<source.length){if(escaped&&source[at]==='\\')at+=2;else if(source[at]===mark){at++;if(source[at]===mark)at++;else break;}else at++;}hide(start,at);continue;
  }
  const tag=source.slice(at).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
  if(tag){at=source.indexOf(tag,at+tag.length)+tag.length;hide(start,at);continue;}
  at++;
 }
 const code=masked.join(''),out=[];let start=0;
 for(let i=0;i<=code.length;i++)if(i===code.length||code[i]===';'){
  const text=code.slice(start,i).trim();if(text)out.push({text,source:source.slice(start,i===code.length?i:i+1)});start=i+1;
 }
 return out;
}
export function splitReviewedDdl(source,maxCharacters=9000){
 const statements=reviewedDdlStatements(source);
 if(statements[0]?.text!=='BEGIN'||statements.at(-1)?.text!=='COMMIT')throw Error('REVIEWED_DDL_OUTER_TRANSACTION_REQUIRED');
 const body=statements.slice(1,-1);
 if(body.some(x=>/^(BEGIN|COMMIT|ROLLBACK|SELECT|WITH|INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i.test(x.text)))throw Error('REVIEWED_DDL_SCHEMA_ONLY_REQUIRED');
 // Owner metadata permits must stay inside their original single transaction.
 if(/begin_metadata|finish_metadata/.test(source))throw Error('REVIEWED_DDL_METADATA_CONTEXT_MUST_STAY_ATOMIC');
 const groups=[];let group='';
 for(const item of body){if(group&&group.length+item.source.length>maxCharacters){groups.push(group);group='';}group+=item.source;}
 if(group)groups.push(group);
 if(groups.join('')!==body.map(x=>x.source).join(''))throw Error('REVIEWED_DDL_STATEMENT_BYTES_CHANGED');
 return groups.map(x=>"BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL timezone='UTC';\n"+x+'\nCOMMIT;');
}
