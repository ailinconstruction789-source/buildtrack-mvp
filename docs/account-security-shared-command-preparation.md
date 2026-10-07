# ชุดบัญชีร่วมก่อนเปิด Lead ส่วนกลาง

25 กันยายน 2569 — เตรียมในเครื่อง ไม่ใช่ SQL พร้อมเปิดใช้งาน

## ขอบเขตและผู้รับผิดชอบ

ผู้ใช้อนุมัติให้เตรียมแก้ช่องทางบัญชีที่จำเป็น หลังพบจุดเสี่ยงในฐานร่วม และยืนยันบัญชี `Admin` เป็นผู้จัดการหลักคนเดียว ไม่จำเป็นต้องสร้าง Admin สำรองในแอป แต่ก่อนติดตั้งต้องยืนยันผู้มีสิทธิ์เข้า Supabase สำหรับกู้คืนและหลักฐาน backup ห้ามทดสอบแบน/ลบ Admin จริงคนสุดท้าย

การตรวจจับคู่ชื่อกับ Auth แบบอ่านอย่างเดียวพบคู่เดียวที่พร้อมในเวลาตรวจ ไม่ใช่การเปิดสิทธิ์ให้แล้ว ไม่พิมพ์ UUID/อีเมล/PIN/token ลงเอกสารนี้

## สิ่งที่เปลี่ยนในเครื่อง

- `account_admin_guard_draft.sql` ยังคง guard/ROLLBACK: คำสั่งเดิมย้ายเข้า schema ภายใน ล้าง ACL ทุกผู้รับยกเว้น owner เฉพาะวัตถุ guard แล้วให้ authenticated เรียกได้เฉพาะ dispatcher ที่ตรวจ Admin/session และ public facade; ไม่เปลี่ยน default privileges ทั้งฐาน
- เพิ่ม helper แบบ invoker ที่ไม่มี client EXECUTE: สร้าง/ลบ Foreman และบัญชีเป็น transaction เดียว เกิดข้อผิดพลาดแล้ว rollback ทั้งหมด ไม่ล้างประวัติงานก่อสร้าง ไม่รับชื่อชน/ชื่อโฟร์แมนค้างมาเป็นบัญชีใหม่อัตโนมัติ บทบาทสำหรับลบอ่านจากฐาน ไม่รับจาก browser
- `trusted_actor_draft.sql` ใช้ helper เดียวกันต่อ ไม่กลับไปเป็นคำสั่งคนละ transaction เมื่ออัปเกรดภายหลัง
- `app_account_command_capabilities()` ส่งเฉพาะ contract และความสามารถ atomic ไม่คืนข้อมูลบัญชีและไม่ใช้แทนการตรวจสิทธิ์
- `lib/auth/accountCommands.ts` และตัวเชื่อมในหน้าหลัก: โหมดใหม่ตรวจ contract ก่อนแล้วส่ง mutation ครั้งเดียว ไม่ retry/fallback เมื่อผิดพลาด โหมดเดิมยังอยู่ขณะสวิตช์ปิดเพื่อไม่เปลี่ยนระบบที่ใช้อยู่กลางทาง

## ผลกระทบและข้อจำกัด

