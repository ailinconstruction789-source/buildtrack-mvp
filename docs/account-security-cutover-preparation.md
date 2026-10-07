# เตรียมติดตั้งและทดสอบระบบสิทธิ์บัญชี

วันที่ 25 กันยายน 2569 — เอกสารรอบเตรียมเดิม; ความคืบหน้าหลังได้รับอนุมัติและการตรวจฐานจริงแบบอ่านอย่างเดียวดู [ชุดบัญชีร่วม](./account-security-shared-command-preparation.md) ยังไม่มีการเปลี่ยนข้อมูลบน Supabase เปิดสวิตช์ หรือ Deploy

**สถานะ: เตรียมการ ไม่ใช่อนุมัติเปิดใช้งาน** หน้าทดลองและฐาน PostgreSQL จำลองผ่านแล้ว แต่ยังไม่ใช่ผล Supabase Auth/PostgREST จริง ร่างทุกไฟล์ยังคง `DESIGN ONLY` และ `ROLLBACK` ไม่ให้ลบ guard แล้วนำไปรันทีละไฟล์เอง

## สิ่งที่จัดเตรียม

1. [SQL รายงานโครงสร้างแบบอ่านอย่างเดียว](../sql/security/account_security_preflight_read_only.sql) ตรวจเฉพาะ catalog ไม่อ่านแถวบัญชี/ลูกค้า ไม่เรียกฟังก์ชันของแอป และไม่ติดตั้งอะไร
2. ชุดทดสอบรายงานในเครื่อง `scripts/sales-runtime/account-preflight.mjs` ครอบคลุมฐานว่าง ระบบเดิม และระบบที่ติดตั้งร่างครบในฐานจำลอง รวมตรวจ grant รายคอลัมน์, function overload, policy ที่อ้าง metadata และ RLS ที่ถูกปิด
3. ลำดับติดตั้ง จุดหยุดตรวจ แผนหยุดใช้งาน/กู้คืน และ [ชุดทดสอบยอมรับ Supabase จริง](./account-security-supabase-acceptance.md) ที่ยังไม่ได้รัน

รายงาน SQL ต้องรันเฉพาะเป้าหมายที่ได้รับอนุญาตในภายหลัง รอบนี้ทดสอบรายงานเฉพาะฐานจำลอง ไม่ถือว่าไฟล์รายงานเป็นการอนุญาตให้เชื่อมฐานใด ๆ

## จุดซ้ำหรือขัดแย้งที่พบจากไฟล์ปัจจุบัน

