# BuildTrack MVP - Consolidated Code Review Report

## 1. Executive Summary

This consolidated report provides a comprehensive evaluation of the BuildTrack MVP codebase. The review encompasses user experience (UX/UI), frontend architecture, backend database structure and security, quality assurance (QA/testing) configuration, and DevOps practices. 

The primary findings indicate that while the BuildTrack MVP is highly interactive and functional, it is currently constrained by:
* **Critical Security Vulnerabilities**: Predictable authentication patterns combined with permissive database policies (RLS) and public user directory leakage expose user data and permit unauthorized data modification.
* **UX/UI & Logic Defects**: Broken session activity tracking, infinite loading states on geolocation denial, and Tailwind color styling typos detract from user experience and application functionality.
* **Performance Hazards**: DOM bloat in Gantt charts due to high element count rendering on site tablets.
* **Broken Testing Pipelines**: A configuration mismatch that causes unit tests to conflict with E2E tests, coupled with incomplete mocks for Supabase client-side methods.
* **DevOps Anti-patterns**: Next.js configuration that suppresses TypeScript compilation errors in production builds and dev script configuration that bypasses native performance optimizations.

A consolidated action plan has been compiled at the end of this report, detailing remediation steps to address these findings systematically.

---

## 2. UX/UI Review

### 2.1 Tailwind CSS Syntax Typos
Several CSS classes contain typos in their color opacity syntax which causes the Tailwind CSS compiler to ignore the styles, rendering elements without borders:
* **Dashboard Inspection Queue Tab Borders**: In `components/DashboardOverview.tsx` (Lines 112 and 120), the class name `border-black/5/80` is invalid:
  ```tsx
  className="flex bg-slate-200/60 p-1 rounded-xl w-fit border border-black/5/80"
  className="flex bg-slate-200/60 p-1 rounded-xl shrink-0 border border-black/5/80"
  ```
* **Inspection Card Divider**: In `components/DashboardOverview.tsx` (Line 209), the class name `border-black/5/60` is invalid:
  ```tsx
  className="text-[10px] sm:text-xs text-slate-400 flex items-center gap-1.5 mt-3 pt-3 border-t border-black/5/60"
  ```
* **Gantt Grid Vertical Lines**: In `components/HouseDetailView.tsx` (Line 290), the class name `border-black/5/50` is invalid:
  ```tsx
  className={`border-l h-full relative ${m.isMonth ? 'border-black/10 bg-slate-200/20' : 'border-black/5/50'}`}
  ```
**Root Cause**: Tailwind CSS color opacity syntax expects `color/opacity` (e.g. `border-black/5` or `border-black/10`). Slashes followed by multiple numbers (e.g., `/5/80`) break the Tailwind compiler parser grammar, causing it to fall back to no border style.

### 2.2 Mobile Preview Layout Container Query Bug
* **File Reference**: `app/page.tsx` (Lines 1180 and 1337)
* **Observed Code**:
  ```typescript
  const isMobileLayout = isMobilePreview || isRealMobile;
  // ...
  <div className={`${isMobilePreview ? 'w-[390px] h-[844px] bg-slate-50 border-[14px] ...' : 'flex h-screen w-full ...'}`}>
  ```
* **Bug Detail**: The "Mobile Preview" button wraps the application frame in a fixed container dimensions (`390px` width by `844px` height). However, because Tailwind’s responsive modifiers (`sm:`, `md:`, `lg:`, `xl:`, etc.) are compiled into standard viewport media queries, they resolve against the browser window width (e.g., `1920px`) rather than the wrapper container width. This means elements inside the cramped 390px layout still render with desktop layout rules (like multiple grid columns and large paddings), resulting in a broken layout.

### 2.3 Geolocation Loading Spinner
* **File Reference**: `app/page.tsx` (Lines 187-232, 1768)
* **Bug Detail**: `navigator.geolocation.getCurrentPosition` is invoked to retrieve client coordinates on page load. However, the method is called with only a success callback. If a user denies geolocation access, or if the browser blocks it, the error callback is never triggered. The `weatherInfo` state remains `null`, forcing the weather widget (Lines 1766-1768) to display the loading text `"กำลังโหลด..."` alongside an active spinner indefinitely.

