# Admin รับรองคืนสิทธิ์ Sales เดิม

วันที่ 25 กันยายน 2569 — ต่อจาก [หน้าตรวจสิทธิ์แบบอ่านอย่างเดียว](./account-security-access-reader.md)

ขั้นเตรียมต่อเนื่อง: [ตรวจจุดขัดแย้ง ลำดับติดตั้ง รายงาน catalog แบบอ่านอย่างเดียว และแผนกู้คืน](./account-security-cutover-preparation.md) พร้อม [กรณีทดสอบ Supabase จริงที่ยังไม่ได้รัน](./account-security-supabase-acceptance.md)

## ทดลองได้แล้วในเครื่อง

เปิด `http://localhost:3000/dev/account-access/directory` ขณะ `npm run dev` ทำงาน เลือก **Sales ตัวอย่าง B → ตรวจและรับรองคืนสิทธิ์ → ใส่เหตุผล → ยืนยันการตรวจ → รับรอง**

ใช้แบบฟอร์มเดียวกับหน้าที่เตรียมให้ Admin แต่ข้อมูลทั้งหมดเป็นสมมติและเก็บในหน่วยความจำ ไม่เรียก Supabase/API ไม่แก้บัญชีจริง รีเฟรชแล้วเริ่มใหม่ บัญชี B เปลี่ยนเป็นเปิดใช้งานรุ่น 2 และยังเห็นหลักฐานพักสิทธิ์รุ่น 1 ส่วนบัญชีที่ถูกแบน/ปิดสิทธิ์/ข้อมูลไม่สอดคล้องไม่มีปุ่มรับรอง

## ขอบเขตส่วนจริงที่เตรียมในโค้ด (ยังปิดอยู่)

- หน้า `/admin/account-access` เพิ่มแบบรับรองแบบเลือกบัญชีจากรายการเท่านั้น ไม่เพิ่มหน้าสร้างบทบาทหรือปลดแบน
- GET `/api/admin/account-access` เดิมยังอ่านอย่างเดียว คำสั่งแยกเป็น POST `/api/admin/account-access/restore`
- ต้องมีสวิตช์เดิมสองตัว และ **`ACCOUNT_ACCESS_RESTORE_ENABLED=true` เพิ่มอีกตัว** จึงเปิดคำสั่ง ค่าเริ่มต้นปิด เอกสารนี้ไม่ใช่คำสั่งให้เปิดสวิตช์ และรอบนี้ไม่ได้แก้ `.env.local` หรือค่า Deploy
- `sql/security/account_access_restore_draft.sql` เป็น **ร่าง DESIGN ONLY + ROLLBACK ไม่ใช่ migration พร้อมรัน** ไม่ต้องนำไปรันใน Supabase
- ไม่เปลี่ยนข้อมูล Auth, บทบาท, คู่บัญชี, PIN, เจ้าของ Lead, KPI หรือประวัติลูกค้า เป็นการรับรองใหม่ของ Sales เดิมที่ enabled อยู่เท่านั้น

## การตรวจและหลักฐาน

1. Server ตรวจผู้ใช้จาก Auth ด้วย bearer ของผู้เรียก ใช้เฉพาะ publishable/anon key ไม่ใช้ service role ไม่รับสิทธิ์จาก metadata/cookie หรือป้ายสถานะบนหน้าจอ
2. คำสั่งฐานข้อมูลตรวจ Admin และสิทธิ์จัดการบัญชีซ้ำ พร้อม canonical role, Auth flags และ session ที่ยังใช้ได้ การตรวจจาก GET หรือ RPC ก่อนหน้าไม่แทนการตรวจใน transaction คำสั่ง
3. เป้าหมายต้องเป็น Sales ที่เคยรับรองแล้ว canonical enabled, Auth กลับมาใช้ได้, ชื่อและรุ่นตรงกับที่เลือก, CRM role/revision ตรงกันแต่ inactive และมีหลักฐานพักสิทธิ์ของรุ่นนี้เท่านั้น
4. ต้องมีเหตุผล/ข้อมูลอ้างอิง 8–500 ตัวอักษรและยืนยันว่าตรวจตัวตน/ความพร้อมแล้ว ไม่มีการพิสูจน์ตัวบุคคลจากชื่อเพียงอย่างเดียว ฝั่งฐานใช้คู่ ID เดิม ไม่เปลี่ยน binding
5. ใช้ operator primitive เดิมด้วยพารามิเตอร์บทบาท Sales ที่ตรึงไว้ เพิ่ม revision, อัปเดต CRM, บันทึกผู้รับรองจาก Auth ID จริง และออก receipt ใน transaction เดียว ล้มเหลวส่วนใดต้องย้อนกลับทั้งหมด
6. เรียง lock เป็น global role-review lock → actor → target canonical → Auth → CRM ป้องกันการเรียงกลับกับ Auth suspension trigger และ operator review

Receipt เป็นหลักฐานการรับรอง **ในอดีต ไม่ใช่สถานะสิทธิ์ปัจจุบัน** หน้าจอโหลดรายการใหม่หลังบันทึก หากถูกแบนซ้ำหลังรับรอง ต้องยังพักสิทธิ์แม้ส่งคำขอเก่าซ้ำ