- ยังไม่ได้เปิด `NEXT_PUBLIC_ACCOUNT_GUARDED_COMMANDS_ENABLED` และไม่ได้เปิด trusted-auth ทั้งแอป สวิตช์เป็นค่าตอน build ไม่ใช่ระบบอนุญาตสิทธิ์
- ต้องพักงานจัดการพนักงานและส่ง client ใหม่พร้อม SQL ก่อนเปิดสวิตช์ บังคับรีโหลด client เก่า: client เก่ายังเพิ่ม/ลบ foremen สองขั้นตอน จึงห้ามปล่อยใช้กับ SQL ใหม่ระหว่าง cutover
- อย่าปิดสวิตช์กลับไปใช้ทางเก่าหลัง SQL ติดตั้งแล้วเพื่อแก้ error ให้หยุดงานบัญชีที่กระทบและใช้ operator แก้ตามแผน
- SQL ยังเรียกธุรกรรม Auth เดิมของแอป ไม่ได้แก้ default PIN หรือเปลี่ยนไป Auth Admin API; การทดสอบ login/refresh/reset จริงยังจำเป็น ไม่มีการถือว่าผ่านเพราะ PostgreSQL จำลองผ่าน
- `reviewed_admins` ป้องกันการลบสมาชิกผ่าน FK แต่ไม่ได้ป้องกันผู้ดูแล Supabase ทุกช่องทางจากการแบน/ลบ/แก้ schema และไม่แทนแผนกู้คืน
- ไม่เปลี่ยน grants/RLS ของ projects, plots, foremen หรือโมดูลอื่นในชุดนี้ ไม่อ้างว่าปิดช่องเขียนของทั้งแอปครบแล้ว
- ไม่สร้าง canonical/Sales role อัตโนมัติจากบทบาทเดิมหรือ metadata

## ก่อนติดตั้งจริง

1. ตรวจ backup และผู้ดำเนินการกู้คืนสำหรับ Admin คนเดียว
2. ตรวจผลกระทบ callers/dependencies, policies, default grants, schema exposure และ legacy Auth จริงตามขอบเขต release
3. เตรียม migration จริงที่มีจุดตรวจและแผนหยุดงานจากสภาพฐานล่าสุด แสดง SQL/ผลกระทบให้ผู้ใช้ก่อนรัน ไม่ลบ guard จากร่างแล้วใช้เป็น migration
4. ประสานช่วงพักงานบัญชี ส่ง client ที่ตรงกัน ตรวจ Admin/session/งานฝ่ายอื่น แล้วจึงทำชุดเปิด Lead ขั้นถัดไป

ผลทดสอบ Supabase Auth/PostgREST จริงยังเป็น NOT_RUN; ผลในเครื่องไม่ถือเป็นอนุมัติเปิดระบบ

## ผลตรวจรอบนี้