---

## 3. Frontend Review

### 3.1 Session Inactivity Expiry localStorage Bug
* **File Reference**: `app/page.tsx` (Lines 384-386)
* **Observed Code**:
  ```typescript
  const updateActivity = () => {
    if (localStorage.getItem('buildtrack_user')) {
      const last = parseInt(localStorage.getItem('buildtrack_last_active') || '0');
      if (Date.now() - last > 30000) {
        localStorage.setItem('buildtrack_last_active', Date.now().toString());
      }
    }
  };
  ```
* **Bug Detail**: The inactivity listener updates `buildtrack_last_active` only if the key `buildtrack_user` exists in `localStorage`. Following the migration to Supabase Auth, client credentials are saved in the Supabase session state, and `buildtrack_user` is never written to `localStorage`. As a result, `updateActivity` is a silent no-op. The user is logged out after 60 minutes of inactivity (`TIMEOUT_MS = 3600000`), regardless of how active they are.

### 3.2 Geolocation Logic
* **File Reference**: `app/page.tsx` (Lines 187-232)
* **Bug Detail**: The reverse geocoding API (`api.bigdatacloud.net`) and weather API (`api.open-meteo.com`) requests are nested directly inside the geolocation success callback. If the APIs fail or experience high latency, there is no timeout or default state resolution. The weather widget remains stuck in the loading state, and console warnings are suppressed, presenting an unhandled failure point in client-side runtime logic.

### 3.3 Gantt Chart DOM Bloat
* **File Reference**: `components/HouseDetailView.tsx` (Lines 290 and 680)
* **Bug Detail**: The vertical grid lines of the Gantt chart are generated by mapping the array `timeMarkers` (representing each day in a 6-month period, i.e., ~180 days) inside the header and *every individual task row*:
  ```typescript
  {timeMarkers.map((m: any, i: any) => (
    <div key={i} className={`border-l h-full ...`} style={{ left: `${m.left}%`, width: `${(1 / totalChartDays) * 100}%` }}></div>
  ))}
  ```
  With a 6-month view and 25 tasks, this produces `25 * 180 = 4,500` absolutely positioned `div` nodes. This causes high CPU load, layout thrashing, and lag on field tablets and lower-end mobile devices.

### 3.4 Data Hook `fetchPlotDetails` Issues
* **File Reference**: `hooks/useBuildTrackData.ts` (Line 199)
* **Bug Detail**: When lazy loading details for a specific plot, `fetchPlotDetails` updates `latestUpdatesMap` as follows:
  ```typescript
  updData?.forEach((upd: any) => {
    const key = `${upd.plot_id}-${upd.task_template_id}`;
    if (newMap[key] && !newMap[key].action) {
      newMap[key].action = upd.action;
      newMap[key].role = upd.role;
      newMap[key].created_at = upd.created_at;
    }
  });
  ```
  Unlike the global loader `fetchAllData` (Line 108), `fetchPlotDetails` lacks a fallback `else if (!newMap[key])` initialization block. If a task has updates in `task_updates` but no matching pre-populated assignment in `plot_task_assignments`, the key in `newMap` is undefined, and the update is discarded. 
  Additionally, unit tests expect `fetchPlotDetails` to return `.id` values from the database, but `latestUpdatesMap` objects do not store `id` fields.

---

## 4. Backend/Database Review

### 4.1 Public User Directory Leakage
* **File Reference**: `components/LoginView.tsx` (Lines 53-59) & `hooks/useBuildTrackData.ts` (Lines 271-278)
* **SQL Policy**: `supabase_security_migration.sql` (Line 71)
  ```sql
  CREATE POLICY "Allow public read access to users" ON public.users FOR SELECT TO public USING (true);
  ```
* **Vulnerability Detail**: To populate the user selection dropdown on the login screen, the frontend executes a select query on the `users` table on mount. Because the RLS policy on `public.users` permits public SELECT queries, anyone can query the REST API directly to retrieve the complete database of usernames, roles, and profiles.

