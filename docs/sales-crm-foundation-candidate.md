# SQL candidate: โครงสร้าง Lead ส่วนกลางแบบยังไม่เปิดรับงาน

28 กันยายน 2569 — **เตรียมในเครื่อง ไม่ได้รับอนุมัติให้รันบน Supabase จริง**

ไฟล์: `supabase/migrations/20260928090010_crm_sealed_foundation_candidate.sql`

สร้างชื่อไฟล์ด้วย Supabase CLI 2.117.0 แล้วประกอบจากแหล่งที่ระบุ SHA256 ไว้ในไฟล์ ตัวทดสอบเทียบ candidate กับแหล่งเหล่านั้นทุกครั้ง ไม่มีคำสั่งต่อฐานจริงในตัวประกอบ

## ขอบเขตที่ติดตั้งได้เมื่อผ่านการตรวจและอนุมัติแยก

- identity foundation แบบไม่แทนคำสั่ง Admin/presence ของทุกฝ่าย
- โครงสร้าง CRM หลัก พร้อม role-review/projection/Auth suspension/Admin read/restore ที่ทดสอบร่วมกันก่อนหน้า
- **ตารางและฟังก์ชันใหม่ยังปิดสิทธิ์ client ทั้งหมด** ไม่เปิดแม้ service_role หรือ inherited default grant; ตารางใหม่มี RLS
- ไม่มีแถว reviewed role, customer, import batch หรือ crm_settings จึงไม่เปิดรับงาน ไม่มีการรับรอง Sales/Owner/Admin อัตโนมัติ
- ไม่มี SQL04–26, worker, dispatcher, Cron, การเปิดหน้าเว็บ หรือการ Deploy

นี่เป็น foundation candidate ไม่ใช่ SQL เปิด Lead สำเร็จในคำสั่งเดียว แม้ติดตั้งแล้วหน้า Lead ยังต้องปิดจนชุดคำสั่ง/ย้ายข้อมูล/สิทธิ์/เว็บพร้อม

## สิ่งที่แก้จากการเอาร่างมาต่อกันเฉย ๆ

1. รวมใน transaction เดียวและมี release/project/backup/Auth compatibility/legacy client review/mode/count gates ตั้งค่าเพียงอย่างเดียวไม่ใช่หลักฐานว่าผู้ใช้อนุมัติหรือเชื่อมถูกโปรเจกต์
2. จำกัดรอ lock 2 วินาที, statement 30 วินาที และ transaction รวม 30 วินาที (ต้องใช้ PostgreSQL 17+) ต้องล็อก sales/customer_voices เพื่อ ALTER และล็อกอ่าน projects/plots/leads ระหว่างตรวจ จึงยังต้องเลือกช่วงเหมาะสมกับฝ่ายอื่น ถ้าติดงานให้หยุด ไม่เพิ่ม timeout อัตโนมัติ
3. เปรียบเทียบข้อมูลเดิมของ sales/voices/leads/projects/plots และ reviewed_admins ก่อน commit; เปรียบเทียบฟังก์ชันเดิม/เจ้าของ/ACL, table ACL/RLS, policies และ triggers เดิม ถ้าเปลี่ยนย้อนกลับทั้งชุด checksum นี้ตรวจความเปลี่ยนแปลงระหว่าง transaction ไม่ใช่ full backup หรือ frozen manifest
4. เพิ่ม trigger ห้ามใส่ค่าลงคอลัมน์ CRM ใหม่ของ sales/customer_voices แม้บัญชีมี table-level INSERT/UPDATE เดิม ปิดช่อง bypass จากหน้าจอเก่าหรือ REST โดยไม่เปลี่ยน grants ของคอลัมน์เดิม
5. **เลื่อน sales_active_plot_booking_idx ไปขั้นหยุด legacy writers/cutover** ไม่เปลี่ยนกติกาจองซ้ำของระบบเดิมระหว่างติดตั้งโครงสร้าง ห้ามเปิด CRM booking ก่อนสร้าง index นี้หลัง audit ด้วย predicate ที่ตรงกัน
6. เพิ่ม append-only guard สำหรับ raw legacy snapshots ให้ UPDATE/DELETE/TRUNCATE ไม่เขียนทับหลักฐาน แม้ caller เป็นเจ้าของตาราง ไม่ใช่อาศัย comment ว่า immutable เท่านั้น
7. ปิด grants ของ object ใหม่ตาม ACL จริง รวม custom default grantees ไม่เปลี่ยน default privileges หรือ grants ของ object เดิม

ห้ามเปิดระบบด้วย flag อย่างเดียว: ต้องปลด seal/grant ที่ตรวจรายตัวใน migration ถัดไป พร้อม legacy writer retirement และ backfill ไม่ใช่การให้ ALL กลับทั้ง schema

## ย้ายข้อมูลเก่าอย่างไรไม่ให้ซ้ำ

**แผนล่าสุดหลังผู้ใช้ยืนยัน:** รอไฟล์ชุดเต็มใหม่ที่รวมข้อมูลเก่า/ลูกค้าเพิ่ม/สถานะล่าสุด ดู `sales-crm-replacement-snapshot.md` ไม่ทำ backfill จากฐานเดิมตามรายการด้านล่างตอนนี้ และยังไม่ลบข้อมูล ชุด foundation นี้ยังใช้ข้อจำกัด legacy_source_lead_id จึงต้องทบทวน provenance ก่อนรองรับไฟล์ใหม่; ไม่แก้ SQL candidate ในรอบเตรียมตัวตรวจไฟล์

