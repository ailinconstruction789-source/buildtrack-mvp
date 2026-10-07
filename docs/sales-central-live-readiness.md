# Lead ส่วนกลาง: ผลตรวจฐานจริงก่อนติดตั้ง

วันที่ตรวจฐานจริงล่าสุด: 28 กันยายน 2569 เวลา 13:49 น. ไทย

## สถานะปัจจุบันหลัง account guard — 28 กันยายน 2569

**เปลี่ยนแผนข้อมูลตามผู้ใช้ยืนยันล่าสุด:** ใช้ข้อมูลฝ่ายขายชุดเต็มใหม่ (ลูกค้าเดิม + เพิ่มใหม่ + สถานะล่าสุด) เพื่อแทนที่ชุดเดิมหลังตรวจและสำรอง ไม่ทำ backfill 895 รายการจากฐานเดิมตอนนี้ และยังไม่ลบข้อมูลใด ดู `sales-crm-replacement-snapshot.md` อัปเดต 29 กันยายน: ตรวจสำเนาชีต 28 กันยายนและเตรียม read-only review แล้ว ผู้ใช้ยืนยันเบอร์ไม่ทราบและวันที่ 2 จุด มี 964 แถวมีชื่อ + 1 แถวพักเพราะไม่มีชื่อ; ยังไม่พร้อมนำเข้า/ยังไม่ยืนยันจำนวนคนไม่ซ้ำ ดู `sales-sheet-import-review.md` Foundation เดิมยังไม่รองรับ external snapshot โดยตรง ต้องปรับ provenance แยก ไม่เปิดใช้ด้วย flag อย่างเดียว

ส่วนนี้แทนข้อความ “ยังไม่ติดตั้งบัญชี/ยังไม่ Deploy” ในประวัติข้างล่าง ไม่ใช่การเปิด Lead:

- **คำยืนยันตัวบุคคล 29 กันยายน:** N001 แถว 3/193 คนเดียวกัน, N002–N065 ครบ 64 กลุ่มเป็นคนละคนทุกแถว บันทึกและทดสอบการแบ่งร่างแล้ว 161 แถว → 160 ชุดบุคคลในกลุ่มที่ตรวจ โดยคงประวัติครบ ไม่ merge จริง/ไม่เลือกเจ้าของหลักแทนผู้ใช้/ไม่สร้างรหัสบุคคลถาวร ยังไม่พร้อมเปิด Lead ด้วย flag อย่างเดียว

- **ตรวจตัวตนและแปลง 29 กันยายน:** อ่านทะเบียนจริงเฉพาะ 8 โครงการ/306 แปลง ผู้ใช้ยืนยัน 7 รหัสโครงการ, 53 แถวเลขแปลงศูนย์นำหน้า และ AL4 แถว 642 เป็นแปลง 67 แล้ว จับคู่ประวัติจองได้ 303/304 แถวและแปลงที่สนใจ 33/33 ยังคงชื่อซ้ำ 65 กลุ่มรอตรวจตัวบุคคล ไม่ merge/ไม่เปลี่ยนฐาน และยังไม่ตรวจ customer/sales dependency ทั้งชุด ดู `sales-sheet-identity-and-plots-2026-09-29.md`

- **อัปเดต mapping ชีต 29 กันยายน:** ผู้ใช้ยืนยันชื่อเต็ม Sales ทั้ง 7 และตัวเตรียมในเครื่องจับคู่ได้ 959/964 แถวที่มีชื่อลูกค้า อีก 5 แถวผู้ดูแลว่างยังพักไว้ ไม่มีการให้สิทธิ์/เปลี่ยนเจ้าของในฐานจริง ยังต้องตรวจ Auth binding สดก่อนนำเข้า และตรวจตัวตนชื่อซ้ำ/ทะเบียนแปลง ดู `sales-sheet-import-review.md`

