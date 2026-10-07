# Customer Voices ต่อ Visit และ QR — รอบ 24 กันยายน 2569

สถานะ: เตรียมโค้ด/หน้าจอ/ร่าง SQL ในเครื่องเท่านั้น สวิตช์ยังปิด ไม่มีการเชื่อม Supabase, นำเข้าข้อมูลลูกค้า, รัน migration หรือ Deploy

## ข้อตกลงและการใช้งาน

1. Lead ส่วนกลาง → โครงการที่สนใจ → นัดหมาย/เช็คอินจริง → Visit ที่ `awaiting_voice` → เปิด “QR แบบประเมิน Customer Voices”
2. Sales เจ้าของความสนใจปัจจุบันหรือ Admin ระบุเหตุผลและออก QR; Owner อ่านได้อย่างเดียว สิทธิ์ทำ SOP ยังเป็น Sales ตามเดิม
3. QR ใช้ได้ **24 ชั่วโมง** ตามผู้ใช้ยืนยัน อายุนี้เตรียมเป็น `crm_settings.voice_token_ttl_hours` ช่วง 1–168 ชั่วโมง ยังไม่มีหน้าตั้งค่าและไม่ได้เปลี่ยนค่าจริง
4. ออก QR ใหม่ยกเลิกลิงก์เก่า; ยกเลิก QR ได้พร้อมเหตุผล; QR ใช้กับ Visit เดียว ไม่ใช่กับทุกครั้งของลูกค้าคนเดียวกัน
5. ลูกค้าไม่ต้องเข้าสู่ระบบหรือกรอกชื่อ/เบอร์ซ้ำ ใช้คำถามเดิม คะแนน 8 ด้านต้องตอบเป็นจำนวนเต็ม 1–5 ไม่มีค่าเริ่มต้น ข้อมูลส่วนตัว/รายได้/วัตถุประสงค์/เหตุผล/แหล่งข้อมูล/ค่าเช่าไม่บังคับ ไม่มีการเลือกให้ล่วงหน้า
6. ช่องไม่ตอบคงเป็นไม่ทราบ/ไม่ได้ตอบ ไม่แปลงเป็น 0, false, เพศ, รายได้ หรือคะแนน 5 โดยอัตโนมัติ ค่า 0 และ false ที่ตอบเองแยกจากการไม่ตอบ
7. บันทึกคำตอบที่ผ่านการตรวจ + สร้างหลักฐาน Customer Voices + ปิด Visit สำเร็จ + ใช้ token ใน transaction เดียว ล้มเหลวต้องย้อนทั้งชุด
8. ส่งซ้ำด้วยคำขอและคำตอบเดิมได้เฉพาะเพื่อยืนยันผลเดิม ไม่สร้างคำตอบซ้ำ ไม่เปิดฟอร์มเก่าให้อ่านกลับ ไม่เขียนทับประวัติครั้งก่อน
9. เปลี่ยนผลการจอง, ส่วนลด, loan, วันโอน, งานติดตาม, SLA, KPI และกิจกรรมอื่นไม่ได้จากคำสั่งแบบสอบถามนี้ Visit ที่สำเร็จเชื่อมต่อคำสั่งจองเดิมได้ตามหลักฐานเดิมของ SQL18

## หน้าจอและข้อมูล

| ส่วน | หน้าที่ |
| --- | --- |
| `/sales-crm/visits` | ลิงก์เฉพาะ Visit ครั้งนั้น; สำเร็จแล้วเปลี่ยนเป็นดูคำตอบ; ไม่ออกลิงก์สำหรับ Visit ยกเลิก |
| `/sales-crm/customer-voices?customerId=…&interestId=…&visitId=…` | ตรวจสิทธิ์/สถานะ, ออก/ยกเลิก QR, ดูผลที่ส่งแล้วแบบอ่านอย่างเดียว |
| `/customer-voices#token=…` | หน้าลูกค้า รับเฉพาะความลับจาก fragment; ลบออกจาก address bar แล้วเก็บชั่วคราวในหน่วยความจำ |
| `/api/sales-crm/customer-voices` | ตรวจ JWT ของผู้ใช้งานจริง, role/capability และขอบเขต; ไม่มี service-role fallback |
| `/api/customer-voices` | รับ JSON เท่านั้น สูงสุด 16 KB, ไม่รับ token จาก query/cookie, ไม่อ่านบัญชี Sales และไม่คืนชื่อ/เบอร์/รหัสลูกค้า/คำตอบเก่า |
| `customer_voices` | หนึ่งแถวต่อ Visit; ใช้ `visit_id`, `crm_answers`, version, submitted/validated timestamp เป็นหลักฐาน |
| `sales_private.visit_submission_tokens` | เก็บเฉพาะ SHA-256 ของความลับสุ่ม 256 บิต พร้อมอายุ/ใช้แล้ว/ยกเลิกแล้ว |
| `sales_private.voice_*` | ใบรับคำขอ, ประวัติพร้อมเหตุผล และ permit เฉพาะ transaction; ห้าม browser อ่าน/เขียนตรง |