| จุด | หลักฐานใน repository | ผลต่อการติดตั้ง |
|---|---|---|
| คำสั่งบัญชีชื่อเดิม | `sync_auth_users.sql`, `fix_auth_users.sql`, `change_username.sql` นิยาม `admin_*` แบบ SECURITY DEFINER; guard ย้ายตัวเดิมเข้าภายในแล้วสร้าง public facade ชื่อเดิม | ใช้ชื่อเดิมเพื่อรองรับ UI แต่ห้ามรันไฟล์เก่าทับภายหลัง เพราะอาจแทนที่ตัวตรวจสิทธิ์; ตรวจ signature, owner, body และ callers ที่ผูกกับ OID ก่อนย้าย |
| คำสั่งออนไลน์ชื่อเดิม | `add_last_seen_at.sql` เขียนตาม username ที่ผู้เรียกส่ง; `trusted_actor_draft.sql` เปลี่ยนให้ผูกผู้เรียกจริง | ห้ามนำไฟล์เก่ามารันซ้ำหลัง cutover; ตรวจ login/refresh/self-presence ร่วมกัน |
| อ่านรายชื่อก่อนล็อกอิน | `login_directory_draft.sql` ถอน SELECT ทั้งตารางจาก anon เหลือ username; `lib/auth/loginDirectory.ts` อ่าน username เท่านั้นแล้ว | ต้องส่งหน้า name-only ให้ครบก่อนลด grant; เวอร์ชันเก่าที่อ่าน `*` หรือเรียง role จะใช้ไม่ได้ ห้ามแก้ด้วยการคืนสิทธิ์กว้าง |
| บทบาทสองแหล่ง | `reviewed_roles` กับ `sales_private.crm_user_roles`; alignment มี `UPDATE ... SET is_active=false` ทุกแถวเดิมก่อนการรับรองใหม่ | เป็นการพักสิทธิ์จริง ไม่ใช่อัปเดตข้อมูลเฉย ๆ ต้องหยุดงานเขียนชั่วคราว เตรียมรายการรับรองและ Admin กู้คืนให้ครบก่อน ไม่ย้ายเจ้าของ Lead/เครดิต KPI |
| ร่างไม่รองรับรันซ้ำ | guard สร้าง private schema; alignment เพิ่มคอลัมน์/trigger; reader/restore ปฏิเสธชื่อที่มีอยู่แล้ว | ถ้าพบวัตถุเดิมต้องทำแผนอัปเกรดตามของจริง ไม่สร้างซ้ำ ไม่ DROP CASCADE ไม่ถือว่ามีชื่อเดียวกันแล้วเท่ากับติดตั้งถูก |
| Default grants ต่างจาก fixture | ร่างล่าสุดล้าง ACL ที่ติดมากับวัตถุ guard รวม service_role และ custom group; fixture เพิ่ม default grants และ role inheritance ตั้งแต่เริ่ม | ยังต้องตรวจ default privileges จริง ไม่ถือว่าผล native พิสูจน์ ACL ของโปรเจกต์; ไม่แก้ default privileges ทั้งฐาน |
| Auth trigger ใหม่กับ trigger เดิม | `crm_auth_revocation_draft.sql` เพิ่ม AFTER UPDATE บน `auth.users` และพัก CRM | ต้องตรวจ trigger/owner จริงและทดสอบ Auth API รวม refresh/ban/unban; PostgreSQL fixture ไม่รับรองการทำงานร่วมกับ Auth service |
| งานบัญชีที่ยังไม่เป็นรายการเดียวกัน | เตรียม atomic Foreman helper และทางเรียกหลัง guarded-commands flag แล้ว; flag ยังปิด client เดิมยังใช้สองขั้นตอน | ต้องส่ง UI/SQL พร้อมกันและพัก client เก่าระหว่าง cutover ทดสอบ Auth จริงต่อ ไม่ให้ canonical role จากป้ายเดิมอัตโนมัติ |
| สิทธิ์ส่วนอื่นของแอป | ดู matrix ใน `account-security-role-review.md`: legacy CRM writers, ก่อสร้าง, Storage/Realtime และ policy หลายฉบับ | สวิตช์ trusted session ไม่แทนการปิดช่องทางเก่า ต้องตรวจของที่ติดตั้งจริงตามขอบเขต release; ไม่สรุปว่าทั้งแอปปลอดภัยจากชุด account tests |

ยังไม่ยืนยันว่าของในฐานจริงตรงกับไฟล์ใด รายงาน catalog และการตรวจ SQL ของเป้าหมายที่อนุมัติเท่านั้นจึงใช้ตัดสินขั้นถัดไปได้

## ใช้รายงาน preflight อย่างไร

รายงานมีสถานะ `deploymentApproval=NOT_GRANTED` เสมอ ไม่สร้างไฟเขียวอัตโนมัติ