- **ล่าสุดในเครื่อง:** มี sealed foundation candidate แล้ว (`20260928090010_crm_sealed_foundation_candidate.sql`) ทดสอบไฟล์จริงผ่าน 34 กรณีบน PostgreSQL จำลอง (`run-qs4W2A`, stopped=true) รวม rollback เมื่อหมดเวลารวม 30 วินาที พร้อม unit 37 ข้อและ ESLint ผ่าน ดู `sales-crm-foundation-candidate.md` ยังไม่ติดตั้ง Supabase จริง ไม่ได้เปิด Lead และยังไม่มี full manifest/backfill writer
- **ขั้นก่อนหน้า:** เส้นทาง staged identity เชื่อม role-review/projection/Auth revocation/Admin restore ผ่าน PostgreSQL ทั้งสายแล้ว (`run-wGj9g2`, stopped=true) พร้อม unit/regression 181 ข้อ ไม่ใช้ global trusted_actor และตรวจฟังก์ชันบัญชี/presence เดิมไม่เปลี่ยน ดู `sales-crm-staged-security-integration.md`

- **ล่าสุด: directory ติดตั้งแล้ว** `20260928082516_login_directory_reviewed_cutover` หลังผู้ใช้อนุมัติและตรวจ Backup ใหม่; REST อนุญาตเฉพาะ username ก่อนล็อกอิน, ปฏิเสธข้อมูลภายใน, staff grants เดิมคงอยู่ และ session Foreman โหลดงานบนเว็บจริงได้ ดู `account-login-directory-cutover.md` ข้อความ candidate/ยังไม่ติดตั้งด้านล่างเป็นประวัติก่อนรอบนี้ ไม่รัน directory ซ้ำ ยังไม่เปิด Lead/trusted-auth/Cron

- **ขั้นเตรียมล่าสุด:** แยกร่าง identity foundation ที่ไม่แทนคำสั่ง Admin/presence ของฝ่ายอื่นแล้ว ทดสอบเฉพาะส่วนใหม่กับ PostgreSQL ในเครื่องผ่าน 31 กรณี และ unit tests ที่เกี่ยวข้อง 62 ข้อ ดู `sales-crm-staged-identity-foundation.md` ยังต้องเชื่อม staged path กับ role-review/projection/recovery ก่อนประกอบชุดติดตั้ง ไม่ติดตั้ง CRM/รับรองสิทธิ์จริง และไม่รัน trusted_actor ร่างเดิมต่อโดยอัตโนมัติ ส่วน directory ในข้อบนเสร็จแล้ว ไม่เตรียมหรือติดตั้งซ้ำ

- ผู้ใช้ยืนยันตรวจรับ client `f404377` แล้วว่ารีเฟรช/ล็อกอิน Admin ใหม่ได้และรายชื่อพนักงานครบ ถือเป็นผลที่ผู้ใช้รายงาน ไม่ใช่การทดสอบทุกฝ่ายหรือ REST หลังจำกัดสิทธิ์ฐาน

- **อัปเดต client หลังผู้ใช้อนุมัติ:** เว็บ 79c5 เผยแพร่ `f404377` ชุดเลือกชื่อก่อนล็อกอิน 9 ไฟล์แล้ว ต่อจาก account client `9df9608`; GitHub Vercel status ของเป้าหมาย success และเว็บหลักส่ง bundle username-only ใหม่ ตรวจตาม `account-login-directory-release.md` ยังรอผู้ใช้ตรวจ fresh login/ข้อมูลพนักงานจริง ไม่มี SQL หรือการเปิด Lead เพิ่มในรอบนี้

