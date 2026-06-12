# Project: BuildTrack MVP Code Review

## Architecture
- Project is a Next.js (App Router) application.
- Frontend components: app layout, UI views (Dashboard, House Detail, Map Visualizer, Task Progress, Owner Analytics, Login).
- Backend: Supabase integration, Postgres DB schemas, migrations, security policies.
- QA: Vitest unit/component tests, Playwright E2E tests.
- DevOps: Package configuration, Next.js build, environment variables.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Codebase Domain Exploration | Read-only analysis of UX/UI, Frontend, Backend, QA, and DevOps aspects | None | DONE |
| 2 | Consolidation & Report Generation | Aggregating explorer findings into code_review_report.md at workspace root | M1 | DONE |
| 3 | Review & Integrity Audit | Verifying review completeness, correctness, and that no source files were modified | M2 | DONE |

## Interface Contracts
- No source code modifications allowed. Communication between agents must happen through .agents/ subdirectories.
- Explorer reports: Written to their respective working directories in .agents/explorer_<domain>/.
- Worker report: Generates c:\Users\HUAWEI\Desktop\buildtrack\code_review_report.md containing all five domains.
