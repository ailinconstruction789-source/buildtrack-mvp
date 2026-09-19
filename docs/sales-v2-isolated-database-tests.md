# Sales V2 — ผลทดสอบ PostgreSQL แยกในเครื่อง

วันที่ 17 กันยายน 2569: ทดสอบ SQL จริงด้วย **PostgreSQL 17.11 แบบพกพาและข้อมูลสมมติเท่านั้น** ไม่ได้เชื่อมต่อ Supabase, อ่าน/คัดลอกข้อมูลลูกค้าจริง, เปลี่ยน env/สิทธิ์จริง, เปิดฟีเจอร์ หรือออก migration ติดตั้ง

## 1. ผลที่ตรวจได้แล้ว

### รอบ durable dispatcher — 18 กันยายน 2569

รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-5DbiQT/report.json`: **passed, stopped=true** สร้างครบ12ร่าง (base/04–14) เพิ่มSQL14แบบจอง/commitก่อนเรียกworker13 ไม่เปลี่ยนSQL09/13หรือกติกาเวลาเดิม ไม่เชื่อมSupabase ไม่ตั้งCron/login/บัญชีจริง ไม่แก้UI/API/envหรือDeploy

| ชุดตรวจใหม่ | ผล |
|---|---|
| Dispatcher semantics | **9กลุ่ม120 assertions**: บทบาทเฉพาะ/10write gates/6read gates, commitก่อนexecute, ปฏิเสธsame-transaction/stale token/noncurrent request, actual top-level CALL, explicit-BEGIN CALL rollback, completion spacing, second-child faultย้อนงานทั้งรอบแต่เก็บreview, transient backoff, 5abandoned reservations, immutable identity/attempt/terminal historyและcreatedAt |
| Dispatcher concurrency/transport | **4กลุ่ม22 assertions**: concurrent prepareสร้างคำขอเดียว, concurrent executeไม่มีงานซ้ำ, actual top-level CALLถูกstatement timeoutหลังCOMMITแรก, socketขาดหลังcommitของprepareและexecuteแต่ละช่วง พร้อมread-only status recovery |

กรณีtimeoutใช้sessionหนึ่งล็อกลูกค้าจริงในฐานจำลอง แล้วอีกsessionเรียกprocedureจริงด้วยstatement_timeout300ms ตรวจว่าคำสั่งถูกยกเลิกก่อนlock_timeout500ms แต่request/attemptจากCOMMITแรกยังอยู่เพียงหนึ่งรายการ งานลูกค้า/worker receipt/audit/cursorไม่เปลี่ยน หลังจำลองหมดช่วงจองใช้requestUUIDเดิมและattemptใหม่ รหัสเก่าถูกปฏิเสธ ไม่ใช่แค่ยกexceptionจำลองแทนการหมดเวลาจริง

กรณีHTTPใช้listenerเฉพาะ127.0.0.1 พอร์ตสุ่มและtokenในหน่วยความจำ ตัดsocketหลังSQLcommitจริงทั้งสองช่วง เก็บintentในPostgreSQLจริง ไม่ใช้memorystoreเป็นหลักฐาน durability แต่HTTPนี้ยังเป็นfixture ไม่ใช่Supabase JWT/PostgREST/Nextหรือpg_cron launcherจริง

การเร่งเวลาในfixtureแก้เฉพาะdeadlineที่ยังเปลี่ยนได้ให้ถึงกำหนด ใช้guardของฐานสมมติ ไม่ปิดtrigger/แก้immutable timestamps ไม่ลบhistory ส่วนการรีเซ็ตcontrolระหว่างกรณีทดสอบเป็นสิทธิ์installerของfixtureเท่านั้น ไม่ได้สร้างAdmin recovery shortcutสำหรับproduction

Nativeเดิมทั้งหมดผ่านด้วย: first-contact91, receipt53, cycle94, preflight31, systemworker82 assertions; clock80กรณี (parity69/notification54เป็นส่วนย่อย), concurrency9กลุ่ม29, cycleconcurrency5กลุ่ม24 และworkerconcurrency4กลุ่ม20

สองรอบของขั้นนี้ (`run-IFmEmU`, `run-5DbiQT`) ผ่านและหยุดทั้งหมด ไม่มีpostmaster.pidหรือprocesspostgres/initdbค้าง รอบแรก112/21 assertions รอบหลัง120/22เพิ่มcreatedAt/UTCprojection/terminalhistoryและactualprocedure timeout ไม่เปิดเครื่องมือหรือบริการภายนอก

ขอบเขตสำคัญ: จัดเก็บประวัติreservationและสถานะล่าสุด ไม่ใช่errorทุกครั้งย้อนหลัง; นโยบาย60วินาที/5attempts/1cycleต่อtickเป็นค่าร่างที่ยังไม่ผ่านload testหรืออนุมัติเปิดจริง สถานะreviewหยุดไว้ถาวรจนกว่าจะมีกระบวนการแก้โดยรักษาประวัติที่ตรวจรับแยก ปัจจุบันไม่มีปุ่มปลดreviewหรือระบบแจ้งผู้ดูแล

Baselineก่อนแก้ผ่าน3,897ข้อ/77ไฟล์; **Vitestฉบับสุดท้ายผ่าน3,921ข้อ/78ไฟล์** ด้วย `npm run test -- --maxWorkers=1 --no-file-parallelism --reporter=dot` (114.43วินาที) รวมstatic dispatcher23ข้อและallowlistเพิ่ม1ข้อ ไม่บวกจำนวนnative assertionsซ้ำในยอดนี้

TypeScript `--noEmit --incremental false` และscoped ESLintผ่าน รันชุดใหญ่แยกกัน ไม่รันbuild/E2Eใหม่เพราะไม่ได้แก้UI/API/โค้ดproductionของแอป ตรวจhashเทียบไฟล์เดิม425ไฟล์: เปลี่ยน11ไฟล์เฉพาะSQL12/Cronfixture/staticCron test/runner/safety/เอกสาร6ไฟล์ เพิ่ม5ไฟล์สำหรับSQL14/native tests2ไฟล์/static test/คู่มือ ไม่มีการลบหรือเปลี่ยนSQL09/13, app, package, env, Masterหรืองานเดิมของผู้ใช้

รายละเอียดและงานก่อนติดตั้ง: [durable dispatcher](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-durable-dispatcher.md)

### รอบแกนร่วมและ system worker — 18 กันยายน 2569

รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-ehd89H/report.json`: **passed, stopped=true** สร้างได้ครบ11ร่าง (base/04–13) หลังแยก business application ของ09เป็น private shared core และเพิ่มระบบ13 ไม่แก้ base/04–08/10–11 ไม่มีการเปลี่ยน Supabase/UI/API/env หรือเปิด Cron

