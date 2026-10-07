# เตรียมฐานสิทธิ์ Lead โดยไม่สลับระบบของฝ่ายอื่น

28 กันยายน 2569 — **ร่างในเครื่องเท่านั้น ยังไม่ติดตั้งและยังไม่เปิด Lead**

อัปเดตต่อเนื่อง: เชื่อมและทดสอบ staged → role-review/projection → Auth suspension → Admin restore ครบในฐานจำลองแล้ว ดู `sales-crm-staged-security-integration.md` ผลรอบ `run-wGj9g2` ผ่านโดยไม่ใช้ global trusted_actor ส่วนผล/งานค้างด้านล่างเป็นสถานะก่อนรอบ integration นี้; ยังเหลือการประกอบและตรวจชุดติดตั้งจริง

## สิ่งที่พบและการแยกขอบเขต

ชุดบัญชีและรายชื่อก่อนล็อกอินติดตั้งแล้ว แต่ `trusted_actor_draft.sql` เดิมไม่ใช่เพียงการเพิ่มสิทธิ์ฝ่ายขาย: มันแทนที่ `execute_account_command` และ `update_user_last_seen` ให้ทุกฝ่ายต้องมีรายการรับรองใหม่ หากรับรองเฉพาะ Admin/Owner/Sales ตามรายชื่อที่ผู้ใช้อนุมัติ ฝ่ายอื่นอาจบันทึกเวลาเข้าใช้งานไม่ได้ การปิดสวิตช์ trusted-auth ในเว็บไม่สามารถกันผลจากการแทนฟังก์ชันในฐานได้

เพิ่มทางเลือก `sql/security/crm_identity_foundation_draft.sql`:

- เพิ่ม `account_security_private.reviewed_roles` แบบว่าง เปิด RLS และไม่ให้ client อ่าน/เขียน รวม service_role; ไม่คัดลอกป้ายสิทธิ์จากข้อมูลเก่า
- เพิ่มตัวตรวจตัวตน private และ `app_current_actor()` แบบ invoker โดยคง contract ที่ role-review/CRM projection เดิมต้องใช้
- ตรวจบัญชีที่ได้รับรองพร้อม session ที่ยังอยู่จริง, การแบน/ลบ/anonymous และไม่ใช้ role จาก metadata
- ไม่แทนคำสั่ง Admin, ไม่เปลี่ยน presence, reviewed_admins, รายชื่อก่อนล็อกอิน, Auth credentials หรือสิทธิ์ก่อสร้างเดิม
- ไม่สร้าง CRM business tables, ไม่ย้ายลูกค้า/จอง, ไม่รับรองบัญชีจริง และไม่เปิดสวิตช์หรือ Cron
- หยุดเมื่อพบฐานสิทธิ์/CRM เดิมที่ต้องตรวจการอัปเกรด ห้ามรันซ้ำหรือใช้ต่อจาก trusted_actor แบบเดิม

ไฟล์มี `DESIGN ONLY` และ `ROLLBACK` ไม่ใช่ migration สำหรับผู้ใช้รัน ตัวทดสอบเอา wrapper ออกเฉพาะในหน่วยความจำ และครอบทุกกรณีด้วย transaction ที่ย้อนกลับ ฐานต้องเป็นฐานจำลองของ runner บน loopback เท่านั้น ไม่รับ URL ฐานจริง

## ข้อจำกัดที่ต้องคงไว้

ช่วงนี้ `reviewed_roles` **ยังไม่ใช่ตัวควบคุมคำสั่งบัญชีเดิม** ซึ่งยังตรวจ reviewed_admins และ session ผ่าน account guard ที่ติดตั้งอยู่ ห้ามเปิด trusted-auth/UI จัดการสิทธิ์ใหม่ หรืออ้างว่าการปิดบทบาทใหม่จะหยุดคำสั่งทุกฝ่ายแล้ว

การตรวจแบนในตัวอ่านอย่างเดียวไม่ทำให้หลังปลดแบนต้องรับรองใหม่โดยอัตโนมัติ ยังต้องนำชุด auth-revocation/recovery ที่เตรียมไว้มาเชื่อมและทดสอบก่อนเปิด CRM จริงตามข้อตกลงผู้ใช้ ไม่เปิดฐานนี้เดี่ยว ๆ เพื่อข้ามขั้นดังกล่าว