คำตอบ V2 ใช้ `lead_id = NULL` เพื่อไม่ปะปนกับ legacy modal ที่ค้นด้วย Lead เก่า ชื่อในคอลัมน์ legacy ที่บังคับ NOT NULL มาจากตัวตนส่วนกลางที่เชื่อถือได้ ไม่ได้รับจาก public payload; ไม่เปิดชื่อนั้นใน QR form ไม่มีการอัปเดตคำตอบ legacy หรือเติมคำตอบให้ข้อมูลเก่า

Sales ทุกคนดูสถานะการส่งได้ แต่ **เนื้อหาคำตอบ** ให้เฉพาะ Sales เจ้าของความสนใจปัจจุบัน/Admin/Owner ทั้งใน RPC และ restrictive RLS ที่ตัดสิทธิ์จาก legacy permissive policies ไม่เพิ่มสิทธิ์รายได้ให้ Sales คนอื่น

## ความปลอดภัยและผลที่ยังยืนยันไม่ได้

- สร้างภาพ QR ภายในแอปด้วย `qrcode` เวอร์ชันตรึง ไม่ส่ง URL ให้บริการ QR ภายนอก ไม่สร้าง QR ด้วยรูปวาดจำลอง
- ไม่บันทึก token ลิงก์ หรือคำตอบค้างใน localStorage/sessionStorage; ไม่ log ข้อผิดพลาดดิบ; public fetch ไม่ส่ง cookie/JWT; ปิด cache/referrer/indexing และ iframe สำหรับหน้าแบบประเมิน
- Public RPC รับความลับจริงแล้วคำนวณ SHA-256 ภายในฐานข้อมูล ไม่รับ hash ที่เก็บไว้เป็นสิทธิ์ส่งแบบประเมิน จึงนำ hash ที่อ่านได้จากฐานมาใช้แทน QR ไม่ได้ ต้องตรวจว่าระบบ logs/APM/PostgREST ไม่เก็บ request body/SQL parameters ของเส้นทางนี้ก่อนเปิดจริง
- การรีเฟรชหรือปิดหน้าทำให้คำขอที่อยู่ในหน่วยความจำหาย จึงเตือนก่อนออกขณะยังไม่ยืนยันผล หากปิดไปแล้วต้องให้ Sales ตรวจสถานะก่อนขอ QR ใหม่ ไม่ส่งคำตอบใหม่อัตโนมัติ
- ใบรับออก QR ไม่ใช่หลักฐานว่า QR ยังใช้ได้ หน้าจอตรวจบริบทล่าสุดก่อนแสดงและซ่อนเมื่อเปลี่ยนบัญชี โหลดใหม่พบว่าสิทธิ์/สถานะเปลี่ยน หมดอายุ หรือโหลดล่าสุดไม่ได้ ไม่ใช่การติดตามสถานะข้ามเครื่องแบบ real-time
- ผู้ถือ QR สามารถส่งคำตอบได้ ความลับนี้ **ไม่ยืนยันทางเทคนิคว่าผู้กรอกเป็นลูกค้าตัวจริง** ห้ามส่งต่อสาธารณะ `crm_submitted_by_customer` หมายถึงช่องทาง bearer customer form ไม่ใช่ลายเซ็น/OTP ที่ตรวจตัวบุคคล
- ก่อนเปิดใช้ต้องทดสอบ PostgREST/JWT/anon และ broad RLS/trigger/grants/legacy import จริงใน staging, HTTPS, โทรศัพท์สแกน QR, back/refresh/หลายแท็บ/หลุดเครือข่ายจริง และระบบป้องกันการเรียก public API จำนวนมาก ทั้งเส้น Next และ Supabase RPC โดยตรง
- ยังไม่ได้ติดตั้ง shared rate limiter, CAPTCHA, OTP, ระบบแก้คำตอบหลังส่ง, ถอนคำตอบ หรือ retention/deletion workflow ต้องตกลงขอบเขตก่อนเพิ่ม; ไม่มีการอ้างว่าครบมาตรการ production/กฎหมายข้อมูลส่วนบุคคล

## การเปิดใช้ — ยังไม่อนุญาตให้ทำในรอบนี้

ต้องมี flags เดิม `SALES_CRM_V2_ENABLED`, `SALES_CRM_LEAD_WORK_ENABLED`, `SALES_CRM_LIFECYCLE_ENABLED`, `SALES_CRM_VISITS_ENABLED` และใหม่ `SALES_CRM_CUSTOMER_VOICES_ENABLED` เป็น `true` พร้อม DB flags ที่สอดคล้องกัน ทุกคำสั่ง fail closed เมื่อไม่พร้อม

`sql/sales/26_customer_voices_draft.sql` เป็น **DESIGN ONLY มี guard ก่อน DDL และ ROLLBACK** ไม่ใช่ migration ให้คัดลอกรัน ต้อง review/cutover/สำรอง/ทดสอบ staging และขออนุมัติเปิดใช้แยกก่อน สคริปต์ native รับเฉพาะฐานใหม่บน loopback ที่สร้างเอง ไม่อ่าน `.env` หรือข้อมูลจริง

