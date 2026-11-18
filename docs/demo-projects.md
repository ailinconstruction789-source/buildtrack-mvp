# Admin Demo projects

The Demo workspace stores map drafts in `public.admin_demo_projects`. It does not create rows in production `projects`, `plots`, tasks, sales, billing or notification tables. Existing project reports therefore do not include these drafts.

## Access

- Only an authenticated, active **Admin** from the existing `app_current_actor()` trusted-identity contract can read, create or edit a Demo. Owner is not Admin.
- RLS enforces this independently of menu visibility and client-side checks. User-editable JWT metadata is not an authorization source.
- All Admins can see Demo projects. `created_by` records the creator; it is not an owner-only access restriction.
- Client writes cannot change creator, creation time, identity or revision. Deletion and truncation are not granted.
- Every update advances the server-controlled revision. Clients must update by both `id` and the last loaded `revision`; no matching row means another save won, so reload rather than overwrite.

## Data contract

Each draft has `id`, `name`, `layout_data`, `created_by`, `created_at`, `updated_at` and `revision`. The initial map contract is version 1 with 24 columns and 16 rows. Cells contain exactly `id`, `x`, `y` and `kind`. Supported kinds are `plot`, `road`, `earthwork`, `fence`, `drainage`, `water`, `electric`, `pole` and `walkway`.

One cell per kind and coordinate is allowed, and different layers may overlap. This is a schematic development canvas, not surveyed coordinates, measured quantities, construction completion or an implemented QC workflow. Demo content must not be promoted into a real project implicitly.

## Installation and verification

Migration: `supabase/migrations/20261114032346_admin_demo_projects.sql`.

The migration requires the existing trusted actor function and fails closed if it is absent. Apply it through the project's normal reviewed migration deployment process; do not replay older cutover migrations or remove their guards. This feature's local implementation does not itself apply the migration to a hosted database.

Run `node scripts/demo-project-runtime.mjs` to verify the migration against a fresh, disposable PostgreSQL cluster using the cached portable PostgreSQL binaries. The runner accepts no external database arguments and does not load application environment files. It uses the real repository trusted-actor function with synthetic users, roles and sessions. The test covers Admin access, other roles and anonymous access, spoofed metadata, revocation, session expiry, column permissions, layout constraints, overlapping layers and optimistic revisions. Production-table sentinel fixtures remain unchanged.

The runtime test is SQL/RLS evidence, not a hosted PostgREST or browser end-to-end test. On Windows, PostgreSQL `initdb` may need to run outside the tool sandbox because its restricted-token startup is incompatible with that sandbox. Its database remains local, synthetic and isolated.

The sandbox schema has no scheduled jobs or outbound notification integration. New features should continue using the Demo store until their production data model and release are separately ready.