ส่วนตรวจ `app_current_actor()` ใช้ row locks สำหรับคำสั่งเขียน ไม่ใช้แทนตัวอ่าน CRM แบบ STABLE/READ ONLY ที่มีอยู่ใน projection; ยังไม่ถือว่าทดสอบ PostgREST GET/HEAD ของเส้นทางใหม่แล้ว

นี่เป็นการลดผลกระทบของการติดตั้ง ไม่ใช่การรับรองว่าช่องสิทธิ์ legacy ของทุกโมดูลได้รับการแก้ครบ และไม่ใช่การคัดลอกข้อมูลไปสร้างระบบ Lead ซ้ำ

## การทดสอบ

- Vitest 3 ไฟล์ 62/62 ผ่าน: staged identity, account-security safety และ approved central roster
- ESLint เฉพาะ 3 ไฟล์ตัวทดสอบ/ตัวเชื่อมผ่าน
- Native PostgreSQL 17.11: staged identity ใหม่ **31/31 ผ่าน** และชุด account-security เดิมที่รันต่อผ่านทั้งหมด
- รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-y7kkvq/report.json`: `status=passed`, `stopped=true`, `sourceFilesUnchanged=true`, `productionChanged=false`; process จบด้วย exit 0
- ทุกกรณี staged ย้อนกลับก่อนชุด full-cutover เดิมเริ่ม จึงยังไม่ใช่หลักฐานว่า staged + role-review/projection/recovery ทำงานครบทั้งสาย ต้องทดสอบเพิ่มตามข้อ 1 ด้านล่าง ไม่ได้ทดสอบ Supabase Auth/PostgREST จริงในรอบนี้

การทดสอบใหม่ตรวจทั้ง checksum ของฟังก์ชันเดิม (definition/owner/ACL), Admin เปลี่ยนรหัสบัญชีสมมติได้ขณะที่ registry ใหม่ยังว่าง, Foreman สมมติใช้ presence เดิมได้, รายชื่อก่อน/หลังล็อกอิน, การปฏิเสธสิทธิ์ปลอมและ session ใช้ไม่ได้ ทุกกรณีย้อนกลับก่อนชุดทดสอบเก่าทำงานต่อ ไม่มีการใช้รายชื่อลูกค้าจริง 895 คน

## ขั้นถัดไปที่ยังต้องทำ

1. ประกอบทางเลือกนี้กับ role-review + CRM projection + auth revocation/recovery ให้เป็นชุดติดตั้งที่ตรวจแยก ตรวจว่าการรับรอง CRM ไม่เปลี่ยน allowlist Admin โดยไม่ตั้งใจ และทดสอบเส้นทาง staged end-to-end ไม่อ้างผลจาก full-cutover เดิมแทน
2. แยก CRM business schema/คำสั่งที่ต้องเปิด Lead ออกจาก Cron ตรวจ ALTER ของ sales/customer_voices และช่องเขียน legacy พร้อม manifest/backfill ที่รักษา Lead IDs และ Sale IDs
3. ขออนุมัติชุด SQL ที่ระบุขอบเขตชัดก่อนติดตั้งจริง แล้วตรวจสิทธิ์ Admin/Sales เจ้าของ/Sales คนอื่น/Owner และเว็บ 79c5 ก่อนเปิดใช้งาน

ยังไม่สร้าง deployment migration จึงไม่มีหมายเลข migration ใหม่ รอบนี้ไม่ใช้ `apply_migration`, ไม่แก้ environment, ไม่ Deploy และไม่เปลี่ยนฐาน Supabase จริง

อ้างอิงแนวทาง session: [Supabase User sessions](https://supabase.com/docs/guides/auth/sessions) — การตรวจ session_id กับ auth.sessions ช่วยปฏิเสธ token ของ session ที่ถูกลบ ไม่ได้แทนการตรวจ JWT ที่ชั้น API