- Account guard ติดตั้งจริงแล้ว (`20260928061913_account_guard_reviewed_cutover`) และเว็บ 79c5 ใช้ client `9df9608` ผู้ใช้ล็อกอิน Admin เอง ทดสอบสร้าง/ลบ Foreman ชั่วคราวผ่าน UI จริงครบแล้วและไม่เหลือบัญชีทดสอบ ดู `account-security-shared-command-preparation.md` ไม่ต้องทำชุดบัญชีนี้ซ้ำ
- API Production `/api/sales-crm/central` ยังตอบ HTTP 503 / `FEATURE_DISABLED` จากคำขอไม่ส่ง credentials ระบบปิดตามที่ตั้งใจ ไม่ใช่หลักฐานการทดสอบสิทธิ์ CRM หลังล็อกอิน
- ตรวจ catalog แบบ READ ONLY เมื่อ `2026-09-28T06:37:27Z`: ยังไม่มี sales_customers, lead_project_interests, crm_settings, crm_legacy_lead_links, sales_private.crm_user_roles, central_command_requests และ account_security_private.reviewed_roles; มี reviewed_admins กับ app_account_command_capabilities แล้ว
- Role/capability/create/search RPC ที่ Lead รุ่นในเครื่องต้องใช้ยังไม่มี ได้แก่ crm_v2_role(), crm_v2_capabilities(), crm_v2_create_customer(uuid,jsonb), crm_v2_central_search_capabilities(), crm_v2_central_search(jsonb,integer) จึงห้ามแก้ด้วยการเปิด flag อย่างเดียว
- จำนวน legacy ล่าสุด leads=895, sales=289, customer_voices=0 ไม่อ่านรายชื่อลูกค้า/เบอร์/หมายเหตุทั้งชุด และไม่ได้เทียบเนื้อหาทุกแถวหรือสร้าง full manifest; จำนวนตรงเดิมไม่ได้พิสูจน์ว่าแถวเดิมไม่เคยถูกแก้
- public.sales ยังใช้ trigger sync_plot_customer_status ที่ฟัง INSERT/DELETE/UPDATE OF plot_id,contract_status และ update_sales_table_updated_at; policies ฝั่งเขียน leads/sales ยังอ้าง user_metadata, customer_voices ยังเปิด authenticated กว้าง ไม่แก้ policy เหล่านี้ในรอบตรวจ

### รายชื่อ CRM ที่ผู้ใช้รับรองแล้ว (ยังไม่ติดตั้งสิทธิ์)

บัญชี Admin, Owner และ Sales ทั้ง 7 ด้านล่างจับคู่ Auth ได้คนละหนึ่งบัญชี ไม่ถูกลบ/แบน/anonymous ณ เวลาตรวจ ไม่มีการส่ง UUID/password/session ออกในรายงานนี้ ป้ายบทบาทเดิมเป็นเพียงข้อมูลประกอบ ไม่ใช่การรับรองสิทธิ์ชุดใหม่

| เจ้าของในข้อมูลเก่า | ชื่อล็อกอินที่จับคู่ | จำนวน Lead เก่า |
|---|---|---:|
| BELL | BELL | 253 |
| FIELD | FIELD | 118 |
| JEEJEE | JEEJEE | 18 |
| NOOK | NOOK | 106 |
| PIEW | PIEW | 254 |
| TAEW | TEAW | 10 |
| YING | YING | 136 |

รวม 895 รายการ จับคู่ได้ครบตามกลุ่มชื่อและ alias ที่ผู้ใช้ยืนยัน แต่ยังไม่สร้าง crm_user_roles/ไม่เปลี่ยนเจ้าของ Lead ชื่อ Piwe ใน KPI ยังคงใช้บัญชี PIEW ตามข้อตกลงเดิม ไม่ต้องสร้างบัญชีใหม่

### ช่องว่างก่อนเปิดจริงและลำดับงาน

