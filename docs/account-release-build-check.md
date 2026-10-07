# ตรวจชุดเผยแพร่ก่อนเปิด Lead ส่วนกลาง

28 กันยายน 2569 — เตรียมในเครื่องเท่านั้น ไม่ใช่อนุมัติ push/deploy/SQL

## ขอบเขตชุดไฟล์

ผู้ใช้ยืนยันว่า GitHub เชื่อม Vercel แบบ Deploy อัตโนมัติ เว็บจริงที่ระบุคือ `https://buildtrack-mvp-79c5.vercel.app/` ขณะตรวจ local branch คือ `main` ต่อมาอ่าน Vercel ผ่าน Chrome ได้และยืนยัน repository/production branch ของเว็บนี้แล้ว แต่พบโปรเจกต์อื่นผูก repository เดียวกันด้วย จึงไม่ push เพื่อทดลอง (ดูผลตรวจด้านล่าง)

เริ่มรอบพบไฟล์แก้ไข/ไฟล์ใหม่ 370 รายการ (ก่อนเพิ่มเครื่องมือตรวจและเอกสารรอบนี้) ไม่ได้ stage หรือเลือกทั้งหมดเป็น release โดยอัตโนมัติ

จากการไล่ static imports ของ `app/page.tsx` และ `app/layout.tsx` พบ dependency ภายใน 87 ไฟล์ มี 29 ไฟล์ที่แก้/เพิ่มใหม่ แบ่งเป็น:

- หน้าหลักและ layout, LoginScreen/LoginView, AdminUsersView
- `useBuildTrackData`, `useTrustedAccountSession`, accountCommands/loginDirectory/trustedActor
- SalesWorkspaceEntry/ModeProvider, LeadTrackerPresentation/View, PostBookingLink, ProjectSalesWorkspace
- SalesReportingEntry/ReportsWorkspace และ contracts/client/flags/workflow ที่เกี่ยวข้อง

ตัวเลขนี้เป็น static-import closure ของหน้าหลัก **ไม่ใช่ manifest ครบของ release**: URL ที่เรียก API, หน้าย่อย, public assets, package-lock และ config ต้องรวมตามการใช้งานด้วย การส่งเฉพาะ `app/page.tsx` หรือ `lib/auth/accountCommands.ts` จะไม่พอ ชุดตรวจจึงตรวจ source ของทั้งแอปก่อน ไม่เขียนทับ/ตัดงานค้างเพื่อแยก release โดยพลการ

แพ็กเกจที่เพิ่มใน diff ปัจจุบันคือ `qrcode@1.5.4` และ `@types/qrcode@1.5.6` ต้องส่ง package.json และ package-lock.json คู่กัน ไม่ติดตั้งแพ็กเกจใหม่ในรอบตรวจนี้

## เครื่องมือตรวจในเครื่อง

`node scripts/release-check/check.mjs`

- สร้างสำเนาใหม่ใต้ `.next/release-check/app-*` บน D: จากรายชื่อ Git (tracked และ untracked ที่ไม่ถูก ignore) เฉพาะ source/config/assets ที่อนุญาต รวมไฟล์ทดสอบและ TypeScript สำรองเดิม ไม่ตัดไฟล์ออกเพื่อหลบ type errors
- ไม่คัดลอก `.env*`, SQL, spreadsheet, credentials, `.vercel`, cache หรือ Git metadata; ไม่รัน migration scripts ที่ถูกคัดลอกเป็น source
- บันทึกรายชื่อและ SHA-256 ใน `release-report.json`; ตรวจว่า source ต้นทางไม่เปลี่ยนระหว่างรัน ไม่แก้ tsconfig/next-env/config ต้นฉบับ
- ล้าง inherited environment เหลือ OS paths ที่จำเป็น ใช้ Supabase URL `http://127.0.0.1:1` กับ key สมมติเท่านั้น ไม่มีเซิร์ฟเวอร์ fixture หรือ Supabase connection จริง
- เปิด guarded account flag เฉพาะ process ตรวจ ปิด trusted-auth และไม่ส่ง Sales/notification flags เข้า process; ไม่แก้ Vercel/local environment
- รัน `next typegen` → `tsc --noEmit --incremental false` → `next build --webpack` ตามลำดับ หยุดเมื่อขั้นใดผิดพลาด ไม่ตั้ง ignoreBuildErrors
- ใช้ low-memory config และ offline font fixture ที่มีอยู่เดิมจาก `scripts/sales-ui-test`; จำกัด compiler workers และไม่ใช้ Google Fonts network
- ไม่ stop dev server ของผู้ใช้ ไม่แก้ Windows/pagefile ไม่ commit/push/deploy และไม่เปิดใช้งาน Lead จริง