- ตรวจตาราง/คอลัมน์ที่หายไป ชนิดข้อมูลจริง, schema ที่ client สร้างวัตถุได้, table/column privileges และ default grants
- ตรวจ signature/overload/owner/invoker–definer/search_path ของฟังก์ชัน, policy/trigger/constraint และ hash สำหรับเทียบ snapshot
- ไม่คืน source ของฟังก์ชันหรือ expression ของ policy ไม่คืนอีเมล/ชื่อบุคคล/รหัสผ่าน/token; ยังเป็นรายงานภายในเพราะมีชื่อวัตถุและรายละเอียดสิทธิ์
- `metadataAuthorizationHint`, `authWriteHint` และ literal-true เป็นเพียงสัญญาณให้ตรวจ ไม่ใช่ SQL parser หรือข้อสรุปสิทธิ์จริง โดยเฉพาะ permissive policy ที่มี restrictive policy ประกบอยู่
- คอลัมน์ของ Auth ที่ปรากฏเป็นเพียง **ชื่อคอลัมน์** ไม่มีค่าภายในรายงาน
- hash ตรงไม่ได้ยืนยัน ownership, grants, function dependencies ใน dynamic SQL หรือความพร้อมใช้งาน ต้องอ่านทุกส่วนประกอบและตรวจนอก catalog เพิ่ม
- การ expose schema ใน Data API รายงานเป็น `UNKNOWN` ต้องตรวจ Dashboard/PostgREST แยก ห้าม expose `account_security_private` หรือ `sales_private` เพียงเพื่อให้ RPC ผ่าน
- ถ้าพบ private schema อยู่แล้ว ผลจะเป็น `existing_namespace_manual_upgrade_review_required` ไม่ให้ติดตั้งชุดเริ่มต้นซ้ำ

SQL ใช้ `BEGIN READ ONLY`, จำกัดเวลาคำสั่ง 15 วินาที/รอ lock 2 วินาที และจบด้วย `ROLLBACK` ถ้าคำสั่งถูกยกเลิกในเครื่องมือที่คง transaction ไว้ ให้ผู้ดำเนินการจบ transaction ก่อนทำงานอื่น ไม่เพิ่มสิทธิ์หรือปรับ timeout อัตโนมัติเพื่อฝืนให้ผ่าน

## ลำดับติดตั้งที่เสนอ — ต้องอนุมัติและซ้อมก่อน

เป็นแผน dependency ไม่ใช่รายการ SQL พร้อมรัน ต้องสร้าง migration จริงจากสภาพฐานที่ตรวจแล้วด้วย Supabase CLI ตามขั้นตอนที่ทบทวน ไม่ประดิษฐ์ migration timestamp หรือรวมไฟล์ร่างแบบข้าม guard

| ลำดับ | เตรียม/ติดตั้ง | จุดหยุดตรวจ |
|---|---|---|
| 0 | ยืนยันโปรเจกต์ทดสอบแยก, ผู้รับผิดชอบ, บัญชีทดสอบ และหลักฐาน backup/recovery | ฐานใช้งานจริงที่มีข้อมูลทดสอบปนอยู่ยังไม่ใช่ระบบแยก; ไม่สร้าง/คิดค่าบริการโปรเจกต์ให้โดยอัตโนมัติ |
| 1 | เก็บ catalog ก่อนเปลี่ยนและตรวจ schema/grants/owners/callers จริง | ชื่อซ้ำ/overload/เจ้าของต่าง/คอลัมน์ไม่ตรงต้องหยุดจัดแผนอัปเกรด |
| 2 | เตรียมหน้า login แบบชื่ออย่างเดียว พร้อมโค้ดใหม่ที่สวิตช์ยังปิด; ประกาศช่วงหยุดเขียนงานที่กระทบ | ต้องตรวจ client เก่าด้วย ไม่เปิดโหมด trusted ในขณะที่ registry ยังว่าง |
| 3 | account guard → login directory → trusted actor → operator role review | ปิดช่องเขียน users ตรง, ไม่ seed Admin จาก metadata, ไม่มีช่วงเปิดคำสั่งให้ PUBLIC |
| 4 | ตรวจ CRM foundation ที่มีอยู่ → CRM role alignment → Auth revocation | ต้องมีฐาน Sales V2 ที่สอดคล้องก่อน ไม่รัน Sales drafts ทั้งชุดซ้ำเพื่อให้ dependency ครบ; alignment พักสิทธิ์เดิม |
| 5 | Operator รับรองคู่บัญชี Admin หลัก/สำรองที่ตรวจตัวตนแล้วและซ้อมกู้คืน จากนั้นรับรองรายชื่อที่อนุมัติ | primitive ใช้ได้หลัง CRM guards ครบเท่านั้น; ไม่รับรองจำนวนมากด้วยการเดาชื่อหรือคัดลอก role |
| 6 | ติดตั้ง account reader → Sales restore, ตรวจ ACL/trigger และ advisors | public facade เป็น invoker, private schema ไม่ expose, service key ไม่อยู่ใน browser |
| 7 | เปิดสวิตช์เฉพาะระบบทดสอบที่อนุมัติ แล้วรันชุดยอมรับ Auth/API/UI จริง | ผ่านทุกกรณีบังคับและไม่มีข้อบกพร่องด้านสิทธิ์/ข้อมูล; ไม่มีการเปิดแจ้งเตือน/Cron พ่วง |
| 8 | ตรวจ legacy/all-module authorization ตามขอบเขต release, ซ้อมกู้คืน, ขออนุมัติ production แยก | หลังอนุมัติจึงนัด cutover จริงและตรวจซ้ำ ไม่ถือว่า approval ของระบบทดสอบครอบคลุม production |

