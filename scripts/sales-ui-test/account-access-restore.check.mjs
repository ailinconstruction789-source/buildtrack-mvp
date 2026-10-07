// Visits ONLY the development-only synthetic page on the already-running local
// dev server. No authenticated storage, no API requests, no server start/stop.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const origin='http://localhost:3000';
const output='node_modules/.cache/account-access-restore';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
try {
  for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    const context=await browser.newContext({viewport,serviceWorkers:'block'});
    const prohibited=[],errors=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin || url.pathname.startsWith('/api/')) {prohibited.push(url.origin+url.pathname);await route.abort();}
      else await route.continue();
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/dev/account-access/directory',{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Sales ตัวอย่าง B'}).waitFor();
    assert.equal(await page.getByRole('article').count(),5);
    assert.equal(await page.getByRole('button',{name:'ตรวจและรับรองคืนสิทธิ์'}).count(),1);
    await page.getByRole('button',{name:'ตรวจและรับรองคืนสิทธิ์'}).click();
    const panel=page.getByRole('region',{name:'รับรองคืนสิทธิ์ Sales'});
    assert.equal(await panel.getByRole('button',{name:'ยืนยันรับรองคืนสิทธิ์'}).isDisabled(),true);
    await panel.getByLabel(/เหตุผล \/ หลักฐาน/).fill('ทดสอบด้วยบัญชีสมมติ ตรวจตัวตนและความพร้อมแล้ว');
    await panel.getByRole('checkbox').check();
    await panel.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await page.screenshot({path:`${output}/${name}-form.png`,fullPage:true});
    await panel.getByRole('button',{name:'ยืนยันรับรองคืนสิทธิ์'}).click();
    await panel.getByText('บันทึกการรับรองแล้ว · รุ่น 2').waitFor();
    const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Sales ตัวอย่าง B'})});
    await card.getByText('เปิดใช้งาน',{exact:true}).waitFor();
    assert.equal(await card.getByText(/บัญชีถูกแบน/).count(),1);
    assert.equal(await page.getByRole('button',{name:'ตรวจและรับรองคืนสิทธิ์'}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await page.screenshot({path:`${output}/${name}-success.png`,fullPage:true});
    await panel.getByRole('button',{name:'ปิดผลการรับรอง'}).click();
    await page.getByLabel('สถานะสิทธิ์').selectOption('awaiting_review');
    await page.getByRole('button',{name:'ค้นหา',exact:true}).click();
    await page.getByText('ไม่พบบัญชีฝ่ายขายที่รับรองแล้วตามตัวกรองนี้').waitFor();
    await page.reload({waitUntil:'networkidle'});
    await page.getByRole('button',{name:'ตรวจและรับรองคืนสิทธิ์'}).waitFor();
    assert.deepEqual(prohibited,[]);assert.deepEqual(errors,[]);
    results.push({viewport:name,restoredSyntheticB:true,retainedSuspension:true,refreshResets:true,apiRequests:0,externalRequests:0,pageErrors:0});
    await context.close();
  }
  console.log(JSON.stringify({results,output}));
} finally {await browser.close();}
