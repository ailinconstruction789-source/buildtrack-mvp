# First-contact SLA — ตัวประมวลผลระบบแบบจำกัดรอบ

วันที่ 18 กันยายน 2569: เพิ่ม **แกนประมวลผลร่วมในร่าง09 และคำสั่งระบบในร่าง13** พร้อมทดสอบ PostgreSQL แยกในเครื่อง ใช้ข้อมูลสมมติเท่านั้น ไม่เชื่อม Supabase ไม่ตั้ง Cron ไม่สร้างบัญชีจริง ไม่แก้ env/สวิตช์จริง ไม่ Deploy และไม่แก้หน้าจอ/API ของแอป

อัปเดตรอบถัดมาในวันเดียวกัน: เพิ่ม [durable dispatcher14](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-durable-dispatcher.md) ที่จอง/commitคำขอก่อนเรียก13แล้ว โดยไม่เปลี่ยน09/13 รายละเอียดด้านล่างเป็นขอบเขตของworker13; ยังไม่มีการติดตั้งหรือผูกตัวเรียกCronจริง

ยังไม่ใช่ระบบแจ้งเตือนอัตโนมัติที่ติดตั้งได้ ผู้ใช้ **ยังไม่ต้องรัน SQL ใด ๆ** ร่าง09/12/13 มีตัวหยุดก่อน DDL และ `ROLLBACK` ท้ายไฟล์เช่นเดิม

## สิ่งที่ทำได้ในร่างนี้

| เส้นทาง | ผู้มีสิทธิ์และประวัติ | การประมวลผล |
|---|---|---|
| Admin เดิม — SQL09/11 | ตรวจบัญชี Admin เดิม; ใบรับผูก Admin + requestId, audit เป็น staff | รักษา contract/API เดิม รวมการยืนยันทีละงานและคำสั่งรอบ |
| ระบบ — SQL13 | EXECUTE ACL สำหรับบทบาทเฉพาะ; ใบรับและ audit เป็น system โดยไม่มีผู้ใช้มนุษย์ | หนึ่งคำสั่งไม่เกิน10งาน ใช้ cursor/global lock เดียวกับ SQL11 |
| แกนกลางใน SQL09 | private SECURITY INVOKER ไม่ให้ app/worker เรียกโดยตรง | สูตรเวลา หลักฐานจบงาน การถอน/กันซ้ำแจ้งเตือน และ audit ชุดเดียว |

ขอบเขตยังเป็น **first_contact ส่วนกลาง** เท่านั้น ไม่รวม Follow-up, Visit, Booking, Import หรือการคิด KPI ไม่ให้เครดิต Sales จากงานของระบบ และไม่เปลี่ยนการเก็บข้อมูลเก่าที่ไม่มีหลักฐานเป็น “ไม่ทราบ”

SQL09 ย้ายเฉพาะ business application เข้า `sales_private.crm_first_contact_apply(...)` โดย Admin wrapper ยังตรวจ auth/บทบาท สวิตช์ คำขอเดิม ลำดับล็อก และเก็บใบรับเดิม แกนกลางรับ snapshot ที่ผู้เรียกภายในล็อกไว้ ไม่รับ actor/เวลา/หลักฐานจาก browser ไม่มี public system flag หรือการสวมบัญชี Admin

## คำสั่งระบบและการกู้ผล

ร่าง [13_first_contact_system_worker_draft.sql](D:/buildtrack/buildtrack-mvp-main/sql/sales/13_first_contact_system_worker_draft.sql) เตรียมเฉพาะสองจุดเรียกใน `sales_private`:

- `crm_first_contact_worker_cycle(uuid)` — ใช้ request ID ที่ตัวเรียกต้องจำไว้ ประมวลผลหนึ่งรอบแบบ atomic ไม่เปิดให้เลือก task/limit/เวลา/ผู้รับจากภายนอก
- `crm_first_contact_worker_receipt(uuid)` — อ่านผลที่ commit แล้ว ไม่ประมวลผลซ้ำ ไม่เลื่อน cursor และไม่คืนข้อมูลภายในนอก whitelist

ใบรับรอบ/งานย่อยระบบแยกจาก Admin ไม่มี FK ไปหา auth.users; audit ระบุ `actor_kind=system`, `actor_user_id=NULL` การส่ง UUID เดิมคืนผลเดิมพร้อม `replayed=true` ระดับรอบ แต่คงผลและเวลางานย่อยในอดีต ไม่มีการเขียนธุรกิจซ้ำ