## ผลและข้อจำกัด

- Boundary tests ของเครื่องมือตรวจมี 3 ข้อ; พบว่า Vitest scan สำเนาใต้ `.next` ซ้ำจนรายงาน 9 ข้อ/3 ไฟล์ จึงเพิ่ม `**/.next/**` ใน exclude โดยไม่ตัด source tests จริงออก ต้องยึดผลรันซ้ำหลังแก้ ไม่อ้าง 9 ข้อเป็น coverage เพิ่ม
- หลังแก้ exclude: เครื่องมือตรวจ + accountCommands + LoginScreen ผ่าน **14/14 จาก 3 ไฟล์** (3+8+3) และ ESLint ของเครื่องมือ/test/Vitest config ผ่าน การแก้ exclude เกิดหลัง snapshot build และไม่เปลี่ยน production app code
- รอบ `app-BxMNfE`: typegen ผ่าน แต่ TypeScript ชน heap limit 768 MiB (`exit 134`) ยังไม่ถึง build; sourceFilesUnchanged=true ไม่ใช่ข้อผิดพลาด TypeScript ของแอป
- รอบ `app-4K9aUh`: เพิ่ม heap cap เฉพาะ process เป็น 1536 MiB รวม favicon เป็น 552 source/assets; **typegen, TypeScript ทั้งชุด และ build ทุก route ผ่าน** สร้าง static pages 19/19 สำเร็จ รายงาน `status=passed`, `sourceFilesUnchanged=true`, `productionChanged=false`, `deployed=false` ไม่ข้าม type errors
- ตรวจ compiled page chunk แล้วพบ contract `buildtrack.account-commands.v1` ใน client ที่เปิด flag เฉพาะการทดสอบ และไม่พบไฟล์ `.env*` ใน root สำเนา ไม่ใช่การตรวจ client บน Vercel จริง
- ตรวจ `npm ls --depth=0` แล้วแพ็กเกจที่ประกาศมีอยู่ พบแพ็กเกจเสริม wasm หลายตัวเป็น extraneous จึงยังไม่อ้างว่าเป็น clean dependency install และไม่ได้ prune/delete/install อะไร
- ใช้ dependencies ที่ติดตั้งอยู่ ไม่ใช่ clean `npm ci`; config ทดสอบจำกัด worker/webpack และ mock fonts จึงไม่ใช่หลักฐานว่า default Turbopack/Vercel/Google Fonts/CDN ผ่าน
- ผล build ไม่แทน browser regression, Supabase Auth/PostgREST acceptance, การตรวจ environment จริง หรือการยืนยัน backup/recovery ล่าสุด
- การเลือก source ไม่ใช่เครื่องสแกน secrets: ก่อน commit ยังต้องตรวจ diff และไฟล์ใหม่ ห้ามรวม `.env`, `supabase/.temp`, report/cache/backup หรือข้อมูลลูกค้า

## ก่อนส่งขึ้น GitHub

1. ทบทวน source manifest และ diff ของ release ที่เลือก พร้อม API/routes/config/dependencies ที่ต้องมาด้วย; ไม่ใช้ git add ทั้งโฟลเดอร์โดยไม่ตรวจ
2. ยืนยัน repository/production branch ใน Vercel และขออนุมัติส่ง release นี้โดยระบุผลกระทบ การอนุญาต SQL ครั้งเดียวไม่ใช่อนุมัติ Deploy ทุกงานที่ค้าง
3. ตรวจ build ด้วยการตั้งค่าจริงและทดสอบเส้นทางฝ่ายอื่น นัดพักงานจัดการพนักงานและปิด/รีโหลด client เก่า
4. ส่ง matching client ก่อน SQL ตาม [ลำดับ cutover](./account-security-shared-command-preparation.md) ไม่เปิด trusted-auth/Sales/Cron พ่วงโดยไม่มีฐานและสิทธิ์พร้อม

