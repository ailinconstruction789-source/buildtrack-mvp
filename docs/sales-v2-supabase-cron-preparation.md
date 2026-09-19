# เตรียม Supabase Cron สำหรับ First-contact SLA

วันที่ 18 กันยายน 2569 — ผู้ใช้ยืนยัน Vercel **Hobby** และ Supabase **Pro**; เป็นข้อมูลจากผู้ใช้ ไม่ได้เปิดตรวจบัญชีหรือค่า Compute จริง

## ผลรอบ preflight และสถานะล่าสุด

เตรียม **การตรวจความพร้อมก่อนเชื่อม Cron** ไม่ใช่ตัวประมวลผลอัตโนมัติที่พร้อมติดตั้ง เพิ่ม SQL12 แบบ operator-only/read-only และเครื่องมือคำนวณความจุแบบออฟไลน์ ทดสอบเฉพาะข้อมูลสมมติในเครื่อง **ไม่รัน SQL บน Supabase ไม่ติดตั้ง extension ไม่สร้าง/แก้ job ไม่สร้างบัญชี ไม่ตั้ง token/env ไม่เปิดฟีเจอร์หรือ deploy**

ร่าง SQL12 ยังมี `RAISE EXCEPTION` ก่อน DDL และ `ROLLBACK` ท้ายไฟล์ ห้ามนำไปรันจริง ผู้ใช้ยังไม่ต้องรัน SQL ใด ๆ รอบนี้ไม่มีปุ่มหรือ API ใหม่ในแอป

อัปเดตหลัง preflightในวันเดียวกัน: เตรียม [แกนร่วม09 และ system worker13](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-system-worker.md) แบบจำกัด10งาน และ [durable dispatcher14](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-durable-dispatcher.md) ที่commitคำขอก่อนเรียกworkerแล้ว แต่ยังไม่มีCronจริงหรือการติดตั้ง บทบาทในร่างเป็นNOLOGINยังไม่ผูกผู้เรียกจริง; ข้อความว่า “ยังไม่มีworker” ในหลักฐานรอบpreflightหมายถึงขณะทำรอบนั้น

### เหตุผลที่ยังไม่ผูก Cron กับ SQL11

SQL09/11 ไม่ได้เพียงตรวจว่าเป็น Admin แต่ยังผูกใบรับกับ `auth.users`, บันทึก audit เป็นพนักงาน และคืนข้อมูล actor เป็น Admin การนำไปตั้งเวลาโดยปลอม JWT/ใช้ refresh token ของ Admin/สร้าง Admin ตัวแทน/ใช้ service role จะทำให้สิทธิ์และหลักฐานไม่ตรงความจริง

รอบpreflightยังไม่เปลี่ยนbase/04–11หรือAPI/หน้าจอ ส่วนรอบถัดมาแยกแกน09ให้ระบบใช้ร่วมกันจริง พร้อมตัวตน/ใบรับระบบใน13และdurable dispatcher14แล้ว คงAdmin contractเดิม ไม่คัดลอกสูตรSLAหรือเรียกSQL11โดยสวมAdmin ขั้นถัดไปคือตรวจbinding/timeout/ความจุและmonitoringก่อนต่อCron

## SQL12 ตรวจอะไรได้

ไฟล์ [12_supabase_cron_preflight_draft.sql](D:/buildtrack/buildtrack-mvp-main/sql/sales/12_supabase_cron_preflight_draft.sql) มีสองฟังก์ชันใน `sales_private` แบบ `SECURITY INVOKER` และกำหนด `search_path=pg_catalog`; ถอนสิทธิ์เรียกจาก PUBLIC/anon/authenticated ไม่มี public RPC หรือสิทธิ์เพิ่มให้ Admin ในแอป ผู้ตรวจในอนาคตต้องเป็นผู้ดูแลฐานที่มีสิทธิ์อ่านจริง ไม่ใช่ใช้ฟังก์ชันเพื่อยกระดับสิทธิ์