หากคำตอบขาดหาย ให้อ่านใบรับด้วย UUID เดิมก่อน การได้ `found=false` **ไม่ยืนยันว่าคำสั่งก่อนล้มเหลว** เพราะอาจยังทำงานอยู่ ตัวเรียกจริงในขั้นถัดไปต้องเก็บ intent/request ID อย่างทนทาน **ก่อน** เรียกคำสั่ง แล้วมีกติกากู้คืนที่ใช้รหัสเดิม ไม่สร้าง UUID ใหม่ทุกครั้งที่ Cron ปลุก ร่างนี้ยังไม่มี dispatcher หรือ durable intent store

การอ่าน/คืนผลใช้ whitelist ทั้งรอบ งานย่อย และ actor ไม่ส่ง evaluation snapshot, ข้อมูลเวร, ชื่อลูกค้า เบอร์ รายได้ หรือ token ใบรับเป็นประวัติ ไม่รับรองสถานะปัจจุบันของแจ้งเตือน

## สิทธิ์ สวิตช์ และข้อจำกัดเวลา

- บทบาท `buildtrack_sales_sla_worker` เป็น NOLOGIN/NOINHERIT ไม่มี superuser/BYPASSRLS/สิทธิ์สร้าง role/ฐาน/replication; หากชื่อมีอยู่แล้วร่างจะหยุด ไม่ยึดบทบาทเดิมมาใช้
- ได้เพียง schema USAGE และ EXECUTE สองจุดเรียกข้างต้น ไม่ได้ table/core/projection grants ไม่มีการเพิ่มสมาชิก role บัญชี login รหัสผ่าน JWT หรือ service-role bypass
- จุดเรียกเป็น SECURITY DEFINER จึงใช้ **ACL ของฟังก์ชันเป็นขอบเขตสิทธิ์** ไม่ใช้ `current_user` ภายในเพื่อพิสูจน์ผู้เรียก และไม่อ่าน JWT เพื่อสวมตัวตนระบบ ส่วนเจ้าของฟังก์ชัน/DBA ยังเป็นผู้มีสิทธิ์สูงตามธรรมชาติ
- เพิ่ม `sla_worker_enabled DEFAULT false` ต้องเปิดครบ9สวิตช์ฐานจึงเขียนได้; การ replay ผ่านจุดเขียนก็ต้องผ่านสวิตช์ทั้งหมด
- อ่านใบรับใช้6สวิตช์อ่านเดิม จึงยังตรวจประวัติได้เมื่อปิด processing/cycle/worker หากปิดสวิตช์อ่านด้วยจะอ่านไม่ได้
- `lock_timeout=500ms` จำกัด **แต่ละครั้งที่รอล็อก** ไม่ใช่เพดานเวลารอบรวม ยังต้องกำหนด statement timeout ที่ระดับ caller/session และวัดโหลดก่อนเลือกงบเวลาจริง

