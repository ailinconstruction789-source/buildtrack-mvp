# Central Lead source refresh — 29 September 2026

Read-only source and production preflight; offline plan preparation only. No Google Sheets edits, production SQL writes, import, activation or deployment were performed for this refresh.

## Source and boundaries

- Workbook: Google Sheets document `115kOO4o3bxytflY0yKlxkw9Uxc6MotKlqQJ4dbzTGm4`, sheet `ข้อมูลลูกค้า`, exported through the signed-in browser.
- Approved import window: rows **2..966 inclusive** (965 rows); row 1 is the header. The 257 extracted rows after 966 are excluded from the import plan. The private frozen workbook is the full source export, not a redacted or truncated workbook.
- The previously hidden 612 rows are visible in this export; visibility does not change identity or import eligibility. Both source versions were read including hidden rows.
- The only changed in-scope cached value is B933, now the already-confirmed date `2026-09-26`. A885 still requires the existing approved import-only correction to `2026-07-25`. The source was not modified by this task.
- All other in-scope cached values, row membership, headers and formula-column membership match the approved old snapshot. Formula expression text was not compared. The resulting customer/history proposals match exactly after applying existing approvals.
- Fresh read-only catalog: 8 projects, 306 plots, unchanged canonical project/plot meaning. Existing project aliases, plot zero-prefix decisions, row 642 plot 67, identities and owners remain valid.

## Proposed import counts — not installed counts

| Item | Preserved/proposed | Eligible to materialize | Held |
| --- | ---: | ---: | ---: |
| Customer candidates | 963 | 958 | 5 |
| Project-interest candidates | 960 | 955 | 5 |
| Booking-history entries | 304 | 303 | 1 |

Source row 680 has no customer name and remains source evidence for Admin, not a customer candidate. Owner holds are rows 438, 439, 440, 444, 894. These six source holds follow the user's decision. Booking row 171 has unknown plot: preserve its cancelled history in staging/evidence without inventing a plot-linked sale. Its hold does not discard the otherwise eligible customer.

Booking stages in the full plan: 202 transferred, 84 cancelled, 18 booked. Eligible linked sales: 202 transferred, 83 cancelled, 18 booked. Historical unknown phones, money, exact event timestamps and round numbers remain unknown; current application defaults are not evidence.

## Fresh live read-only preflight

The approved roster still resolves to 9 identities: 7 Sales, 1 Admin and 1 Owner. No credentials or sessions were retrieved. Roster identity digest: `f94f056bf287da5913d303ce1d9065d92517643fa5ce2e0f46785368251b7efd`. The roster check expires after one hour for cutover purposes and must be rerun. The CRM foundation was still absent at this check.

Legacy inventory remains 289 sales and 306 plots. Source/legacy active plot classifications: 199 same-stage, 10 stage-changed, 11 source-only, 3 legacy-only, 83 without active sales; no active collision or occupancy-flag mismatch. These are occupancy comparisons, not customer identity matches or permission to reuse sale IDs.

The previously reviewed stale transfer flags for ไอลิน6 plots 16, 18 and 19 still conflict with source booking stages. Apply only the user's existing source-authoritative correction through the reviewed cutover procedure. Two other transferred flags correspond to transferred source rows and are not reset. Construction progress must not be inferred from booking state.

This refresh did **not retrieve or compare legacy booking/transfer dates**: input dates were intentionally null in the inventory preflight. No conclusion about their absence or equality is justified. The check does not prove the absence of non-FK consumers or certify a recovery backup.

## Frozen local artifact binding

Private directory (Git-ignored): `node_modules/.cache/buildtrack-sales-release/source-ZvbkZU/`.

- `private-source.xlsx`: exact verified full export bytes; hash rechecked after freezing.
- `private-import-plan.json`: bounded plan with customer data. Never commit, print or attach it publicly.
- `catalog.json`: exact fresh catalog input.
- `source-review.json`: redacted comparison receipt and aggregate plan summary.
- `source-files.json`: provenance paths and workbook hash.
- `private-roster-preflight.json`, `private-inventory-preflight.json`: point-in-time read-only inputs, not evergreen release evidence.

These files are local cached artifacts, not an encrypted archive or Supabase recovery backup. Preserve them through the release; do not assume browser temporary files or ignored files are included in Git/worktree snapshots. The earlier unfrozen preparation folder `source-Jrc9io` was retained, not deleted; use `source-ZvbkZU` for this frozen source set.

| Binding | SHA256/digest |
| --- | --- |
| Previous workbook | `37b4cfa1e3b444261b83fe4d0b9c12792fe47d0f244db7d456a04abf2d1be1bf` |
| Frozen current workbook | `9ad3ddc7644e673de9d180d064f1939ff3fe267b1c6989c3124620c2320f8b23` |
| Bounded reviewed input | `4336012fea81a7cad790fede50446e1ce8a37def919be2b8ae489f4e06a2eb1b` |
| Fresh catalog | `9d61beb9b1eda00667f79cd64509e94366a2697b96f6d1d863c2e9f732b29190` |
| Import plan | `d831341f3441ad7f29dd6f61ed9913801fc362dc002ce82001dfc6b9b877588b` |
| Reconciliation receipt | `5fa95c783d741dc8aed35db941029958b4e940e0235c62ba69755a9e177322f0` |

`scripts/sales-runtime/sheet-source-refresh.mjs` validates original approval bindings, permits only already-confirmed date changes/visibility differences, rejects other in-scope changes and revalidates the bounded plan. `run-sheet-source-refresh.mjs` freezes the source and generates private artifacts without database access. Synthetic source/identity/relationship/plan/inventory tests: 161 passed across 6 files. Scoped ESLint passed. Real customer records were not loaded into the synthetic PostgreSQL runtime.

`importReady=false` remains intentional: offline reconciliation does not approve live execution. Follow `docs/sales-central-booking-release-candidate.md` for the remaining live-schema, recovery, selected deployment, data operations and acceptance gates. Existing business decisions are retained; no new business-rule question arose from this refresh.
