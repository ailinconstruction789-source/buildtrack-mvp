# ชุดทดสอบยอมรับ Supabase Auth / API จริง

วันที่ 25 กันยายน 2569 — **เตรียมกรณีทดสอบเท่านั้น ยังไม่ได้รัน** ใช้หลังอนุมัติเป้าหมายตาม [แผนติดตั้ง](./account-security-cutover-preparation.md)

## ขอบเขตและเงื่อนไขก่อนเริ่ม

- ระบุ project ref/URL ของระบบทดสอบแยกอย่างชัดเจน ผู้ดำเนินการต้องตรวจว่าไม่ใช่ฐานใช้งานจริงหรือแอปที่มีข้อมูลจริง ห้ามหยิบค่าจาก `.env.local` หรือเปลี่ยนเป้าหมายอัตโนมัติ
- ถ้ายังไม่ยืนยันเป้าหมายหรือไม่มีสิทธิ์ ให้จบที่ `NOT_RUN` ไม่สร้างบัญชี ไม่ติดตั้ง schema ไม่แบน/ลบใคร
- ใช้ Auth service จริงสำหรับ login/refresh/logout/ban/unban ไม่ปลอม `request.jwt.claims` ใน SQL แล้วนับว่าผ่าน Auth และไม่ INSERT/UPDATE ตาราง Auth เพื่อเลียนแบบการเรียก service
- บัญชี fixture: Admin A หลัก, Admin B สำรอง, Admin C สำหรับทดสอบถอนสิทธิ์, Sales S1/S2, Owner O และบัญชีที่ยังไม่รับรอง U; ทุกบัญชีเป็นสมมติที่อนุมัติ ไม่มีชื่อพนักงานจริง
- Operator รับรองคู่ Auth UUID ↔ legacy ID ผ่านขั้นตอนที่ตรวจแล้ว ห้าม bootstrap ด้วย `user_metadata` หรือชื่อเหมือนกัน บัญชีใหม่ไม่ควรได้สิทธิ์ CRM อัตโนมัติ
- บัญชี Admin หลัก/สำรองต้องกู้คืนและล็อกอินได้ก่อนทดสอบ C ห้ามทดลองแบน Admin คนสุดท้าย
- คีย์สำหรับ Auth administration ใช้เฉพาะช่องทางทดสอบที่อนุมัติและไม่ส่งเข้า browser/รายงาน/Git; คำสั่งของแอปต้องใช้ bearer ของแต่ละผู้ทดสอบ ไม่ใช้ service key เพื่อทำให้กรณีที่ควรถูกปฏิเสธผ่าน
- ปิด notification dispatcher/Cron/บริการภายนอกทุกชนิดที่ไม่อยู่ในกรณีทดสอบ ใช้ customer/Lead/Visit/QR สมมติทั้งหมด

## ช่องทางที่ต้องตรวจ

ต้องแยกผลอย่างน้อย 3 ช่องทาง: หน้าแอป, Next API `/api/admin/account-access` กับ `/restore`, และ Supabase REST RPC โดยตรง `/rest/v1/rpc/...` เพื่อพิสูจน์ว่าเลี่ยงหน้าจอ/API แล้วก็ไม่ได้สิทธิ์เกิน