NOLOGIN role เป็นเพียงชุดสิทธิ์ที่ยังไม่ได้ผูกกับผู้เรียกจริง **ไม่ได้พิสูจน์ว่า Supabase Cron สามารถเชื่อมด้วยบทบาทนี้ได้แล้ว** ต้องออกแบบ/ตรวจ authentication และ least-privilege binding ใน staging ที่อนุญาตก่อน อย่าแก้ให้กลายเป็น superuser หรือใช้บัญชี Admin เพื่อให้เรียกผ่าน การตั้ง search_path และ REVOKE PUBLIC/GRANT เฉพาะบทบาทยึดแนวทาง [PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html); คุณสมบัติ NOLOGIN ตาม [Role Attributes](https://www.postgresql.org/docs/17/role-attributes.html)

## การทำงานพร้อมกันและความครบถ้วน

ใช้ keyset `(created_at,id)` เลือก10งาน + ดูล่วงหน้า1งาน ร่วม cursor/global lock กับ Admin11 งาน held ยังเลื่อน cursor เมื่อรอบ commit จึงไม่บังงานท้ายชุดตลอดไป แต่ข้อมูลเสียที่ทำให้ child ล้มเหลวจะย้อนกลับ **ทั้งรอบ** และต้องแก้ที่ต้นเหตุ ไม่ข้ามอย่างเงียบ ๆ

ก่อนเริ่ม child ใด ๆ จะล็อกลูกค้าทั้งชุดตามลำดับ UUID แล้ว owner calendar advisory, หัวเวร, บทบาทเจ้าของ และ task จากนั้นตรวจ binding ซ้ำ โดยเก็บสิทธิ์เจ้าของจากแถวบทบาทที่ล็อกจริง ไม่อนุมานสิทธิ์จากแถวที่เพิ่งถูกเพิ่มโดย session อื่น

งานแต่ละรายการอ่าน snapshot ที่ล็อกใหม่ก่อนเรียกแกนร่วม แกนคำนวณจากเวลา server และหลักฐานปัจจุบัน บันทึกลูกค้า/งาน/แจ้งเตือน/audit/ใบรับทั้งสองระดับ/cursor ใน transaction เดียว ไม่มี COMMIT ย่อย ไม่มีวนจนหมดฐาน ไม่มี retry หรือการส่งตามเวลาในร่างนี้

## ผลทดสอบและสิ่งที่ยังไม่รับรอง

- SQL13 สร้างได้ในฐานใหม่หลัง base/04–12; native worker82 assertions ผ่าน รวม default-off/9gates, role จริงแบบไม่มี JWT, auditระบบ, แยก ledger, ข้อมูลส่วนเกินไม่รั่ว, rollbackเมื่องานที่สองล้มเหลว, held11งานข้ามไป Admin และ parity กับ Admin บนงานเดียวกันสำหรับ held/due-soon/not-due/overdue/contact-proven
- หลาย session + loopback HTTP: 4กลุ่ม20 assertions ผ่าน รวม Admin↔system global lock, same-ID contention/replay, Admin09 ถือ customer แล้ว system รอ และตัด socket หลัง SQL commit เพื่อกู้ด้วยใบรับเดิม
- ชุด native เดิมผ่านหลังย้ายแกนร่วม: first-contact91, receipt53, cycle94, preflight31, clock80กรณี (parity69/notification54เป็นส่วนย่อย), concurrency9กลุ่ม29และ cycle concurrency5กลุ่ม24
- Static25ข้อสำหรับ system worker ตรวจ invariants เพิ่ม ไม่แทนการรัน PostgreSQL; ผลรวม Vitest/TypeScript/ESLint และรายงานฐานอยู่ใน [รายงานตรวจในเครื่อง](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-isolated-database-tests.md)

HTTP ที่ทดสอบเป็นตัวขนส่งสมมติบน127.0.0.1 ไม่ใช่ Next+Supabase JWT/PostgREST/Cron จริง การทดสอบฐานใช้ default ACL/เจ้าของฟังก์ชันของ fixture ไม่รับรอง default privileges, service-role grants, ownership, trigger/policy และ legacy writers ที่ติดตั้งจริง ต้องตรวจทุกช่องทางเขียนและสิทธิ์ effective ก่อน rollout; กติกาล็อกใช้ได้ต่อเมื่อ writers อื่นรักษาข้อตกลงเดียวกัน

## ขั้นถัดไป

เตรียม **dispatcherที่เก็บรหัสรอบก่อนส่งและกู้ได้เมื่อผลไม่แน่ชัด** แล้วใน14 พร้อมreservation budget/fencing/backoffและหนึ่งcycleต่อtickแบบร่าง ขั้นถัดไปยังต้องตรวจstaging/privilege binding/throughputที่ได้รับอนุญาต ออกแบบmonitoringและการแก้reviewโดยคงประวัติ จัดmigrationและลงทะเบียนCronแบบปิดก่อนเปิดจริงแยกอีกครั้ง

SQL12 ยังคง `automationReady=false` หลังเพิ่ม14เหตุผลเป็น `CRON_BINDING_NOT_VALIDATED` ไม่รับรองว่ามีworker/dispatcherติดตั้งแล้ว ตรวจข้อความเรียกworker13และdispatcher14เป็นสัญญาณชนกับjobเดิม แต่ยังไม่อ้างว่าตรวจwrapper/ตัวตั้งเวลาทั้งหมดได้ รายละเอียดความจุและแผนCronอยู่ใน [แผน Supabase Cron](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-supabase-cron-preparation.md)