| ส่วนตรวจ | วิธีตีความ |
|---|---|
| `extension` | ตรวจการติดตั้ง pg_cron และสมาชิก extension ของ cron.job/API ตาม signature ที่คาดไว้; มีชื่อตาราง/ฟังก์ชันเหมือนกันยังไม่ถือว่าเป็น extension จริง |
| `inventory` | ตรวจรูปตาราง/ชนิดคอลัมน์/USAGE/SELECT และ RLS ของ `current_user`; ตรวจไม่ครบคืน unknown/null ไม่แทนด้วยศูนย์ |
| `reservedNameCount` | ชื่อที่เสนอ `buildtrack-sales-first-contact-v1` รวมงานปิด งานต่างเจ้าของ และต่างฐานด้วย; มากกว่าศูนย์ต้องตรวจเจ้าของ/ที่มา ห้ามเขียนทับ |
| `knownCommandCount` | นับข้อความอ้างตัวประมวลผล09/11, worker13, dispatcher prepare/execute/tick14; ไม่รับรองwrapper/ชื่ออื่น ข้อความในcomment/literalอาจติดด้วย จึงเป็นเพียงสัญญาณให้ตรวจ |
| `settings` | อ่านสวิตช์เดิม8ตัวเป็นsnapshotไม่แก้ค่า; ไม่มีแถวหรือสิทธิ์ไม่ครบเป็นunknown; ไม่ใช่ผลตรวจworker/dispatcher gateตัวที่9–10หรือยืนยันการติดตั้ง13–14 |
| `cycleCandidates` | นับตาม filter เดียวกับ SQL11 ไม่เกิน901แถว ไม่ใช่จำนวนคนที่ควรได้รับแจ้งเตือน; ยังรวม held/legacy/ยังไม่ถึงกำหนด |
| `automationReady` | คืน **false เสมอ** พร้อม `CRON_BINDING_NOT_VALIDATED` แม้flagsครบและไม่มีชื่อซ้ำ; ไม่รับรองการติดตั้งworker/dispatcherหรือความพร้อมเปิดจริง |

`inventoryComplete` หมายถึงเห็นรายการใน relation ที่ตรวจครบด้านสิทธิ์ **ไม่ยืนยัน authenticity ของ extension** ต้องอ่าน `extension.catalogOwnedByExtension` แยกกัน และยังต้องตรวจ wrapper อื่นโดยผู้ดูแล ไม่มีรายงานใดในรอบนี้อนุมัติให้เปิดระบบ

ผลไม่แสดง SQL command จริง ชื่อบัญชี/ฐานลูกค้า token เบอร์โทร รายได้ ข้อมูลเวร หรือข้อความผิดพลาดที่อาจมีความลับ ไม่มีการลบ/ย้าย/ปิด Cron ของระบบอื่น

ฟังก์ชันอ่านไม่ล็อกสถานะไว้ จึงอาจเปลี่ยนหลังรายงาน ต้องตรวจซ้ำภายใต้การควบคุมของผู้ดูแลก่อนติดตั้งจริง `LIMIT901` จำกัดจำนวนแถวผลลัพธ์ ไม่รับประกัน CPU/ระยะเวลารวม ควรกำหนด statement timeout ที่ระดับ session ของผู้ตรวจใน staging ที่ได้รับอนุญาต

## ความถี่ต้องสัมพันธ์กับจำนวนงาน

[cron-capacity.mjs](D:/buildtrack/buildtrack-mvp-main/scripts/sales-runtime/cron-capacity.mjs) เป็น pure helper สำหรับทดสอบเลขเท่านั้น ไม่อ่าน env/ฐาน ไม่เปิด timer ไม่เชื่อมเครือข่าย และไม่มีผู้เรียกในแอป production

รับจำนวน candidate พร้อมคำยืนยันว่าเป็นจำนวนแน่นอนหรือเพียงขอบล่าง, ตำแหน่งเริ่ม sweep, ช่วง tick, จำนวน cycle ต่อ tick และงบเวลาต่อ cycle **ที่ต้องมาจากการทดสอบโหลด** ใช้ cap10 เดิม ไม่เปลี่ยนกติกา SLA

- 901แถวที่ชนเพดานตัวอย่างถือเป็นขอบล่าง แม้จริงอาจมีพอดี901 ไม่ยืนยันจำนวนหรือความจุพอจากรายงานนี้
- ค่าขั้นต่ำ `minimumCyclesAtCurrentCap` ใน SQL ไม่รวมการรอ ล็อก retry หรือขอบเขต cursor; helper เผื่อเพิ่มหนึ่ง cycle ถ้าไม่ยืนยันว่า cursor เริ่มหัวชุด
- งบงานต่อ tick ต้องน้อยกว่าช่วง tick ไม่ยอมถือว่าปลอดภัยเมื่อกินเวลาครบพอดี
- คำนวณเวลารอ tick แรกและเวลาจบรอบสุดท้ายด้วย ไม่ดูแค่จำนวนรอบต่อชั่วโมง
- `fitsWarningWindowInModel` เป็นผลเลขของ workload คงที่ในแบบจำลองเท่านั้น; `guaranteesDelivery=false` เสมอ ไม่ใช่การรับรองว่าจะเตือนได้ตรงก่อนกำหนด30นาที

