# ชุดจำกัดการอ่านรายชื่อก่อนล็อกอิน — เตรียมในเครื่อง 28 กันยายน 2569

สถานะ: **ติดตั้ง username-only directory บน Supabase จริงแล้ว 28 กันยายน 2569** หน้าเว็บชื่ออย่างเดียว `f404377` เผยแพร่แล้ว ผู้ใช้ตอบคำถามตรวจรับโดยตรงว่า “ทดสอบแล้ว เข้าได้และรายชื่อครบ” หลังรีเฟรช/ล็อกอิน Admin ใหม่และเปิด Manage Users และยืนยันบัญชีพนักงานเพิ่มว่า “เข้าได้ งานเดิมแสดงปกติ” นับเป็น user-reported acceptance ก่อนติดตั้งของสองเส้นทาง ผลหลังติดตั้งอยู่ข้างล่าง ไม่ใช่การเปิด Lead

## ผลติดตั้งจริง — 28 กันยายน 2569 เวลา 15:25 น. ไทย

- ผู้ใช้เปิด Backup ใน Chrome ให้ตรวจใหม่ เห็น project `kbthmdedilswdmmczfay`, main/Production, physical backups 7 รายการ ล่าสุด `2026-09-27T20:23:29Z` (28 ก.ย. 03:23:29 ไทย) ไม่กด Restore และไม่อ้างว่าซ้อมกู้คืนแล้ว
- ตรวจ history/catalog ใหม่เวลา `2026-09-28T08:24:14Z` ไม่พบ directory policy/migration เดิม ไฟล์ SHA-256 ตรงรุ่นทดสอบ จากนั้นใช้ apply_migration เพียงครั้งเดียวพร้อม operator attestations ตามหลักฐาน/การอนุมัติ ได้ success=true
- Remote migration: **`20260928082516_login_directory_reviewed_cutover`**; source local: `20260928075605_login_directory_reviewed_cutover.sql` และ hash `d50b54735a42d38cd4c53a532284646f9d7aec5c230b920879d48f31c1eab39b` ไม่แก้ source เพื่อให้ hash เปลี่ยน ข้อความ LOCAL CANDIDATE ในหัวไฟล์เป็นประวัติการเตรียม ให้ยึดสถานะติดตั้งจากรายงานนี้ ห้าม replay/db push ทั้งโฟลเดอร์เพื่อชดเชย timestamp ต่างกัน
- ตรวจหลังติดตั้งเวลา `2026-09-28T08:25:40Z`: anon ไม่มี table SELECT, username SELECT=true เพียงคอลัมน์เดียว; id/role/created_at/last_seen_at=false ทั้งหมด, authenticated ยังคง SELECT ทุกคอลัมน์เดิม; RLS ยังเปิด, unsafe client writes=false, directory policy มีแล้ว
- จำนวนก่อน/หลังตรง: users/auth.users 18/18, foremen 4, projects 8, plots 306, leads 895, sales 289; staff identity digest และ hashes ของ body/ACL/security-definer ของ account/presence functions ตรงเดิม ไม่มีการย้ายหรือแก้ข้อมูลธุรกิจใน SQL ชุดนี้ จำนวนตรงไม่ใช่การตรวจเนื้อหาทุกแถว
- REST จริงแบบไม่ล็อกอิน ใช้ enabled publishable key (ไม่เก็บ key ในรายงาน): `select=username&order=username.asc&offset=0&limit=200` ได้ HTTP 200, Content-Range `0-17/18`, ทุกแถวมีเฉพาะ username; ขอ role/id/*/last_seen_at หรือเรียงด้วย role ได้ HTTP 401 / PostgreSQL `42501` ทั้ง 5 กรณี ใช้ limit=0 ในกรณีปฏิเสธเพื่อไม่ส่งข้อมูลภายในออกหากเกิด regression
- SQL READ ONLY ภายใต้ SET LOCAL ROLE authenticated อ่านชุดคอลัมน์พนักงานเดิมได้ 18 แถว เป็นการตรวจสิทธิ์ฐาน ไม่ใช่ authenticated REST/session acceptance
- เปิดเว็บ 79c5 ในแท็บ Chrome ใหม่ ใช้ session พนักงาน Foreman ที่ผู้ใช้มีอยู่ หน้าโครงการและรายการงานโหลดเสร็จหลังติดตั้ง ไม่ logout/เปลี่ยนบัญชี ไม่กรอก PIN ไม่แก้งาน ไม่อ่าน token; ไม่อ้างว่าได้ทดสอบ fresh login ของ Admin หลังติดตั้งหรือทดสอบทุกโมดูล
- Advisors ก่อน/หลังชื่อและจำนวนข้อเตือนเหมือนเดิม ไม่มีการแก้ข้อเดิมพ่วง: [definer views 10](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [mutable search_path 8](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [user_metadata RLS 5](https://supabase.com/docs/guides/database/database-linter?lint=0015_rls_references_user_metadata), [legacy presence anon RPC](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated presence RPC](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); [reviewed_admins no-policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) เป็น private deny-by-default ตามแบบ ไม่รับรองว่าทั้งระบบปลอดภัยครบแล้ว
- ไม่แก้บทบาท/PIN/Auth credentials, ไม่เปลี่ยน account RPC/presence, ไม่เปิด trusted-auth/Lead/Cron, ไม่ Deploy เพิ่ม ไม่ Restore ฐาน

ขั้นต่อไป: ทบทวนชุดฐาน CRM/สิทธิ์/ย้ายข้อมูลแยกจาก directory ที่ติดตั้งแล้ว ห้ามรัน account guard หรือ directory ซ้ำ และห้ามเปิด trusted_actor ทั้งชุดโดยยังไม่มีแผน Admin/presence ของฝ่ายอื่น ผลอนุมัติครั้งนี้ครอบคลุม directory เท่านั้น

## ประวัติก่อนติดตั้ง — 28 กันยายน 2569 (ขณะนั้นยังไม่มี mutation)

- ผู้ใช้ตอบ “โอเคทำเลย” ต่อคำขออนุญาตที่ระบุชัดว่าติดตั้งเฉพาะ username-only directory ไม่เปลี่ยนบทบาท/รหัสผ่าน/ลูกค้า/งานฝ่ายอื่น และไม่เปิด Lead พร้อมแจ้งผลต่อแท็บรุ่นเก่าแล้ว ไม่ต้องถามอนุญาตขอบเขตเดิมซ้ำหากกลับมาทำต่อโดยเป้าหมาย/ไฟล์/ผลกระทบไม่เปลี่ยน
- ตรวจ project ref ตรง, ACTIVE_HEALTHY, PostgreSQL 17.6.1.111; migration history มีเพียง `20260928061913_account_guard_reviewed_cutover` ยังไม่มี directory migration
- ไฟล์ candidate SHA-256 `d50b54735a42d38cd4c53a532284646f9d7aec5c230b920879d48f31c1eab39b` ตรงรายงานทดสอบ run-ZFmYov ที่ passed/stopped
- Preflight READ ONLY เวลา `2026-09-28T08:17:14.804159Z`: owner/operator postgres, RLS=true, anon/authenticated table SELECT=true, unsafe client writes=false, directory policy absent; users/auth.users=18/18, foremen=4, projects=8, plots=306, leads=895, sales=289 เก็บเฉพาะ counts กับ hashes ของฟังก์ชัน/ตัวตนเพื่อเทียบหลังติดตั้ง ไม่อ่านรายชื่อลูกค้า
- Security advisors ก่อนติดตั้งยังพบข้อเดิมนอกขอบเขต: definer views 10, mutable search_path 8, user_metadata RLS 5, legacy presence RPC และ leaked-password protection; reviewed_admins no-policy เป็น deny-by-default ตามแบบ ไม่แก้ทั้งหมดพ่วงในงานนี้
- การเปิด Backup ใน Chrome และช่องอ่าน DOM ไม่ตอบกลับ; ลองทาง CLI `backups list --project-ref kbthmdedilswdmmczfay` แล้วไม่มี CLI access token ไม่ขอหรือค้นหา token จาก browser
- หลักฐาน Backup ล่าสุดที่เคยตรวจได้วันนี้คือ `2026-09-27T20:23:29Z` แต่ยังตรวจรายการปัจจุบันในรอบติดตั้งนี้ไม่ได้ จึง **ไม่ตั้ง backup gate ให้ผ่าน และไม่เรียก apply_migration** ให้ผู้ใช้เปิดหน้า Scheduled Backups หรือส่งภาพวันที่/สถานะก่อนทำต่อ โดยไม่กด Restore
- เมื่อได้หลักฐานแล้วตรวจ catalog/history ซ้ำก่อนรันเฉพาะ candidate นี้ หากคำสั่งติดตั้งตอบกำกวมให้ตรวจ history/ACL ก่อน retry ห้ามรันซ้ำทันที

## สิ่งที่ตรวจและเตรียมเพิ่ม

- ตรวจ catalog ฐานจริง `kbthmdedilswdmmczfay` แบบ READ ONLY: users เปิด RLS, anon ยังอ่านทั้งตาราง, authenticated ยังอ่านทั้งตาราง, ไม่มีสิทธิ์ client เขียนตาราง/คอลัมน์, restrictive policies ปิด insert/update/delete ยังเป็น false, 4 account RPC เป็น invoker, ไม่มี login_name_public_read/reviewed_roles/crm_user_roles ไม่อ่านแถวลูกค้า
- CLI 2.117.0 สร้างไฟล์ `supabase/migrations/20260928075605_login_directory_reviewed_cutover.sql` ในเครื่อง ไม่มี db push/apply migration
- ไฟล์จำกัด anon ให้ SELECT username เท่านั้น ถอน SELECT ที่ PUBLIC/anon ระดับตารางและคอลัมน์ก่อน พร้อมตรวจสิทธิ์สืบทอด; authenticated คงสิทธิ์อ่านข้อมูลพนักงานเดิม
- ไม่แก้ข้อมูลผู้ใช้ บทบาท รหัสผ่าน ฟังก์ชันบัญชี ฟังก์ชันเวลาออนไลน์ แปลง ลูกค้า หรือสวิตช์ใด ๆ ไม่เพิ่มตารางรายชื่อซ้ำ
- ต้องมี operator attestations ครบ release/project/client/acceptance/backup/old-tabs และสภาพ guard ต้องตรง; ค่าที่ระบุด้วย operator **ไม่ใช่หลักฐานว่าเชื่อมถูกฐานหรือทดสอบผ่านเอง** ต้องตรวจอิสระก่อนเสมอ
- รันซ้ำหรือพบ policy เดิมจะหยุดให้ทบทวน ไม่ overwrite เงียบ ๆ; lock รอไม่เกิน 2 วินาทีและ statement ไม่เกิน 30 วินาที การเปลี่ยนอยู่ใน transaction เดียว

## เหตุที่ไม่รันร่างสิทธิ์ทั้งหมดต่อกัน

`trusted_actor_draft.sql` ไม่ใช่เพียงเพิ่มสิทธิ์ Sales: มันสร้าง reviewed_roles แล้วเปลี่ยน `execute_account_command` ให้ต้องมี reviewed role และเปลี่ยน `update_user_last_seen(text)` ของทุกฝ่ายไปใช้ current_actor ด้วย หากติดตั้งโดย registry ยังว่าง จะปฏิเสธคำสั่ง Admin และ presence แม้หน้าเว็บยังไม่เปิด trusted-auth

ดังนั้น candidate นี้แยกเฉพาะ directory ไม่ตัด prerequisite ของ trusted_actor/role_review/crm_role_alignment และไม่รับรองบทบาททุกฝ่ายอัตโนมัติ ขั้น CRM foundation ยังต้องจัดชุด migration/backfill/role review ให้ครบก่อนเปิด Lead

## ผลตรวจในเครื่อง

- Unit safety tests 23/23 ผ่านจาก login-directory-cutover, login-directory, account-security; scoped ESLint ผ่าน
- ชุด PostgreSQL 17.11 จำลอง **ผ่านแล้ว**: directory 21 assertions + candidate gates/rollback 14 assertions รวม 35 ข้อเฉพาะชุดนี้ พร้อม account/trusted-role/CRM workflow/revocation/restore regression ใน runner เดิม ผ่านการไม่มีหลักฐาน, client เก่า, grants เขียนระดับคอลัมน์, policy ชื่อเดิมแต่ body เปลี่ยน, inherited SELECT, rollback หลัง postcheck, รันซ้ำ และยืนยันข้อมูล/ฟังก์ชัน/รายชื่อ Admin เดิมไม่เปลี่ยน
- รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-ZFmYov/report.json`: status=passed, stopped=true, sourceFilesUnchanged=true; process exit 0 ไม่เหลือฐานจำลองที่กำลังทำงานจากรอบนี้ ไม่ลบชุดหลักฐาน
- ตัว runner ไม่รับ URL/ฐานเดิม ไม่อ่าน .env และตรวจฐานชื่อสุ่มใน cluster ใหม่เฉพาะ loopback ก่อน mutation; ใช้บัญชี/ข้อมูลสมมติเท่านั้น ไม่ใช่ผล Supabase Auth/PostgREST จริง

## ก่อนอนุมัติให้ติดตั้งจริง

1. Admin และบัญชีพนักงานตรวจรับแล้วตามคำตอบข้างต้น; ผลหลังติดตั้งยังต้องตรวจแยก
2. ตรวจรายงาน catalog/backup ใหม่และ target จากช่องทางอิสระ นัดให้ผู้ใช้แท็บเก่ารีเฟรช และยืนยันผู้ดำเนินการที่เข้าถึง SQL เพื่อแก้เฉพาะจุดได้
3. ผู้ใช้อนุมัติ candidate นี้แยกจากงาน CRM แล้วตามบันทึกรอบติดตั้งข้างต้น; ยังติดเงื่อนไข Backup ปัจจุบัน ไม่ใช่ขาดการอนุมัติ SQL
4. ก่อนใช้ CLI migration workflow ต้อง reconcile `20260925103516` local กับ `20260928061913` remote ของ account guard โดยไม่ replay/ลบประวัติ remote ห้าม db push ทั้งโฟลเดอร์
5. หลังติดตั้ง ตรวจ anon อ่านได้เฉพาะชื่อผ่าน REST จริง, exact count/เรียงชื่อ, authenticated staff และ Admin ใช้งานได้ พร้อมตรวจ advisors; ถ้าล้มเหลวหยุดขั้นถัดไป แก้ client/สิทธิ์เฉพาะจุด ห้ามคืน SELECT ทั้งตารางให้ anon หรือ Restore ฐานร่วมทั้งก้อนโดยอัตโนมัติ

อ้างอิงที่ตรวจ: [Supabase Column Level Security](https://supabase.com/docs/guides/database/postgres/column-level-security) — สิทธิ์ระดับตารางมีผลเหนือการถอนสิทธิ์คอลัมน์และ wildcard จะใช้ไม่ได้หลังจำกัดคอลัมน์ ตรวจ changelog วันที่ 28 กันยายน 2569 แล้ว; รอบนี้ไม่มีการอัปเกรด Postgres/extension หรือเปลี่ยน API library
