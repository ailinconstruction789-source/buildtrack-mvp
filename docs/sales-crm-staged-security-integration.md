# ทดสอบการรับรอง–ถอน–คืนสิทธิ์ CRM ด้วยเส้นทาง staged

28 กันยายน 2569 — ในเครื่องเท่านั้น ยังไม่เปิดใช้งานจริง

## ขอบเขต

เพิ่มโหมด `node scripts/sales-runtime/run.mjs --crm-staged-security-only` ซึ่งสร้างฐาน PostgreSQL ชั่วคราวใหม่บน loopback ไม่อ่าน `.env` และไม่รับ URL ฐานเดิม ใช้ account guard และ username directory ชุดเดิม แล้วเลือก identity foundation แบบ staged **แทน** `trusted_actor_draft.sql` ที่สลับ Admin/presence ของทุกฝ่าย

หลังจากนั้นรัน role-review → CRM projection → workflow SQL → Auth suspension → หน้ารายชื่อสิทธิ์แบบอ่าน → คืนสิทธิ์ Sales โดย Admin ในฐานจำลองเดียวกัน เป็นเส้นทางแยกจากโหมด `--account-security-only` เดิม ไม่อาศัยการผ่านชุดเดิมมาอ้างว่าชุด staged ผ่าน

ข้อมูลบัญชีทั้งหมดในชุดทดสอบเป็น `guard_*` สมมติ ครอบคลุมหลายบทบาทเพื่อทดสอบการโจมตี ไม่ใช่รายชื่อ 9 บัญชีจริงที่ผู้ใช้อนุมัติ และไม่ใช่คำสั่งรับรองฝ่ายอื่นจริง

## สิ่งที่ตรวจ

- ใช้คำสั่งจริงในร่างสำหรับรับ Lead/ติดตาม/จอง/หลังจอง/Visit/Customer Voices ไม่เรียกฐานลูกค้าจริง
- บทบาทและ CRM projection เปลี่ยนพร้อมเลข revision; การใช้ session ผิดบัญชีหรือ metadata ปลอมไม่เปิดสิทธิ์
- แบนแล้ว CRM ถูกระงับ ปลดแบนอย่างเดียวไม่คืนสิทธิ์ ต้อง Admin ตรวจและสั่งคืนสิทธิ์
- ตรวจคำสั่งซ้ำ, revision เก่า, การแบนชนกับการคืนสิทธิ์, rollback เมื่อบันทึกหลักฐานล้มเหลว และห้ามถอน Admin ที่จำเป็น
- เทียบ definition/owner/ACL ของฟังก์ชันที่มีอยู่ก่อนเริ่ม staged ทั้งชุดหลังจบ เพื่อจับการเปลี่ยนคำสั่งส่วนกลางโดยไม่ตั้งใจ
- พนักงานที่ยังไม่มี reviewed role ใช้ presence เดิมได้ แต่ไม่ได้ CRM role; ไม่สร้าง global presence façade ขึ้นมาแอบแทน
- ตรวจสิทธิ์รายชื่อก่อนล็อกอินและรายชื่อผู้จัดการบัญชีหลังทดสอบคืนสิทธิ์

## ผลตรวจ

- Unit tests **181/181 ผ่าน** จาก 12 ไฟล์ (ชุดแก้ไข 71 + regression ตัวทดสอบ/เส้นทางเดิม 110) และ ESLint ไฟล์ที่แก้ผ่าน
- Native PostgreSQL 17.11 โหมด `crm-staged-security-only` **ผ่านทั้งสาย**; ด่านคงพฤติกรรมระบบเดิมเฉพาะ staged 11 ข้อผ่าน และ foundation 31 ข้อผ่าน พร้อม role-review/projection/workflow/Auth revocation/read/restore suites
- รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-wGj9g2/report.json`: `status=passed`, `stopped=true`, `sourceFilesUnchanged=true`, `productionChanged=false`, process exit 0 และ `trustedActor=null` ยืนยันไม่ได้แอบใช้ global-cutover draft ในเส้นทางนี้

รอบแรก `run-C4vYeq` หยุดที่ assertion ซึ่งเทียบทุก field ของ reviewed_admins: การคืนสิทธิ์ Sales อัปเดตเวลา/ข้อความรับรองของแถว former Admin ที่ disabled อยู่แล้ว โดยไม่ได้เปลี่ยน enabled/identity ของผู้จัดการ ไม่แก้ SQL เพื่อหลบการตรวจ แต่แยก snapshot ให้ตรวจ identity+enabled ของ **ทุกแถว** และทุก field ของ Admin ที่ **ยัง active** พร้อมเพิ่ม negative tests จับการเปิด/ปิดสิทธิ์ สลับตัวตน ลบแถว และแก้ข้อมูล Admin ที่ active ฐานจำลองรอบแรกปิดแล้ว

## ข้อจำกัดก่อนติดตั้งจริง

โหมดนี้ยังใช้ legacy table fixtures แบบย่อ จึงไม่แทนการตรวจ ALTER/grants/policies/triggers ในฐานจริง และจำลอง Auth tables/claims ไม่ใช่การทดสอบ Supabase Auth/PostgREST บนบริการจริง

ร่าง Auth suspension เพิ่ม trigger บน `auth.users` แม้เขียนเฉพาะ CRM ก็ต้องตรวจสิทธิ์บริการ Auth และผลต่อการแก้บัญชีฝ่ายอื่นก่อนติดตั้ง ไม่ถือว่าไม่มีผลกระทบเพียงเพราะตัวทดสอบในเครื่องผ่าน

role-review primitive สามารถเปลี่ยนบัญชีผู้จัดการได้เมื่อ operator ระบุชัด จึงห้ามนำไปเปิดเป็น generic RPC ให้ Sales และต้องผูกรายชื่อ/ขอบเขตที่อนุมัติไว้ในชุดติดตั้ง ส่วนหน้า Admin คืนสิทธิ์เป็นคำสั่งแคบสำหรับ Sales ที่เคยได้รับรองแล้วเท่านั้น

ยังไม่มี migration สำหรับติดตั้ง CRM, ไม่มี backfill ลูกค้า, ไม่มี SQL mutation บน Supabase, ไม่มี Deploy/เปิด flag/Cron รอบนี้ ข้อมูลลูกค้าเก่าและแผนย้ายยังอยู่ในขั้นถัดไป

ขั้นถัดไป: ประกอบ reviewed deployment candidate จากเส้นทาง staged ที่ผ่านนี้ แยก dependencies ของ CRM business tables/legacy writes/ข้อมูลย้ายจากงาน Cron ตรวจ Auth trigger กับบริการจริงและกรอบ rollback ก่อนขออนุมัติ SQL ชุดนั้น ไม่เอาร่างหลายไฟล์มาตัด guard แล้วติดตั้งทันที