ตัวอย่างสมมติ **895งาน, 1วินาทีต่อcycle, ทุก1นาที, เริ่มหัวชุด, ไม่มี error/งานใหม่**:

| จำนวน cycle ต่อ tick | ระยะกวาดทั้งชุดในแบบจำลอง |
|---|---|
| 1 | 90นาที1วินาที — ไม่ทันช่วงเตือน30นาที |
| 5 | 18นาที5วินาที — ยังไม่รับรองความหน่วงการเตือนที่ยอมรับได้ |

ไม่ได้อ้างว่าข้อมูลเก่า895รายการทั้งหมดเป็น candidate หรือว่าหนึ่ง cycle ใช้1วินาทีจริง ตัวเลข5ไม่ได้ถูกตั้งใช้งาน ก่อนเปิดต้องวัด scan latency/backlog ภายใต้จำนวนงาน/เวรจริงและ contention รวมถึงการชะงักเมื่อมีงานผิดโครงสร้าง การเข้า Pro ไม่ยืนยันขนาด Compute หรือความจุที่เพียงพอ

## แผนเชื่อมจริงหลังผ่านขั้นนี้

1. **แกนประมวลผลร่วม:** แยก business core ของ SQL09 โดยคง contract Admin เดิม ตรวจผู้เรียกก่อนเข้าถึงแกน ไม่ให้ client ส่ง actor/system flag ที่ยกระดับตนเอง ตรวจ manual/system parity ของกติกา24ชั่วโมง/120นาทีทำงาน/เตือน30นาที
2. **ตัวตนระบบและใบรับ:** งานระบบบันทึก provenance เป็น system ไม่เป็น Admin หรือให้เครดิต Sales/KPI; ออกแบบ ledger/run identity และการกู้คืนอย่างทนทาน ไม่ใช้ receipt ของ Admin คนใดเป็นเจ้าของงานอัตโนมัติ
3. **หนึ่งคำสั่ง DB ที่จำกัดขอบเขต:** รักษาลำดับล็อก SQL09/11, notification dedupe, cursor และ atomicity เดิม กำหนด kill switch ค่าเริ่มปิด, timeout, retry/backoff, error/backlog monitoring ไม่วนจนหมดข้อมูลแบบไม่จำกัด ไม่เพิ่ม COMMIT ลงใน SECURITY DEFINER เพื่อแบ่ง transaction โดยพลการ
4. **ทดสอบ worker ในฐานแยก:** manual กับ system พร้อมกัน, jobซ้ำ, ใบรับหลังการเชื่อมต่อขาด, ถอนสิทธิ์/เปลี่ยนเวร/เปลี่ยนเจ้าของ, poison batch, rollback และปิดสวิตช์ ต้องไม่เขียนข้อมูลธุรกิจซ้ำ
5. **ตรวจ staging ที่อนุญาต:** schema/grants/trigger/version/extension/API, บทบาทที่ Cron ใช้จริง, throughput, failure recovery และกระบวนการคงหลักฐาน ต้องไม่อนุมานว่าการจำลอง catalog ผ่านคือทดสอบ pg_cron ผ่าน
6. **เตรียม migration และลงทะเบียนแบบปิด:** ผู้ใช้อนุมัติแยกก่อนติดตั้งจริง ตรวจชื่อซ้ำภายใต้การควบคุมของผู้ดูแล แล้วจึงสร้างเฉพาะ job ของเราเป็น `active=false` ใน migration ที่ตรวจรับ ห้ามอาศัย upsert ชื่อเดิมโดยไม่ตรวจ ไม่เปิดสองตัวตั้งเวลาคู่กัน
7. **เปิดภายหลังผู้ใช้อนุมัติ:** ตรวจรอบแรก/เวลารอ/แจ้งเตือน/ความซ้ำ มีวิธีปิดเฉพาะ job ของเราและสวิตช์ระบบ ไม่ถอด pg_cron ทั้ง extension เพราะกระทบงานอื่น

รายการนี้เป็นลำดับตรวจรับ ไม่ใช่คำสั่งให้รันหรือหลักฐานว่าขั้น1–7เสร็จแล้ว รอบpreflightทำเฉพาะรายงาน/แบบจำลอง/เอกสาร ต่อมาทำshared core/worker/ledger/durable intentและbounded retry/backoffพร้อมทดสอบกรณีหลักของข้อ1–4ในเครื่องแล้ว แต่monitoring/การแก้review/workloadจริง/privilege bindingยังไม่เสร็จ ข้อ5–7ยังไม่ได้ดำเนินการ