`role_review` พึ่ง `assert_crm_review_ready()` ถ้ามี CRM อยู่แล้ว จึงห้ามเรียกขั้นรับรองก่อน alignment/revocation ที่จำเป็นครบ ในช่วงติดตั้งต้องรักษาทางกู้คืนของ SQL operator ไว้ ไม่พึ่ง Admin ใน browser เพียงทางเดียว

## แผนหยุดใช้งานและกู้คืน

| เหตุการณ์ | แนวทางที่ต้องซ้อม |
|---|---|
| SQL ล้มเหลวก่อน commit | rollback transaction ที่ล้มเหลว ตรวจ catalog/hash/สิทธิ์กลับจุดเดิมก่อน retry; อย่าอนุมานว่าไฟล์ก่อนหน้าที่ commit ไปแล้วถูกย้อนกลับด้วย |
| เปิด UI แล้ว reader/restore ผิดพลาด | ปิดสวิตช์ reader/restore และหยุดรับคำสั่งใหม่ ตรวจคำขอค้างจาก receipt/audit; ปิด UI อย่างเดียวไม่บล็อก direct RPC ต้องมีคำสั่ง containment ที่อนุมัติและทดสอบ ACL ทั้ง public/private facade |
| Auth trigger ทำให้ Auth API ล้มเหลว | หยุดงานเขียน CRM/คำสั่งที่เกี่ยวข้องตามแผน approved ก่อนแก้ ไม่ถอด trigger แล้วปล่อย CRM เดิม active; ใช้ operator/recovery path ที่ซ้อมแล้ว |
| Admin ใช้ไม่ได้ | ใช้ Admin สำรองหรือ operator ที่ตรวจตัวตนแล้ว รับรองด้วยหลักฐานใหม่ ไม่ปลอม metadata/แก้ role ใน browser/ให้ service key กับ client |
| ต้องย้อนรุ่นหลังมีการรับรองสำเร็จ | รักษา ledger, receipts, canonical revisions และข้อมูลธุรกิจไว้ แก้ไปข้างหน้าหรือปิดเฉพาะความสามารถที่เสีย ห้ามลด revision, ลบ audit, DROP CASCADE หรือกู้ฐานทั้งก้อนทับธุรกรรมใหม่โดยไม่อนุมัติแผนข้อมูล |