1. **ชุดติดตั้งฐานและสิทธิ์ CRM:** แยก reviewed forward migration จากร่าง ให้ต่อ account guard ที่ติดตั้งแล้วได้โดยไม่สร้างซ้ำ ประเมิน trusted-role/login-directory dependency และไม่บังคับเปิด trusted-auth ของทุกฝ่ายเพื่อให้หน้า Lead ใช้ได้ ผู้ใช้รับรองครบแล้ว: Sales 7 บัญชี + Owner อ่านอย่างเดียว + Admin ตามรายการ; ต้องทบทวน SQL/grants/session enforcement พร้อมกันก่อนติดตั้ง
2. **ชุดย้ายและปิดช่องเขียนเดิม:** จัด full legacy-ID manifest/snapshot และ backfill ที่รันซ้ำไม่ซ้ำ ใช้หนึ่ง customer ต่อ legacy Lead ID ตามข้อตกลง เก็บ 289 Sale IDs และประวัติเดิม เบอร์แทน/เงิน/วันที่ไม่มีหลักฐานเป็นไม่ทราบ ไม่สร้าง Visit/SLA ย้อนหลัง ผูกแปลงและตรวจยอดก่อนเปิด ต้องเลิก legacy write ทั้ง UI และฐาน ไม่ใช่ซ่อนแท็บอย่างเดียว; ไม่ใช้ importer เก่ามาย้าย
3. **ชุดเว็บและเปิดรับงาน:** เลือก release เฉพาะ dependency ที่จำเป็นจาก dirty worktree ไม่ push ทุกไฟล์โดยเหมารวม สลับหน้ารายโครงการเป็นลูกค้าจองแทน Lead ตามข้อตกลง ทดสอบ Admin/Sales เจ้าของ/Sales คนอื่น/Owner พร้อมข้อมูลย้ายและการจอง ก่อนเปิด server flag กับ DB setting ให้ตรงกัน คง Cron/notifications ปิดในรอบ Lead

ใน repository ตอนตรวจ มี migration candidate ฝั่งบัญชีเพียงไฟล์เดียว ยังไม่มี deployment migration/backfill ฝ่ายขายพร้อมรัน ร่าง base มี ALTER TABLE sales/customer_voices และ security drafts มีการเปลี่ยนสิทธิ์ จึงไม่ใช่การเพิ่มตารางเปล่าอย่างเดียว ห้ามตัด DESIGN ONLY/ROLLBACK จากร่างแล้วติดตั้งรวดเดียว และต้อง reconcile timestamp migration บัญชี local/remote ก่อนใช้ CLI migration workflow

### ผลทดสอบรอบนี้และขอบเขต

Vitest 5 ไฟล์ **250/250 ผ่าน**: centralServer, centralContracts, centralTracker, CentralLeadForm, CentralLeadsView; รัน worker เดียว ใช้เวลา 26.33 วินาที เป็น unit/component + mocked API ไม่ใช่ Supabase Auth/PostgREST acceptance ของ Lead จริง ไม่มีการรันชุดฐานจำลองทั้งหมดหรือ full build ซ้ำ

รอบตรวจ readiness แรกไม่มี SQL mutation, ไม่มีการให้สิทธิ์ CRM, ไม่มีการย้ายข้อมูล, ไม่มีแก้ app code/env หรือ Deploy เพิ่ม แก้เฉพาะรายงานนี้เพื่อเก็บสถานะที่ตรวจได้จริง งานหลังรับรองรายชื่ออยู่ในส่วนถัดไป

### หลังผู้ใช้ยืนยันรายชื่อ: ตัวตรวจการผูกบัญชีพร้อมใช้ในงานเตรียม

