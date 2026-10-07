# External snapshot: private staging ก่อนเชื่อม CRM

29 กันยายน 2569 — **ร่างในเครื่องเท่านั้น ไม่ใช่ migration พร้อมใช้จริง**

## ทำแล้วในรอบนี้

`sql/sales/external_snapshot_staging_draft.sql` เตรียมโครงสร้างแยกจาก foundation เดิม ไม่แก้ `public.sales_customers`, `public.sales`, `public.leads`, โครงการ/แปลง, Auth, สิทธิ์พนักงาน หรือ feature flags ใช้กับร่าง `sheet-snapshot-plan-v1` จากขั้นก่อนหน้า ไม่สร้าง legacy Lead ปลอมเพื่อผ่าน FK

SQL ต้นฉบับมี guard หยุดทันทีและจบด้วย ROLLBACK ไม่เพิ่มลง migration directory ไม่สร้าง migration history ตัวทดสอบแกะ guard **ในหน่วยความจำเฉพาะฐานจำลองใหม่ที่ตรวจว่าเป็นของตัวรันทดสอบแล้ว** ห้ามคัดลอก body ไปใช้จริงหรือ `supabase db push`

## โครงสร้างใน `crm_external_private`

| ตาราง | หน้าที่ |
|---|---|
| snapshot_batches | เก็บแผนเต็มพร้อม file hash, plan digest และเวลารับหลักฐาน; เวลารับไม่ใช่วันเริ่ม Lead/KPI |
| customer_candidates | ตัวบุคคลตามคำยืนยัน เช่น N001 หนึ่งคน; เบอร์/วันเริ่ม Lead ไม่ทราบเป็น null และเจ้าของที่ขาดต้องพัก |
| interest_candidates | ความสนใจแยกตามลูกค้าและโครงการ; เจ้าของแยกจากส่วนกลาง; สถานะเก่าที่ไม่ทราบไม่ถูกเติมเป็น new |
| source_records | เก็บแถวต้นฉบับ ค่าดิบ วันที่แก้ตามคำยืนยัน ประเด็นตรวจ และรายการรอ Admin; แถวไม่มีชื่อไม่ถูกทิ้ง |
| booking_history | เก็บแต่ละประวัติจอง/ยกเลิก/โอน ไม่ทำให้แปลงถูกจองจริง; ประวัติไม่มีแปลงต้องมีเหตุผลพัก |

ตารางลูกเชื่อมภายใน batch ด้วย composite FK และ unique constraints เพื่อป้องกันโยงลูกค้า/ความสนใจ/แถวประวัติผิดกัน มีดัชนีสำหรับ FK หลัก ไม่มี FK ไปยังบัญชีจริงหรือทะเบียนแปลงจริงใน staging: ชื่อ login/project/plot ที่ตรวจเป็นหลักฐาน mapping เท่านั้น ต้องตรวจ binding สดในขั้นเชื่อม CRM

ร่างเก็บแผนเต็มและ projection ของแต่ละส่วนเพื่อเทียบ replay กับตรวจความสัมพันธ์ จึงมีข้อมูลส่วนบุคคลซ้ำในพื้นที่ private บางส่วน ยังต้องกำหนดระยะเก็บหลักฐานและสิทธิ์ผู้ดูแลก่อนใช้จริง ไม่มี writer/API สำหรับรับข้อมูลจริงหรือเปิดอ่านหลักฐานผ่าน browser ในรอบนี้

## การรันซ้ำและความครบถ้วน

- `stage_snapshot` เป็น `SECURITY INVOKER`, search_path ว่าง ไม่มีการยกระดับสิทธิ์ของผู้เรียก
- รุ่นแรกตรึง **หนึ่ง full snapshot สำหรับ customer-sheet** ด้วย unique feed ซึ่ง caller เปลี่ยนชื่อเพื่อเลี่ยงไม่ได้ ไม่มี DO UPDATE หรือการต่อท้ายไฟล์รุ่นใหม่เป็นลูกค้าชุดใหม่
- ชุดเดิมทุกส่วนตรงกัน: คืน batch ID เดิมและ `replayed=true` ตรวจยอดตารางลูกอีกครั้ง ไม่เพิ่มลูกค้าหรือธุรกรรม
- ไฟล์/แผน/mapping/ค่าดิบเปลี่ยนแม้ส่ง digest เดิม: เปรียบเทียบ JSON ทั้งแผนแล้วหยุดให้ทบทวน ไม่เขียนทับหลักฐาน
- สองคำขอแข่งขันกันถูก serialize ด้วย unique conflict และ row lock; isolation ที่เข้มกว่านี้อาจต้อง retry transaction ตามปกติ ไม่ retry ข้อผิดพลาดด้านข้อมูลอัตโนมัติ
- ตรวจ membership ของ customer กับทุก source row, interest กับ source/customer, booking กับ source/customer/interest และเทียบรายละเอียด booking กับหลักฐานหลัง mapping
- source ที่ชื่อ/เจ้าของขาดต้องพัก และแถวพักต้องตรงรายการ holds ไม่สามารถตัดประวัติ booking ทิ้งจาก payload เงียบ ๆ
- ความผิดพลาดระหว่างนำเข้า rollback ทั้ง statement/transaction ไม่มี batch/ข้อมูลลูกค้างครึ่งชุด
- UPDATE/DELETE/TRUNCATE ถูก append-only trigger ปฏิเสธ รวม caller ที่เป็นเจ้าของตารางตามปกติ; ไม่อ้างว่าป้องกัน superuser ปิด trigger/เปลี่ยน DDL ได้