ห้ามกู้คืนด้วยการเปิด `PUBLIC EXECUTE`, ให้ client เขียนตารางบัญชีโดยตรง, คืน policy กว้าง หรือสลับกลับไปเชื่อ metadata หลัง cutover เพียงเพื่อให้หน้าจอกลับมาใช้ได้ นี่เป็น **แผนหยุดใช้งานอย่างปลอดภัย** ไม่ใช่ไฟล์ rollback ที่พร้อมรันกับฐานที่ยังไม่ได้ตรวจ

การเรียก Auth API และการ Deploy เป็นคนละ transaction กับ SQL การแบน/ปลดแบนที่ทำผ่าน Auth API ไม่ถูกย้อนกลับด้วย SQL `ROLLBACK` ต้องบันทึกทุกการเปลี่ยนและคืนเฉพาะบัญชีทดสอบที่อนุมัติ

## ข้อที่ยังต้องยืนยัน

- ชื่อ/รหัสโปรเจกต์หรือ branch สำหรับทดสอบแยก ไม่ต้องส่งรหัสผ่านหรือคีย์ลับในแชต
- ผู้ตรวจตัวตน Admin หลัก/สำรอง และขอบเขตบัญชีสมมติที่อนุญาตให้สร้าง/แบน/รับรองระหว่างทดสอบ
- ผล catalog และนโยบายจริง, การส่ง UI/SQL atomic Foreman ให้ตรงรุ่น, งาน provisioning, สิทธิ์ legacy/all-module และ recovery drill ก่อนเปิดจริง

## ผลตรวจรอบเตรียมนี้

- Vitest **73/73 ผ่าน จาก 10 ไฟล์** เฉพาะชุด SQL/runtime safety ของบัญชี รวมตัวตรวจรายงานใหม่ ไม่ใช่การรัน UI/Auth ทั้งแอปซ้ำ
- Native PostgreSQL 17.11 เพิ่ม **27 assertions รวม 537 ผ่าน**: ฐานว่าง 5, ระบบเดิม 8, ระบบที่เตรียมครบและการตรวจความผิดปกติ 14
- รายงานสุดท้าย `node_modules/.cache/buildtrack-sales-runtime/runs/run-2Y0qvR/report.json`: `status=passed`, `stopped=true`, `productionChanged=false`, `sourceFilesUnchanged=true`; ฐานจำลองรอบก่อนหน้าปิดแล้วเช่นกัน
- ตัวรายงานอ่าน catalog ภายใน READ ONLY จริง ทดสอบเมื่อ schema/role ยังไม่มี, ตรวจ grant รายคอลัมน์, overload, metadata policy และ RLS ที่ปิด แล้วคืน catalog fixture ทุกอย่างให้เหมือนก่อนทดสอบ
- ESLint ของ runtime helper/test/ตัวเชื่อมที่เปลี่ยน และการตรวจไวยากรณ์ JavaScript ผ่าน ไม่มีการแก้หน้าแอป จึงไม่ได้รัน browser/production build ซ้ำในรอบนี้
- เตรียมกรณียอมรับ Supabase จริง 26 กรณี แต่ **ทั้งหมดในเอกสารยอมรับยังเป็น NOT_RUN** ผล local ไม่เปลี่ยนสถานะนั้น
- ไม่อ่าน `.env.local`, ไม่ขอคีย์ลับ, ไม่รัน SQL/เปลี่ยนสิทธิ์/อ่านข้อมูลลูกค้าบน Supabase และไม่เปลี่ยน draft guards/feature flags/การตั้งค่า Deploy

แนวทางที่ใช้: [Supabase API grants/RLS](https://supabase.com/docs/guides/api/securing-your-api), [Database functions](https://supabase.com/docs/guides/database/functions), [Sessions](https://supabase.com/docs/guides/auth/sessions) — จำกัดสิทธิ์ทั้ง API และฐานข้อมูล ไม่ใช้ผลหน้าจอแทนการพิสูจน์สิทธิ์
