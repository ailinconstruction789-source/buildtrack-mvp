# เตรียมประวัติจองชุดใหม่โดยเก็บข้อมูลเดิม

29 กันยายน 2569 — ทำในเครื่องและทดสอบด้วยข้อมูลสมมติเท่านั้น ไม่มีนำเข้าลูกค้าจริง ไม่มีเปลี่ยน Supabase/Vercel หรือเปิด Lead ส่วนกลาง

## ส่วนที่ทำแล้ว

`sql/sales/external_booking_bridge_draft.sql` ต่อจาก private staging และ identity bridge ที่ใช้ sealed foundation ตัวจริง เตรียมประวัติจองแบบมีชนิดข้อมูลและรหัสรายการของตัวเอง ไม่จับคู่หรือใช้ `public.sales.id` เดิมจากแปลง/ชื่อ/วันที่

- แต่ละประวัติผูกกับ customer/interest/plot ที่ identity bridge ตรวจไว้ พร้อม Sales ผู้ดูแลรายโครงการ ไม่เปลี่ยนเป็นเจ้าของ Lead ส่วนกลางทั้งหมด
- เก็บ booked/transferred/cancelled ครบทั้งรายการพร้อมใช้ตรวจและรายการพัก แถวไม่มีแปลงไม่หายไป ยกเลิกที่ไม่ทราบแปลงยังถูกพัก
- แยกวันจอง/โอน/ยกเลิกเป็นวันที่ตามต้นทาง ไม่ใช้วันนำเข้า ไม่สมมติชั่วโมง/เขตเวลา ไม่สร้าง booking round จากลำดับแถว และไม่สมมติยอดมัดจำ/เหตุผล/วิธีกู้
- บังคับหนึ่งประวัติไม่ยกเลิกต่อแปลงภายในชุดเตรียม โอนแล้วยังนับถือครองแปลง และรายการพักไม่ถูกข้ามเพื่อหลบเงื่อนไขซ้ำ
- เก็บภาพข้อมูลเดิมของ leads/sales/plots/projects/customer_voices ใน receipt ส่วนตัวพร้อมชุดคำขอและผู้เตรียม โดยต้นฉบับยังอยู่ ไม่ลบหรือแก้ค่าเดิม ภาพนี้ **ไม่ใช่ backup ทั้งระบบหรือผลทดสอบ restore**
- รันซ้ำตรงคำขอได้รหัสเดิม คำขอเปลี่ยน บัญชีถูกปิด/แบน สิทธิ์เก่า โครงการผิด หรือข้อมูลเดิม/งานก่อสร้างเปลี่ยน จะหยุดให้ตรวจใหม่

`prepared_booking_sales` อยู่ใน private schema เท่านั้น **ยังไม่เป็นรายการขายใน public.sales ไม่ครองแปลงจริง และยังไม่แสดงในหน้าลูกค้าจองของโครงการ** ชื่อ `eligible_for_release_review` หมายถึงผ่านเงื่อนไขพื้นฐานให้ตรวจสลับชุดต่อ ไม่ใช่อนุมัติเปิดใช้

## การไม่กระทบฝ่ายอื่น

ร่างนี้ไม่มีคำสั่งเขียน public.sales/plots/leads/customer_voices ไม่มีปิด trigger เดิม ไม่มีแก้สถานะก่อสร้าง/ส่งมอบ/เวลาหยุดงาน ไม่มีเปลี่ยนสิทธิ์หรือเปิด CRM flags ยังคง DESIGN ONLY guard และ ROLLBACK ไม่มี migration พร้อมติดตั้ง

ใช้ SHARE locks ระหว่างจับภาพข้อมูลเดิมเพื่อกันข้อมูลเปลี่ยนคั่นกลาง ตั้ง lock timeout 2 วินาที การทดสอบนี้อยู่ฐานแยกในเครื่องเท่านั้น หากจะนำแนวทางนี้ไปใช้จริงต้องทบทวนช่วงเวลาและผลกระทบต่อผู้ใช้งาน เพราะ SHARE locks สามารถรอหรือบล็อกการเขียนของฝ่ายอื่นจนจบ transaction ได้ ไม่ใช่คำรับประกัน zero downtime

คำยืนยันไอลิน6 16/18/19 ให้เป็นจองตามชีตยังอ้างอิง `sales-booking-inventory-review.md` ไม่ใช้ SQL รอบนี้ล้าง transferred flag หรือสถานะส่งมอบ งานแก้ flags ที่ใช้ร่วมกันต้องอยู่ในแผนสลับชุดแยกและคงข้อมูลหน้างานไว้

## สิทธิ์และความครบถ้วน