| ชุดตรวจ native รอบนี้ | ผล |
|---|---|
| System worker13 | **82 assertions**: NOLOGIN role/สิทธิ์/9สวิตช์เริ่มปิด, ไม่มี JWT ก็เป็นระบบ, auditและใบรับแยกจาก Admin, private projection, replay/readไม่เขียน, rollbackงานที่สองล้มเหลว, held11งานใช้ cursorร่วมกับ Admin และผลจริงเทียบ Admin บนงานเดียวกัน |
| System concurrency/recovery | **4กลุ่ม20 assertions**: Admin11↔workerถือglobal lockร่วม, same-ID contention/replay, manual09ถือcustomerแล้วworkerรอ และ HTTPsocketขาดหลังSQLcommitพร้อมกู้ผล/ลองรหัสเดิม |
| คำสั่งและใบรับเดิม | first-contact91, receipt53, cycle94, Cronpreflight31 assertions ผ่าน |
| เวลาเดิม | clock80กรณีผ่าน (parityTypeScript69/notification54เป็นส่วนย่อย ไม่บวกซ้ำ) |
| Concurrencyเดิม | 9กลุ่ม29assertions และ cycle concurrency5กลุ่ม24assertions ผ่าน |

Manual/system parityใช้คำสั่งจริงทั้งสองทางบนtaskเดียวกัน โดยผลmanualถูกเก็บแล้ว rollbackธุรกิจใน subtransaction ก่อนเรียกworker เปรียบเทียบ held, due-soon, not-due, overdue และ contact-proven; ไม่นำผลระบบไปสวมactor Admin หรือให้เครดิตKPIแก่Sales

Workerconcurrencyใช้ roleจริงบนnativePostgreSQL และHTTPlistenerเฉพาะ127.0.0.1 ตัดsocketหลังcommit ตรวจsnapshotลูกค้า/task/notification/audit/Adminและsystemledgers/cursorว่าไม่เขียนซ้ำ แต่ยังไม่ใช่SupabaseAuth/PostgREST/Next/Cronจริง ไม่มีdurable dispatcherหรือการตั้งเวลารอบนี้

