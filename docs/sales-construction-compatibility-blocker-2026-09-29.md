# Live construction / Sales activation conflict

29 September 2026. Read-only review of `kbthmdedilswdmmczfay`; no production mutations, customer import, deployment or activation in this review.

## Resolution applied after user approval

The user explicitly approved separating construction completion from Sales transfer confirmation. The narrow repair was subsequently applied to production via the Supabase migration tool as **`20260929093340 construction_completion_sales_transfer_only`**. Local CLI-created source is `supabase/migrations/20260929092748_construction_completion_sales_transfer_only.sql`; remote timestamp differs, so do not directory-wide `db push` or reapply this one-shot migration.

Only `public.auto_update_plot_sale_status()` was replaced. It preserves existing task-counting logic and leaves occupied plots' sales state unchanged. Vacant completion still sets `ready_for_sale`, except an already-transferred plot is never demoted. It does not add `ready_to_transfer`, change `is_completed` semantics, backfill dates, rewrite history, alter grants/RLS or recreate any trigger. The upstream task-progress and defect-sync definitions remain identical. New transfer confirmation remains a Sales responsibility; the bounded release does not enable new post-booking workflows.

Before changing the function, the migration verifies the approved target/decision, current owner, exact LF-normalized live definition hash and exact enabled trigger. It preserves function owner/ACL/security/config metadata, all trigger rows, and upstream function definitions, with transaction/statement 30-second and lock 2-second limits. Failure rolls the definition change back. It invokes no data mutation or CRM installation.

Local native PostgreSQL report `node_modules/.cache/buildtrack-sales-runtime/runs/run-SKpkOA/report.json`: **passed; cluster stopped**. The new 19-check regression reproduced the original failure, then verified exact repair/atomic rollback/no existing-data change, booked/vacant/transferred/stale-occupancy/incomplete/bulk cases, defect sync and continued rejection of manual stock/transfer changes under the new writer. The existing exact-package suites also passed, including 69 writer checks. Unit regression: 11 tests / 3 files passed; scoped ESLint passed. Tests use only synthetic rows and owner-level execution, not real Supabase Auth/PostgREST/RLS/browser acceptance.

Live read-only verification at **2026-09-29 09:34:16 UTC**:

- LF-normalized function MD5 changed from `c6630c35e6bfeebf1469ab6136e2a129` to **`54c895cd4e84be7650f89baa4b43c138`**, matching the tested repair exactly.
- Still SECURITY INVOKER, owned by postgres, original config and enabled trigger definition unchanged.
- Counts before/after: 306 plots, 289 sales, 21,790 task updates, 13,050 assignments. Counts alone are not row-equality proof; no live task was changed for testing and the migration contains no data-write invocation.
- CRM foundation/external schemas remain absent. No customer import, central Lead activation or app deployment occurred in this repair.
- Security advisor categories/counts remain unchanged. Existing mutable search-path, broad legacy RLS/user-metadata and definer-view findings remain outside this narrow behavioral fix. No claim of whole-system security remediation. References: [search-path advisory](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [metadata RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0015_rls_references_user_metadata).

This resolves the identified automatic-transfer conflict. Other complete-schema/selective-app-build/import/acceptance gates remain. Do not restore the original auto-transfer body after activating the booking writer: that would reintroduce the construction failure. Never restore the shared database wholesale to undo this function-only change.

## Evidence

- Supabase scheduled-backup dashboard viewed successfully for the correct production project. Latest listed physical backup: **28 September 2026 20:24:38 UTC / 29 September 03:24:38 Bangkok**. No Restore action. Listing is not a restore test and does not cover subsequent construction work.
- Live migrations remain `20260928061913 account_guard_reviewed_cutover` and `20260928082516 login_directory_reviewed_cutover`. CRM foundation/external schemas are absent; counts remain 895 legacy Leads, 289 sales, 306 plots, 8 projects and 0 Customer Voices.
- Read-only live metadata snapshot: `node_modules/.cache/buildtrack-sales-release/live-schema-compatibility-20260929.json`.
- Exact enabled construction trigger definitions captured at `2026-09-29T09:21:25.122Z`: `node_modules/.cache/buildtrack-sales-release/live-construction-trigger-chain-20260929.json`. These files contain schema metadata, not customer rows or credentials.

## Failure mechanism

1. A construction update to `public.task_updates` invokes `public.update_task_progress_trigger()` through `trigger_update_task_progress`.
2. It upserts `plot_task_assignments`, setting progress and `actual_end_date`. For an existing assignment whose completion date changes from null to non-null, the enabled `auto_update_plot_sale_status_trigger` fires.
3. Live `public.auto_update_plot_sale_status()` counts progress-counted tasks and assignments with `current_progress >= 100`. If all counted tasks are complete and `plots.has_customer=true`, it executes **`UPDATE plots SET sale_status='transferred'`**. For vacant plots it sets `ready_for_sale`.
4. The proposed `crm_external_private.guard_booking_plot_stock()` accepts unchanged stock and `active`/`ready_for_sale` construction transitions, but rejects changing `sale_status` to `transferred` outside the reviewed sales workflow with `EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED`.
5. Therefore, after activation, the qualifying booked-but-not-transferred plot completion would raise an error and roll back the enclosing construction write. This is a code/metadata-derived conflict; no production task was changed to reproduce it.

The earlier minimal synthetic fixture did not contain this chain. Passing booking/cancellation/pause/resume tests is not evidence that final construction completion works. The issue was found before installation/activation.

## Important local/live difference

Repository `auto_ready_for_sale_trigger.sql` is **not** the live body: it uses `ready_to_transfer`, sets `is_completed`, and changes task exclusion/completion criteria. Do not run this whole file as a guessed repair. The current booking guard also rejects `ready_to_transfer`, so replacing the function alone is insufficient.

Do not remove the stock guard or allow arbitrary `transferred` writes to work around the conflict. That would reopen inconsistent sale/plot state and could fabricate real transfer events.

## Original decision request (now approved and implemented above)

Recommended bounded direction: **construction completion is not ownership transfer**. Preserve construction completion recording; do not automatically change a booked sale/plot to `transferred`. Keep any future transfer confirmation separate and out of this central-intake/booking-only release. Already transferred plots/history must remain unchanged. Do not change task counting/exclusion rules, unrelated defects, or historical completion records as part of this compatibility fix.

This requires changing an existing automatic rule used by the live construction department, beyond the earlier narrow Sales package. Ask the user to approve that behavior before implementing a replacement trigger/adapter. If a visible `ready_to_transfer` status is preferred, review all consumers and guard transitions explicitly; do not silently introduce it.

After approval: implement the smallest live-body-based integration, add the exact upstream completion trigger chain to synthetic regression (occupied/vacant/already transferred/incomplete cases and atomic rollback), then regenerate/retest the exact candidate and recheck metadata drift. Never backfill or replay real construction updates just to test the repair.

## Other observations

No current incoming foreign key or view dependency on legacy sales was found in this bounded metadata review. Eight construction views depend on plots, and construction child references to leads/plots exist; these must be preserved. This is not a complete proof that no external/non-FK consumer uses legacy sale IDs.

The current live `/sales-crm` page requires login in the inspected browser session; no Admin/Sales authenticated acceptance is claimed. The isolated release worktree remains at the deployed account/login client baseline; no dirty-main bulk publish occurred.