| ID | ผู้ทดสอบ / เหตุการณ์ | ผลที่ต้องได้ / หลักฐาน |
|---|---|---|
| ENV-01 | เป้าหมายยังไม่ได้ยืนยัน / URL ไม่ตรงรายการอนุมัติ | หยุดก่อนคำขอเปลี่ยนข้อมูลใด ๆ; ไม่ fallback ไปโปรเจกต์อื่น |
| ENV-02 | ตรวจ catalog/grants ก่อนติดตั้งและหลังติดตั้ง | signatures/owners/ACL/trigger ตรงชุดที่รับรอง ไม่มี overload ที่ไม่รู้จัก; private schemas ไม่ expose; ตรวจ default/inherited grants และ service_role ของ legacy functions ที่ย้าย schema โดยเฉพาะ; เก็บ hash และข้อยกเว้นที่อนุมัติ |
| DIR-01 | ยังไม่ล็อกอิน เปิด dropdown | เลือกชื่อได้ อ่าน `username` เท่านั้น; ขอ role/last_seen_at/`*` ผ่าน REST ต้องไม่ได้ข้อมูล |
| AUTH-01 | A, S1, O, U ล็อกอินจริงและ refresh หน้า | ได้ role ที่รับรองเท่านั้น; U ไม่ได้รับสิทธิ์จาก label หรือ metadata; ผลบันทึกแยกตามบัญชี |
| AUTH-02 | S1 แก้ user metadata ของตัวเองเป็น Admin | ยังเป็น Sales และใช้คำสั่ง Admin ไม่ได้ทั้ง Next API และ direct RPC; ไม่ใช่ทดสอบด้วย JWT ที่แต่งเอง |
| AUTH-03 | logout แล้วใช้ access token เดิมเรียกคำสั่งอ่อนไหว | คำสั่งถูกปฏิเสธแม้ token ยังไม่หมดอายุ; ไม่บันทึก receipt/audit ใหม่; sign-out อย่างเดียวไม่พักเจ้าของ Lead/QR/งานติดตาม |
| AUTH-04 | session ถูกเพิกถอน/หมดอายุ แล้วลอง token เดิม | ปฏิเสธทุก sensitive entry ที่อยู่ในขอบเขต; ทดสอบ expiry ตามการตั้งค่าที่ระบบแยกรองรับ ไม่เปลี่ยนเวลาของ production |
| READ-01 | A อ่านผ่านหน้า, Next API และ reader RPC GET/POST | รายการ/ตัวกรอง/จำนวนตรงกัน ไม่มีอีเมล PIN password token หรือข้อความอ้างอิงส่วนตัว; reader ใช้ read-only ได้ |
| READ-02 | anon, S1, O และ Admin C ที่ไม่มี canManageAccounts ขอรายการ | ปฏิเสธโดยไม่คืนข้อมูลบัญชี; metadata อ้าง Admin ไม่ช่วย |
| READ-03 | สลับบัญชี/logout ระหว่างโหลด | ล้างรายการทันที ผลตอบกลับเก่าต้องไม่กลับมาแสดงให้อีกบัญชี |
| BAN-01 | Auth admin แบน S1 ขณะ Sales ใช้งาน | Auth operation สำเร็จโดยไม่ถูก trigger ขวาง; CRM หยุดสิทธิ์, งาน/QR ตามนโยบายพัก, ประวัติและเจ้าของ Lead เดิมคงอยู่ |
| BAN-02 | ปลดแบนหรือรอครบเวลาแบนของ S1 | ล็อกอินตามเงื่อนไข Auth ได้ แต่ CRM ยังรอ Admin รับรอง ไม่คืนสิทธิ์อัตโนมัติ |
| RESTORE-01 | A เลือก S1 ที่พร้อม กรอกเหตุผลและยืนยัน | revision เพิ่มหนึ่ง, CRM active, audit ระบุ A, receipt ตรงคำขอ, ประวัติพักสิทธิ์เดิมยังอยู่ |
| RESTORE-02 | S1/O/anon/C ไม่มีสิทธิ์ เรียกคำสั่งตรง | ปฏิเสธแม้ข้าม UI; ไม่มี partial write หรือ receipt |
| RESTORE-03 | เป้าหมายยังแบน, canonical disabled, ไม่ใช่ Sales, ไม่มีหลักฐานพัก หรือ projection ไม่ตรง | ไม่รับรอง ไม่ปลดแบน ไม่เปลี่ยน role และไม่แก้ข้อมูลให้ตรงเอง |
| RESTORE-04 | ชื่อหรือรุ่นเปลี่ยนระหว่างเปิดฟอร์มกับส่ง | แจ้งข้อมูลเปลี่ยน ต้องตรวจใหม่; ไม่ overwrite การตัดสินใหม่ |
| RESTORE-05 | ส่งคำขอเดียวกันสองครั้ง / พร้อมกัน | รับรองเพิ่มครั้งเดียว ได้ receipt เดิม; ID เดิมแต่ payload หรือ Admin คนละคนต้องไม่ใช้แทนกัน |
| RESTORE-06 | เครือข่ายขาดหลัง server อาจ commit | ไม่แจ้งสำเร็จหรือยกเลิกโดยเดา; retry ด้วย ID/payload เดิม; ไม่มีการสร้างคำขอใหม่อัตโนมัติ |
| RESTORE-07 | แบน S1 ซ้ำหลังรับรอง แล้ว replay คำขอเก่า | receipt เป็นหลักฐานเก่าเท่านั้น S1 ยังถูกพัก ไม่คืนสิทธิ์จาก replay |
| RACE-01 | แบนระหว่างรับรอง ทั้งลำดับแบนก่อน/หลัง | ผลตรงลำดับ commit ไม่มี deadlock หรือสิทธิ์ค้าง active หลัง ban commit; เก็บหลักฐานทั้งสองลำดับ |
| RACE-02 | ถอน canManageAccounts ของ C ระหว่าง C รับรอง | คำสั่งหลังการถอนมีผลต้องไม่ผ่าน; การรับรองที่ commit ก่อนหน้าต้องมี audit ไม่ลบย้อนหลัง |
| HISTORY-01 | เปรียบเทียบก่อน/หลังทุกกรณีบัญชี | จำนวน/ID/เจ้าของ Lead, booking/cancellation, KPI dates, Visit/Voices ของข้อมูลสมมติไม่เปลี่ยนเพราะการแก้สิทธิ์ |
| LEGACY-01 | เปลี่ยนชื่อ/PIN/สร้างบัญชีสมมติด้วย account RPC เดิม | ผ่าน Auth login จริงได้ตามนโยบาย; การสร้างไม่มอบ trusted role อัตโนมัติ; ตรวจ Auth compatibility ของ legacy body ไม่ถือว่าห่อ guard แล้วผ่าน |
| LEGACY-02 | เพิ่ม/ลบ Foreman แล้วให้ account RPC ล้มเหลว | ต้องไม่มี orphan/การลบครึ่งเดียว เตรียม atomic SQL/helper และ client หลัง flag แล้ว แต่ยังปิดอยู่ ต้องตรวจ client/SQL รุ่นตรงกันและกัน client เก่าสองขั้นตอน; ผล Supabase จริงยัง NOT_RUN |
| REG-01 | ทุกบทบาทและทางเข้า Sales/Owner/หน้าหลัก/URL ตรง | ไม่ได้สิทธิ์เพิ่มจาก metadata; งานก่อสร้าง/จัดซื้อ/Storage/Realtime ที่อนุมัติยังทำงาน; legacy write paths ที่ต้องปิดใช้ไม่ได้ |
| RECOVERY-01 | ปิดความสามารถใหม่ / Admin หลักใช้ไม่ได้ | Admin สำรองหรือ operator กู้ได้โดยไม่คืน grant กว้าง; เก็บ audit/revisions; ตรวจ direct RPC ไม่ใช่แค่ปุ่มหาย |