- ผู้ใช้ตอบ “ใช่ๆ” ยืนยัน Sales BELL/FIELD/JEEJEE/NOOK/PIEW/TEAW/YING, Owner อ่านอย่างเดียว และ Admin ตามสิทธิ์ที่ตกลง ไม่ต้องถามรับรองรายชื่อชุดเดิมซ้ำ เว้นแต่ binding/สถานะเปลี่ยน
- เพิ่ม `sql/sales/central_roster_preflight_read_only.sql` เป็น SELECT report ใน READ ONLY transaction จำกัดเวลา 15 วินาที/lock 2 วินาที และ ROLLBACK ไม่ใช่ migration ไม่อ่านรหัสผ่าน metadata หรือ session และไม่คืนข้อมูลลูกค้า มีเฉพาะ staff identity bindings กับจำนวนแยกเจ้าของเดิม
- เพิ่ม `scripts/sales-runtime/central-roster.mjs` ตรวจรายชื่อที่อนุมัติครบ 9, ชื่อ login ชนกัน, legacy/Auth IDs ไม่ซ้ำ, บัญชีไม่ถูกลบ/แบน/anonymous, Admin ตรง reviewed_admins ที่ติดตั้ง, เจ้าของเดิมทุกกลุ่มเป็น Sales และจำนวนรวมครบ 895 รายการ ต้องใช้ report อายุไม่เกินหนึ่งชั่วโมงจาก target ที่ operator ตรวจแยกแล้ว
- ตรวจผลจากฐานจริงเวลา `2026-09-28T06:49:53.02598Z` ด้วย validator ในเครื่องผ่าน: Sales 7, Admin 1, Owner 1; Lead เดิมจับคู่ได้ 895, Sale 289, plots 306 ยังไม่สร้าง/แก้สิทธิ์ใด ๆ
- Identity digest ที่ตรวจแล้ว: `f94f056bf287da5913d303ce1d9065d92517643fa5ce2e0f46785368251b7efd` ตัวตรวจ `assertCentralRosterUnchanged` ต้องเทียบ digest นี้กับรายงานสดก่อนนำ binding ไปเตรียมติดตั้ง หากมีการสร้างบัญชีใหม่แทนชื่อเดิม UUID เปลี่ยน หรือบทบาทเปลี่ยน ต้องหยุดทบทวน ไม่ยกสิทธิ์ให้ชื่อเดิมอัตโนมัติ Digest ไม่ใช่ลายเซ็นหรือสิทธิ์เข้าฐาน
- Raw identity report เก็บชั่วคราวในหน่วยความจำ ไม่บันทึก UUID จริงลง migration หรือ repository; summary ซ่อน IDs ตัว validator ไม่มี network, env loader, SQL installer หรือการเขียนไฟล์ และคืน deploymentReady=false เสมอ
- Tests ของตัวตรวจใหม่ **43 ผ่าน** รวมกรณีปฏิเสธข้อมูลผิด/เก่า/บัญชีไม่พร้อม/ID ซ้ำ/ชื่อเดิมเปลี่ยน UUID; รวม account-cutover/account-preflight regression เป็น **56/56 ผ่าน จาก 3 ไฟล์** และ ESLint ของสองไฟล์ใหม่ผ่าน เป็น unit tests + การใช้ read-only report จริง ไม่ใช่การติดตั้งสิทธิ์หรือ role enforcement end-to-end

### Dependency ที่ต้องจัดการก่อนทำ migration ต่อจากชุดบัญชี

ตรวจ source พบ `crm_role_alignment_draft.sql` ต้องใช้ reviewed_roles/review_account_role; ชุด trusted_actor ก่อนหน้านั้นต้องผ่าน login_directory ซึ่งถอน anonymous SELECT ทั้งตาราง users ให้เหลือ username เท่านั้น ขณะที่ release 9df9608 ยังใช้ Login/data hook เดิม จึงไม่สามารถรัน security drafts ต่อกันตรง ๆ บนเว็บปัจจุบันโดยรับรองว่า login ฝ่ายอื่นไม่เสียได้

แนวทางต่อคือจัด matching name-only login client ที่เตรียมในเครื่องให้เป็น release แยกขอบเขต พร้อมพิสูจน์ว่าการโหลดข้อมูล/สิทธิ์หลังล็อกอินฝ่ายอื่นยังทำงาน ก่อนติดตั้งฐานที่เปลี่ยนสิทธิ์อ่านรายชื่อ **ไม่ใช่เปิด trusted-auth หรือรับรองบทบาททุกฝ่ายโดยอัตโนมัติ** หากจะเลือก CRM-only dependency แทน ต้องออกแบบและทดสอบเป็นชุดใหม่ ไม่ตัด prerequisite ของร่างเดิมทิ้งเพื่อให้ผ่าน

รอบยืนยันรายชื่อนี้แก้เฉพาะตัวตรวจ/SQL report/tests/เอกสาร ยังไม่มี Lead deployment migration, SQL mutation, backfill, feature flag, credential change หรือ Deploy เพิ่ม แยกผลเตรียมรายชื่อสำเร็จออกจากสถานะเปิดใช้งานจริง

### Client prerequisite เตรียมแล้ว — ยังไม่ Deploy