- Vitest 82/82 ผ่านจาก 7 ไฟล์: client ใหม่, SQL draft/runtime safety, trusted actor และ login directory
- Native PostgreSQL 17.11 รวม 550 assertions ผ่าน (guard 86) รวม default/inherited ACL, service_role, rollback ของ Foreman/บัญชีทั้งขาสร้างและขาลบ, ชื่อชน, ประวัติก่อสร้าง และชุดบัญชี/CRM เดิม
- รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-kSCAIE/report.json`: passed, stopped=true, productionChanged=false, sourceFilesUnchanged=true, realSupabaseAuthTested=false
- ESLint เฉพาะ helper/test/runtime ที่แก้ และ TypeScript strict เฉพาะ helper ใหม่ผ่าน ไม่ใช่ full-project typecheck/build หรือ browser acceptance
- ไม่เปิด flag ไม่แก้ environment ไม่ติดตั้ง SQL บน Supabase และไม่หยุด dev server ของผู้ใช้ ฐานจำลองของรอบทดสอบปิดแล้ว

## ตรวจฐานจริงและข้อมูลสำรองเพิ่มเติม

25 กันยายน 2569 — ใช้ catalog แบบ READ ONLY และหน้า Dashboard ที่ผู้ใช้ล็อกอินใน Chrome เท่านั้น ไม่มีการเปลี่ยนฐานจริง

- เปิด Database Backups ของ project `kbthmdedilswdmmczfay` ใน Chrome ตามที่ผู้ใช้เลือก เห็นรายการ physical backups 7 วัน ล่าสุด `24 Sep 2026 20:23:53 (+0000)` หรือ **25 กันยายน 2569 เวลา 03:23:53 น. ประเทศไทย** และปุ่ม Restore ไม่ได้กด Restore/ดาวน์โหลด/เปิด PITR หรือเปลี่ยนการตั้งค่า
- เป็นหลักฐานว่ามีรายการสำรองใน Dashboard ไม่ใช่ผลซ้อมกู้คืน หรือการรับรองว่าครอบคลุมธุรกรรมหลังเวลานั้น; หน้าแจ้งว่า Storage objects ไม่รวมใน database backup
- ยืนยันซ้ำว่า account/Sales private schemas และ current-actor RPC ยังไม่มี นิยามคำสั่งบัญชี 4 ตัวมี hash ตรงกับการตรวจฐานจริงครั้งก่อน แต่ hash ของ body ในไฟล์ local ไม่ตรงกับฐานจริง จึงยังต้องตรวจเนื้อหา/ความต่างก่อนอ้างว่าชุดทดสอบ legacy body ตรงของจริง (hash ต่างอย่างเดียวไม่พิสูจน์ว่าตรรกะต่าง)
- ไม่พบ catalog dependency หรือ textual caller ใน public/Sales/account schemas ที่อ้างชื่อคำสั่งบัญชีทั้งสี่ในขอบเขตที่ค้น ไม่ถือว่าตรวจ callers ภายนอก/SQL ที่สร้างชื่อแบบ dynamic ครบแล้ว
- ไม่พบ user trigger บน public.users, auth.users หรือ public.foremen จาก catalog; foremen มี PK และ unique name ไม่มี FK เข้า/ออกตามผลตรวจ
- anon/authenticated ไม่มี CREATE ใน public/extensions; default grants ของ postgres ใน public มี anon/authenticated/service_role จึงยังจำเป็นต้องล้าง ACL เฉพาะวัตถุใหม่ตามที่เตรียม
- Admin มี candidate หนึ่งและคู่ Auth ที่พร้อมหนึ่ง ไม่ได้เพิ่มสมาชิก reviewed_admins หรือทดสอบบัญชีจริง
- Security Advisors ยังรายงานคำสั่งบัญชีเดิมที่ anon/authenticated เรียกได้, mutable search_path, policy อ้าง metadata และ views ของฝ่ายอื่น ไม่เปลี่ยนวัตถุเหล่านั้นนอกขอบเขตโดยอัตโนมัติ

อ้างอิง: [Database backups และข้อจำกัด](https://supabase.com/docs/guides/platform/backups), [คำสั่ง SECURITY DEFINER ที่ anon เรียกได้](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [RLS ที่อ้าง user metadata](https://supabase.com/docs/guides/database/database-linter?lint=0015_rls_references_user_metadata), [views ที่ใช้สิทธิ์เจ้าของ](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)

ข้อความด้านบนเป็นหลักฐานตามเวลาที่ตรวจ ไม่ใช่สถานะฐานปัจจุบัน ดูความคืบหน้าถัดไปก่อนตัดสินใจติดตั้ง

## ความคืบหน้า 28 กันยายน 2569

- เตรียม migration candidate `supabase/migrations/20260925103516_account_guard_reviewed_cutover.sql` ด้วย Supabase CLI แล้ว แต่ยังไม่ได้ติดตั้งจริง ไฟล์นี้มี COMMIT และจุดตรวจ operator ต่างจาก draft ที่ยังมี DESIGN ONLY/ROLLBACK ห้ามรันแบบ db push โดยไม่ทบทวน
- ตรวจ body ของคำสั่งเดิมครบแล้วเมื่อ 25 กันยายน: สร้าง/ลบ/เปลี่ยน PIN ตรงกับ source ที่เลือก ส่วนเปลี่ยนชื่อใช้ body snapshot ที่ตรวจจากฐานจริงใน `scripts/sales-runtime/reviewed-legacy-accounts.mjs` โดยไม่แก้ไฟล์ SQL เก่าของผู้ใช้
- fixture ตรวจ raw hash กับ snapshot ก่อน compile และตรวจ hash แบบ CRLF→LF หลังส่งผ่าน psql; migration ตรวจแบบเดียวกันโดยไม่ตัด comment/ช่องว่าง/SQL tokens อื่น การเปลี่ยน body ต้องหยุดทบทวน ไม่ปรับ expected hash เพื่อให้ผ่านโดยไม่ตรวจ
- candidate จำกัดเฉพาะ account guard และรับรอง Admin ที่ผูก UUID ผ่านการตรวจอิสระใน transaction เดียว ไม่เปิด Sales ไม่แก้ข้อมูลลูกค้า และไม่เปลี่ยน default grants ทั้งฐาน
- ค่า release/project/client/backup ที่ operator ระบุเป็นคำยืนยันของผู้ดำเนินการ ไม่ใช่หลักฐานอัตโนมัติว่าเชื่อมถูกโปรเจกต์ เว็บพร้อม หรือกู้คืนได้ ต้องตรวจจริงก่อนตั้งค่า
- ตรวจเว็บ `https://buildtrack-mvp-79c5.vercel.app/` เมื่อ 25 กันยายนแบบไม่ล็อกอิน: account handler ใน public chunk `0jthsu2t1tqt7.js` ยังสร้าง Foreman สองขั้นตอน และไม่มี capability handshake ใน chunk นี้ จึงยังไม่ผ่าน client-readiness gate ไม่ใช่ผลตรวจเว็บซ้ำวันที่ 28
- ผู้ใช้ยืนยันวันที่ 28 กันยายนว่า Deploy ผ่าน GitHub → Vercel อัตโนมัติ ยังไม่ได้อนุมัติหรือดำเนินการส่งทั้ง dirty worktree ขึ้น production
- ชุดทดสอบย่อยรอบวันที่ 28 ผ่าน 33/33 จาก 5 ไฟล์ ครอบคลุม candidate, legacy snapshot, guard, preflight และ client command
- ชุดหน้าเลือกชื่อ/Login และ data hook ผ่านอีก 41/41 จาก 4 ไฟล์ รวมรอบนี้ 74 unit/component tests; ESLint เฉพาะ helper/runtime/test 7 ไฟล์ผ่าน ไม่ใช่ full-project lint หรือทดสอบผ่าน browser จริง