ใช้ private SECURITY INVOKER และ security-invoker view ปิด grants ของ anon/authenticated/service_role รวม role ที่รับสิทธิ์จาก default privileges ตาราง private เปิด RLS และปฏิเสธ UPDATE/DELETE/TRUNCATE ภาพหลักฐาน ไม่เปิด API ใหม่

ก่อนเตรียมหรือ replay จะตรวจ staging เทียบกับ snapshot ที่ตรึงไว้อีกครั้ง และตรวจความครบของ history → identity links → projection เพื่อกันรายการที่ operator เพิ่มภายหลังตกหล่นจาก JOIN จุดนี้พบจากการตรวจอิสระและเพิ่ม regression แล้ว ไม่มีการข้ามรายการเงียบ ๆ

การใช้ Supabase/Postgres skills ทำให้เก็บส่วนนี้เป็น private invoker, จำกัดสิทธิ์ และตรวจ FK/locking/replay ก่อนสลับข้อมูล ตาม [Database Functions](https://supabase.com/docs/guides/database/functions) ตรวจ changelog แล้วไม่เพิ่ม extension หรือตัวเข้ารหัสที่เกี่ยวกับการเปลี่ยนแปลง PG 17.11

## การทดสอบ

รัน `node scripts/sales-runtime/run.mjs --external-booking-bridge-only` จะสร้าง native PostgreSQL ใหม่บน loopback และใช้ข้อมูลสมมติ ไม่มีอ่าน .env หรือรับ URL ฐานจริง จากนั้นทดสอบ account security, sealed foundation และ CRM identity bridge ก่อนทดสอบส่วนใหม่นี้ และหยุดฐานเมื่อจบ

- Unit tests เฉพาะส่วน 128/128 ผ่านใน 5 ไฟล์ และ ESLint ไฟล์ JS ที่แก้ผ่าน
- Native รอบสุดท้าย `node_modules/.cache/buildtrack-sales-runtime/runs/run-fpfkkD/report.json`: ส่วน booking preparation **34 checks ผ่าน** พร้อม suite เดิม account security/foundation/identity bridge และ `stopped=true`
- Native ครอบคลุมรันพร้อมกันสามคำขอ, rollback ทั้งชุด, replay IDs เดิม, source append ที่ไม่มี link, ข้อมูลเดิมเปลี่ยน, null amounts/dates, เจ้าของรายโครงการ, private ACLs และการคงทุกคอลัมน์ของ plots รวมข้อมูลก่อสร้างสมมติ
- ชุดสมมติมี 3 ประวัติ (2 รายการผ่านเงื่อนไขตรวจต่อ, 1 ยกเลิกไม่ทราบแปลงพักไว้), 1 แปลงที่มีการขาย และ 2 sales เดิมที่เก็บครบ ไม่ใช่การนำเข้าข้อมูลจริง 304 ประวัติ/220 แปลง
- ไม่ใช่ full app build/E2E, Supabase Auth integration, restore backup หรือการสลับ public.sales จริง

## สิ่งที่ยังต้องทำก่อนใช้จริง

อัปเดต 29 กันยายน: เพิ่ม [ตัวสลับรายการขายและย้อนกลับเฉพาะข้อมูลที่เกี่ยวข้อง](sales-external-sales-cutover.md) และทดสอบบนฐานจำลองแล้ว ยังไม่เป็นชุดเปิดใช้จริง เพราะคำสั่งจอง/รายงานและการเลิกใช้ตัวเขียนเดิมยังต้องเชื่อมต่อให้ครบ

อัปเดต: เพิ่มตัวอ่าน prepared snapshot และหน้าจอรองรับประวัติแบบวัน/รอบไม่ทราบแล้ว ดู `sales-prepared-project-reader.md` ทดสอบข้อมูลจาก native PostgreSQL กับ parser จริง โดย API ปฏิบัติงานยังปฏิเสธชุดเตรียมและไม่มีการสลับ public.sales

ส่วนถัดไปคือการสลับชุดข้อมูลที่ public.sales และหน้ารายงานอ่าน โดยไม่ให้ 289 รายการเดิมถูกนับบวกกับ 304 ประวัติใหม่ ต้องออกแบบการเก็บประวัติเดิม/การย้อนกลับ การจัดการ active-plot constraints และ trigger พร้อมปรับ lifecycle/report guards ให้รู้จัก external history และทดสอบกับตัวอ่านของแอป ไม่ใช่เปิด flag จากผลทดสอบนี้

ก่อนสลับจริงยังต้องตรวจชีตล่าสุด บัญชีปัจจุบัน และข้อมูลฝ่ายอื่นที่อาจเปลี่ยน พร้อมยืนยัน backup และชุดแก้จริง แยกจากการอนุมัติให้เตรียมและทดสอบในเครื่องครั้งนี้