เก็บสำเนาและ log ในพื้นที่ ignored เพื่อวิเคราะห์ได้ ไม่ลบข้อมูลผู้ใช้เพื่อคืนพื้นที่ หากต้องล้างให้ยืนยัน exact path และลบเฉพาะผลที่เครื่องมือนี้สร้าง

## Browser smoke check — 28 กันยายน 2569

ใช้ `scripts/release-check/serve.mjs app-4K9aUh` เปิดเฉพาะ snapshot ที่ตรวจผ่าน บน `127.0.0.1` พอร์ตสุ่ม ไม่มี credentials จริงหรือฐาน fixture ที่ตอบสำเร็จ ตรวจผ่าน browser ในแอป:

- `/`: แสดงหน้า Login; เมื่อ Supabase สมมติเข้าไม่ได้ มีข้อความโหลดรายชื่อไม่สำเร็จ, username และ Sign In ปิดไว้; กดโหลดอีกครั้งแล้วเข้าสถานะกำลังโหลด ไม่ข้ามไปล็อกอิน
- `/sales-crm`: แสดง Lead ส่วนกลางและข้อความให้เข้าสู่ระบบ ปุ่มบันทึก Lead ใหม่ปิดไว้ ตรวจภาพแล้วไม่มี layout แตกใน viewport 1280×720 ที่ใช้
- `/admin/account-access`: แสดงว่ายังไม่เปิดอ่านข้อมูลจริง/รับรองสิทธิ์ และไม่มีรายชื่อสมมติปะปนแทนข้อมูลจริง
- `/dev/account-access/directory`: แสดง 404 ใน production mode ตามที่กำหนด
- HTTP checks 5 คำขอบน snapshot: GET/POST central, GET account-access, POST restore, GET bookings คืน 503 / FEATURE_DISABLED และ Cache-Control: no-store ทั้งหมด ไม่มีการทำรายการบน Supabase

เป็นการตรวจหน้าจอและจุดปิดการใช้งานเท่านั้น **ไม่ใช่** happy-path Login/Admin, สร้าง/ลบพนักงาน, Lead/Booking end-to-end, RLS, regression หลังล็อกอินของฝ่ายอื่น หรือ mobile acceptance ผลเหล่านี้ยังต้องทดสอบต่อก่อนเปิดจริง

ปิดเซิร์ฟเวอร์ snapshot แล้ว ยืนยัน `serve-report.json` มี stopped=true และพอร์ตไม่ตอบสนอง ไม่หยุด dev server ของผู้ใช้ ในเครื่องมือรอบนี้ stdin ของ exec ถูกปิด จึงส่งคำสั่ง stop ไม่ได้: ตรวจ PID/คำสั่ง/เวลาเริ่มให้ตรงกับ report แล้วหยุดเฉพาะ owned Next PID ผ่าน Windows; ไม่หยุด node ทั้งหมด ครั้งถัดไปใช้ session ที่คง stdin ไว้ (เช่น tty) หากต้องการหยุดก่อนครบ auto-stop 10 นาที

### ผลตรวจ GitHub/Vercel แบบอ่านอย่างเดียว — 28 กันยายน 2569

- อ่าน Git local: branch `main`, origin `github.com/ailinconstruction789-source/buildtrack-mvp.git`
- เชื่อม Chrome กลับได้แล้ว อ่านหน้า Overview ของทั้ง 4 โปรเจกต์ โดยไม่แก้การตั้งค่าหรือเปิดค่า environment/credentials
- ทุกโปรเจกต์ด้านล่างแสดง Repository เป็น `ailinconstruction789-source/buildtrack-mvp`

| โปรเจกต์ | หลักฐานสถานะ Production | หลักฐานสาขา |
| --- | --- | --- |
| `buildtrack-mvp-79c5` (เว็บหลักที่ผู้ใช้ระบุ) | Ready, commit `c004d82`, 22 ก.ย. | Source `main` และข้อความให้ push ไป `main` เพื่ออัปเดต Production |
| `buildtrack-mvp-w2a8` | Ready, commit `c004d82`, 22 ก.ย. | Source `main` และข้อความให้ push ไป `main` เพื่ออัปเดต Production |
| `buildtrack-mvp-ifre` | No Production Deployment; รายการ 22 ก.ย. Error; หน้าแจ้งว่า Production domain ไม่ให้บริการ | ยังไม่ยืนยันการตั้งค่าสาขา: หน้า Environments ไม่แสดงรายการที่อ่านได้ |
| `buildtrack-mvp` | No Production Deployment; รายการ 22 ก.ย. Error; หน้าแจ้งว่า Production domain ไม่ให้บริการ | ยังไม่ยืนยันการตั้งค่าสาขา; ค่า main ในลิงก์ Open in ไม่ใช้แทนหลักฐาน branch setting |

