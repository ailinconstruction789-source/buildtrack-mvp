# QC Inspection Plan Progress (บันทึกสถานะการพัฒนาระบบแผนตรวจ QC)

เอกสารนี้ใช้สำหรับติดตามสถานะการพัฒนาตามกติกาของ BuildTrack ทีละเฟส โดยต่อยอดจากระบบตรวจงานเดิม ไม่สร้างคิวซ้ำซ้อน และรักษาความเข้ากันได้ 100%

---

## 1. ข้อมูลภาพรวม (Overview)
- **ระบบเป้าหมาย:** ระบบแผนตรวจ QC ประจำวัน (QC Daily Inspection Plan), ระบบคะแนนถ่วงน้ำหนัก (Weighted Scoring), ระบบการลาพร้อมการมอบหมายผู้ตรวจแทน (QC Leave & Stand-in Inspector Management), และแดชบอร์ดตรวจสอบภาระงานระดับบริหาร (Executive Audit Dashboard & Calendar)
- **หลักการสำคัญ:**
  1. งานที่ Site Engineer (SE) ส่งตรวจในวัน $T$ ก่อน Cut-off (17:00 น. Asia/Bangkok) จะถูกจัดเป็นแผนตรวจประจำวันของ QC ในวันทำงานถัดไป (ข้ามวันอาทิตย์)
  2. ใช้ระบบแต้มถ่วงน้ำหนัก (Weighted Score): งานโครงสร้าง/Hold Point (3–5 แต้ม), งานสถาปัตย์/ระบบ (2–3 แต้ม), งานเก็บกวาด/ย่อย (1 แต้ม)
  3. บันทึก Snapshot แต้มและขอบเขตงานอย่างถาวร (Immutable Snapshot) เมื่อกดยืนยันแผน (Confirm Plan) เพื่อไม่ให้การแก้แม่แบบในอนาคตเปลี่ยนคะแนนย้อนหลัง
  4. การลาของ QC: ลาล่วงหน้า/ลาฉุกเฉิน, เต็มวัน/บางช่วงเวลา, **ห้ามอนุมัติการลาของตนเองอย่างเด็ดขาด (Self-approval is forbidden)**
  5. การมอบหมายผู้ตรวจแทน (Stand-in Inspector):
     - บันทึกประวัติการส่งต่อ (Audit Trail) ครบถ้วน (ผู้ตรวจเดิม, ผู้รับช่วง, ผู้มอบหมาย, เหตุผล, เวลาเริ่มรับผิดชอบ, ขอบเขตที่ทำแล้วและที่เหลือ)
     - **ป้องกัน Conflict of Interest:** ห้าม Site Engineer ผู้ส่งตรวจงานเป็นผู้ตรวจแทนงานที่ตนเองส่งตรวจ
     - ตรวจสอบว่าผู้ตรวจแทนไม่อยู่ในช่วงลา และแจ้งเตือนหากภาระงานจะ Overload (> 12 แต้ม)
  6. เครดิตผลงาน: มอบให้ผู้ตรวจจริงตามขอบเขตงาน ผู้ตรวจเดิมยังคงมีเครดิตในส่วนที่ตรวจเสร็จแล้ว และไม่คิดแต้มซ้ำซ้อน หากตรวจไม่ผ่าน (Reject) ยังคงได้แต้มผลงานเต็มเพราะตรวจจริง
  7. การยกเลิกลา: จะไม่ย้อนการโอนงานกลับเองโดยอัตโนมัติ ต้องให้ผู้จัดแผนเป็นผู้ตัดสินใจ
  8. ไม่แตะงานและไม่นำข้อมูลจาก Admin Demo Project มาคิดคำนวณ KPI จริง

---

## 2. แผนการพัฒนาทีละเฟส (Phased Roadmap)