## หลักฐานรอบ preflight และข้อจำกัดการทดสอบ

- baseline เดิม Vitest3,830ข้อ/74ไฟล์ผ่านก่อนเพิ่มชุดนี้
- SQL12 มี static source guards และ execute ใน PostgreSQL แยกของตัวรันเดิม พร้อม assertion ว่าการอ่านไม่เปลี่ยน settings/ลูกค้า/งาน/แจ้งเตือน/audit/ใบรับ/cursor หรือ job
- ชุดทดสอบสร้าง `cron.job`/API จำลองและบทบาททดสอบเฉพาะใน transaction ที่ ROLLBACK ไม่มีการติดตั้ง pg_cron/launcher จริง ไม่แก้ pg_extension/pg_depend เพื่อปลอมว่าติดตั้งแล้ว
- ทดสอบ unknown เมื่อขาดสิทธิ์, RLSซ่อนรายการ, relation/ชนิดคอลัมน์ผิด, ชื่อซ้ำงานปิด/ต่างเจ้าของ, ไม่แสดงความลับ, 895/901/เกิน901 candidate และสวิตช์เดิมครบแต่ automation ยังปิด
- ผลรุ่นสุดท้ายและรายงานการหยุดฐานอยู่ใน [รายงานฐานแยก](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-isolated-database-tests.md)
- ผลยืนยันสุดท้าย: Vitest3,870ข้อ/76ไฟล์ผ่านแบบเรียงลำดับ, SQL preflight31assertionsและชุดฐานเดิมทั้งหมดผ่าน, TypeScript/scoped ESLintผ่าน ฐานทดสอบหยุดทั้งหมด; ไม่แก้UI/timeoutหลังพบ4กรณีUIสะดุดในรอบที่รันหลายชุดพร้อมกัน
- ไม่ทดสอบการลงทะเบียน/ตื่นตามเวลาของ pg_cron จริง, Supabase JWT/PostgREST, production migration หรือ SLA latency จริง ไม่รัน build/E2E ใหม่เพราะไม่เปลี่ยน UI/API/โค้ด production ของแอป

## แหล่งอ้างอิงที่ตรวจ18กันยายน2569

- [Supabase Cron](https://supabase.com/docs/guides/cron): เรียก SQL/function ในฐานได้และมีประวัติรัน; คำแนะนำด้านประสิทธิภาพไม่เกิน8งานพร้อมกันและไม่เกิน10นาทีต่อjob ไม่ใช่ค่าตั้งของระบบเรา
- [ติดตั้ง Cron](https://supabase.com/docs/guides/cron/install): ต้องเปิด pg_cron; ถอด extension จะลบ jobs ทั้งหมด จึงไม่ใช้เป็นวิธี rollback ของงานเดียว
- [Cron Quickstart](https://supabase.com/docs/guides/cron/quickstart): ใช้ชื่อ job ซ้ำสามารถเขียนทับของเดิม จึงต้องตรวจ collision ก่อน
- [pg_cron ต้นทาง](https://github.com/citusdata/pg_cron): job ID เดียวกันทำทีละ instance แต่สะสมคิวได้; jobคนละIDแม้ชื่อซ้ำต่างเจ้าของอาจทำพร้อมกัน จึงยังต้องมี application locks/idempotence; รองรับพารามิเตอร์ active ใน APIลงทะเบียน
- ตรวจชนิดคอลัมน์จาก [SQLอัปเกรดเป็น1.5](https://github.com/citusdata/pg_cron/blob/main/pg_cron--1.4-1--1.5.sql): `jobname` เปลี่ยนจาก PostgreSQL `name` เป็น `text`; preflightนี้คาดรูปคอลัมน์รุ่น1.5ขึ้นไป รุ่นเก่าหรือรูปไม่ตรงจะเป็น unexpected_catalog ต้องตรวจรุ่นจริงก่อนใช้ ไม่เหมารวมว่าทุกรุ่นเข้ากันได้
- [Vercel Hobby](https://vercel.com/docs/plans/hobby): เงื่อนไข non-commercial/personalยังแยกจาก Supabase Pro ต้องจัดการโฮสต์สำหรับการใช้งานบริษัทก่อน production; ไม่มีการเปลี่ยนแพ็กเกจในรอบนี้
