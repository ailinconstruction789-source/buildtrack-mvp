# เชื่อมสิทธิ์แอปหลักกับ Lead ส่วนกลาง — ขั้น 3b (ร่างในเครื่อง)

วันที่ 25 กันยายน 2569 ต่อจาก [การรับรองบัญชี ขั้น 3a](./account-security-role-review.md)

ต่อเนื่อง: [ขั้น 3c ทดสอบสิทธิ์ร่วมกับจอง/หลังจอง/Visit/QR/แจ้งเตือน](./account-security-workflow-integration.md) เพิ่มชุด integration SQL06–26 ในฐานจำลองแล้ว ดูผลและขอบเขตล่าสุดที่เอกสารนั้น รายการข้างล่างเป็นผล ณ จบขั้น 3b

## สิ่งที่เปลี่ยนในร่าง

`sql/security/crm_role_alignment_draft.sql` ใช้ `reviewed_roles` เป็นแหล่งบทบาทหลัก ส่วน `crm_user_roles` เดิมเป็นข้อมูลสิทธิ์ที่สะท้อนจากรายการรับรอง เพื่อรักษาตัวอ่านเดิม, row type, การล็อกแถว และชื่อฝ่ายขายสำหรับประวัติ ไม่สร้าง Lead หรือคัดลอกข้อมูลลูกค้า

| บทบาทที่รับรองในแอปหลัก | สิทธิ์ CRM หลังผ่านการรับรองในชุดใหม่ |
|---|---|
| Admin ที่ enabled | admin; สิทธิ์จัดการบัญชียังต้องมี reviewed_admins แยกตามเดิม |
| Owner ที่ enabled | owner ตามข้อจำกัดอ่าน/เขียนเดิมของ CRM |
| Sales ที่ enabled | sales; กติกาเจ้าของ Lead และเห็นทุกโครงการไม่เปลี่ยน |
| ฝ่ายก่อสร้าง/จัดซื้อ/สโตร์ หรือ disabled | ไม่เปิดสิทธิ์ CRM; แถวชื่อเดิมยังอยู่แบบ inactive |

ขั้น 3a ยังคงหยุดเมื่อพบ CRM ที่ยังไม่เชื่อม โดยย้ายเงื่อนไขไป helper ส่วนตัว `assert_crm_review_ready` ขั้น 3b เปลี่ยน helper นี้หลังเตรียม trigger ครบแล้ว หาก trigger ที่จำเป็นหาย/ถูกปิด คำสั่งรับรองจะหยุด

ร่างขั้น 3b:

- เริ่มจากปิด is_active ของรายการ CRM เดิมทั้งหมดและเปลี่ยนค่าเริ่มต้นเป็น false **ไม่ยกป้ายสิทธิ์เก่าให้เป็นสิทธิ์ใหม่** ไม่ลบชื่อ/ID จาก directory ต้องรับรองสิทธิ์ CRM ผ่านคำสั่งขั้น 3a ใหม่หลังติดตั้งชุดที่ได้รับอนุมัติ
- เมื่อรับรอง เปลี่ยนบทบาท หรือปิดบัญชีผ่านคำสั่งหลัก จะปรับ CRM ใน transaction เดียวกัน พร้อมเลข `trusted_review_revision` ถ้าตรวจไม่ผ่าน/ถอน Admin คนสุดท้ายไม่สำเร็จ ทั้งบทบาทหลักและ CRM ย้อนกลับพร้อมกัน
- บัญชีฝ่ายขายใหม่ที่ไม่มีแถว CRM ใช้คู่รหัสที่รับรองและ username เป็นชื่อเริ่มต้น แต่ไม่เปลี่ยน alias ในแถวเดิม เช่น TAEW/PIEW
- ป้องกันเปิดสิทธิ์ CRM เกินบทบาทที่รับรอง/ใช้ revision เก่า/เปลี่ยน user_id และป้องกันลบหรือ truncate directory ผ่านคำสั่งปกติ ถอนสิทธิ์ client ทั้งตารางและคอลัมน์ รวม service_role
- `crm_v2_role()` คงชื่อและผลลัพธ์ admin/owner/sales/ว่าง แต่เป็น invoker façade เรียกแกน private ที่ตรวจ Auth/session, บัญชีถูกลบ/แบน/anonymous, บทบาทหลัก และ revision ของ CRM ไม่ใช้ user_metadata
- คำสั่งเขียนล็อกสิทธิ์หลักก่อนแถว CRM เพื่อประสานกับการถอนสิทธิ์ งานที่ได้รับอนุญาตแล้วอาจทำเสร็จก่อนถอนสิทธิ์ commit; คำขอหลัง commit ต้องถูกปฏิเสธ ไม่อ้างว่าย้อนยกเลิกงานที่เสร็จแล้ว
- โหมดอ่านอย่างเดียวตรวจเงื่อนไขสิทธิ์โดยไม่ล็อกแถว เพื่อให้ GET/HEAD และ STABLE RPC ใช้งานได้ การเปิด READ ONLY ไม่ช่วยข้ามสิทธิ์เขียน เพราะฐานข้อมูลไม่ให้เขียนใน transaction นั้น