### 4.2 Insecure Authentication Logic (Predictable Email & Suffix PINs)
* **File Reference**: `app/page.tsx` (Lines 455-468) & `supabase_security_migration.sql` (Lines 26-27)
* **Vulnerability Detail**: Supabase Auth requires an email and password. To accommodate the user selection dropdown and 4-digit PINs, the system generates login credentials programmatically:
  * **Email**: `LOWER(REPLACE(username, ' ', '')) || '@buildtrack.local'`
  * **Password**: `pin || 'BT!'`
  
  Since the user directory is public, an attacker can obtain usernames, construct their target email addresses, and brute-force the 4-digit PIN (10,000 permutations) against the GoTrue endpoint in a few seconds, gaining full system access.

### 4.3 Highly Permissive RLS Policies
* **File Reference**: `supabase_security_migration.sql` (Lines 74-84)
* **Vulnerability Detail**: The Row Level Security (RLS) rules grant full permission (`ALL`) to any `authenticated` user across all critical tables without checking user roles:
  ```sql
  CREATE POLICY "Allow auth all projects" ON public.projects FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all plots" ON public.plots FOR ALL TO authenticated USING (true) WITH CHECK (true);
  ```
  Any logged-in user, including a Foreman, can perform write, edit, or delete actions on projects, plots, tasks, and contractor templates, leading to privilege escalation risks.

### 4.4 Redundant & Dangling Public RLS Policies
* **File Reference**: `database_migrations.sql` (Lines 137-168)
* **Vulnerability Detail**: The initial migrations contain fallback public-access policies for tables such as `notifications`, `task_updates`, and `plot_task_assignments`:
  ```sql
  CREATE POLICY "Allow public select on notifications" ON notifications FOR SELECT USING (true);
  ```
  Because PostgreSQL policies are evaluated using `OR` logic, these public-write/read policies remain active even after `supabase_security_migration.sql` applies authenticated policies. Unauthenticated users can bypass Supabase Auth to directly select or insert records.

### 4.5 Defects Table Column Name Inconsistency
* **File Reference**: `app/page.tsx` (Lines 987 and 1137-1142)
* **Bug Detail**: When reporting a defect, the frontend inserts the record using the `task_id` column:
  ```typescript
  await supabase.from('defects').insert([{ plot_id: defectModal.plotId, task_id: defectModal.task?.id, ... }]);
  ```
  However, when a task is approved, the frontend attempts to resolve all associated pending defects using `task_template_id`:
  ```typescript
  await supabase.from('defects').update({ status: 'resolved' }).eq('plot_id', selectedPlot.id).eq('task_template_id', selectedTask.id);
  ```
  If the `defects` schema contains only one of these columns, one of the queries will throw a database error. If both columns exist but are populated inconsistently, the update query matches zero rows, leaving pending defects unresolved.

### 4.6 Site Engineer Task Approval Trigger Failure
* **File Reference**: `database_migrations.sql` (Lines 51-55) & `app/page.tsx` (Lines 1097-1110)
* **Trigger Code**:
  ```sql
  -- Calculate Max End Date (Only when QC approved)
  SELECT MAX(created_at) INTO max_end
  FROM task_updates
  WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
    AND action IN ('QC อนุมัติผ่าน', 'QC อนุมัติ');
  ```
* **Bug Detail**: The `update_task_progress_trigger()` trigger recalculates `actual_end_date` by querying updates where the action is `'QC อนุมัติผ่าน'` or `'QC อนุมัติ'`. When a Site Engineer approves a task, the action label inserted is `'Site Engineer อนุมัติ'`. Since this action is omitted from the trigger query, `max_end` evaluates to `NULL`, and the database updates `actual_end_date` in `plot_task_assignments` to `NULL`, erasing the completion date.

### 4.7 Inefficient Startup Fetching
* **File Reference**: `hooks/useBuildTrackData.ts` (Lines 26-40 and 67-71)
* **Bug Detail**: The startup hook loads all records from `plot_task_assignments` and `plot_task_schedules` recursively in blocks of 1,000 using `fetchWithoutLimit`. This pulls the history and status of all tasks across all projects, creating substantial database transaction overhead and slowing down app initialization as the database grows.

---

## 5. QA/Testing Review

