# External snapshot → CRM identities (sealed bridge)

29 กันยายน 2569 — ทำและทดสอบในเครื่องเท่านั้น ไม่ใช่ชุดเปิดใช้งานจริง

## ผลที่ทำแล้ว

ร่าง `sql/sales/external_crm_bridge_draft.sql` เชื่อม private staging เข้าตาราง CRM ของ **sealed foundation ตัวจริง** ในฐานจำลอง ไม่สร้างตาราง CRM ทดแทนเพื่อให้ test ผ่าน และไม่แก้ foundation candidate เดิม

- ลูกค้าที่ผ่านการตรวจสร้างใน `public.sales_customers`; ผู้ดูแลว่าง/ชื่อขาดคงอยู่ staging ไม่ถูกมอบหมาย Admin แทน
- ความสนใจสร้างใน `public.lead_project_interests` แยกผู้ดูแลรายโครงการ และเก็บ `legacy_unclassified` แทนการเดาว่า new/follow_up
- N001 แบบจำลองมีลูกค้าหนึ่งคน ผู้ดูแลส่วนกลาง JEEJEE ขณะที่อีกโครงการยังเป็น PIEW และมีประวัติจองสองรายการแยกกัน
- ประวัติจองทั้งหมดเชื่อมผ่าน `crm_external_private.booking_crm_links` ไปยังลูกค้า/ความสนใจ/แปลงที่ตรวจ ถ้าไม่มีแปลงยังเก็บประวัติไว้ ไม่สร้างแปลงทดแทน
- **ไม่มีการเขียน `public.sales` หรือเปลี่ยน `public.plots`** จึงยังไม่แสดงเป็นลูกค้าจองในหน้าโครงการหรือถือครองแปลงจริง นั่นเป็นขั้น inventory/booking cutover ถัดไป

ข้อมูลใช้ในการทดสอบทั้งหมดเป็นข้อมูลสมมติ ไม่ได้นำลูกค้าจริง 963 รายการเข้าฐานใดในรอบนี้

## Provenance และข้อมูลไม่ทราบ

ใช้ `record_origin='legacy_import'` ในความหมายข้อมูลประวัติเก่า เพื่อคงสัญญาเดิมของ SLA/ตัวอ่าน โดยบังคับเลือกหลักฐานอย่างใดอย่างหนึ่งเท่านั้น:

1. `legacy_source_lead_id` อ้างอิง Lead ในฐานเดิม โดยช่อง external ว่างทั้งคู่ หรือ
2. `external_snapshot_batch_id + external_customer_key` อ้างอิง candidate ใน staging โดย `legacy_source_lead_id` ว่าง

ใช้ `MATCH FULL` และ check ปฏิเสธช่อง external ครึ่งคู่ ไม่มีหลักฐาน หรือมีหลักฐานสองสาขาพร้อมกัน ไม่ปลอมแถว `public.leads` และไม่ใช้ชื่อ/เบอร์เป็นรหัสลูกค้าถาวร

กฎ Lead ใหม่ยังต้องมีเบอร์จริงและวันเริ่ม Lead ตามเดิม ส่วนข้อมูล external คงเบอร์/วันเริ่ม Lead/วันติดต่อครั้งแรกเป็น null ความสนใจไม่ทราบวันเกิดใช้ `interest_created_at=null` เฉพาะแถว external ที่มีหลักฐาน เวลาบันทึก `created_at`/มอบหมายเจ้าของปัจจุบันไม่ถูกนำไปแทนวันที่ประวัติหรือ KPI ไม่มีสร้าง Visit, Voices, activity หรือ SLA task ย้อนหลัง

ความสนใจยังเป็น `central_interest`, ไม่มีวันเปิดงาน/เหตุผลเปิดงาน/แปลงเป้าหมายที่เลือกใหม่ หลักฐานแปลงที่เคยสนใจยังอยู่ staging เพราะการนำเข้าประวัติไม่ใช่การเลือกแปลงว่าง ณ ปัจจุบัน

## สิทธิ์และการปิดระบบ

- ตัวเชื่อมเป็น private `SECURITY INVOKER` อนุญาตเฉพาะ SQL owner ของ staging ไม่มี browser RPC; ต้องอ้างอิง Admin ที่ตรวจสิทธิ์แล้วและยังใช้ได้
- ทุก Sales binding ต้องตรงชื่อบัญชี/Auth UUID/review revision ปัจจุบัน เป็น Sales ที่เปิดสิทธิ์และไม่ถูกแบน/ลบ/anonymous ไม่เพิ่มหรือเปิดสิทธิ์จากชื่อในไฟล์ ไม่แก้ role table ด้วย bridge
- ปิด table/function grants รวม default grants ของ role กำหนดเอง ตาราง private ใหม่มี RLS
- แถว CRM external ที่สร้างแล้วถูก seal ปฏิเสธ UPDATE/DELETE จนมี release ที่ตรวจใหม่
- เพิ่ม guard บน `crm_settings` ปฏิเสธการเปิด flag `*_enabled` และ `booking_cutover_reviewed` แม้ SQL owner เปลี่ยนเองตามปกติ ต้องออกแบบ release guard ใหม่ก่อน ไม่ใช่เปิดสวิตช์ให้ผ่าน