## วิธีบันทึกผล

ต่อกรณีให้บันทึก ID, เวลา, project ref ที่อนุมัติ, alias fixture, app/SQL revision, ช่องทาง, HTTP status/error code, expected/actual, PASS/FAIL/NOT_RUN และหลักฐานก่อน–หลังที่ไม่มีข้อมูลลับ

ห้ามบันทึก JWT, refresh token, password/PIN, service key, raw request headers หรือข้อมูลลูกค้าจริงลงรายงาน เก็บจำนวน/รหัส fixture/ผลตรวจเท่าที่จำเป็น ไม่ใช้ console dump ทั้ง session/response

กรณีบังคับที่ FAIL หรือ NOT_RUN ถือว่ายังไม่ผ่าน release gate การเห็นหน้า UI ทำงานหรือได้ HTTP 200 อย่างเดียวไม่พอ ผล PostgreSQL จำลองและ mocked client ให้แนบเป็นหลักฐานเสริม ไม่แทนรายการนี้

## สิ่งที่ยังไม่ได้สร้าง/เปิด

ยังไม่มีตัว runner ที่รับ URL/คีย์แล้วเขียน Supabase โดยอัตโนมัติ เพื่อไม่ให้ต่อผิดฐานก่อนเลือกเป้าหมาย ขั้นต่อไปหลังยืนยันระบบแยกจึงออกแบบการป้องกันเป้าหมายและการเก็บ secret ตามช่องทางจริง ทบทวนเอกสาร Auth ปัจจุบัน และขออนุมัติขอบเขตการเปลี่ยนบัญชีทดสอบก่อนรัน

อ้างอิง: [Auth sessions](https://supabase.com/docs/guides/auth/sessions), [API grants และ RLS](https://supabase.com/docs/guides/api/securing-your-api)