| เฟส | ขอบเขตการทำงาน | สถานะ |
| :--- | :--- | :--- |
| **Phase 1** | โครงสร้างตาราง DB, Service คำนวณแต้มถ่วงน้ำหนัก & จัดแผนวันถัดไป, จัดการสิทธิ์, Snapshot น้ำหนัก, UI สไลด์ด้านขวา & หน้าจอตั้งค่าน้ำหนักแม่แบบ | ✅ เสร็จสมบูรณ์ |
| **Phase 2** | เชื่อมโยงระบบตรวจเดิม (ตรวจผ่าน, ตรวจซ้ำ, ติดปัญหาหน้างาน), Fast-Track Hold Point, บันทึกแต้มตามผลตรวจจริง | ✅ เสร็จสมบูรณ์ |
| **Phase 3** | ระบบการลา QC (เต็มวัน/ครึ่งวัน, ป้องกันอนุมัติตนเอง), ระบบตรวจสอบและโอนงานให้ผู้ตรวจแทน (Stand-in), ป้องกัน Self-Inspection, จัดการ Capacity | ✅ เสร็จสมบูรณ์ |
| **Phase 4** | แดชบอร์ดผู้บริหาร (QC Audit Calendar & Scorecards), สูตรคำนวณโปร่งใสแบบเปิดเผย, การจำแนกข้อมูลอดีต (Legacy Data), และ End-to-End Test Verification | ✅ เสร็จสมบูรณ์ |
| **Phase 5** | วิเคราะห์ภาระงานย้อนหลัง (จันทร์–เสาร์), หน้าต่างตั้งค่าเกณฑ์ภาระงานรายวัน (Admin Capacity Threshold Modal), และเชื่อมโยงคิวตรวจสดเข้าสู่ปฏิทินรายเดือน | ✅ เสร็จสมบูรณ์ |

---

## 3. รายละเอียดผลงาน Phase 4 (Executive Dashboard & E2E Verification)