การตรวจของตัวช่วยยืนยันข้อกำหนดเดิม:

- ตรึงรายการ legacy Lead IDs/Sale IDs **ครบชุด** พร้อม hash ของต้นฉบับ รุ่น mapping และบัญชีเจ้าของที่ตรวจแล้ว รายงานตัวอย่าง 20/50 แถวไม่เพียงพอ จำนวน 895/289/306 เป็น baseline ที่ต้องตรวจให้เป็นปัจจุบัน ไม่ใช่คำสั่งเหมาทุกแถวในอนาคต
- หนึ่ง customer ต่อ legacy Lead ID ก่อน ไม่รวมจากเบอร์แทนหรือชื่อเหมือนกัน; legacy_source_lead_id และ legacy links ป้องกันสร้างซ้ำข้าม batch ต้องตรวจเพิ่มว่ารหัสต้นทางตรงกับ customer ใน link จริง
- เก็บ Sale IDs เดิมและสิทธิ์ครองแปลงเดิม ไม่สร้าง booking ใหม่จากความสนใจ ประวัติยกเลิกยังอยู่
- snapshot ก่อนเปลี่ยนเงิน/วันที่; การรันซ้ำต้อง payload และ mapping ตรงเดิมจึงเป็น no-op หากไม่ตรงให้หยุด ไม่ upsert ทับหลักฐาน
- เบอร์แทนเป็น NULL/unknown_legacy; ยอดมัดจำศูนย์ที่ไม่มีหลักฐานและวันที่ไม่ทราบเป็น NULL เฉพาะ manifest ไม่เดาจากวันสร้างแถว/วันนำเข้า; ราคาเดิมที่มีหลักฐานคงค่าเดิม
- ไม่สร้าง Visit สำเร็จ, แบบสอบถาม, SLA ติดต่อครั้งแรก หรือประวัติสินเชื่อย้อนหลังเพื่อเติม funnel
- ก่อน backfill หยุด legacy importer/ทุกช่องเขียนเดิมและแยกงานหลังเวลาตรึงข้อมูล ห้าม dual-write ระหว่างระบบเก่าและใหม่

**ยังไม่มี full manifest/backfill writer ในชุดนี้** และไม่ได้ดาวน์โหลดข้อมูลลูกค้า 895 คนมาตรวจรอบนี้ การย้ายและตรวจ replay เป็นงานถัดไป ไม่อ้างว่า uniqueness ของตารางอย่างเดียวเพียงพอ

## หลักฐานทดสอบในเครื่อง

- Unit tests 3 ไฟล์ 37/37 ผ่าน; ESLint เฉพาะไฟล์ที่แก้ผ่าน
- Native PostgreSQL ใช้ `--crm-foundation-only` รัน **candidate จริง** ไม่ได้เอาร่างอื่นมาแทน และใช้ function เดิมจาก `sync_plot_sales_status.sql` โดยไม่รัน retroactive UPDATE ของไฟล์นั้น
- รอบแรก `run-HA6uZX` หยุดที่ test ซึ่งคาดว่า TRUNCATE จะถึง append-only trigger แต่ FK ปฏิเสธก่อน จึงปรับเฉพาะ test ให้ใช้ CASCADE ภายใน transaction ที่ ROLLBACK เพื่อพิสูจน์ trigger และตรวจว่ารายการขายยังอยู่ ไม่ผ่อน SQL protection
- รอบสุดท้าย `run-qs4W2A/report.json`: candidate ผ่าน 34 กรณี รวม timeout ยกเลิก transaction และคืน schema/ข้อมูลเดิม; account guard 86, account cutover 22, directory 21 และ directory cutover 14 กรณีผ่านร่วมกัน ฐานจำลองหยุดแล้ว (`stopped=true`) และ source ไม่เปลี่ยนระหว่างทดสอบ
- Unit tests หลังเพิ่ม timeout ผ่าน 37/37; ESLint ทั้ง 6 ไฟล์ที่เกี่ยวข้องผ่าน ไม่ได้ทดสอบบริการ Supabase Auth จริง ไม่ได้ backfill หรือเปลี่ยน production

## ก่อนรันจริงยังต้องครบ

ตรวจ catalog/type/default/trigger/grants ของโปรเจกต์จริงแบบอ่านอย่างเดียวเทียบ candidate; ทดสอบ Auth trigger กับบริการ Supabase จริงตามขอบเขตที่ตกลง; ทบทวน client ที่ใช้ SELECT * หรือ positional payload เพราะคอลัมน์ใหม่เพิ่ม shape แม้ค่าเป็น NULL; ตรวจ Backup และความพร้อมช่วงล็อกตาราง แล้วขออนุมัติ candidate นี้โดยเฉพาะ

**ห้าม `supabase db push` ตอนนี้**: account/directory migrations ที่ติดตั้งแล้วมี local/remote timestamps ต่างกัน ต้องจัดประวัติให้ถูกต้องก่อนใช้วิธีนั้น และไม่รัน SQL บัญชี/รายชื่อเดิมซ้ำ