**ขอบเขต:** นี่เป็น replay ของ staging เท่านั้น ไม่ใช่ replay ของการเขียน CRM/เปลี่ยนสถานะแปลง และไม่ใช่ permanent identity registry ข้ามรุ่นไฟล์ `planDigest` ไม่ใช่ลายเซ็นอนุมัติ ตัวฟังก์ชัน SQL ไม่รับรองว่าชุดแรกได้รับอนุมัติจริงหรือคำนวณ JS fingerprint ซ้ำ ต้องตรวจด้วยตัวเตรียมและกระบวนการอนุมัติก่อนใช้ writer จริง

การแก้รายการรอ Admin/เปลี่ยนผู้ดูแลในอนาคตต้องเก็บคำยืนยันรุ่นใหม่แยกจากหลักฐานเดิม และมี reconciliation ที่ทบทวนแล้ว รุ่นนี้จงใจปฏิเสธการเปลี่ยนแผนหลัง stage ยังไม่มี UI ปลดพักหรือคำสั่งแทนที่ snapshot

## การปิดสิทธิ์

ทุกตารางเปิด RLS และไม่มี client policy; ปิด schema/table/function grants ของ PUBLIC และทุก default grantee ที่ไม่ใช่เจ้าของ object รวม service_role และ role กำหนดเอง ไม่แก้ default privileges หรือสิทธิ์ตารางเดิมของฝ่ายอื่น ไม่มี public RPC และไม่ควรเพิ่ม schema นี้เข้า Data API

ตรวจตาม Supabase/Postgres skills: ใช้สิทธิ์ผู้เรียก, ปิด default EXECUTE, ตรวจ RLS/ACL, ใช้ FK/index และ atomic conflict handling อ้างอิง [Database Functions](https://supabase.com/docs/guides/database/functions) ตรวจ changelog PG 17.11 แล้ว; ร่างนี้ไม่เพิ่ม ltree/btree_gist/custom operators/legacy pgcrypto ciphers ตาม [ข้อเปลี่ยนแปลง PostgreSQL](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) ไม่ได้ตรวจหรืออัปเกรดฐานจริง

## หลักฐานทดสอบ

- Native PostgreSQL **17.11**, ข้อมูลสมมติเท่านั้น ไม่มีโหลด `.env`, URL ฐานจริง หรือข้อมูลลูกค้าจริง
- `node scripts/sales-runtime/run.mjs --external-snapshot-only` ใช้ portable PostgreSQL เดิม สร้างฐาน/พอร์ต/บัญชีสุ่มใหม่บน loopback และหยุดฐานหลังจบ
- รอบสุดท้าย `node_modules/.cache/buildtrack-sales-runtime/runs/run-uT3ID7/report.json`: **71 checks ผ่าน**, `stopped=true`
- Vitest เฉพาะส่วนที่เกี่ยวข้อง **249/249 ผ่านใน 7 ไฟล์** (runtime safety, external staging, foundation candidate และ sheet reviews) ไม่ใช่การรัน full app; ESLint เฉพาะไฟล์ JavaScript ที่แก้ผ่าน
- ทดสอบคำขอชุดเดิมพร้อมกัน 3 ครั้ง ได้ batch เดียว/insert ครั้งเดียว, retry ไม่เพิ่มยอด, เปลี่ยน raw payload โดย digest เดิมถูกปฏิเสธ, ประวัติไม่ครบ/FK ผิด/ปลดพักเองถูกปฏิเสธและไม่เหลือข้อมูลบางส่วน
- ทดสอบ rollback ชุดที่ถูกต้องทั้ง transaction, UPDATE/DELETE/TRUNCATE guard, RLS เมื่อมี SELECT grant โดยผิดพลาด, writer ไม่ bypass สิทธิ์ และคำสั่ง/ข้อมูล sentinel ของฝ่ายอื่นไม่เปลี่ยน
- ไม่ใช่ full app/E2E, Supabase Auth integration, load benchmark, backup restore ของ production หรือความเข้ากันได้กับ schema จริงทุกฝ่าย ไม่ทดสอบไฟล์ลูกค้าจริงในฐานจำลองรอบนี้

## งานถัดไปก่อนใช้จริง

อัปเดตรอบถัดมา: identity bridge ของลูกค้า/ความสนใจและลิงก์ประวัติจองเตรียมและทดสอบบน sealed foundation แล้ว ดู `sales-external-crm-bridge.md` ยังไม่เขียน public.sales/สถานะแปลงหรือเปิดสิทธิ์ จึงไม่ถือว่างาน booking/inventory cutover ด้านล่างเสร็จ

1. ออกแบบและทดสอบ bridge จาก external source ไป CRM โดยไม่คลายกฎ live intake: origin/FK ที่ไม่อิง legacy Lead, historical interest status และ booking ที่ข้อมูลไม่ครบ
2. ทดสอบ bridge กับ foundation ที่ปิดอยู่ รวมรันซ้ำ/คืน transaction/สิทธิ์/แปลง โดยไม่มีคำสั่งเปิด flag หรือแก้ประวัติเดิมโดยอัตโนมัติ
3. ตรวจบัญชี/ความเชื่อมโยงงานฝ่ายอื่น/สำเนาล่าสุดและแผนคืนระบบ ขออนุมัติ candidate และ cutover แยกก่อนเขียนฐานจริง

ยังคง `importReady=false`, `productionChanged=false`, `liveRowsWritten=0`; ไม่มีการลบข้อมูล เปลี่ยน Google Sheets, Deploy, รัน SQL บน Supabase หรือเปิด Lead ส่วนกลางในรอบนี้
