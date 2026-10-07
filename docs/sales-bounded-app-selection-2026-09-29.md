# Bounded app release selection

**Release update:** all 67 selected files were independently hash-checked, committed as `7ae9052ea392e7d683e87ecf5b7e829f291deaeb`, pushed to main and deployed on 79c5 as `3diW7XJ6w7YvYPGiKkebcvc4dKja`. See `docs/sales-central-release-execution-2026-09-29.md` for database activation and acceptance limits. Earlier future-tense statements record the original selection plan, not current deployment status.

Read-only dependency review against deployed account/login baseline `f404377c4e5cef2088de1f4d1805164967608539` in the existing `account-guard-release` worktree. Preserve the dirty main workspace. The previous all-source build is not verification of this proposed 40-file release selection.

## Copy ten existing files

```text
app/owner/page.tsx
app/sales/page.tsx
app/sales-crm/page.tsx
components/sales/CentralLeadForm.tsx
components/sales/CentralLeadsView.tsx
lib/sales/centralClient.ts
lib/sales/centralContracts.ts
lib/sales/centralServer.ts
lib/sales/leadWorkServer.ts
lib/sales/leadLifecycleServer.ts
```

## Add 26 files

```text
app/sales-crm/bookings/page.tsx
app/sales-crm/projects/page.tsx
app/api/sales-crm/bookings/route.ts
app/api/sales-crm/bookings/search/route.ts
app/api/sales-crm/project-sales/route.ts
components/sales/BookingActionForm.tsx
components/sales/BookingForm.tsx
components/sales/BookingWorkspace.tsx
components/sales/CentralLeadTracker.tsx
components/sales/LeadTrackerPresentation.tsx
components/sales/PostBookingLink.tsx
components/sales/ProjectSalesWorkspace.tsx
components/sales/SalesWorkspaceEntry.tsx
components/sales/SalesWorkspaceModeProvider.tsx
lib/sales/bookingClient.ts
lib/sales/bookingContracts.ts
lib/sales/bookingPending.ts
lib/sales/bookingServer.ts
lib/sales/centralPending.ts
lib/sales/centralTracker.ts
lib/sales/importedBookingHistory.ts
lib/sales/projectSalesClient.ts
lib/sales/projectSalesContracts.ts
lib/sales/projectSalesFlags.ts
lib/sales/projectSalesServer.ts
lib/sales/releaseScope.ts
```

## Four selective patches, not whole-file copies

1. `app/page.tsx`: only replace legacy Sales/report dynamic imports and corresponding render branches with SalesWorkspaceEntry/SalesReportingEntry. Exclude global trusted-auth, login/logout, presence and account permission changes.
2. `app/layout.tsx`: add SalesWorkspaceModeProvider with projectWorkspaceMode/salesReportsEnabled and **postBookingEnabled=false**. Do not import the unfinished postBookingServer only to compute a disabled flag.
3. `app/sales-crm/[customerId]/page.tsx`: add extendedSalesReleaseAllowed fail-closed gate only, retaining the deployed LeadWorkView. Exclude new Visit/interests imports and props.
4. New `components/sales/SalesReportingEntry.tsx`: release-specific subset retaining legacy reports in legacy mode, blocked-mode/central disabled notices and dashboard suppression. Omit new reports workspace/client branches and future reporting implementation.

Preserve deployed LoginView/LoginScreen, useBuildTrackData, accountCommands/loginDirectory, AdminUsersView, LeadTrackerView, LeadWorkView, NotificationsView and workflow helpers. No QR package/package-lock or next.config changes are needed for this bounded release. Some files appear deleted relative to the old main index but are actually untracked files matching the deployed baseline; do not infer deletion from that index-only comparison.

The main SalesWorkspaceEntry daily_visits notice should not direct users into a Visit workflow that is closed. Correct only its release wording, not add Visit features.

## Verification and activation boundaries

The selected worktree is now assembled and locally verified as recorded below. CentralBookingRelease tests were adapted to the selected routes without adding excluded reporting modules. Deployed account flags and auth behavior are preserved. Real Admin/Sales and other-department acceptance remains a separate release check; local verification is not production authorization or activation evidence.

The concrete live construction conflict was subsequently repaired with user approval; see `sales-construction-compatibility-blocker-2026-09-29.md`. Preserve that prerequisite and complete the remaining selected-build/schema/import/acceptance checks before activation. No commit, push, environment mutation or deployment was performed by this selection review.

## Assembly checkpoint

Assembled in the existing release worktree `C:/Users/HUAWEI/.codex/worktrees/account-guard-release/buildtrack-mvp-main`, from clean baseline `f404377c4e5cef2088de1f4d1805164967608539`. Exactly 40 application files plus 27 selected test/fixture files; no package, lockfile, Next config, account/login, construction or other-department implementation changes.

