# Original User Request

## Initial Request — 2026-06-12T08:36:57Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Wait for teamwork_preview subagent to complete the task

ทำการตรวจสอบโค้ดและโครงสร้างของโปรเจกต์ BuildTrack MVP ในภาพรวมทั้งหมด โดยให้ตัวแทน (Agent) แต่ละตำแหน่งรีวิวระบบตามความรับผิดชอบของตนเอง และจัดทำเอกสารสรุปข้อเสนอแนะ (Report) ออกมาเพียงอย่างเดียวโดยยังไม่ต้องแก้โค้ด

Working directory: c:\Users\HUAWEI\Desktop\buildtrack
Integrity mode: development

## Requirements

### R1. Comprehensive Codebase Review
The team must conduct a thorough read-only review of the entire BuildTrack MVP codebase, assessing it from the perspectives of UX/UI, Frontend Engineering, Backend/Database Security, QA/Testing, and DevOps.

### R2. Consolidated Report Delivery
The team must produce a single, well-structured Markdown report (`code_review_report.md`) detailing their findings. The report must be organized by engineering discipline and highlight specific areas for improvement, missing features, or security risks.

### R3. No Source Code Modifications
The team must ONLY analyze the code and write the report. They must NOT modify, delete, or create any project source code files during this process.

## Acceptance Criteria

### Report Completeness
- [ ] A file named `code_review_report.md` is successfully created.
- [ ] The report contains distinct sections for all 5 domains: UX/UI, Frontend, Backend/Database, QA, and DevOps.
- [ ] The findings reference actual files, components, or database schemas existing in the project, rather than providing generic advice.

### Non-destructive Verification
- [ ] No changes have been made to any `.tsx`, `.ts`, `.js`, `.css`, or `.sql` files within the working directory.