ไม่มีการเปลี่ยน UI, PIN, environment, สวิตช์จริง, ข้อมูลลูกค้า, Supabase จริงหรือ Deploy ไฟล์ยังมี **DESIGN ONLY + ROLLBACK** ไม่ใช่ migration พร้อมใช้ ผู้ใช้ยังไม่ต้องรัน SQL

## หลักฐานที่ตรวจจริงในเครื่อง

ตัวทดสอบเดิมโหมด `--account-security-only` ต่อฐานบัญชีสมมติกับ schema/คำสั่งฝ่ายขายใน repository ได้แก่ base, SQL04 และ SQL05 โดยไม่ mock คำสั่งรับ Lead

- CRM เก่าที่อ้างว่าเป็น Admin ไม่เปิดสิทธิ์เอง และบัญชีไม่รับรองเปิดสิทธิ์ไม่ได้
- ใช้ `crm_v2_create_customer`, `crm_v2_central_snapshot`, `crm_v2_record_lead_work` จริงเพื่อสร้าง Lead พร้อมโครงการที่สนใจ/อ่านรายการ/บันทึกติดตามและงานถัดไป
- เปลี่ยน Sales เป็น Owner แล้วสร้าง Lead และ replay งานติดตามเดิมไม่ได้ แต่สิทธิ์อ่านตามบทบาทยังใช้ได้
- ปิดบัญชีแล้วทั้งตัวอ่านบทบาทหลักและ CRM ปฏิเสธ รวม direct RLS read ไม่มีแถวลูกค้า และ Admin สร้าง Lead ให้เจ้าของที่ inactive ไม่ได้
- เทียบ customer, interest, activity, next action, SLA และ audit ก่อน/หลังเปลี่ยนสิทธิ์เหมือนกันทุกค่า จึงไม่เปลี่ยนเจ้าของ Lead, วันเริ่ม Lead, หลักฐานติดตามหรือประวัติเดิมในชุดทดสอบนี้ ไม่ใช่การรับรองการคำนวณ KPI ทุกประเภท
- ตรวจ metadata ปลอม, session ต่างบัญชี/ผิดรูปแบบ/หาย, บัญชีถูกแบน, ACL ของ anon/authenticated/service_role, ถอนสิทธิ์พร้อมสร้าง Lead และ rollback เมื่อพยายามถอน Admin คนสุดท้าย
- จำลอง READ ONLY แบบ PostgREST สำหรับ capability/snapshot/direct RLS read และตรวจว่าใช้ READ ONLY ส่งคำสั่งเขียนไม่ได้

ผลล่าสุด:

- Vitest เฉพาะบัญชี/ล็อกอิน/ความปลอดภัยตัวทดสอบ **204/204 ผ่าน** จาก 12 ไฟล์
- Native PostgreSQL 17.11: ขั้นก่อนหน้า 200 assertions + CRM alignment 57 = **257 ผ่าน**
- รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-6fWmrj/report.json`: status=passed, stopped=true, productionChanged=false, sourceFilesUnchanged=true
- รอบแรกหยุดเพราะ fixture ไม่มีแถว crm_settings (ร่างตั้งใจไม่ seed) แก้เฉพาะ fixture ให้มีแถวตั้งค่าที่ใช้ค่าเริ่มต้นปิดก่อนตรวจ ไม่ผ่อนเงื่อนไขสิทธิ์ ฐานจำลองทุกครั้งปิดหลังทดสอบ
- ไม่เปลี่ยน TypeScript/UI ในรอบนี้ ไม่รัน production build/browser E2E และไม่ทดสอบ Supabase Auth/PostgREST จริง ผล native ไม่แทนผลเหล่านั้น

## ขอบเขตที่ยังไม่เสร็จและลำดับถัดไป

1. ทดสอบ integration **SQL06–26** ต่อจากฐานสิทธิ์ชุดนี้ โดยเฉพาะจอง/ยกเลิก/หลังจอง/QR/แจ้งเตือนและ system worker รวมคำสั่งพร้อมกันและการถอนสิทธิ์ระหว่างทำงาน รอบนี้ SQL05 compile แล้ว แต่ยังไม่ได้ทดสอบ lifecycle command ใหม่ครบทุกเส้นทาง
2. การแบน/ลบบัญชีหรือ session ใน Auth ถูกตรวจเมื่อเรียก role reader แล้ว แต่การเลือกเจ้าของงาน/งานเบื้องหลังที่อ่าน CRM directory ตรง ๆ ยังต้องตรวจทุก caller การแบนใน Auth ไม่ได้ยิง trigger เข้าชุด projection นี้ จึงไม่อ้างว่าการจัดการ Auth ภายนอกเท่ากับ workflow ปิดบัญชีที่รับรองแล้ว
3. SQL โดยตรงหรือ service งานอื่นที่แก้ private tables/ปิด trigger อาจข้ามการรับรองและ audit ได้ ห้ามให้ช่องเหล่านั้นแก่ client; ต้องตรวจ grants, owner, dependency, overload และ caller ในฐานที่จะติดตั้ง การตรวจชื่อ trigger อย่างเดียวไม่รับรองฐานที่ถูกแก้โดย DBA
4. legacy policies ของโครงการ/แปลง/ก่อสร้าง/Storage/Realtime และหน้า standalone ยังไม่ถูกแทนที่ทั้งหมด ดู matrix ในขั้น 3a
5. ก่อนติดตั้งจริงต้องปิดงานเขียน/งานตั้งเวลาที่เกี่ยวข้อง, ใช้ migration ที่ตรวจแยก, รับรองบัญชีครบและกู้คืนได้, ทดสอบ Supabase/เบราว์เซอร์ในระบบแยก แล้วค่อยขออนุมัติเปิด ไม่คืน permissive policy หรือป้ายสิทธิ์เก่าเป็นทาง rollback

ไม่มีรายชื่อบัญชีจริงหรือข้อมูลลูกค้าถูกอ่าน/ย้ายในรอบนี้ และยังไม่มีบัญชีจริงได้รับการรับรองจากร่างนี้

## แนวทางที่ใช้

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): user_metadata แก้ได้จากผู้ใช้และ JWT role อาจเก่า จึงอ่านรายการรับรองในฐานข้อมูล
- [PostgREST Transactions](https://postgrest.org/en/latest/references/transactions.html): GET/HEAD และ POST ของ STABLE RPC ใช้ transaction อ่านอย่างเดียว จึงแยกการตรวจแบบอ่านจากการล็อกสิทธิ์ระหว่างคำสั่งเขียน
