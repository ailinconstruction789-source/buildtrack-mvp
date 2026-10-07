# Name-only login client release candidate — 28 September 2026

## Status

Published on 28 September 2026 after the user approved this exact nine-file release.
Commit `f404377c4e5cef2088de1f4d1805164967608539` was pushed non-force to GitHub/main from the isolated release worktree. No Supabase changes were made in this release.
This is the client prerequisite for later restricting anonymous users-table reads.
It does not enable trusted-auth, CRM, notifications, or change any database grant.

Base: deployed account client `9df960815c1977c4b6a123484575dc98dbd8b16d`.
Candidate workspace: `C:/Users/HUAWEI/.codex/worktrees/account-guard-release/buildtrack-mvp-main`.
The workspace was clean at the start; the existing account guard commit is preserved.
Main workspace remains dirty and was not pulled/reset or copied wholesale into the candidate.

## Exact release scope: nine files

1. `app/page.tsx`: replace dynamic LoginView with LoginScreen and pass isLoggingIn instead of allUsers. Only two diff hunks. Existing handleLogin, Auth calls, PIN processing, session restoration, presence, account commands, and all business handlers unchanged.
2. `components/LoginView.tsx`: names-only dropdown, typed props, loading/error/retry UI, same name-selection plus four-digit PIN interaction. Enter and click obey the same disabled conditions.
3. `components/LoginScreen.tsx`: separate public directory request while signed out, masked errors, manual retry, ignore late responses after unmount.
4. `lib/auth/loginDirectory.ts`: select and sort username only, bounded paginated requests with exact count, reject inconsistent/malformed/duplicate results. Never fall back to wildcard or role reads.
5. `hooks/useBuildTrackData.ts`: fetch staff fields only after loggedInUser exists; clear stale directory on identity change and ignore late results. Preserve the staff data needed by Admin/assignment/construction consumers. Existing project/task/plot/business operations unchanged.
6. `components/__tests__/LoginView.test.tsx`.
7. `components/__tests__/LoginScreen.test.tsx`.
8. `lib/auth/__tests__/loginDirectory.test.ts`.
9. `hooks/__tests__/useBuildTrackData.test.ts`.

Runtime files reuse the previously prepared code in the main workspace. The only main-workspace code edit this turn was adding the nine-role regression cases to the existing hook test; no main app runtime was overwritten.

## Verification

- Local snapshot `.next/release-check/app-pnhOdo`: 296 source/assets; typegen, TypeScript and build all exit 0; 13/13 static pages; report status passed and sourceFilesUnchanged=true at build completion.
- Build uses the existing low-memory Webpack/offline-font profile and synthetic loopback Supabase URL/key. No app .env copied; no real authentication/data acceptance. Not a clean npm install or the default Vercel build profile.
- First unit run on the snapshot: 49 passed and nine new role cases failed because the test recreated its caller object on each render. Fixed the fixture to retain the same caller object, matching the app's state. No runtime source was changed to suppress the failure.
- Final unit/component run: **58/58 passed, five files** (LoginView, LoginScreen, useBuildTrackData, loginDirectory, existing accountCommands). The role matrix includes Admin, Owner, Sales, Foreman, Site Engineer, QC, Project Planner, Procurement, Store. This is mocked regression coverage, not live logins for all roles.
- Final tests ran in the main workspace after comparing the five runtime dependencies against the candidate: LoginView, LoginScreen, useBuildTrackData, loginDirectory and accountCommands match after newline normalization.
- After build completion, the only candidate file changed was `hooks/__tests__/useBuildTrackData.test.ts` to fix the test fixture. Compared all 296 captured hashes: no application runtime/config/dependency changes after the successful build. Original snapshot/report were left intact; do not claim the snapshot's failed test fixture itself passed.
- ESLint passed for LoginScreen, LoginView, loginDirectory, LoginScreen tests, loginDirectory tests. This is scoped lint, not full-project lint of pre-existing code.
- Candidate `git diff --check` passed. No changes to package files, SQL, environment files, Next config, Sales modules, account-command helper, or secrets.

## Activation sequence and remaining boundaries

### Publication evidence — 28 September 2026

- Remote main was checked against `9df960815c1977c4b6a123484575dc98dbd8b16d` immediately before publication; only the nine listed paths were staged/committed. Release worktree is clean afterward; the dirty main workspace was not pulled/reset.
- GitHub commit status for `f404377c4e5cef2088de1f4d1805164967608539`, context `Vercel – buildtrack-mvp-79c5`, reports **success / Deployment has completed**. Deployment: `https://vercel.com/ailinconstruction789-s-projects/buildtrack-mvp-79c5/DgJdQyad4Ag7YxgPWEzzBq45zq2o`.
- Production root `https://buildtrack-mvp-79c5.vercel.app/` returns HTTP 200. Inspected its 13 public script/preload assets: `/_next/static/chunks/15rj0dyzs87_~.js` contains the username-only exact-count reader and retry UI; `/_next/static/chunks/0wbpnps1zyjpu.js` contains the explicit post-login staff fields. This confirms the new client is served by the main domain, not just built on GitHub.
- Chrome inspection repeatedly timed out; no fresh-login acceptance or live staff-loading acceptance is claimed for this release. Ask the user to refresh/login themselves and check Manage Users; do not reuse credentials or log out their existing session automatically.
- GitHub aggregate status is failure because the unrelated `buildtrack-mvp-ifre` project failed; the target `79c5` and unused `w2a8` both report success. Do not conflate aggregate status with the target, or modify unrelated projects.
- No SQL, grants, role changes, credentials, feature flags or Vercel environment settings changed. Lead/trusted-auth/notifications remain disabled. Prior local test/build evidence below is unchanged.

The publication in steps 1–2 below is complete. On 28 September 2026 the user explicitly answered the acceptance question: refreshed/logged in as Admin and Manage Users showed the full list ("ทดสอบแล้ว เข้าได้และรายชื่อครบ"). This completes user-reported Admin login/staff-list acceptance for this client release; other roles and post-grant-change REST acceptance are not implied. The earlier Chrome timeout remains historical evidence, not a current Admin-acceptance blocker.

1. Obtain approval for publishing this nine-file client release via GitHub/main -> Vercel 79c5. Prior permission to publish the three-file account guard client is not blanket approval for all dirty worktree changes.
2. Re-check remote main and candidate diff, commit only these nine paths, push non-force if reviewed base still matches, and verify Vercel Ready plus live names-only directory behavior. Preserve the guarded-account environment flag; no new flag is required for this client change.
3. Confirm actual login/after-login staff loading on the deployed candidate. Do not create/reset accounts merely for a login test, ask users to enter their own credentials when needed.
4. Only after the client is confirmed compatible, prepare and review the separately gated database directory/role migration, including old-tab handling. No SQL directory grant change is authorized by this document alone.
5. Continue CRM foundation/backfill/cutover using the already-approved nine CRM identities. This does not require re-approving unchanged names, and must not auto-enable trusted-auth for other departments.

The client still retains legacy post-login identity/authorization behavior outside this narrow release. Name selection is NOT proof of identity; existing RLS/metadata risks outside the account guard are not resolved by this UI update. The future migration must enforce database access separately.