### ผลฐานจำลองรอบใหม่

- Native PostgreSQL 17.11 ผ่าน **572 assertions** รวม **22 assertions ของ migration candidate**: ปฏิเสธ gate/UUID ไม่ครบ, body เปลี่ยน, Admin ถูกแบน, rollback เมื่อผิดพลาดหลัง DDL/ACL/INSERT และการสร้าง/ลบ Foreman แบบ transaction เดียว ก่อนต่อชุดสิทธิ์บัญชี/CRM เดิมทั้งหมด
- รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-rLrkyk/report.json`: `status=passed`, `stopped=true`, `productionChanged=false`, `sourceFilesUnchanged=true`, `realSupabaseAuthTested=false`; เริ่ม `2026-09-28T01:41:36Z` จบ `2026-09-28T01:46:11Z`
- ปัญหา Windows เปิด psql ไม่สำเร็จในรอบ `run-9Lo2aC` วันที่ 25 ไม่เกิดซ้ำในรอบนี้ ไม่ได้แก้ระบบ Windows หรือลดจุดตรวจเพื่อให้ผ่าน และยังไม่มีหลักฐานพอสรุปสาเหตุเดิมว่าเป็น RAM
- ยังคง **NOT_RUN** สำหรับ Supabase Auth/PostgREST acceptance จริง, production build ของ release ที่เลือก, browser regression ฝ่ายอื่น และการซ้อมกู้คืน ไม่ถือว่าฐานจำลองแทนผลเหล่านี้ได้

## ลำดับเผยแพร่ผ่าน GitHub/Vercel — ยังไม่ดำเนินการ

1. ทบทวน diff และไฟล์ใหม่ที่จะปล่อยเป็นชุดเดียวกันก่อน commit: `app/page.tsx` มีทั้ง account commands, trusted-session และ Sales entry จึงไม่ใช่การส่ง helper บัญชีเพียงไฟล์เดียว ตรวจ imports และ dependency ให้ครบ ไม่ใช้ `git add .` กับงานค้างทั้งหมดโดยไม่ตรวจ ไม่รวม `supabase/.temp/cli-latest`, local caches, environment หรือข้อมูลสำรองใน release
2. ยืนยัน GitHub repository และ production branch ใน Vercel; local branch `main` อย่างเดียวไม่พิสูจน์การตั้งค่า deployment ห้าม push เพื่อทดลองว่าขึ้นเว็บใด
3. ตรวจ build/หน้า login/งานบัญชีและเส้นทางฝ่ายอื่นของ release ที่เลือก โดยไม่ใช้ข้อมูลจริงทำ mutation ทดสอบ ก่อนนัดพักงานจัดการพนักงาน ต้องปิดหรือรีโหลดแท็บเก่าที่มีสิทธิ์เขียนบัญชี
4. ในช่วงพักงาน ส่ง matching client ที่ build ด้วย `NEXT_PUBLIC_ACCOUNT_GUARDED_COMMANDS_ENABLED=true` และตรวจ deployment ที่ขึ้นจริง ก่อน SQL ใหม่ client นี้ต้องหยุดสร้าง/ลบบัญชีด้วยข้อความยังไม่พร้อมและไม่เขียน Foreman โดยตรง ไม่ให้ทดสอบด้วยการทำรายการจริงที่ไม่ได้อนุมัติ
5. ยังไม่เปิด `NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED`, `ACCOUNT_ACCESS_READ_ENABLED`, `ACCOUNT_ACCESS_RESTORE_ENABLED` หรือ Sales/Cron flags ใน release account guard นี้ เพราะมี dependencies อีกชุด ตรวจค่าจริงใน Vercel โดยไม่เปิดเผย secrets; การแก้ค่าตอน build ต้องมาพร้อม deployment ใหม่ ไม่ถือว่าการส่ง source อย่างเดียวเปิด flag แล้ว
6. ตรวจ backup ล่าสุดและ operator recovery, catalog/body/grants/dependencies และคู่ Admin ซ้ำ แสดง SQL/ผลกระทบตามข้อตกลงก่อนรัน candidate เฉพาะโปรเจกต์ที่อนุมัติ การตั้ง gate ไม่แทนการตรวจเหล่านี้
7. หลังติดตั้ง ตรวจ ACL/capability และ Admin session ผ่าน Supabase Auth/PostgREST จริง รวมงานฝ่ายอื่น ก่อนคืนงานบัญชี จากนั้นจึงทำฐานและสิทธิ์ Lead ส่วนกลางต่อ ห้ามใช้ผลฐานจำลองแทน acceptance จริง
8. หากผิดพลาด ให้พักงานบัญชีและรักษาเส้นทาง operator ไว้ ไม่ rollback เว็บเป็น client เก่าที่เขียนสองขั้นตอนหลัง SQL ใหม่ติดตั้งแล้ว และไม่คืน PUBLIC EXECUTE เพื่อแก้หน้าจอ

ขณะนี้ไม่ push, deploy, เปลี่ยน environment, รัน SQL บน Supabase หรือเปิด Lead/Cron อัตโนมัติจากแผนนี้

## ผลตรวจชุดเว็บต่อเนื่อง 28 กันยายน

ตรวจทั้ง source ในสำเนาที่ไม่มี credentials แล้ว: typegen/TypeScript/build ทุก route ผ่านด้วย low-memory Webpack profile และ fonts จำลอง (ไม่ใช่ default Vercel/Turbopack) ดู [ชุดไฟล์และผล Build](./account-release-build-check.md) ยังคงต้องทบทวน release, ทดสอบหน้าเว็บ/ฝ่ายอื่น และยืนยัน production branch ก่อน push; ไม่มี SQL หรือ deployment จริงในขั้นนี้

## Preflight หลังเผยแพร่ client — 28 กันยายน 2569

สถานะใหม่แทนข้อจำกัดด้าน client ก่อนหน้านี้: candidate Admin แบบแยก 3 ไฟล์ commit `9df9608` ถูกส่ง main และ Vercel `79c5` เป็น Ready แล้ว พร้อม guarded flag เฉพาะ Production; รายละเอียดและการตรวจ compiled handler ดู [รายงานเผยแพร่](./account-release-build-check.md) ไม่ได้ส่งทั้ง dirty worktree หรือเปิด Sales

ตรวจเป้าหมาย `kbthmdedilswdmmczfay` ผ่าน MCP แบบ `BEGIN READ ONLY` เมื่อ `2026-09-28T05:31:23Z` และตรวจ compatibility เพิ่มต่อเนื่อง:

- Project ACTIVE_HEALTHY, PostgreSQL 17.6.1.111, operator postgres
- ยังไม่มี `account_security_private`, `sales_private` หรือ `app_account_command_capabilities()` จึงยังไม่มี SQL guard ติดตั้ง
- คำสั่งบัญชีเดิม 4 signature มี body hash normalized ตรง candidate ทั้งหมด; เป็น plpgsql/void/non-set/no-default และ postgres เป็นเจ้าของ ไม่มี overload เพิ่มในรายงาน
- Admin binding พบหนึ่งคู่และพร้อมหนึ่งคู่ ไม่ได้บันทึก UUID/อีเมล/PIN ลงรายงาน ไม่เพิ่ม reviewed_admins หรือรับรองสิทธิ์ใด ๆ
- ไม่พบ user trigger ใน users/foremen/auth.users และไม่มี FK เข้า/ออก foremen; anon/authenticated ไม่มี CREATE บน public/extensions
- public.users มีคอลัมน์ id/username/role/created_at/last_seen_at และเปิด RLS แต่ authenticated ยังมี UPDATE ตามระบบเดิม; candidate จะถอน direct write เฉพาะตารางบัญชีตามขอบเขตที่ทบทวน
- ตรวจ client ที่เผยแพร่แล้วพบ online tracker เรียก `update_user_last_seen(text)` (ไม่ใช่ direct UPDATE); RPC เดิมในฐานเป็น SECURITY DEFINER ของ postgres และ candidate ไม่แก้ฟังก์ชันนี้ จึงไม่จำเป็นต้องเปิด trusted-session ทั้งชุดเพื่อรองรับเส้นทางเดิม ไม่ถือเป็นการรับรองความปลอดภัยของ presence เดิมหรือ regression ครบ
- อ่าน changelog ปัจจุบัน พบประกาศ minor PostgreSQL upgrade/pgcrypto; รอบนี้ไม่อัปเกรดเครื่องฐานข้อมูลหรือ extensions ไม่เปลี่ยนวิธีเข้ารหัสเดิม

### จุดหยุดก่อน SQL

เปิดหน้า Scheduled Backups ผ่าน Chrome แล้ว แต่พบ Session expired; หลังเริ่ม sign-in ใหม่หน้าแสดงเฉพาะโครงหน้าและยังไม่มีรายการสำรอง/เวลา Backup ที่ตรวจได้ จึง **ยังไม่ยืนยัน Backup ล่าสุด** ไม่ใช้รายการวันที่ 24 ก.ย. ที่เคยเห็นแทนหลักฐานปัจจุบัน และไม่ตั้งค่า backup gate ให้ผ่านโดยเดา

ให้ผู้ใช้เข้าสู่ระบบ Supabase ด้วยตัวเองและแสดงหน้า Backup โดยไม่กด Restore จากนั้นตรวจรายการสำรอง/การเข้าถึง operator และยืนยัน Admin binding ตามขั้นตอนก่อนใช้ migration candidate ขณะจบรอบนี้มีเพียง read-only SQL ไม่มี DDL/DML/migration บนฐานจริง ไม่มีการแก้คีย์หรือ Auth credentials

## ติดตั้ง account guard จริงแล้ว — 28 กันยายน 2569

ส่วนนี้แทนสถานะ “ยังไม่ติดตั้ง/ติด Backup” ข้างต้น เฉพาะ account guard ไม่ใช่การเปิด Sales:

- ผู้ใช้แจ้งว่าเห็น Backup แล้ว ตรวจ Chrome พบ physical backups 7 วัน ล่าสุด `2026-09-27T20:23:29Z` (28 ก.ย. เวลา 03:23:29 ไทย) ไม่กด Restore และไม่ได้ทดสอบกู้คืน จึงไม่รับรองข้อมูลหลังเวลาสำรองหรือ point-in-time recovery
- ตรวจคู่บัญชี Admin ใหม่ก่อนติดตั้ง: พบหนึ่งคู่ active ตรง binding ที่ยืนยันไว้ จากนั้นเติม operator gates ในหน่วยความจำให้ candidate เดิม โดยไม่ hardcode UUID ลงไฟล์ต้นฉบับ
- ใช้ Supabase apply_migration สำเร็จ ชื่อ `account_guard_reviewed_cutover`; remote migration version **`20260928061913`** ส่วน source candidate ยังชื่อ `20260925103516_account_guard_reviewed_cutover.sql` ต้อง reconcile ประวัติ local/remote ก่อนใช้ CLI migration workflow ครั้งถัดไป ห้าม db push หรือ replay candidate นี้ซ้ำ
- ติดตั้ง private dispatcher, public invoker facades, restrictive account-write policies และ reviewed Admin ที่ enabled เพียงหนึ่งบัญชี ตรงคู่ Admin ที่ผู้ใช้อนุมัติ ไม่มีการเปลี่ยนรหัสผ่านหรือทดลองสร้าง/ลบบัญชีจริง
- ตรวจหลังติดตั้ง: users 18, auth.users 18, foremen 4, projects 8, plots 306 เท่ากับก่อนติดตั้งทุกค่า จำนวนไม่ใช่หลักฐานตรวจเนื้อหาทุกแถว; ไม่ได้อ่านข้อมูลลูกค้าทั้งชุด
- Legacy function bodies ทั้ง 4 hash ยังตรงเดิม; ย้ายเข้า private schema เป็น invoker และ anon/authenticated/service_role เรียกตรงไม่ได้ มีเพียง guarded dispatcher ที่ยกระดับสิทธิ์
- anon/authenticated ไม่มี direct table/column write บน public.users; SELECT เดิมยังอยู่ และไม่มีสิทธิ์ตาราง reviewed_admins; restrictive INSERT/UPDATE/DELETE policies ครบ service_role ยังมีสิทธิ์ public.users ตามระบบ backend เดิม ไม่อ้างว่าปิดทุก privileged path
- Read-only transaction probe ผ่าน: authenticated อ่าน capability contract/atomicForeman ได้; dispatcher ปฏิเสธเมื่อไม่มี session ด้วย ACCOUNT_ADMIN_REQUIRED; anon อ่าน capability ไม่ได้ ใช้ action ที่ไม่มี mutation และ ROLLBACK ไม่ปลอม session Admin ไม่ถือเป็นผล Auth/PostgREST acceptance
- Security Advisors: mutable search_path 12→8, anon-executable definer 5→1, authenticated-executable definer 5→1; ทั้ง 4 คำสั่งบัญชีไม่อยู่ในรายการเหล่านี้แล้ว ยังมีปัญหา legacy นอกขอบเขต เช่น views 10 และ metadata policies 5 ไม่แก้ฝ่ายอื่นอัตโนมัติ
- มี notice ใหม่ [RLS enabled without policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) สำหรับ private reviewed_admins เป็น intentional deny-by-default ไม่มี client grants และไม่เพิ่ม client policy เพียงเพื่อปิด notice; [legacy metadata-policy finding](https://supabase.com/docs/guides/database/database-linter?lint=0015_rls_references_user_metadata) ยังต้องทบทวนแยก ไม่ถือว่าทั้งฐานปลอดภัยครบแล้ว
- ไม่สร้าง Sales schema, ไม่เปิด Lead/trusted-auth/Cron/notifications และไม่แก้ presence RPC เดิม

### ขั้นถัดไปที่ยังไม่ผ่าน

ให้ผู้ใช้รีโหลดเว็บ Production 79c5 และล็อกอิน Admin ใหม่ด้วยตัวเอง โดยไม่ส่ง PIN/รหัสผ่านในแชต ตรวจการเข้าใช้งานและหน้าจัดการบัญชีจริงก่อนยกเลิกช่วงพักงานบัญชี การทดสอบเพิ่ม/ลบบัญชีต้องกำหนดบัญชีทดสอบที่ทิ้งได้ก่อน ไม่ใช้บัญชีพนักงานจริงทดลอง ไม่ถือว่าการติดตั้ง SQL หรือ capability probe เป็นการผ่าน happy-path end-to-end แล้ว

### ผลทดสอบเพิ่มบัญชีผ่าน Admin จริง — 28 กันยายน 2569

- ผู้ใช้ล็อกอิน Admin เองบน Production 79c5 และอนุมัติสร้างเฉพาะ `BT_GUARD_TEST_20260928` บทบาท Foreman หลังแจ้งว่าจะมีสิทธิ์ Foreman จริงระหว่างทดสอบ
- สร้างผ่านหน้า MANAGE USERS ด้วยปุ่มเพิ่มผู้ใช้หนึ่งครั้ง ไม่ใช้ SQL สร้างแทนและไม่อ่าน token/PIN จาก browser เห็นบัญชีใหม่ในรายชื่อพร้อมบทบาท FOREMAN
- ตรวจฐานแบบ READ ONLY: ชื่อทดสอบมี public.users (role Foreman) 1, auth.users 1, public.foremen 1, auth.sessions 0; totals users/auth.users 19/19, foremen 5, projects 8, plots 306 และ enabled reviewed Admin 1
- ผลนี้ยืนยัน happy-path create ผ่าน Admin session/UI จริงและข้อมูลทั้งสามส่วนครบ ไม่ใช่หลักฐานทดสอบ rollback/concurrency บน production หรือการปฏิเสธบัญชี non-Admin จริง
- **บัญชีทดสอบยังมีอยู่และมีสิทธิ์จริง** รอผู้ใช้ยืนยันการลบผ่านหน้าเว็บ ก่อนทดสอบ delete และตรวจจำนวนกลับ baseline 18/18/4 ห้ามถือว่าคำอนุมัติสร้างรวมการลบแล้ว ยังไม่เปิด Lead/Sales

### ผลทดสอบลบบัญชีผ่าน Admin จริง — 28 กันยายน 2569

- ผู้ใช้ยืนยันให้ลบเฉพาะ `BT_GUARD_TEST_20260928` พร้อมรายชื่อ Foreman แล้ว จึงกดปุ่มลบของแถวนั้น และตรวจข้อความยืนยันที่ระบุชื่อตรงกันก่อนยืนยันหนึ่งครั้งผ่าน Production UI ไม่ใช้ SQL ลบแทน
- หน้าเว็บนำแถวทดสอบออกแล้ว ตรวจฐานแบบ READ ONLY พบ test public.users=0, auth.users=0, public.foremen=0 และ sessions ที่ join กับบัญชีดังกล่าว=0 (ก่อนลบไม่เคยมี session ของบัญชีทดสอบ จึงไม่ใช่ผลทดสอบ revocation)
- จำนวนหลังลบกลับ baseline: public.users=18, auth.users=18, foremen=4, projects=8, plots=306; enabled reviewed Admin ยังคง 1 บัญชี ไม่เหลือบัญชีทดสอบนี้
- ผล create/delete happy path ผ่าน Admin session จริงบนเว็บ Production ครบแล้ว เป็นการลบจริง ไม่ใช่ soft-delete/ถังขยะ ไม่ได้ทดสอบ restore และไม่มีเหตุให้ restore ฐานร่วมเพื่อกู้บัญชีทดสอบ
- ผลนี้ไม่ครอบคลุมเปลี่ยนชื่อ/PIN, non-Admin Auth/PostgREST rejection, concurrency หรือ regression ฝ่ายอื่นครบทุกเส้นทาง ไม่เปลี่ยนรหัสผ่านพนักงาน ไม่ขยายสิทธิ์บัญชีอื่น และยังไม่เปิด Lead/Sales/trusted-auth/Cron/notifications