### 5.1 Vitest running E2E tests conflict
* **File Reference**: `vitest.config.ts` (Lines 1-16)
* **Bug Detail**: The Vitest configuration does not specify exclusion rules for the `./e2e` directory. As a result, Vitest scans the entire project and attempts to execute the Playwright test file `e2e/dashboard.spec.ts` under its JSDOM environment, leading to a test suite crash:
  ```
  FAIL  e2e/dashboard.spec.ts
  Error: Playwright Test did not expect test.describe() to be called here.
  ```

### 5.2 Flawed Hook Unit Test Assertions
* **File Reference**: `hooks/__tests__/useBuildTrackData.test.ts` (Lines 19-23)
* **Observed Code**:
  ```typescript
  it('initially sets loading to true and does not fetch if user is null', () => {
    const { result } = renderHook(() => useBuildTrackData(null));
    expect(result.current.loading).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });
  ```
* **Bug Detail**: The assertion expects `supabase.from` not to be called when `loggedInUser` is null. However, `useBuildTrackData` runs a mount `useEffect` that unconditionally calls `fetchUsers()`, invoking `supabase.from('users')` to load the login dropdown values. This triggers a test assertion failure.

### 5.3 Missing Unit Test Mocks for Supabase Realtime
* **File Reference**: `hooks/__tests__/useBuildTrackData.test.ts` (Lines 6-10)
* **Bug Detail**: The mock configuration for Supabase in unit tests only overrides `.from`. When `loggedInUser` is defined, the custom hook triggers a realtime subscription call on `supabase.channel()`:
  ```typescript
  const channel = supabase.channel('realtime_task_updates').on(...).subscribe();
  ```
  Since `channel` is undefined in the mock, the test crashes with `TypeError: supabase.channel is not a function`. The test suite also lacks mocks for the `.range()` builder method used by `fetchWithoutLimit`.

### 5.4 Playwright Test Gaps
* **File Reference**: `playwright.config.ts` (Lines 14-23)
* **Bug Detail**: The Playwright configuration only targets Desktop Chromium and Desktop Firefox. It lacks coverage for WebKit (Safari) and mobile browser viewports, which are critical for site devices (e.g., iPhones and iPads). Additionally, the E2E runner initiates tests against `npm run dev` (development bundle) rather than production builds, reducing the capability to catch build-time assets issues.

---

## 6. DevOps Review

### 6.1 TypeScript Build Errors Ignored in next.config.ts
* **File Reference**: `next.config.ts` (Lines 3-8)
* **Observed Code**:
  ```typescript
  const nextConfig: NextConfig = {
    typescript: {
      ignoreBuildErrors: true,
    },
  };
  ```
* **Bug Detail**: The configuration deliberately disables typechecking during production compilation (`npm run build`). This allows type-unsafe and buggy builds to deploy successfully, elevating runtime production risks.

### 6.2 Oversized memory allocation and forced webpack in dev mode
* **File Reference**: `package.json` (Line 6)
* **Observed Code**:
  ```json
  "dev": "node --max-old-space-size=8192 node_modules/next/dist/bin/next dev --webpack",
  ```
* **Bug Detail**: The local dev script overrides the Node memory heap size to `8192` MB (8GB) and forces Webpack compilation instead of using Next.js's native Rust-based Turbopack (`--turbo`). This suggests memory leaks or bloated configurations are present, slowing compilation and increasing resource consumption on developer workstations.

---

## 7. Consolidated Action Plan

### 7.1 UX/UI & Frontend Resolution Plan
1. **Fix Tailwind Border Typos**:
   * Replace `border-black/5/80` and `border-black/5/60` with `border-black/5` or `border-black/10` in `components/DashboardOverview.tsx`.
   * Replace `border-black/5/50` with `border-black/5` or `border-black/10` in `components/HouseDetailView.tsx`.
2. **Implement Container Queries for Mobile Preview**:
   * Install and configure `@tailwindcss/container-queries`.
   * Wrap the mobile preview block in a `@container` div, and replace viewport classes (`sm:`, `md:`, etc.) inside that container with container queries (`@sm:`, `@md:`, etc.) to ensure desktop layouts scale down properly in preview frames.