The scoped reports entry preserves the deployed legacy components in legacy mode, suppresses hidden legacy dashboards in central mode, and keeps all new reports unavailable even if a future reports flag is enabled. The shared layout hardcodes post-booking unavailable. Daily Visit navigation explains that Visit is not open, without inviting an unsupported workflow.

Earlier snapshot `D:/buildtrack/buildtrack-mvp-main/.next/release-check/app-06WRAz` passed type generation and TypeScript checking, then its webpack build was deliberately stopped at process 23364 to free memory for the sequential database rehearsal. Final verification below supersedes that interrupted run. The release worktree has no installed dependencies; selected tests ran in the credential-free copied snapshot, not against dirty main source modules.

### Final local verification

- Snapshot: `D:/buildtrack/buildtrack-mvp-main/.next/release-check/app-O2OaVK`, 345 source/assets, exact selected worktree.
- Type generation, standalone TypeScript checking, webpack production build, final Next TypeScript checking and 13 static pages: passed. Source files unchanged during build.
- Report: `app-O2OaVK/release-report.json`, SHA-256 `4079c2e732fb5e118dcd8f137c42032423612a6a8f9ac0ac43d8cd68b546a093`; completed `2026-09-29T09:57:20.800Z`.
- 548 tests across 23 selected files passed with exit 0, one worker, 512 MiB heap cap. Includes 14 deployed baseline-preservation assertions and 7 legacy/central reporting behavior checks.
- An earlier identical suite passed all tests but its JSON reporter hit a local EPERM output-file error; the successful clean rerun used the default reporter and no file writer.
- Scoped lint of selective wrappers, scope tests, layout and customer detail gate passed with zero warnings. `git diff --check` clean.
- No build/test/server processes remain owned by this assembly. No commit or push was performed by the assembly agent.

No commit, push, deployment, activation, production SQL or credentials were used by this assembly. The build profile substitutes offline fonts, low-memory webpack config and a synthetic Supabase URL/key; it cannot establish real Auth/API acceptance or guarantee default Vercel Turbopack compilation.

### Assembled file manifest

SHA-256 hashes are of local file bytes, before Git line-ending normalization. No environment files or customer data are included.