ตาราง receipt เป็น private + RLS + ไม่มีสิทธิ์อ่าน/เขียนตรงจาก client และ append-only ไม่มีอีเมล/รหัสผ่าน/token เก็บเฉพาะคำขอที่จำเป็นกับหลักฐานการรับรอง ข้อความเหตุผลต้องไม่ใส่ข้อมูลส่วนตัวลูกค้าหรือความลับ

## กดซ้ำ / เน็ตหลุด / เปลี่ยนบัญชี

- สร้าง UUID หนึ่งค่าต่อคำขอและตรึง payload หลังส่ง ปิดการแก้ช่องข้อมูลและป้องกันกดซ้ำระหว่างรอ
- ถ้าไม่ทราบผลหลังส่ง ไม่แจ้งว่าสำเร็จหรือยกเลิก และไม่ retry อัตโนมัติ ให้กดส่ง **คำขอเดิม** ซ้ำ ฐานส่ง receipt เดิมให้เมื่อ actor/payload ตรง ไม่รับรองเพิ่ม
- ถ้าข้อมูลเปลี่ยนหรือไม่มีสิทธิ์ ต้องปิดแบบและตรวจรายการใหม่ ไม่เปลี่ยนเลขคำขอเงียบ ๆ
- ไม่เก็บ payload/เหตุผล/token ใน browser storage การโหลดรายการตามเวลา/กลับมาที่หน้าต่างไม่ล้างคำขอค้าง แต่ logout/เปลี่ยนเซสชันปิดแบบและซ่อนข้อมูลเดิม ผลช้าที่ตามมาไม่กลับมาแสดง
- ถ้าปิดหรือรีเฟรชหน้าระหว่างผลไม่แน่นอน คำขอในหน่วยความจำจะหาย ต้องตรวจสถานะ/ประวัติรับรองก่อนทำใหม่ ยังไม่มีหน้าค้น receipt ย้อนหลังจากเลขคำขอสำหรับผู้ดูแล

## ผลตรวจในเครื่อง

- Vitest ชุดที่เกี่ยวข้อง **202/202 ผ่าน จาก 17 ไฟล์** รวม regression ล็อกอิน/เซสชัน/หน้ารายการ/ตัวอย่าง ไม่ใช่ทุก test ของ repository
- Native PostgreSQL 17.11: เพิ่ม **52 assertions รวม 510 ผ่าน** รวม authorization, stale revision/ชื่อ, Auth unavailable, malformed input, prerequisite guard, rollback เมื่อ receipt ล้มเหลว, replay/กดพร้อมกัน, receipt append-only และรักษาข้อมูลธุรกิจ/Auth/หลักฐานเดิม
- ทดสอบ backend ที่รอ lock จริง 4 คู่: คำขอเดียวกันพร้อมกัน, รับรองก่อนแบน, แบนก่อนรับรอง และถอนสิทธิ์ Admin ก่อนคำสั่งรับรอง
- รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-Dr7eyl/report.json`: `status=passed`, `stopped=true`, `productionChanged=false`, `sourceFilesUnchanged=true`
- TypeScript เฉพาะ dependency ของส่วนใหม่ 0 diagnostics และ ESLint ของไฟล์ TypeScript ที่เพิ่ม/แก้ซึ่งตรวจผ่าน
- Browser smoke ใช้หน้า **ข้อมูลสมมติเท่านั้น** บน dev server ที่ผู้ใช้เปิดไว้: desktop 1440×1000 และ mobile 390×844 รับรอง B, คงประวัติพักสิทธิ์, กรองสถานะ, รีเฟรชเริ่มใหม่ ไม่มีแนวนอนล้น, API/external request/page error เป็น 0 ตรวจภาพแล้ว
- ปิดเฉพาะ browser/ฐานจำลองที่การทดสอบสร้าง ไม่หยุดหรือ restart dev server ของผู้ใช้ ไม่มี production build, deployment, live SQL, migration หรือการเปิด flag/Cron

ทดสอบ browser ด้วย `node scripts/sales-ui-test/account-access-restore.check.mjs` หลังเปิด dev server ที่ `localhost:3000` ตัวทดสอบปิดกั้น API/ปลายทางภายนอกและไม่ใช้สถานะล็อกอินของผู้ใช้ ต้องใช้ hostname เดียวกับ dev server ไม่ใช่เปลี่ยนเป็น IP แล้วถือว่าหน้าจอเสียจาก HMR ที่เชื่อมไม่สำเร็จ

## ก่อนเปิดใช้งานจริง

ยังต้องตรวจและทดสอบ **Supabase Auth/PostgREST จริงในระบบแยกที่ได้รับอนุญาต**, เทียบ catalog/grants/trigger ownership, ตรวจตัวตนและการกู้คืน Admin, เตรียม migration/cutover ที่ได้รับอนุมัติ รวมสิทธิ์ legacy และทดสอบ rollback ก่อนเปิด flags ไม่มีข้อใดถือว่าผ่านจาก PostgreSQL จำลองหรือ UI ตัวอย่าง

อ้างอิงแนวทางที่ตรวจ: [Supabase Database Functions](https://supabase.com/docs/guides/database/functions), [Auth Sessions](https://supabase.com/docs/guides/auth/sessions), [Postgres lock ordering](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS)