- ผลกระทบที่ยืนยันได้: การ push `main` อาจอัปเดตทั้งเว็บหลัก `79c5` และ `w2a8` ไม่ใช่เพียงเว็บเดียว ยังไม่ได้ตรวจ build-skip/auto-deploy overrides และไม่รับรองว่าทั้ง 4 จะ deploy สำเร็จหรือใช้ฐานข้อมูลเดียวกัน
- ผู้ใช้ยืนยันต่อมาว่า **ใช้งานเฉพาะ `79c5`; `w2a8` ไม่ได้ใช้แล้ว** จึงกำหนดเว็บหลักนี้เป็นเป้าหมายเปิดใช้ ไม่ disconnect/delete/pause โปรเจกต์เก่าโดยอนุมานเอง การ push main ยังอาจทำให้โปรเจกต์เก่า build ตามได้
- อ่านหน้า Environment Variables ของ `79c5` (All Types / All Environments / All Variables): Project แสดงเพียงชื่อ `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `GEMINI_API_KEY` สำหรับ Production and Preview; Shared แสดง No shared variables linked ไม่เปิดดู/คัดลอกค่า secrets
- ไม่พบ account/Sales flags ในรายการที่แสดง จึงยังไม่มีหลักฐานว่าเปิด guarded client ใน Vercel แล้ว ไม่อนุมานค่า secret หรือฐานที่เชื่อมจากชื่อ environment variable และไม่ถือว่าตรวจทุกแหล่ง override/config ครบ
- ยังไม่ได้ deploy matching Admin client ขึ้นเว็บจริง ผล build/smoke ในเครื่องด้านบนไม่ใช่ผลยอมรับบน Production
- ไม่มี commit/push/deploy/แก้การตั้งค่า Vercel หรือรัน SQL จริงจากการตรวจรอบนี้

### ขอบเขตการเปิดใช้รอบบัญชี (ไม่ใช่เปิด Sales ทั้งชุด)

- ก่อน cutover ต้องพักงานเพิ่ม/ลบ/เปลี่ยนชื่อ/PIN ของบัญชี และให้ Admin ปิด/รีโหลดแท็บเก่า; ไม่กำหนดปิดงานก่อสร้างของฝ่ายอื่นทั้งหมดโดยอัตโนมัติ
- กำหนดเฉพาะเว็บหลัก `79c5` ให้ build matching client ด้วย `NEXT_PUBLIC_ACCOUNT_GUARDED_COMMANDS_ENABLED=true` ในช่วงที่ตกลงแล้ว ก่อนติดตั้ง SQL; ระหว่างยังไม่มี capability RPC การสร้าง/ลบต้องหยุดโดยไม่ย้อนเรียก legacy writer
- คง `NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED`, `ACCOUNT_ACCESS_READ_ENABLED`, `ACCOUNT_ACCESS_RESTORE_ENABLED` และ Sales/Cron flags ปิดไว้ในชุดนี้ ห้ามเปิดตามชื่อ feature ที่มีใน source โดยไม่มีฐาน/สิทธิ์พร้อม
- ตรวจ source แล้ว: login directory ใช้ select username จากตารางเดิม ไม่ต้องมี RPC ใหม่ในโหมดนี้; trusted-session hook ไม่ติดตั้ง listeners/เรียก RPC เมื่อ flag ปิด; Sales workspace/report entry ยังคงเลือก legacy เมื่อ server workspace flag ไม่ได้เปิด
- ข้อข้างต้นเป็น code review ไม่ใช่การรับรองว่า Auth/PostgREST หรือ client ฝ่ายอื่นบนฐานจริงผ่าน acceptance แล้ว

## ชุด Admin เฉพาะส่วน — แยกหลังยืนยันช่วงพักงานบัญชี

ผู้ใช้แจ้งว่ายังไม่มีใครทำงานเพิ่ม/ลบ/เปลี่ยนชื่อ/PIN ในขณะนั้น ไม่ใช่การรับรองว่าจะไม่มีการทำงานตลอดวัน ต้องประสานอีกครั้งหาก cutover เกิดคนละช่วงเวลา

เตรียม managed worktree `C:/Users/HUAWEI/.codex/worktrees/account-guard-release/buildtrack-mvp-main` จาก commit `c004d829424a8246d82e389d48ed6de6ff77ba53` (ตรงกับ Production และผลอ่าน remote main วันที่ 28 ก.ย.) โดยไม่คัดลอกหรือเขียนทับงานค้างในโฟลเดอร์หลัก

นี่เป็น **candidate อีกชุดหนึ่ง** ไม่ใช่ snapshot ทั้ง source `app-4K9aUh` ข้างต้น มี diff เฉพาะ 3 ไฟล์:

1. `app/page.tsx`: เพิ่ม import helper และแยกเส้นทาง guarded/legacy เฉพาะเพิ่มกับลบบัญชี
2. `lib/auth/accountCommands.ts`: helper เดิมที่ตรวจ contract/atomicForeman ก่อน mutation ครั้งเดียว ไม่มี retry/fallback หรือเขียน foremen จาก browser ในเส้นทาง guarded
3. `lib/auth/accountCommands.test.ts`: ทดสอบ helper 8 ข้อ

ไม่มีการเปลี่ยน Login, data hook, Admin layout, หน้า Lead/Sales, dependencies, next.config หรือ schema ใน candidate นี้ ต่างจากแนวทางส่ง full dirty source ที่วิเคราะห์ไว้ช่วงแรก การแก้ app/page แบบบางส่วนจึงหลีกเลี่ยง dependency ของ Sales/trusted-session ได้โดยไม่ลบงานเหล่านั้นจากโฟลเดอร์เดิม

เครื่องมือ `scripts/release-check/check.mjs --source <absolute-worktree-path>` รองรับตรวจ candidate จาก worktree ใน repository เดียวกันแล้ว โดยตรวจ git common directory ก่อนคัดลอก และยังวาง build/log บน D: ใช้ dependency เดิม, synthetic Supabase และ offline fonts ไม่คัดลอก `.env` การตรวจครั้งแรกติด ownership ของ Git จึงรันด้วยสิทธิ์เจ้าของสำเนา ไม่เพิ่ม global safe.directory หรือเปลี่ยน Git security configuration

- boundary tests ของเครื่องมือตรวจผ่าน 4/4 และ ESLint ผ่าน
- snapshot candidate `app-Uw3rK6`: unit tests helper + LoginView เดิม + data hook เดิม ผ่าน **20/20 จาก 3 ไฟล์** (8+12) ไม่มี mutation บนฐานจริง
- สถานะ build และขั้นตอนเผยแพร่ต้องอ้างผลบันทึกท้ายเอกสาร ไม่อนุมานจากผล full-source snapshot เดิม

### ผล candidate และรุ่นที่เตรียมเผยแพร่

- `app-Uw3rK6/release-report.json`: passed; typegen/typecheck/build exit 0; 292 source/assets; static pages 13/13; sourceFilesUnchanged=true และตรวจ hash ซ้ำแล้วไม่พบ source เปลี่ยน; productionChanged=false, deployed=false
- ยังคงเป็น low-memory Webpack/offline-font profile ใช้ dependencies ในเครื่อง ไม่ใช่ clean install/default Vercel build หรือ Supabase Auth/PostgREST acceptance
- commit เฉพาะ 3 ไฟล์แล้วในเครื่อง: `9df9608` บน `codex/account-guard-release` ใน managed worktree ไม่ commit งานค้างอื่นในโฟลเดอร์หลัก และยังไม่ push สาขานี้หรือ main
- ก่อนเผยแพร่ ต้องยืนยันชุด `9df9608` + การตั้ง guarded flag เฉพาะ Production ของ `79c5` และช่วงพักงานบัญชี; ห้ามอ้างการอนุญาต SQL เป็นสิทธิ์ส่งโค้ดทุกไฟล์
- หลัง push หากมีการทำจริงในรอบต่อไป ห้าม git pull/reset ทับ dirty main เดิมเพื่อให้เลขรุ่นตรงกันโดยอัตโนมัติ ต้องรักษางานค้างและประสานการรวมฐานภายหลัง

### เริ่มเผยแพร่จริง — 28 กันยายน 2569

หลังแสดงขอบเขต commit 3 ไฟล์และขออนุมัติส่ง main พร้อมเปิดสวิตช์เฉพาะ `79c5` ผู้ใช้ตอบ “ทำต่อเลย”:

- สร้าง Config environment variable `NEXT_PUBLIC_ACCOUNT_GUARDED_COMMANDS_ENABLED=true` **เฉพาะ Production ของ buildtrack-mvp-79c5** ผ่าน Vercel UI; เห็นข้อความ Added Environment Variable successfully พร้อมรายการ Production ไม่แก้ Preview/Shared หรือ keys เดิม
- ตรวจ remote main ก่อนส่งยังเป็น `c004d82` แล้ว push แบบ non-force เฉพาะ commit `9df960815c1977c4b6a123484575dc98dbd8b16d` ไป `refs/heads/main` สำเร็จ ไม่ push งานค้างอื่น ไม่เปลี่ยน branch/ไฟล์ต้นฉบับใน D:
- Vercel deployment ยังต้องตรวจผลให้สำเร็จและตรวจ compiled client บนเว็บจริงก่อนถือว่าพร้อม SQL ไม่ถือว่าการ push สำเร็จเท่ากับ Production พร้อม
- ยังไม่มี SQL mutation หรือการเปิด Lead/trusted-auth/notifications ในขั้นเผยแพร่ client นี้ ระหว่าง SQL ยังไม่พร้อม client guarded ต้องหยุด create/delete หลัง capability check

### ผลเผยแพร่ client สำเร็จ

- ยืนยัน GitHub `refs/heads/main` เป็น `9df960815c1977c4b6a123484575dc98dbd8b16d` หลัง push
- Vercel deployment `Ed7Jp9CntFE9Z8azbnSAvkK9GCdB` แสดง **Ready / Production / Latest**, Source main `9df9608`, ระยะเวลา build 48 วินาที วันที่ 28 ก.ย. 2569 และ Domains มี `buildtrack-mvp-79c5.vercel.app`
- Deployment URL: `https://vercel.com/ailinconstruction789-s-projects/buildtrack-mvp-79c5/Ed7Jp9CntFE9Z8azbnSAvkK9GCdB`
- อ่านหน้าเว็บจริงได้ HTTP 200; ตรวจ public script 12 ไฟล์ พบ guarded contract ใน `/_next/static/chunks/0nd260rzz122m.js` พร้อม capability/atomicForeman check และข้อความยังไม่พร้อม
- ตรวจเนื้อหา compiled handler เพิ่ม/ลบแล้วเรียก guarded helper โดยตรง ไม่ใช่เพียงมี string contract ที่ไม่ถูกเรียก; helper ตรวจ contract ก่อน mutation หนึ่งครั้ง และ throw เมื่อ capability ไม่ตรง
- เปิดหน้าเว็บจริงใน Chrome เห็นหน้า Login และ dropdown โหลด option 19 รายการ (รวม placeholder) โดยไม่ส่งชื่อ/PIN ไม่ลองเพิ่ม/ลบบัญชี และไม่ทำ mutation ทดสอบ
- **ข้อจำกัด:** ยังไม่ผ่าน happy-path Admin/Auth/PostgREST หลังติดตั้ง guard; SQL ยังไม่ได้ติดตั้ง ดังนั้นต้องคงพักงานบัญชีและให้ Admin รีโหลดแท็บเก่าก่อน cutover ไม่ถือว่า Lead เปิดแล้วหรือระบบบัญชีขั้นใหม่พร้อมใช้งานครบ
- โฟลเดอร์หลัก D: ยังคงงานค้างเดิมและ local main เดิมไว้ ไม่ pull/reset เพื่อทับให้ตรงกับ remote