เตรียม name-only LoginScreen และแยก staff loader เป็น candidate 9 ไฟล์ต่อจาก release 9df9608 แล้วใน worktree เดิม ไม่แก้ login handler/PIN/role ของฝ่ายอื่น ทดสอบ 58 ข้อผ่านและ build 13 หน้าผ่าน รายละเอียดและข้อจำกัดใน `docs/account-login-directory-release.md` ขั้นถัดไปคืออนุมัติเผยแพร่ชุดนี้ ตรวจเว็บจริง แล้วค่อยติดตั้ง directory/role foundation ที่ตรงกัน ยังไม่ถอน SELECT หรือเปิด Lead ในฐานจริง

## ประวัติการตรวจและการเตรียมก่อน account cutover

รายการต่อไปนี้เป็นประวัติ ณ วันที่เขียน ให้ใช้ส่วนสถานะปัจจุบันด้านบนตัดสินใจ ไม่ใช้ข้อความเก่าว่า account guard ยังไม่ติดตั้ง

## ขอบเขตการอนุญาต

ผู้ใช้อนุญาตให้ดำเนินการ SQL เฉพาะงานเปิด Lead ส่วนกลางครั้งนี้ ไม่ใช่สิทธิ์ถาวรหรือการอนุญาตให้เปลี่ยนระบบบัญชีทุกฝ่าย ลบข้อมูล เปิด Cron หรือ Deploy ทั้งระบบ ฝ่าย Sales ยังไม่ใช้งานจริง แต่ฝ่ายอื่นใช้ฐานเดียวกันอยู่

เป้าหมายที่ตรวจคือ BuildTrack project `kbthmdedilswdmmczfay` ซึ่งตรงกับ host ที่แอปตั้งไว้ ไม่ใช่ `ailin-store`

**สถานะล่าสุด: ได้อนุมัติให้เตรียมและทดสอบช่องทางบัญชีร่วมที่จำเป็นแล้ว ยังไม่ติดตั้งบนฐานจริง** ผู้ใช้ยืนยันผู้จัดการบัญชีหลักคนเดียว ชื่อล็อกอิน `Admin` ต้องแสดงชุด SQL/ผลกระทบก่อนเปลี่ยนฐานจริงตามลำดับที่ตกลงไว้

28 กันยายน: migration candidate ผ่านฐานจำลอง 572 assertions รวมจุดตรวจติดตั้งใหม่ 22 ข้อ และปิดฐานจำลองแล้ว (รายงาน `run-rLrkyk`) ผู้ใช้ยืนยัน GitHub → Vercel อัตโนมัติ ขั้นต่อไปทบทวนชุด release/build และนัดอัปเดต client ให้ตรงกับ SQL ไม่ใช่เปิด flag Lead ทันที; ยังไม่มี push/deploy/SQL จริง

ผลต่อเนื่อง: ตรวจ TypeScript และ build ทุก route ในสำเนาที่ไม่มี credentials ผ่านแล้วด้วย low-memory Webpack/offline-font profile ดู [รายงานชุดเว็บ](./account-release-build-check.md) ไม่ใช่ผล default Vercel build หรือ Auth/API จริง

## การตรวจที่ดำเนินการ

- อ่านเฉพาะ catalog ของฐาน: ตาราง, grants, policies และคำสั่งบัญชีที่เกี่ยวข้อง
- ใช้ `BEGIN READ ONLY`, จำกัดเวลาคำสั่งและเวลารอ lock และจบด้วย `ROLLBACK`
- รอบตรวจ catalog ไม่อ่านแถวลูกค้า/บัญชี; รอบยืนยันตัวตนภายหลังอ่านเฉพาะบัญชีชื่อ `Admin` และจำนวนคู่ Auth ที่ตรงกัน ไม่ดึง PIN, password, token หรือ Auth session
- อ่านนิยามคำสั่งเปลี่ยน PIN และลบบัญชี โดยปิดบัง string literals ก่อนส่งผลกลับ เพื่อยืนยันว่ามีการตรวจผู้เรียกในตัวคำสั่งหรือไม่
- ไม่เรียกคำสั่งเปลี่ยน PIN/ลบบัญชี ไม่ทดสอบโจมตี และไม่ทำรายการทดลองในฐานจริง