3. **Graceful Geolocation Failures**:
   * Add a fallback error callback to `navigator.geolocation.getCurrentPosition`.
   * If permission is denied or retrieval fails, catch the error, set coordinates to a default location (e.g., Bangkok main office), log a console warning, and update the weather widget state to remove the loading spinner.
4. **Fix Session Inactivity Tracker**:
   * In `app/page.tsx` line 385, replace `localStorage.getItem('buildtrack_user')` with `loggedInUser` state validation. Ensure that updates to `buildtrack_last_active` occur when a valid Supabase Auth session exists.
5. **Optimize Gantt Grid Rendering**:
   * Remove individual `div` elements for each day marker.
   * Apply a single background grid on the chart wrapper using CSS linear gradients:
     ```css
     background-image: repeating-linear-gradient(to right, #e2e8f0 0px, #e2e8f0 1px, transparent 1px, transparent var(--cell-width));
     ```
     This reduces DOM nodes from thousands to zero for the grid lines.

### 7.2 Backend & Database Resolution Plan
1. **Eliminate Public User Directory Leak**:
   * Drop the public select policy in `supabase_security_migration.sql` (`Allow public read access to users`).
   * Replace the frontend select dropdown in `components/LoginView.tsx` with text inputs for Username and PIN.
2. **Transition to Secure Auth Credentials**:
   * Require users to register with strong passwords or implement secure OAuth. If PINs are required, enforce API-level rate limits on GoTrue and use dynamically salted PIN codes.
3. **Implement Role-Based Access Control (RBAC)**:
   * Update RLS policies to inspect the user's role metadata stored in their JWT claims:
     ```sql
     CREATE POLICY "Allow write projects to admin" ON public.projects 
     FOR ALL TO authenticated 
     USING (coalesce((auth.jwt() -> 'user_metadata' ->> 'role'), '') IN ('Admin', 'Owner', 'Project Planner'));
     ```
   * Restrict access on tables such as `projects`, `plots`, and `task_templates` to planners and admins. Restrict `task_updates` writes to site engineers, foremen, and QC.
4. **Purge Hanging Public Policies**:
   * Run migration queries to drop all public policies created in `database_migrations.sql` on `notifications`, `task_updates`, and `plot_task_assignments`.
5. **Standardize Defect Schema Columns**:
   * Update the DB schema and queries to use a single consistent column (e.g. `task_id`) to track defects. Update the resolution query in `handleReviewAction` in `app/page.tsx` to filter on `task_id` rather than `task_template_id`.
6. **Fix site engineer approval triggers**:
   * In `database_migrations.sql`, modify `update_task_progress_trigger` to compute `max_end` when progress reaches `100` rather than checking hardcoded QC strings:
     ```sql
     SELECT MAX(created_at) INTO max_end
     FROM task_updates
     WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
       AND progress = 100;
     ```
7. **Optimize Startup Fetching**:
   * Replace `fetchWithoutLimit` for `plot_task_assignments` and `plot_task_schedules` with filtered queries scoping data to the selected project.

### 7.3 QA & DevOps Resolution Plan
1. **Configure Vitest Path Exclusions**:
   * Update `vitest.config.ts` to include `exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**']`.
2. **Update custom hook unit tests**:
   * Modify the mock implementation of `supabase` to include stubs for `.channel()`, `.on()`, `.subscribe()`, and `.range()` methods.
   * Update Test 1 in `useBuildTrackData.test.ts` to expect a call to the `'users'` table.
   * Add the missing `else if (!newMap[key])` initialization block inside `fetchPlotDetails` in `hooks/useBuildTrackData.ts` to handle lazy loading updates correctly.
   * Modify Test 3 assertions to check `plot_id` and `task_template_id` instead of `.id`.
3. **Enhance Playwright Testing Scope**:
   * Add `webkit` (Safari) and mobile viewports (e.g., iPhone/iPad simulator profiles) to the projects configuration in `playwright.config.ts`.
   * Set `webServer.command` to `npm run build && npm run start` to test built production assets.
4. **Enforce Type Safety**:
   * Remove `ignoreBuildErrors: true` from `next.config.ts` to block builds with compilation errors from deploying.
5. **Optimize Dev Environment**:
   * Remove the `--webpack` override and memory heap size flags from the `dev` command in `package.json` to leverage native Turbopack compilation.