### SQL ฝั่งบัญชีติดตั้งแล้ว — 28 กันยายน 2569

- หลังผู้ใช้แสดง Backup และตรวจ Admin binding ซ้ำ ติดตั้ง `account_guard_reviewed_cutover` สำเร็จบนโปรเจกต์ที่อนุมัติ remote version `20260928061913`; รายละเอียดและขอบเขตตรวจอยู่ท้าย `docs/account-security-shared-command-preparation.md`
- Capability contract ตรงกับ client `9df9608`; read-only role probes และ ACL checks ผ่าน จำนวน users/auth.users/foremen/projects/plots ไม่เปลี่ยน แต่ยังไม่ได้ทดสอบผ่านการล็อกอิน Admin และ Auth/PostgREST จริง
- ข้อความ “SQL ยังไม่ได้ติดตั้ง” ด้านบนเป็นประวัติก่อนขั้นนี้ ให้คงพักงานจัดการบัญชีจนผู้ใช้รีโหลด/ล็อกอิน Admin ใหม่และตรวจรับ ส่วน Lead/Sales/trusted-auth/notifications ยังไม่เปิด
- Source candidate timestamp ต่างจาก remote migration timestamp ที่ MCP สร้าง ต้อง reconcile ก่อน CLI migration workflow ห้าม replay/db push อัตโนมัติ; ไม่แก้หรือลบประวัติ remote เพื่อให้เลขตรงกัน