## ผลทดสอบ

- Native PostgreSQL 17.11 แยกในเครื่อง รอบสุดท้าย `runs/run-XGn0Of/report.json` ผ่าน **72 assertions + 6 กลุ่ม concurrency / 19 assertions**: submit ซ้ำพร้อมกัน, คนละคำขอ, revoke, cancel Visit, rotate QR และหมดอายุหลังรอ lock ยืนยันมี backend รอ lock จริง ไม่ใช่เพียงเรียก Promise พร้อมกัน
- ทดสอบ read-only context, SQL/TypeScript parity, restrictive RLS คร่อม legacy allow-all, การแยกคำตอบ/ไม่เติมค่าที่ขาด, immutable history และย้อนทั้ง transaction เมื่อบันทึก receipt ล้มเหลว ทั้ง 24 ร่างมี hash คงเดิมตลอดการรัน
- ทดสอบ hash-at-rest ใช้แทนความลับ QR ไม่ได้ ทั้ง open และ submit; เรียก public RPC ด้วยความลับต้นฉบับแล้ว hash ภายใน DB ไม่รับ hash เป็น credential
- ยืนยัน cluster `stopped=true` และไม่มี `postmaster.pid` ทั้งรอบสุดท้ายและรอบก่อน `run-jqLJA8` (69+19 ก่อนเพิ่มการป้องกัน hash) ไม่ลบฐานที่หยุดแล้ว/รายงานใน cache
- TypeScript ทั้งโครงการผ่าน `noEmit --incremental false` (กำหนด heap เฉพาะ process ไม่เปลี่ยน config) รอบแรกแก้ type assertion ของ synthetic test fixture ให้ใช้ parser จริงแทน ไม่ผ่อน production type
- Scoped ESLint เฉพาะไฟล์ใหม่/ไฟล์เชื่อมต่อที่แก้ผ่าน ไม่มี warning; การเรียกแบบ wildcard รอบแรกครอบคลุม legacy `CustomerVoicesModal.tsx` ด้วย พบปัญหาเดิม 6 errors/1 warning ไม่แก้ไฟล์นอกขอบเขตและไม่อ้างว่า lint ทั้งแอปผ่าน
- ชุด UI/client ที่เพิ่มผ่าน 58 ข้อ / 4 ไฟล์; selector ใน test รอบแรกกว้างไปจับคำว่าโครงการในคำถามคะแนน แก้ selector ให้ตรงช่องตัวตนโดยไม่แก้คำถามจริง; QR encoder ทดสอบสร้าง matrix/PNG จริง แต่ยังไม่ใช่การสแกนจากโทรศัพท์
- Vitest ทั้งชุดรันจบ: ผ่าน 5,736 / 5,737 ข้อ ใน 161 ไฟล์ (412.58 วินาที); จุดเดียวที่ไม่ผ่านเป็น source assertion ใน `projectSalesSql.test.ts` ซึ่งสมมติว่าโหมด `central-search-only` ต้องอยู่ต้นนิพจน์ ทั้งที่เพิ่ม `customer-voices-only` ไว้ก่อนหน้าแล้ว แก้ให้ตรวจชื่อแต่ละโหมดแยกกันโดยไม่เปลี่ยนโค้ดทำงานจริง
- หลังแก้ assertion ตรวจซ้ำชุดที่เกี่ยวข้อง 16 ไฟล์ ผ่าน **202 / 202 ข้อ** (37.80 วินาที) ครอบคลุม Customer Voices, QR, Visit, SOP และโหมดฐานข้อมูลที่เชื่อมต่อ ไม่รันทั้งชุดซ้ำหลังการแก้เฉพาะ test จึงไม่อ้างผลทั้งชุดเป็น 5,737 / 5,737 และไม่นำยอด focused มาบวกซ้ำ

ผลข้างต้นเป็นรอบเตรียมโค้ด ไม่ได้รัน production build, PostgREST, staging หรือ native legacy notification/capacity suites ซ้ำ ไม่ถือว่า UI/mock/native facade ที่ผ่านเท่ากับ production พร้อมเปิดใช้

รอบถัดมาแก้ข้อจำกัดดิสก์/หน่วยความจำของชุด browser integration tests โดย build สำเนาเฉพาะ Customer Voices 27 ไฟล์แบบ production ให้เสร็จก่อนเปิด browser ผ่าน **12/12 รายการ** (desktop และ Chromium จำลองมือถือ) ภายใน 47.26 วินาที ไม่ใช่ build แอปทั้งโครงการหรือทดสอบสิทธิ์ Supabase จริง ดูรายละเอียดใน [รายงานตรวจเบราว์เซอร์](sales-v2-customer-voices-browser-check.md) ผู้ใช้ยืนยันว่ามีโปรเจกต์ทดสอบแล้วและจะส่งชื่อมา ขั้นต่อไปตรวจยืนยันเป้าหมายแบบอ่านอย่างเดียวก่อน ยังไม่มีการเปิด flags, รัน SQL บน Supabase หรือ Deploy