## หลักฐานที่พบ

### 1. ฐาน Lead ใหม่ยังไม่ติดตั้ง

ผลตรวจความพร้อมในรอบก่อนหน้าไม่พบ `sales_customers`, `lead_project_interests`, `crm_settings`, `crm_legacy_lead_links`, `sales_private.crm_user_roles`, `sales_private.central_command_requests` หรือ 5 RPC ที่หน้า Lead ต้องใช้ รอบนี้ตรวจยืนยันว่า namespace `sales_private` และ `account_security_private` ยังไม่มี

การเปิด `SALES_CRM_V2_ENABLED` อย่างเดียวจึงไม่ทำให้หน้ารับ Lead ใช้งานได้ และไม่ควรเปิดระบบบัญชีใหม่ทั้งแอปเพื่อแก้ข้อความหน้า Lead

### 2. จุดเสี่ยงบัญชีร่วมที่ยืนยันจากฐานจริง

- `public.users` เปิด RLS แต่มี permissive ALL policy สำหรับ PUBLIC ที่ USING/WITH CHECK เป็น true พร้อมสิทธิ์ SELECT/INSERT/UPDATE/DELETE ของ `anon` และ `authenticated`
- คำสั่ง `admin_create_user`, `admin_delete_user`, `admin_change_username`, `admin_change_user_password` ที่มีอยู่ เป็น SECURITY DEFINER และให้สิทธิ์ EXECUTE แก่ `anon` และ `authenticated`
- ตรวจ body ของคำสั่งเปลี่ยน PIN และลบบัญชีแล้ว: เขียน `auth.users` โดยตรงตามชื่อที่ส่งเข้ามา ไม่มีการตรวจตัวตน/บทบาทผู้เรียกใน body และเจ้าของฟังก์ชันคือ `postgres`; `anon` มี USAGE ของ public schema
- พบสิทธิ์ระดับฐานที่มีความเสี่ยงสูง ไม่ได้ทดลองเรียกผ่าน HTTP ไม่ได้เปลี่ยนบัญชี และไม่ใช่หลักฐานว่ามีผู้โจมตีใช้งานช่องทางนี้แล้ว การ expose Data API และการตั้งค่าระดับ gateway ยังไม่ได้ยืนยันในรอบนี้

การผูก Lead กับ Auth UUID โดยเพิ่มตารางสิทธิ์ Sales อย่างเดียวไม่แก้ความเสี่ยงที่คำสั่งบัญชีเดิมอาจเปลี่ยนรหัสหรือลบบัญชีที่ได้รับสิทธิ์ได้

### 3. ข้อมูลโครงการและแปลงใช้ร่วมกับฝ่ายอื่น

- `public.projects` และ `public.plots` เปิด RLS แต่มี permissive PUBLIC ALL policy ที่ USING/WITH CHECK เป็น true และ grants ของ `anon` ครบ SELECT/INSERT/UPDATE/DELETE
- `leads` และ `sales` มี policy ฝั่งเขียนที่อ้าง `user_metadata` เป็นสัญญาณให้ตรวจสิทธิ์เดิมเพิ่มเติม ไม่ถือว่า grants เพียงอย่างเดียวพิสูจน์ว่า anon เขียนสองตารางนี้ได้ เพราะต้องประเมิน RLS ร่วมด้วย
- ร่าง Lead ใช้ FK ไปยัง projects/plots และร่างเต็มยังแก้ sales/customer_voices ดังนั้นห้ามนำร่างเต็มออก guard แล้วรันเป็นการเปิดเฉพาะหน้ารับ Lead

### 4. แอปใช้คำสั่งบัญชีเหล่านี้ร่วมกัน

`app/page.tsx` เรียก 4 RPC เดิมในการจัดการพนักงาน รวมการเพิ่ม/ลบ Foreman ซึ่งยังเป็นสองขั้นตอน (แก้ foremen ก่อน account RPC) การถอน EXECUTE หรือเปลี่ยน guard ทันทีอาจทำให้การจัดการพนักงานล้มเหลวหรือทำงานครึ่งเดียว