ก่อนแก้ผ่านbaseline Vitest3,870ข้อ/76ไฟล์ ระหว่างแยกแกนมีstatic test2ข้อไม่ผ่านเพราะการแทนข้อความในตัวทดสอบ JavaScriptตีความ `$'` ในSQLregexเป็นคำสั่งแทนsuffix แก้เฉพาะตัวทดสอบให้ใช้replacement callback จากนั้นชุดscoped132ข้อผ่าน ไม่แก้สูตรธุรกิจเพื่อให้ผ่าน การเทียบsourcebusinessspanยืนยันเปลี่ยนเฉพาะactorในaudit/response; เพิ่มinputguardsของcoreและย้ายledgerกลับAdminwrapperโดยคงcontractเดิม

Nativeสามรอบในขั้นนี้ (`run-9PbcUr`, `run-GIS3lx`, `run-ehd89H`) ผ่านและหยุดทั้งหมด ไม่พบpostmaster.pidหรือprocesspostgres/initdbหลังจบ รอบแรกตรวจregression/compile13ก่อนผูกscenariosใหม่ สองรอบหลังทดสอบworker/concurrencyครบ; รอบสุดท้ายรวมการตรวจข้อความworker13ในCronpreflightแล้ว ไม่ลบcache/รายงานหรือเปลี่ยนข้อมูลเดิม

ข้อจำกัด: fixtureใช้defaultACL/ownershipของฐานจำลอง จึงไม่รับรองสิทธิ์จริงหรือการผูกNOLOGINroleให้Cron ต้องตรวจdefault privileges/เจ้าของfunction/legacywritersและbindingในstagingที่ได้รับอนุญาต รวมถึงวัดthroughputและstatementtimeoutจริง ไม่อ้างว่าlock_timeout500msคือเพดานเวลารอบทั้งหมด

**ผลยืนยันสุดท้าย: Vitest3,897ข้อ/77ไฟล์ผ่าน** ด้วย `npm run test -- --maxWorkers=1 --no-file-parallelism --reporter=dot` (168.77วินาที), TypeScript `--noEmit --incremental false` และscoped ESLintผ่าน รันแต่ละชุดใหญ่แยกกัน ไม่รันbuild/E2Eใหม่เพราะไม่มีการแก้UI/API/โค้ดproductionของแอป และไม่ใช้ผลbuildรอบก่อนมารับรองรอบนี้

ตรวจhashเทียบไฟล์เดิม420ไฟล์: เปลี่ยนเฉพาะ13ไฟล์ตามขอบเขต (SQL09/12, Cronfixture, runner/safety, static tests2ไฟล์ และเอกสาร6ไฟล์) เพิ่ม5ไฟล์สำหรับSQL13/nativefixture/concurrency/static tests/คู่มือ ไม่มีการลบหรือเปลี่ยนไฟล์แอป/package/env/MasterหรือSQLฐานส่วนอื่น

รายละเอียดและขั้นต่อไป: [system workerและsharedcore](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-system-worker.md)

### รอบเพิ่มคำสั่งจำกัด 10 งาน — 17 กันยายน 2569

รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-7kcze0/report.json`: **passed, stopped=true** สร้างได้ครบ **9 ร่าง: base และ 04–11** โดยไม่แก้ base/04–10 ตัวหยุดใน SQL ต้นฉบับยังอยู่ และไม่มีการนำไปติดตั้งจริง

| ชุดตรวจ native รอบนี้ | ผล |
|---|---|
| คำสั่งรอบ SQL11 | 94 assertions ผ่าน: เพดาน/ลำดับ/งาน held 11 รายการข้ามรอบและข้าม Admin, งานที่สามล้มเหลวหลังสองงานแรกทำแล้วต้องย้อนกลับทั้งหมด, replay/อ่าน, สวิตช์/สิทธิ์/ไม่เปิดเผยข้อมูลภายใน และรอบว่าง |
| รอบพร้อมกัน/เครือข่าย | 5 กลุ่ม / 24 assertions ผ่าน: global BUSY, same-ID lock timeout/replay, งานเดี่ยวชนรอบ, ถอน Admin ระหว่างรอ และ TCP ขาดหลัง commit |
| คำสั่งเดี่ยวเดิม | 91 assertions ผ่าน |
| อ่านใบรับเดิม | 53 assertions ผ่าน |
| เวลาและปฏิทินเดิม | 80 กรณีผ่าน รวมส่วนย่อยเทียบ TypeScript 69 และเงื่อนไขแจ้งเตือน 54 ไม่บวกซ้ำ |
| concurrency เดิม | 9 กลุ่ม / 29 assertions ผ่าน |

กรณีเครือข่ายใหม่ใช้ **HTTP listener บน 127.0.0.1 และตัด socket หลัง transaction SQL จริง commit** ตรวจพบว่าการอ่านคืนใบรับเดิมได้และ explicit retry ไม่เปลี่ยนลูกค้า/งาน/แจ้งเตือน/audit/ใบรับ/cursor อย่างไรก็ตาม HTTP transport เป็น fixture ที่มี token สมมติและเรียก native RPC ไม่ใช่ Next handler + Supabase JWT/PostgREST จริง ทดสอบ handler/contract แยกด้วย unit mock จึงยังไม่อ้างว่าเป็น staging E2E

listener ใช้พอร์ตสุ่ม/token ในหน่วยความจำ ไม่ส่งต่อภายนอก และปิด socket/รอ query ของตัวเองใน finally ฐานทุกอันที่สร้างในรอบนี้หยุดแล้วและไม่เหลือ postmaster.pid รอบแรก `run-4m9XIB` หยุดปลอดภัยหลังพบชื่อคอลัมน์กำกวมใน assertion ของ fixture ซึ่งแก้แล้วก่อนรันฐานใหม่ ไม่ใช่ข้อผิดพลาดของ SQL11 ที่นำไปแก้ฐานจริง

ผลทดสอบรวม: **Vitest 3,830 ข้อ / 74 ไฟล์ผ่าน** รวม contract/HTTP handler ใหม่ 253 ข้อ, source invariants SQL11 18 ข้อ และ safety ของตัวรัน 74 ข้อ (ทั้งหมดอยู่ในยอดรวม ไม่ใช่จำนวนทดสอบฐานเพิ่ม) ESLint ของโค้ด/เทสต์/ตัวรันที่แก้และ TypeScript noEmit ผ่าน

Production build ด้วย `npm run build -- --webpack` ผ่าน รวม route `/api/sales-crm/sla-cycles`; รอบนี้ไม่ได้เปลี่ยน config bundler หรือทดสอบ default Turbopack ซ้ำจากข้อจำกัดเครื่องที่บันทึกรอบก่อน ไม่ deploy ไม่เปิดฟีเจอร์หรือ cron บน Vercel ที่ผู้ใช้ยืนยันว่าเป็น hosting ของแอป

ขอบเขตและงานก่อนเปิดตัวตั้งเวลา: [bounded cycles](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-bounded-cycles.md)

### รอบเพิ่มหน้าตรวจใบรับ Admin — 17 กันยายน 2569

รายงาน `node_modules/.cache/buildtrack-sales-runtime/runs/run-nwIX7k/report.json`: `passed`, `stopped=true` สร้างโครงสร้างครบ **8 ร่าง: base และ 04–10** ร่าง SQL10 ใหม่เพิ่มเฉพาะฟังก์ชันอ่านใบรับ ไม่แก้ base/04–09 และไม่ติดตั้งลง Supabase

- ชุดใบรับใหม่ผ่าน **53 assertions**: สิทธิ์/รูปแบบ input/สวิตช์อ่าน, อ่านได้เมื่อปิดสวิตช์ประมวลผล, จำกัดบัญชีและคู่รหัส, ไม่เปิดเผยฟิลด์ภายใน, ไม่เปลี่ยนข้อมูลจาก GET และยังอ่านประวัติหลังปิด Lead ได้
- ชุดเดิมยังผ่าน: คำสั่ง/สิทธิ์/ธุรกรรม 91 assertions, เวลา 80 กรณี (เทียบ TypeScript 69 และเงื่อนไขแจ้งเตือน 54 ซึ่งเป็นส่วนย่อย), concurrency 9 กลุ่ม / 29 assertions
- UI → client → HTTP handler ทดสอบด้วย transport/RPC สมมติ 4 กรณี รวมจำลอง POST commit แล้วทิ้งผลตอบกลับและกู้ผ่าน GET โดยไม่ส่งซ้ำ เป็นการทดสอบแยกจาก PostgreSQL ไม่ใช่ HTTP/PostgREST จริง

ผลทดสอบรวมรอบหน้าจอ: **Vitest 3,558 ข้อ / 71 ไฟล์ผ่าน** รวม safety tests ของตัวรัน 73 ข้อ; TypeScript `--noEmit --incremental false` และ ESLint ของโค้ด/เทสต์/ตัวรันที่เปลี่ยนผ่าน TypeScript รอบแรกชนข้อจำกัดหน่วยความจำเมื่อรันพร้อม build แต่รันแยกแล้วผ่าน

**Production build ผ่านด้วย `npm run build -- --webpack`** รวมเส้นทางใหม่ `/sales-crm/sla-processing` และ `/api/sales-crm/sla-receipts` ไม่แก้การตั้งค่า bundler ใน repository รอบ default Turbopack ไม่สำเร็จ: ครั้งแรกดาวน์โหลด Google Fonts เดิมไม่ได้ใน sandbox; เมื่ออนุญาตเครือข่ายแล้วหยุดด้วย Windows `os error 1450` ทรัพยากรเครื่องไม่พอ จึงยังไม่อ้างว่า default Turbopack ผ่าน ไม่ได้ deploy หรือรัน authenticated E2E กับ Supabase

รายละเอียดหน้าจอและขอบเขตอ่าน/เขียน: [Admin processing](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-admin-processing.md)

### หลักฐานรอบก่อนเพิ่มหน้าจอ (เก็บไว้เพื่อเปรียบเทียบ)

| ชุดตรวจ | ผล | ขอบเขตหลักฐาน |
|---|---|---|
| สร้างโครงสร้างและฟังก์ชัน | ผ่าน 7 ร่าง: base และ 04–09 | PostgreSQL จริงบน schema สมมติ ไม่ใช่ schema production |
| คำสั่ง/สิทธิ์/ธุรกรรม | ผ่าน 91 assertions | เรียก RPC ในฐานทดสอบด้วยบทบาท `authenticated`/`anon`; ไม่ใช้ superuser แทนสิทธิ์ผู้ใช้ |
| นับเวลาและปฏิทิน | ผ่าน 80 กรณี | 69 กรณีเทียบกับ helper TypeScript เดิม; 54 กรณีตรวจเงื่อนไขแจ้งเตือน ซึ่งซ้อนอยู่ใน 80 กรณี ไม่บวกซ้ำ |
| หลาย session พร้อมกัน | ผ่าน 9 กลุ่ม / 29 assertions | คำขอซ้ำ, 8 คำขอต่างรหัส, ใบรับที่ไม่ได้ใช้ผล, กดอ่าน, เปลี่ยนเวร, เวรครั้งแรก, ถอนสิทธิ์, Lost, ย้ายเจ้าของ |
| ตัวรันปลอดภัย | ผ่าน unit tests 72 ข้อ | จำกัดปลายทาง/ชื่อฐาน/สิ่งแวดล้อม/คำสั่ง psql; อยู่ในชุด Vitest รวม ไม่ใช่ 72 การทดสอบฐาน |
| หยุดเมื่อขอยกเลิก | ผ่าน self-test ของ signal handler | ส่ง SIGINT event ให้ handler ภายในตัวรันทดสอบ และยืนยัน process PostgreSQL ที่สร้างเองหยุด ไม่ใช่การทดสอบ forced Windows termination |

ผลตรวจรวมฉบับสุดท้าย: Vitest **3,249 ข้อ / 64 ไฟล์ผ่าน** (`npm run test -- --maxWorkers=1 --no-file-parallelism`), TypeScript `--noEmit --incremental false` และ ESLint ของไฟล์เครื่องมือทดสอบผ่าน ไม่รัน production build ใหม่หรือ E2E กับระบบจริงในรอบนี้ เพราะไม่มีการแก้โค้ด production ของแอป

รายงาน native รอบสุดท้าย: `node_modules/.cache/buildtrack-sales-runtime/runs/run-Cc7MY6/report.json` สถานะ `passed`, `stopped=true`; self-test การหยุด: `run-sHgQpt/report.json` สถานะ `interrupt-handler-check-passed` ตรวจทุก cluster ที่สร้างในรอบนี้แล้วหยุดทั้งหมดและไม่มี `postmaster.pid` ค้าง

ไม่พบข้อผิดพลาดที่ต้องแก้ SQL ร่างจากกรณีที่ทดสอบ: **base และ 04–09 ไม่เปลี่ยนแม้แต่ไบต์เดียว** ตัวรันบันทึก SHA-256 และตรวจซ้ำเมื่อจบ ชุดนี้เพิ่มเครื่องมือทดสอบ/fixture/เอกสาร ไม่แก้ workflow production

### ประเด็นสำคัญที่ผ่าน

- Lead สร้างด้วย RPC จริง, เจ้าของอัตโนมัติ, สิทธิ์บทบาทที่เชื่อถือได้ ไม่ยกระดับจากข้อความใน JWT metadata สมมติ; สวิตช์ฐานทั้ง 7 ปิดแล้วคำสั่งถูกปฏิเสธ
- ปฏิเสธการอ่านใบรับส่วนตัว/เขียนงาน SLA/แก้ประวัติโดยตรงด้วยบทบาททั่วไป, rollback หลังประมวลผลไม่เหลือผลครึ่งทาง, ใบรับและ audit ที่ป้องกันไว้แก้ย้อนหลังไม่ได้
- คำขอรหัสเดิมคืนใบรับเดิม รหัสเดิมกับ payload ต่างกันถูกปฏิเสธ และคำขอต่างรหัสไม่เพิ่มแจ้งเตือนซ้ำ
- นับกติกา 24 ชั่วโมง / 120 นาทีทำงานทั้ง 3 แบบ, เศษวินาทีระดับ microsecond, เวรข้ามวัน, ลา/พักซ้อนกัน, ช่วงต่อกัน, สิ้นเวร, เวรไม่ครบ และขอบเขต 400/401 ช่วง
- เปลี่ยนรุ่นเวรแม้กำหนดเท่าเดิมต้องเปลี่ยนหลักฐานอ้างอิง, เวรครั้งแรกล็อกได้แม้ยังไม่มีหัวตาราง, ไม่ล้างสถานะอ่าน และไม่ส่งรายการของเจ้าของเดิมให้คนใหม่
- ติดต่อสำเร็จต้องมีหลักฐานจากคำสั่งติดตามเดิม; no-answer/ข้อมูลเก่า/หลักฐานถูก correction ไม่ถูกนับว่าสำเร็จ; เมื่อจบงานถอนแจ้งเตือนและคงกำหนดบริการเดิม
- ถอนสิทธิ์ Admin ระหว่างรอล็อกต้องไม่บันทึก; Lost กับย้ายเจ้าของใช้ RPC lifecycle จริง การย้ายเจ้าของยังพัก `OWNER_REVIEW` ไม่สร้างกติกา SLA คนใหม่ที่ผู้ใช้ยังไม่ยืนยัน

กรณีที่ตั้งใจตรวจการรอล็อก ใช้ PostgreSQL คนละ backend และตรวจพบ `wait_event_type='Lock'` ก่อนปล่อยธุรกรรม ไม่อาศัยเพียงการเริ่ม Promise พร้อมกัน ส่วนการกู้หลังไม่ได้รับผลเป็นการ **ทิ้งผลที่ commit แล้วและลองรหัสเดิม** ยังไม่ใช่การตัดเครือข่าย HTTP/PostgREST จริง

## 2. วิธีรันทดสอบซ้ำ

รันจากโฟลเดอร์โครงการ:

```powershell
npm run test:sales-db
```

ทุกครั้งสร้าง cluster, user/password, port และชื่อฐานใหม่ ไม่ใช้ฐานเดิมหรือข้อมูลจากรอบก่อน หากย้ายเครื่อง ให้จัดหา binary PostgreSQL ที่ตรวจสอบแล้วและระบุเฉพาะโฟลเดอร์ binary:

```powershell
npm run test:sales-db -- --bin 'D:\tools\postgresql\bin'
npm run test:sales-db -- --check-interrupt
```

คำสั่งไม่รับ URL/host/ชื่อฐานภายนอก และไม่ดาวน์โหลดหรือติดตั้งอะไรเอง ตัวเลือก `--check-interrupt` ทดสอบการหยุดอย่างเดียว ไม่รันชุดธุรกิจ

ชุด binary รอบนี้มาจาก [EDB PostgreSQL binaries](https://www.enterprisedb.com/download-postgresql-binaries) ตามช่องทาง ZIP ที่ [PostgreSQL แนะนำสำหรับ Windows](https://www.postgresql.org/download/windows/): `postgresql-17.11-3-windows-x64-binaries.zip` ขนาด 341,325,378 bytes

SHA-256 ที่คำนวณจากไฟล์ที่ดาวน์โหลด: `4B8DB0930C38F6EF845DB919551DEDDA3B6B845AEB0927B3D79A6E8E9E4537CF` เป็น hash สำหรับระบุไฟล์ที่ใช้ในรอบนี้ **ไม่ใช่การยืนยันด้วย checksum ที่ผู้จัดจำหน่ายเผยแพร่แยกต่างหาก** ไม่ติดตั้ง Windows service, ไม่แก้ PATH, ไม่เพิ่ม dependency ของแอป

## 3. ขอบเขตป้องกันในตัวรัน

- เก็บ binary/cluster/report เฉพาะ `node_modules/.cache/buildtrack-sales-runtime/` ที่ Git ไม่ติดตาม; ไม่อ่าน `.env`, app session, Supabase key หรือ database URL
- รับการเชื่อมต่อเฉพาะ `127.0.0.1`, ใช้พอร์ตใหม่และรหัสผ่านสุ่มแบบ SCRAM; ล้างตัวแปร PG*/DATABASE_URL/Supabase/NODE_OPTIONS ที่อาจติดมาจากเครื่อง
- ก่อนเขียน SQL ตรวจ IP/port/user/ชื่อฐาน/marker/listen address และ `data_directory` ที่ resolve แล้วว่าตรงโฟลเดอร์ใหม่ของรอบนี้
- ปิด psql startup file และ password prompt; ปฏิเสธ URI/conninfo ในชื่อฐานและ psql metacommands เช่น `\connect`, `\i`, `\!` ที่อยู่นอก SQL literal/comment ที่ทุก query boundary
- โหลดเฉพาะ draft allowlist หลังยืนยันฐานของตัวเองแล้ว โดยนำเฉพาะเนื้อหาร่างมารันในหน่วยความจำของตัวทดสอบ ไม่แก้ guard/ROLLBACK ของต้นฉบับ ไม่สร้างไฟล์ SQL ติดตั้ง
- Fixture มี guard บังคับชื่อฐาน/marker/loopback และต้องเริ่มในฐานใหม่; ข้อมูลย้อนหลังเป็นหลักฐานที่สร้างขึ้นเพื่อทดสอบเท่านั้น ไม่ใช่เครื่องมือนำเข้าที่ผ่านการอนุมัติ
- หยุดเฉพาะ process/cluster ของตัวเองใน `finally` และ graceful SIGINT/SIGTERM, รอคำสั่งลูกจบและยืนยันการหยุดก่อนรายงาน ไม่มีคำสั่ง kill ตามชื่อ process/port หรือ recursive delete

ตัวรันนี้รับเฉพาะ SQL ที่ตรวจจาก repository แล้ว **ไม่ใช่ sandbox สำหรับ SQL ที่ไม่เชื่อถือ** การปิดเครื่องหรือ force-kill ที่ระบบไม่ส่งให้ handler จัดการยังไม่รับประกัน cleanup อัตโนมัติ; ต้องตรวจ cluster ที่ระบุในรายงานโดยเฉพาะ ห้ามหยุด PostgreSQL ทั้งเครื่องแบบเหมา

รายงาน `runs/run-*/report.json` เก็บผล/hash/สถานะการหยุด และ `postgres.log` สำหรับวิเคราะห์ ทุกข้อมูลเป็นข้อมูลสมมติ ฐานที่หยุดแล้วและ binary ถูกเก็บไว้ใน cache ไม่ลบอัตโนมัติ ไม่รวมใน Git

## 4. สิ่งที่ผลนี้ยังไม่รับรอง / ขั้นถัดไป

1. ตาราง legacy ใน fixture เป็นเพียง facade ของชนิด key/คอลัมน์ที่ร่างอ้าง ไม่ใช่สำเนา grants, permissive policies, trigger, FK/cascade และข้อมูลจริงทั้งหมด จึงยังไม่ยืนยันความเข้ากันได้ของ migration กับ Supabase
2. `auth.uid()` เป็น shim ของ request subject ที่ตัวทดสอบกำหนด ไม่ใช่การตรวจ JWT/PostgREST/Auth ของ Supabase จริง; ต้องทดสอบเส้นทาง HTTP/API/session/สิทธิ์ร่วมกันใน staging ก่อนเปิดใช้
3. รุ่นนี้ใช้ PostgreSQL 17.11; รายงานจากผู้ใช้เดิมเป็น 17.6 จึงต้องยืนยันรุ่นและ configuration ของเป้าหมายอีกครั้ง ไม่อ้างว่าทดสอบ environment เดียวกันทุกอย่าง
4. ยังไม่ใช่ coverage ทุก combination: แม้มี loopback TCP fault แล้ว ยังต้องเพิ่ม real app/PostgREST connection-loss, activity/correction writers ชนกันจริง, หลักฐาน Admin/หลายขอบเขต/ย้อนหลังปะปน และ stress/load ของรูปแบบ scheduler ที่จะใช้ก่อนยอมรับการส่งอัตโนมัติ
5. หน้าตรวจใบรับ/ยืนยันAdmin คำสั่งหนึ่งรอบไม่เกิน10งาน sharedcore/systemworkerและdurable dispatcherเตรียมแล้วและยังปิดฟีเจอร์; ขั้นถัดไปตรวจbindingสิทธิ์Cron/วัดความจุ/monitoringและการจัดการreview ก่อนต่อเวลาเรียกและทดสอบHTTP/PostgRESTจริงในstagingที่ได้รับอนุญาต GET/inboxยังไม่เป็นตัวส่ง
6. ยังต้องมี migration ติดตั้งที่ review แยก, security/legacy writer cutover, สำรอง/ซ้อมนำเข้าและตรวจ KPI ก่อนเปิดระบบจริง ผู้ใช้ยังไม่ต้องรัน SQL ร่างใด ๆ

แผนรวมอยู่ใน [compatibility และ rollout](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-compatibility-and-rollout.md)

## 5. รอบเตรียม Supabase Cron — 18 กันยายน 2569

เพิ่ม [SQL12 preflight](D:/buildtrack/buildtrack-mvp-main/docs/sales-v2-supabase-cron-preparation.md) แบบ private/operator/read-only ไม่มี worker หรือคำสั่งลงทะเบียน/เปิด Cron รันเฉพาะในฐานทดสอบใหม่ ไม่เชื่อม Supabase ไม่แก้ SQL base/04–11, UI/API, env หรือ Master

Native รอบสุดท้าย `node_modules/.cache/buildtrack-sales-runtime/runs/run-agqp7G/report.json`: **passed, stopped=true** สร้างฟังก์ชันจาก10ร่าง (base/04–12) ผ่าน; first-contact91, receipt53, cycle94, **Cron preflight31 assertions**; clock80กรณี (parity69/notification54ซ้อนอยู่ในชุดเดิม), concurrency9กลุ่ม29assertions และ cycle concurrency5กลุ่ม24assertions ผ่านทั้งหมด

ชุด Cron ใช้ relation/API จำลองใน transaction ที่ ROLLBACK และยืนยัน `realCronExtensionTested=false` ไม่ติดตั้ง pg_cron ไม่แก้ system catalog เพื่อปลอม extension การทดสอบนี้พิสูจน์ตรรกะอ่าน/สิทธิ์/ไม่เปลี่ยนข้อมูลบน PostgreSQL จริง แต่ **ไม่พิสูจน์ launcher/extension/การลงทะเบียนหรือการตื่นตามเวลาบน Supabase**

ระหว่างเตรียม fixture พบข้อมูลจำลองผิดข้อบังคับเดิม3จุด: หลาย first-contact เปิดในลูกค้าคนเดียว, ตั้ง done โดยไม่มีหลักฐาน และ UPDATE settings ที่ยังไม่มีแถว แก้เฉพาะ fixture ให้ตรง schema ไม่ถอด constraint หรือแก้ business core รอบถัดมาที่รันพร้อมชุดอื่นมี initdb timeout/restricted-token error จึงรันใหม่หลังชุดอื่นจบจนผ่าน ไม่เปลี่ยน timeout/sandbox หรือใช้สิทธิ์ยกระดับ

ตรวจ5โฟลเดอร์ที่สร้างในรอบนี้ (`run-97UpAc`, `run-RLl30h`, `run-rW2zBA`, `run-AupEUq`, `run-agqp7G`) รายงานหยุดทั้งหมดและไม่มี postmaster.pid; หลังจบรอบสุดท้ายไม่พบ process postgres/initdb ผ่าน Get-Process เก็บรายงาน/ฐานที่หยุดไว้ใน cache ไม่ลบอัตโนมัติ

Baseline Vitest3,830ข้อผ่าน ชุดใหม่ static12/แบบจำลองความจุ27/allowlistเพิ่ม1รวมอยู่ใน Vitest ไม่บวกซ้ำกับยอดรวม ช่วงรันหลายชุดพร้อมกันพบ4การทดสอบUIเดิม timeout/รอelementไม่ทัน จึงตรวจยืนยันแบบเรียงลำดับโดยไม่แก้ UI/timeout; TypeScript noEmit และ scoped ESLint ผ่าน ไม่รัน build/E2E เพราะไม่มีการแก้แอป production

**ผลยืนยันสุดท้าย: Vitest3,870ข้อ/76ไฟล์ผ่าน** ด้วย `npm run test -- --maxWorkers=1 --no-file-parallelism --reporter=dot` (182วินาที) รวม4กรณีUIที่สะดุดก่อนหน้า ผ่านโดยไม่แก้โค้ดหรือขยาย timeout ตรวจ hash ไฟล์เดิม414ไฟล์แล้วเปลี่ยนเฉพาะเอกสาร4ไฟล์และตัวรันทดสอบ2ไฟล์ เพิ่ม6ไฟล์ตามขอบเขต ไม่มีการลบไฟล์หรือเปลี่ยน business core/งานผู้ใช้
