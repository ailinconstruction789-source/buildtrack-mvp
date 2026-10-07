# Central booking project map restoration — 2026-09-29

## Scope

Restore a read-only project map using the existing saved project layout. Show current central booking occupancy, the current customer, and all linked booking/cancellation history. Keep booking entry in the existing central workflow. No legacy customer form, direct sale writes, survey, SOP/house preparation, notifications, KPI, or post-booking workflow is enabled.

Production baseline: `7ae9052ea392e7d683e87ecf5b7e829f291deaeb` on 79c5. Use the existing `account-guard-release` worktree; do not publish the dirty main workspace. Main contains unrelated deferred work.

## Entries and behavior

- Central Lead page: “ผังแปลงทุกโครงการ” → `/sales-crm/projects/map`.
- Project workspace: switch between “ผังโครงการ (Project Map)” and booking/history list.
- Prior general Sales workspace opens map mode; explicit booked/transferred entries retain list mode.
- Project chooser has no implicit default project.
- Map colors: available, booked/in progress, transferred/handover, needs review.
- Construction completion is a separate badge, never a transfer event.
- Cancelled bookings remain in history but do not occupy the plot.
- Unmatched IDs, duplicate active bookings, unknown occupancy, or conflicting plot/sale flags are not painted vacant.
- Missing stored layouts show an unmapped-plot list, never invented geometry.
- Refresh/project changes remove stale details; failed reads do not fall back to old customers.

## Read boundary

New GET-only `/api/sales-crm/project-map?projectName=...` shares the existing project reader authentication and capabilities checks. It verifies the caller through `getUser`, the trusted CRM role, activation/capability flags and project scope. All downstream calls use the caller JWT and the existing public client key, never a service key.

Booking history comes from all pages of `crm_v2_project_sales` with tab `all`, empty search, validated page sequence, actor, project and unique sale IDs. Limit: 100 pages, fail closed if exceeded. Plot reads request an exact count and fail if the server truncates results (up to 2,000 plots); original geometry uses explicit `projects.name/layout_data` only. Output fields are explicitly projected. Responses are `no-store`, vary by Authorization, and sanitize failures. No new grants, RLS changes, migration, data import, customer edits or Supabase writes are required/performed for this update.

Existing broad legacy `projects`/`plots` policies were observed during the read audit; this update neither changes nor broadens them, and does not claim to remediate that pre-existing issue. The new endpoint independently checks the existing trusted CRM authorization before reading either table.

## Saved-layout read audit

Aggregate/read-only checks of the existing production data found:

- Seven projects with saved maps; 306 plots across the project registry.
- Every saved plot reference exactly matches its canonical plot ID within its project (zero unmatched); no fuzzy name/phone matching.
- Zero coordinates outside saved grid bounds, zero unknown/null required plot metadata in the checked set.
- 155 coordinates have legitimate overlay layers (fences/infrastructure over plots/roads). The parser explicitly preserves those layers. Zero conflicting base layers, duplicate same-layer cells, or unsupported terrain types.
- Terrain types: plot, road, park, horizontal/vertical fence, horizontal infrastructure; vertical infrastructure is also supported.

No individual customer records were needed for this geometry audit.

## Verification checkpoint

- First selected snapshot `app-FhZs2u`: type generation, TypeScript and production build passed. Selected regression suite: 600 tests / 29 files passed after pointing the existing baseline test at the actual release source, not the intentionally modified low-memory build configuration.
- A subsequent real-layout check identified legitimate stacked terrain. Layer handling and tests were then updated; the final release must use the subsequent snapshot, not `app-FhZs2u`.
- Follow-up focused tests: 25 passed (geometry/model, map UI, Sales entry).
- Interactive loopback fixture uses only synthetic customers/plots and a stubbed Supabase module; no credentials or real data. Verified the rendered map, counts, click-to-open customer details, unknown money/date display and central history link in the browser. Fixture files remain local and are not part of the production selection.
- Final snapshot/deployment/acceptance results are recorded below once verified.

## Final release result

- Final selected snapshot: `.next/release-check/app-L8EwRO/release-report.json`. Type generation, TypeScript and low-memory offline-font production build passed; all source files unchanged. All 18 selected source/test hashes matched the report before staging.
- Final regression suite: **604 tests / 30 files passed**, one worker, including the deployed baseline preservation tests, booking/central-reader regressions and map tests. Scoped lint and Git whitespace checks passed.
- Commit: `af9f71b0d401515b9ec35a83222e13236bcce784`, `feat: restore read-only project maps with central booking history`.
- Normal non-force push to main succeeded after confirming remote main still matched `7ae9052ea392e7d683e87ecf5b7e829f291deaeb`. Exactly 9 application files and 9 test/fixture files; no package/config, SQL, account/login, construction or other-department changes. Existing release worktree is clean.
- No Supabase writes/migrations, flags, secrets, or Vercel environment changes were performed. The existing central-booking feature flags also guard the new map route.
- Initial deployment succeeded on 79c5 at `2026-09-29T13:41:06Z` (deployment `BAFFNhkEn2Mj9QXcwiQpiYxiJZND`). Production map page returned 200; unauthenticated map/project-sales/bookings reads returned 401, while deferred lead-work remained disabled (503).
- Authenticated Chrome acceptance loaded the saved ไอลิน6 geometry and current booking/transfer colors. It also exposed two existing off-map walkway registry entries incorrectly included in the vacant legend, prompting the bounded follow-up below. No customer/booking mutation was used for acceptance.

## Off-map infrastructure follow-up

- Keep every registry row, but exclude off-map entries from the mapped-plot legend. Unplaced entries otherwise classified vacant now display needs-review, without a central booking action. Proven existing booking/transfer history is retained.
- Exactly four existing map/model/test files changed; no SQL/data/config changes.
- Selected snapshot `.next/release-check/app-KZJxtw/release-report.json`: type generation, TypeScript and production build passed, source files unchanged, all four file hashes verified against the report. Focused regression: 25 tests passed; scoped lint and whitespace checks passed.
- Full selected regression: **605 tests / 30 files passed** (one worker, 54.78 seconds).
- Follow-up commit `7499cdd638bc2ff0c33b3ece4d8b0f1e8e7ed857` was pushed normally to main after verifying remote main was still the initial map commit. Release checkout clean; unrelated dirty main-workspace changes remain preserved.
- Follow-up Vercel deployment `3hGHCM7Aj6bBqJuB12tqB7hWHfhi` confirmed **Ready / Production / Current**, source `7499cdd`, domain `buildtrack-mvp-79c5.vercel.app`, completion `2026-09-29T13:58:26Z`. GitHub status polling had lagged; the authenticated Vercel deployment page was the authoritative completion signal.
- Authenticated production reload confirmed ไอลิน6: 68 available, 8 booked/in progress, 4 transferred/handover, 0 mapped review plots. Both off-map walkways now show needs-review and are excluded from the legend. Original plot geometry remains displayed.
- Read-only click acceptance on the initial map deployment confirmed a booked plot opens its customer, owner, booking date, price and central booking-history links. No booking was submitted or changed. Browser screenshot capture timed out on final acceptance; accessibility state confirmed the final live counts and labels. The production map tab is kept open as the deliverable.