เหตุผล: คำสั่ง booking/lifecycle/visit เดิมบางจุดตรวจแค่ lost หรือ legacy_source_lead_id การมีสถานะ `legacy_unclassified` อย่างเดียว **ไม่พอป้องกันเขียนงาน** และประวัติที่อยู่ private ยังไม่ถูกนับโดยคำสั่งปิด Lost/report เดิม

ตัวอ่าน `projectInterestsContracts.ts` และ `visitSopContracts.ts` รองรับ historical unknown แบบ read projection เพิ่มแล้ว โดย SOP ปฏิเสธ `canWrite=true` สำหรับสถานะนี้ ไม่เพิ่มสถานะนี้เข้า `INTEREST_STATUSES` ที่ใช้รับคำสั่งจาก Sales ไม่เปลี่ยน UI flag หรือเปิด route

## การรันซ้ำและการล็อก

ล็อก batch เพื่อให้คำขอพร้อมกันสร้าง CRM ได้ชุดเดียว เก็บ receipt และคืน IDs เดิมเมื่อแผน/ผู้ตรวจ/บัญชี/เลข revision/หลักฐานตรวจเหมือนเดิม การเรียงรายการ bindings ต่างกันไม่ทำให้ซ้ำ แต่คำยืนยันเปลี่ยนต้องหยุด Replay ตรวจบัญชีและทะเบียนปัจจุบัน รวมจำนวน materialized rows และ booking link membership อีกครั้ง

ใช้ lock เดียวกับการ review สิทธิ์ และถือ share lock ของบัญชี/สิทธิ์ รวมโครงการและแปลงที่เกี่ยวข้องก่อนตรวจ membership จน commit จึงกันการย้ายแปลงข้ามโครงการระหว่างตรวจและบันทึกได้ ถ้ารอ lock ไม่สำเร็จให้หยุด/rollback ไม่เพิ่ม timeout อัตโนมัติ ไม่มีการรับประกันว่าการติดตั้งจริงไม่มี lock ต่อฝ่ายอื่น

SQL ต้นฉบับยังมี DESIGN ONLY guard + ROLLBACK; ไม่สร้าง migration file หรือ deployment history ไม่มีคำสั่งลบ snapshot/แทนที่ข้อมูลจริง/ปลด seal อยู่ในร่างนี้

## ผลทดสอบ

- เรียก `node scripts/sales-runtime/run.mjs --external-crm-bridge-only` ใช้ฐาน native PostgreSQL 17.11 ใหม่บน loopback ไม่มี `.env` หรือ URL ฐานจริง
- รอบล่าสุด `node_modules/.cache/buildtrack-sales-runtime/runs/run-b8eeKu/report.json`: bridge **48 checks ผ่าน**, `stopped=true`
- Vitest เฉพาะส่วน **236/236 ผ่านใน 7 ไฟล์** รวม bridge/staging/snapshot/runtime safety/foundation และ read contracts ของ project interests/SOP; ESLint เฉพาะไฟล์ที่แก้ผ่าน ไม่ใช่ full app build หรือ E2E
- ก่อน bridge รัน account guard 86, account cutover 22, directory 21, directory cutover 14 และ exact sealed foundation 34 checks ผ่านร่วมกัน
- ครอบคลุม replay พร้อมกัน 3 คำขอ, IDs เดิม, ข้อมูล/บัญชีเปลี่ยนแล้วปฏิเสธ, rollback ทั้งชุด, provenance ขาด/ครึ่งคู่/สองสาขา, legacy branch เดิม, held candidate, customer-interest ผิดคู่, unknown dates, grants/RLS/activation seal
- ตรวจการแข่งขันจริง: ขณะ bridge ถือ catalog lock การแก้ project ของแปลงอีก connection ถูก lock timeout ไม่สามารถแทรกระหว่าง validation ได้
- เปรียบเทียบ sales/plots/leads/voices/roles/settings ก่อนและหลังชุดทดสอบ ไม่เปลี่ยน และ seal คอลัมน์ใหม่ของ sales ยังทำงาน

ไม่ใช่ full app/E2E, Supabase Auth integration, ทดสอบนำเข้าข้อมูลลูกค้าจริง, ทดสอบย้ายการครองแปลง หรือ restore backup ของ production หลักฐานของ staging และ identity bridge ไม่ได้แปลว่า booking cutover พร้อม

## ขั้นถัดไป

อัปเดต 29 กันยายน: ตรวจเทียบฐานจริงแบบอ่านอย่างเดียวกับ snapshot แล้ว ดู `sales-booking-inventory-review.md` และรายงาน JSON คู่กัน พบ 24 แปลงที่ต่าง และคำยืนยันให้ยึดชีตสำหรับไอลิน6 16/18/19 ยังไม่เขียน sales/plots จริง

ออกแบบเชื่อมประวัติจอง/โอน/ยกเลิกกับ `public.sales` และตัวอ่านในโครงการ โดยเทียบ legacy sales/ผู้ครองแปลงจริงก่อนเปลี่ยน พร้อมปรับ readiness guards ของ lifecycle/report ให้รู้จัก external history ทดสอบแล้วจึงเตรียม migration/release แยกเพื่อขออนุมัติ ไม่ลบข้อมูลเก่าหรือปลด seal ในขั้นนี้

แนวทางสิทธิ์/ฟังก์ชันตรวจตาม Supabase/Postgres skills และ [Database Functions](https://supabase.com/docs/guides/database/functions); private operator-only ไม่ใช่การใช้ service role ข้าม RLS จากหน้าเว็บ