### ผล Admin UI create/delete acceptance — 28 กันยายน 2569

- ผู้ใช้ล็อกอิน Admin ใหม่เอง เห็นหน้า MANAGE USERS และบัญชีเดิม 18 รายการ จากนั้นอนุมัติสร้าง `BT_GUARD_TEST_20260928` บทบาท Foreman และยืนยันการลบแยกอีกครั้ง
- สร้างและลบผ่านปุ่มบนเว็บ Production จริง ตรวจข้อมูล read-only หลังแต่ละคำสั่ง: สร้างครบ public.users/auth.users/foremen อย่างละ 1 แล้วลบไม่เหลือทั้งสามส่วน; counts กลับ 18/18/4, projects 8, plots 306 และ reviewed Admin 1
- Create/delete happy path ผ่านแล้ว ไม่เหลือบัญชีทดสอบ ไม่ใช่การรับรอง rename/PIN, non-Admin live acceptance หรือระบบฝ่ายขายทั้งหมด ยังไม่เปิด Lead และไม่มี release เพิ่มในขั้นนี้

### Candidate ถัดไป: หน้าเลือกชื่อก่อนล็อกอิน — ยังไม่เผยแพร่

**อัปเดตหลังผู้ใช้อนุมัติ:** เผยแพร่เฉพาะ 9 ไฟล์เป็น `f404377c4e5cef2088de1f4d1805164967608539` แล้ว ตรวจ GitHub status ของ `Vercel – buildtrack-mvp-79c5` เป็น success และเว็บหลัก HTTP 200 พร้อม public bundle ของ reader username-only รุ่นใหม่ รายละเอียดใน `account-login-directory-release.md` ไม่มี SQL/เปลี่ยน flag เพิ่ม ยังรอผู้ใช้ตรวจล็อกอินใหม่และโหลดข้อมูลพนักงานจริง ข้อความด้านล่างเป็นประวัติการเตรียมก่อนเผยแพร่

เตรียมชุด 9 ไฟล์ต่อจาก 9df9608 ใน release worktree เดิมแล้ว รายละเอียดอยู่ใน `docs/account-login-directory-release.md` ไม่คัดลอก dirty main ทั้งชุด ไม่แก้วิธีตรวจ PIN หรือเปิด trusted-auth

- Snapshot `app-pnhOdo`: typegen/typecheck/build ผ่าน, 296 source/assets, 13 static pages, sourceFilesUnchanged=true เมื่อ build จบ
- ทดสอบสุดท้าย 58/58 ผ่านจาก 5 ไฟล์ รวมเพิ่ม role regression 9 บทบาท ตรวจ source runtime ตรง candidate; แก้เฉพาะ test fixture หลัง build ไม่มี app/runtime/config เปลี่ยน
- Scoped ESLint และ candidate diff check ผ่าน ยังไม่มี commit/push/deploy/SQL ในขั้นนี้ ต้องยืนยันขอบเขตเผยแพร่และตรวจเว็บจริงก่อนเปลี่ยนสิทธิ์อ่าน directory ในฐาน