### 3.1 ภาพรวมฟังก์ชัน Dashboard ระดับบริหาร
1. **[`components/qc/QCInspectionAuditCalendar.tsx`](file:///d:/buildtrack/buildtrack-mvp-main/components/qc/QCInspectionAuditCalendar.tsx):**
   - **ปฏิทินตรวจสอบแบบมีข้อความประกอบสี (Color + Text Indicators):**
     - เขียว: ตรวจครบตามแผน 100%
     - น้ำเงิน: ตรวจได้บางส่วน (เช่น 8/12 แต้ม) พร้อมบอกสาเหตุ
     - ม่วง: วันลาอนุมัติ (แยกสถานะไม่นำมาตัดคะแนน)
     - ส้ม: มีงานค้างตรวจ (Backlog)
     - แดง: งานค้างรอจัดผู้ตรวจแทน
     - เทา: วันหยุด / ไม่มีงานตามแผน
   - **กล่องเจาะลึกรายวัน (Drill-Down Modal):** กดที่วันใดๆ เพื่อดูสรุปแต้ม, รายชื่อผู้ตรวจ, ประวัติโอนงาน, งานแทรก, และรายการงานที่ตรวจทั้งหมด
   - **ตัวกรองระดับบริหาร:** เลือกเดือน/ปี (พ.ศ.), กรองตามผู้ตรวจ QC รายบุคคล, กรองตามโครงการก่อสร้าง
   - **คะแนนความโปร่งใส 6 ด้าน:**
     1. อัตราปิดงานตามแผน (Clearance Rate)
     2. การเคลียร์ Hold Point ตรงเวลา (Hold Point On-Time)
     3. ภาระงานเกินเกณฑ์สะสม (Overload Days)
     4. ความสมบูรณ์ของการส่งมอบงาน SE (SE Handoff Integrity)
     5. งานตรวจแทนและแบ่งเบาภาระ (Stand-in Contribution)
     6. สถานะวันลาอนุมัติ (Approved Leave Days)

2. **สูตรคำนวณที่โปร่งใสและตรวจสอบได้ (Transparent Formula Modals):**
   - [`lib/qc/qcAuditAnalyticsService.ts`](file:///d:/buildtrack/buildtrack-mvp-main/lib/qc/qcAuditAnalyticsService.ts) ให้บริการสูตรคำนวณที่อธิบาย:
     - ตัวตั้ง (Numerator)
     - ตัวหาร (Denominator)
     - ข้อยกเว้นที่เป็นธรรม (Exclusions: วันลาอนุมัติ, วันหยุด, งานที่เลื่อนโดยผู้จัดแผน)
     - หลักความยุติธรรม (Fairness Note: งานไม่ผ่าน QC ยังได้แต้ม, งานส่งหลัง 17:00 ไม่คิดเป็นงานค้างของ QC)

3. **การจัดกลุ่มชื่องานในการตั้งค่าน้ำหนัก (Group by Task Name):**
   - ใน [`components/qc/QCTaskWeightConfigModal.tsx`](file:///d:/buildtrack/buildtrack-mvp-main/components/qc/QCTaskWeightConfigModal.tsx) ได้ปรับรวมชื่องานที่ซ้ำกัน (ซึ่งเดิมแยกตามแต่ละแบบบ้าน `house_type_id`) ให้แสดงเหลือเพียง 1 บรรทัดต่อ 1 ชื่องาน
   - พร้อมแสดงแบดจ์ `ใช้งานใน N แบบบ้าน` และบันทึกค่าน้ำหนักแต้ม/Hold Point ไปยังทุกแบบบ้านพร้อมกันในครั้งเดียวผ่าน `saveQCTaskWeightsBatch`

4. **การแยกข้อมูลอดีตอย่างชัดเจน (Legacy Data Transparency Banner):**
   - ใน [`components/QCPerformanceDashboard.tsx`](file:///d:/buildtrack/buildtrack-mvp-main/components/QCPerformanceDashboard.tsx) เพิ่มกล่องแจ้งเตือนข้อมูลย้อนหลัง:
     - ข้อมูลงานตรวจก่อนติดตั้งระบบจะไม่มี Snapshot แต้มถ่วงน้ำหนัก จึงไม่นำมาคำนวณปนเปื้อน
     - ไม่เดาแต้มย้อนหลังสำหรับงานเก่าที่ไม่มีข้อมูลบันทึก

---

## 4. ฐานข้อมูล & Unified Migration File

เพื่อป้องกันปัญหาข้อผิดพลาด Dependency ระหว่างตาราง (`relation does not exist` หรือ foreign key mismatch) ได้รวมเป็นไฟล์ Migration เดียวที่สมบูรณ์และ Idempotent:

- **ไฟล์หลัก:** [`supabase/migrations/20261121_combined_qc_inspection_plan_full_migration.sql`](file:///d:/buildtrack/buildtrack-mvp-main/supabase/migrations/20261121_combined_qc_inspection_plan_full_migration.sql)
  (และสำเนาที่ root: [`20261121_combined_qc_inspection_plan_full_migration.sql`](file:///d:/buildtrack/buildtrack-mvp-main/20261121_combined_qc_inspection_plan_full_migration.sql))

**โครงสร้างตารางที่สร้าง/ขยาย:**
1. `qc_task_weights`: กำหนดค่าน้ำหนักแม่แบบ (1-5 แต้ม) และธง Hold Point
2. `qc_daily_inspection_plans`: หัวแผนตรวจประจำวันของแต่ละ QC และโครงการ
3. `qc_daily_plan_items`: รายการงานตรวจรายวัน พร้อม Snapshot น้ำหนัก, สถานะตรวจ, แต้มที่ได้จริง, และประวัติการเลื่อน/แทรก
4. `qc_leave_requests`: ทะเบียนการลาของ QC พร้อม Constraint ห้ามอนุมัติลาตนเอง
5. `qc_stand_in_handovers`: บันทึกประวัติการส่งต่องานตรวจแทนพร้อมขอบเขตงาน
6. `qc_plan_deferral_logs`: บันทึกการเลื่อนแผนงานพร้อมเหตุผลและผู้อนุมัติ

---

## 5. ผลการทดสอบทั้งระบบ (End-to-End Verification Results)

การทดสอบครอบคลุม 8 สถานการณ์จริง และชุดการทดสอบทั้งระบบ:

1. **Scenario 1 (Normal Handoff):** SE ส่งตรวจก่อน 17:00 น. → ผู้จัดแผนยืนยันแผน → QC ตรวจผ่าน → ได้แต้มครบเต็มจำนวน ✅
2. **Scenario 2 (Thorough Inspection & Reject):** SE ส่งตรวจ → QC เข้าตรวจละเอียดแล้วกด Reject → QC ยังคงได้แต้มเต็มเพราะปฏิบัติงานจริง → ส่งคิวเข้าสู่รอบตรวจซ้ำ ✅
3. **Scenario 3 (Site Unready / Cannot Inspect):** หน้างานติดปัญหา (ประตูถูกล็อค/ช่างไม่อยู่) → ตรวจไม่ได้ → ได้รับ 0 แต้มพร้อมบันทึกสาเหตุชัดเจนโดยไม่ตัดคะแนนความประพฤติ ✅
4. **Scenario 4 (Urgent Injection & Workload Balance):** งานด่วน 4 แต้มแทรกเข้ามา → เลื่อนงานเดิม 4 แต้มไปวันถัดไป → ระบบบันทึกอัตราส่วน 12 แผนเดิม / 8 ตรวจเสร็จ / 4 เลื่อนอย่างถูกต้อง ✅
5. **Scenario 5 (Leave & Stand-in Handoff):** QC ลาพักร้อน → อนุมัติการลา → ผู้จัดแผนโอนงานให้ผู้ตรวจแทน → ผู้ตรวจแทนตรวจผ่านและได้แต้มผลงาน ✅
6. **Scenario 6 (Conflict of Interest Prevention):** SE ผู้ส่งตรวจงานนั้น ถูกเสนอชื่อเป็นผู้ตรวจแทน → ระบบปฏิเสธทันทีเพื่อป้องกันการตรวจรับงานตนเอง ✅
7. **Scenario 7 (Executive Monthly Rollup):** สรุปผลงานรายเดือน, อัตราปิดงาน, Hold Point ตรงเวลา, วันลา, และตัวอธิบายสูตรคำนวณ ✅
8. **Scenario 8 (Demo Project Exclusion):** ข้อมูลของ 'Admin Demo Project' ถูกตัดออกจากการประเมินผล KPI ทั้งหมดโดยสิ้นเชิง ✅

### สรุปผลรัน Vitest:
- `lib/__tests__/qcCapacitySettingService.test.ts`: **3/3 ผ่าน 100%**
- `components/qc/__tests__/QCCapacityThresholdModal.test.tsx`: **4/4 ผ่าน 100%**
- `lib/__tests__/qcEndToEndFlow.test.ts`: **8/8 ผ่าน 100%**
- `lib/__tests__/qcLeaveAndStandInService.test.ts`: **13/13 ผ่าน 100%**
- `lib/__tests__/qcInspectionPlanService.test.ts`: **21/21 ผ่าน 100%**
- `lib/__tests__/qcInspectionPlan.test.ts`: **12/12 ผ่าน 100%**
- `components/qc/__tests__/QCDailyInspectionPlanSlideOver.test.tsx`: **9/9 ผ่าน 100%**
- **รวมทั้งหมด: 70 การทดสอบ ผ่าน 100% (0 Failed)**
- **Type Check: `npx tsc --noEmit` ผ่าน 0 Errors**

---

## 6. แนวทางการเริ่มใช้งานจริง (Operational Rollout Guidelines)

1. **การติดตั้ง SQL Migration:**
   - รันไฟล์ [`supabase/migrations/20261121_combined_qc_inspection_plan_full_migration.sql`](file:///d:/buildtrack/buildtrack-mvp-main/supabase/migrations/20261121_combined_qc_inspection_plan_full_migration.sql) ใน Supabase Dashboard SQL Editor
   - ตัวสคริปต์ปลอดภัย (Idempotent) สามารถรันซ้ำได้โดยไม่ลบข้อมูลเก่า

2. **ช่วงทดลองใช้แบบ Pilot Run (แนะนำ 2-4 สัปดาห์):**
   - กำหนดเกณฑ์ภาระงานมาตรฐานที่ 10–12 แต้มต่อวันต่อคน
   - Cut-off เวลาส่งงาน 17:00 น. สำหรับการจัดแผนในวันทำงานถัดไป
   - ใช้ Dashboard และ Audit Calendar เพื่อเรียนรู้รอบการทำงานจริงของทีม QC และ SE ก่อนนำคะแนนไปใช้ประเมินผลงาน (KPI) ของบุคคล