| Path | SHA-256 | Purpose |
| --- | --- | --- |
| `app/api/sales-crm/bookings/route.ts` | `9ee54d63b952e8d25b9cc27d0fef215deaf926e8890964dbff668b71140f057b` | application |
| `app/api/sales-crm/bookings/search/route.ts` | `22252a8059fceeed85ddb5c9807165ee6ecca17a518e310230576dc1f4b99cbb` | application |
| `app/api/sales-crm/project-sales/route.ts` | `171bc3d0fd8120ec0e37522759e18964dda6aba52ec527af9e05aa69cb705cc2` | application |
| `app/layout.tsx` | `7f2a7feedeaebf92dbbb92e5bdac66935470df2eb4ebf36d92e3a1eabe23bcab` | application |
| `app/owner/page.tsx` | `a168b01a4fd6459430fca41d96475a8f9292f642c8c353aecfd897564b03af4f` | application |
| `app/page.tsx` | `6c257046056038dea24b044754b0f7e4db84283c2c39d1bae20b315d49acc853` | application |
| `app/sales-crm/[customerId]/page.tsx` | `0e0dc4f02e02b63108049baa6e5e6fdc130a99a94874467a5fc60512c05e99bc` | application |
| `app/sales-crm/bookings/page.tsx` | `a1a78bd9c825f4599bbfeff0a57d4cbb91a60e7996cc5fbfc460b80fae878d10` | application |
| `app/sales-crm/page.tsx` | `dc0cff81d848e0c83deaed4f9a32456deeec52127186bb6ce8742a4b885c398c` | application |
| `app/sales-crm/projects/page.tsx` | `c8ad81fa409b308237cdd99130c850c83149bb6664eb01a2daa9c82fa62acf81` | application |
| `app/sales/page.tsx` | `ec980ec6704825107154240c3cae1b84cb7c4eb3dd2407320ec4aee335a89637` | application |
| `components/sales/__tests__/bookingFixtures.ts` | `7efaed587e6080dffded213d49a57c0c7c3c638a4eaea21160db6e489a8c4b08` | test/fixture |
| `components/sales/__tests__/BookingForm.test.tsx` | `1474353f690555bbed447ea66142a7abe560fc2a7942920803c966dac7b38537` | test/fixture |
| `components/sales/__tests__/BookingPage.test.tsx` | `c25eb7c8261eb15c7e0e7fa7ab58c5799aa0b53ab350e99e9c38979208e78ad4` | test/fixture |
| `components/sales/__tests__/BookingWorkspace.test.tsx` | `3ec1f5e00a1d50e5158e46f6dda00fd2825fec4ff70833a09fc5a94329b3d026` | test/fixture |
| `components/sales/__tests__/BoundedReportingEntry.test.tsx` | `f42e6061c29a5c92f485f9c7e7c4064e9e33e28202bf3832e3837a8f4d19dfda` | test/fixture |
| `components/sales/__tests__/CentralBookingRelease.test.tsx` | `33455fe3e05b5178506b60c3c944f8fc225086fdb520488a443a41e7f1a0b480` | test/fixture |
| `components/sales/__tests__/CentralLeadForm.test.tsx` | `ff284d604d90a9f3637193144e344036e074396839a17703792303ef8566fe37` | test/fixture |
| `components/sales/__tests__/CentralLeadsView.test.tsx` | `af437959880dd633cb808ebbb8b703e723358fe5ac61a01f1610a86f0a103ede` | test/fixture |
| `components/sales/__tests__/projectSalesFixtures.ts` | `bfc9fb21b413b91a0ffb8af9ad309734d40707249013a33a4b5d40bf72bc6458` | test/fixture |
| `components/sales/__tests__/ProjectSalesPage.test.tsx` | `3bfa96c69cef632c662b261eba30876e1160a305676f4257a18b456dd8189d11` | test/fixture |
| `components/sales/__tests__/ProjectSalesWorkspace.test.tsx` | `83ff12f2c39af4f8f088ec29071f8549462c6d286b844da8eb4d7eb20f66f090` | test/fixture |
| `components/sales/BookingActionForm.tsx` | `95c723f3c0da45bfdafd2e1186e532d7d616f7f2f169a73bb546caeef94354b4` | application |
| `components/sales/BookingForm.tsx` | `27112b2ffe32e7735f9c39b5750bfb22cc0f1bb12cd77db377fe6bc25cc17f11` | application |
| `components/sales/BookingWorkspace.tsx` | `dec1a207815cef57a1648995b58fd292ca7cb8ba390a26076d050c713c2ae769` | application |
| `components/sales/CentralLeadForm.tsx` | `e157092fa816ac708865cba6fa7b36f27e12defd0a10b83e1620fa621328b13e` | application |
| `components/sales/CentralLeadsView.tsx` | `9b074ba945114c89656a60ddf7d6bdad03da15bfc07c13596515ec3d436b26e7` | application |
| `components/sales/CentralLeadTracker.tsx` | `9deb71bbee1cee8ce87811ac4b6ea54e48d0790666186e9d98b309b320c4fd27` | application |
| `components/sales/LeadTrackerPresentation.tsx` | `5916887bd422d268f8501835e79aaf1e039d600a6f9d47826238dda016e74cd7` | application |
| `components/sales/PostBookingLink.tsx` | `74413812f7832b553fc284d2b21f4dbe3b45514852afc45c74b78f1b7f59dc50` | application |
| `components/sales/ProjectSalesWorkspace.tsx` | `7e2b032ef153fbcb1e32fd635dde606a1c45fe1076dfef41c16c9859679d5d0a` | application |
| `components/sales/SalesReportingEntry.tsx` | `bf5a4cb980ab0a73fbf2535c71e9a37c1d7c6fc3191348d1cf617097223f28a5` | application |
| `components/sales/SalesWorkspaceEntry.tsx` | `4f4b41fac6d454ef885f127150d970283fad8502580a241b73f8b73816d2fba0` | application |
| `components/sales/SalesWorkspaceModeProvider.tsx` | `1be1f64ee19fd00cdfa63faa7eb173379b38235933ba8260cb3ab29d87dde5a2` | application |
| `lib/sales/__tests__/bookingClient.test.ts` | `025047a1fdd2ac02208cd9ee678658a7e8f9f4ceae575f8259946e84fea6bf7d` | test/fixture |
| `lib/sales/__tests__/bookingContracts.test.ts` | `a3caac4b4a4b78bd7fe4cb1bd8fd9f40e0b2f3315a1c614d92855a96cd42c437` | test/fixture |
| `lib/sales/__tests__/bookingFixtures.ts` | `7b10a370b5422e9b301763113b691cd2623a9256c231177a6aee383bf259751f` | test/fixture |
| `lib/sales/__tests__/bookingPending.test.ts` | `8d938ca5119ce4b946680c4520e7796bb4a01c5affd73cd84da5f03aba1bbec0` | test/fixture |
| `lib/sales/__tests__/bookingServer.test.ts` | `1e190ec1a266b2512307b3771f04eb84b6d9616df877616d8e49114ca2d4cc57` | test/fixture |
| `lib/sales/__tests__/boundedReleaseBaseline.test.ts` | `0890f8171941c74379861c1b1d71a834ab500d408e84200fd426f80156b1859a` | test/fixture |
| `lib/sales/__tests__/centralClient.test.ts` | `4687649e1579e82086d47d13746765e0fd5e8af016c61031772a293d60732122` | test/fixture |
| `lib/sales/__tests__/centralContracts.test.ts` | `9834c10b8545d8c704506173647c4de1db3600f8cd75157d047aae1dbfb0cae3` | test/fixture |
| `lib/sales/__tests__/centralPending.test.ts` | `4455eab69e4110d62d6edb8f00688283f48d6b3a9ae8e5f6df07455df7a78e28` | test/fixture |
| `lib/sales/__tests__/centralServer.test.ts` | `5041ddaf7cc567ee433c6c1881d83f4a9fd4b2e94b5e5395e8bb0ca06f34915d` | test/fixture |
| `lib/sales/__tests__/centralTracker.test.ts` | `ab408a296979f3dc7520ca13df268d0105ef9dacadb6c8efd69061f3425ad06e` | test/fixture |
| `lib/sales/__tests__/importedBookingHistory.test.ts` | `661af83807fc1b34301ed89a0bcd5925f47bd401a4e4b4ff020408014aa219d0` | test/fixture |
| `lib/sales/__tests__/projectSalesClient.test.ts` | `817eb56e46fb39c1b3dc8bddc59cd519b80bbd5a555ce3d10f4ce723ab25faf3` | test/fixture |
| `lib/sales/__tests__/projectSalesContracts.test.ts` | `9874e52b7672b844cda9a586447f5299114f101a862a35657eb278a70f3675e7` | test/fixture |
| `lib/sales/__tests__/projectSalesFixtures.ts` | `7d3d0de01835af45d75e0b5cc5f22eb2514e8ebfd31e98b591f6ffa033e54d00` | test/fixture |
| `lib/sales/__tests__/projectSalesServer.test.ts` | `25d3462927f001971f4deceac2e756f5b44c3d6ced56cbd96ddefb49a30f23db` | test/fixture |
| `lib/sales/bookingClient.ts` | `e20abb86ebf0469e1dbbf5246850733358aaccc77cd7020512aa116cf0fb7885` | application |
| `lib/sales/bookingContracts.ts` | `f3eb433b8675ff0fa4d8e42b8fe4376ba2c4408dd050ea06c113231e3ff6dd05` | application |
| `lib/sales/bookingPending.ts` | `12746b133beb94412874123ab7606e3c655f6c232f066d3ce44637c5f1eb96ee` | application |
| `lib/sales/bookingServer.ts` | `14aaf3d3441493caaa32e80dc1a354aef4a4168c4d070ca044204747bedd4caf` | application |
| `lib/sales/centralClient.ts` | `7233e7d7d70585e51293a2d9233c3e2600f8fafe8492fc4d99932d127202bd7d` | application |
| `lib/sales/centralContracts.ts` | `6f69d1d38592306912bd7b5ed3c6de986ed7a62805d835d43f37b5ed9d80c8e2` | application |
| `lib/sales/centralPending.ts` | `184b4ff76909a2d0567e4dbb7ec38d76e5a0205112d040fbc27ac260d6cf35ad` | application |
| `lib/sales/centralServer.ts` | `dedb447921c5d9b43b20a17f8c0539fadbb3a3639932ffad2dcfba969b52a7d0` | application |
| `lib/sales/centralTracker.ts` | `98b9b35a714c33ea9ecb7310dbd3a1a5ed3381e41727b1cf59b241219cd9ca87` | application |
| `lib/sales/importedBookingHistory.ts` | `f6a0f5dd395436ac297675b0f2b771bbd65bb0a78ea9afbd1e034ec031ee7972` | application |
| `lib/sales/leadLifecycleServer.ts` | `00232232ed2727754ca067c63c41a5985ac433480cae67391f310c8d09fc438c` | application |
| `lib/sales/leadWorkServer.ts` | `f7d31b05adc1a82279f36224adc5b9dedddb1ecb2af854ca4ee0865708b3fe41` | application |
| `lib/sales/projectSalesClient.ts` | `24adf0471c4d91b94ee84412401ff43adf79d8e48c3bdc3e1b2e93245bd61aa3` | application |
| `lib/sales/projectSalesContracts.ts` | `29b77aa6fb60394abf832be712d138757ac21ca1314e930b25b0545a6a682a20` | application |
| `lib/sales/projectSalesFlags.ts` | `4643b32795b35da66220c97e850e11a20eb090163645c7e2251ed2b5f3cbb201` | application |
| `lib/sales/projectSalesServer.ts` | `92b34991358b2709d840f6188fa429860b0d3b44ba351c003edef5c7c962dcee` | application |
| `lib/sales/releaseScope.ts` | `52626df386669a65f00621e5d362100b053277974918730d260c45bf04b9e161` | application |