## สิ่งที่ยังไม่ได้ทำ

- ไม่รัน DDL, INSERT, UPDATE, DELETE, GRANT, REVOKE หรือ migration บน Supabase
- ไม่ติดตั้งร่าง ไม่ลบตัวป้องกัน DESIGN ONLY/ROLLBACK
- ไม่ผูกหรือเดาสิทธิ์ Sales/Admin จากชื่อหรือ metadata และไม่เปลี่ยนสิทธิ์ฝ่ายอื่น
- ไม่เปิด feature flags ไม่แก้ `.env.local` ไม่ Deploy ไม่เปิดแจ้งเตือน/Cron
- ไม่สร้าง branch หรือบริการที่มีค่าใช้จ่ายเพิ่ม
- ไม่ตรวจยืนยัน backup/recovery ล่าสุดหรือซ้อมการกู้คืน และไม่อ้างว่าผลทดสอบฐานจำลองเป็นผล Supabase Auth/API จริง

## ความคืบหน้าหลังอนุมัติการเตรียม

- ยืนยันชื่อล็อกอิน `Admin` ตรงตัว: พบ legacy ID 1 และคู่ Auth ตามวิธีจับคู่เดิมของแอปหนึ่งบัญชี ผลสถานะไม่ถูกลบ/แบน/anonymous ในเวลาที่ตรวจ **ยังไม่ใช่การรับรองสิทธิ์หรือทดสอบล็อกอิน/กู้คืนสำเร็จ**
- ยืนยันโครงสร้าง `foremen`: id, name, created_at พร้อม unique name; ไม่พบ FK หรือ trigger ที่ตารางนี้จาก catalog ที่ตรวจ ไม่อ่านรายชื่อโฟร์แมน
- เตรียม SQL ให้ล้าง grants รวม service/default/inherited grants เฉพาะวัตถุ account guard และรวมงาน Foreman กับบัญชีใน transaction เดียว
- เตรียมทางเรียกในหน้าแอปหลัง `NEXT_PUBLIC_ACCOUNT_GUARDED_COMMANDS_ENABLED` (ปิดตามค่าเริ่มต้น) ตรวจ contract ก่อนส่งคำสั่ง และไม่กลับไปเขียนสองขั้นตอนหากการตรวจล้มเหลว ยังไม่แก้ไฟล์ environment
- SQL drafts ยังมี guard และ ROLLBACK; มี account-guard migration candidate แยกที่มี COMMIT พร้อมจุดตรวจ operator แล้ว แต่ยังไม่ใช่อนุมัติให้ติดตั้ง และยังไม่เปิดฐาน Lead ดู [แผนชุดบัญชีร่วมและลำดับ GitHub/Vercel](./account-security-shared-command-preparation.md)

## ขั้นถัดไปก่อนเปลี่ยนฐานจริง

ขอบเขตที่ได้รับอนุมัติให้เตรียมคือ **ช่องทางจัดการบัญชีร่วมที่จำเป็น**: การสร้าง/ลบ/เปลี่ยนชื่อ/เปลี่ยน PIN และการเขียนตาราง users โดยตรง พร้อมตรวจความเข้ากันได้กับงานของฝ่ายอื่นและทางกู้คืน Admin ไม่ใช่อนุญาตให้เปลี่ยนสิทธิ์ทุกโมดูลโดยเหมารวม

ขั้นต่อไปตรวจหน้า login/งานพนักงานเดิม ตรวจ backup และทางกู้คืนโดย operator พร้อมรายการผู้มีสิทธิ์ จากนั้นแสดงชุด SQL/ผลกระทบ/ขั้นตอนหยุดและกู้คืนให้ตรวจ ก่อนรัน SQL ที่เปลี่ยนฐานจริง ระหว่างนี้คง Lead ใหม่ปิดไว้ ไม่อ้อมการตรวจสิทธิ์

อ้างอิงหลักการตรวจ grants ร่วมกับ RLS และการจำกัดสิทธิ์ function: [Supabase — Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
