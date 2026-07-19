# Backend & Database Code Review Report

## 1. Observation

A detailed read-only code review of the database files, security migrations, backend schemas, and Supabase interaction libraries in the BuildTrack MVP project was conducted. Below are the key direct observations:

### 1.1 User Directory Leakage on Login View
- **File**: `components/LoginView.tsx` (lines 53-59)
  ```tsx
  <select id="username-select" value={loginData.username} onChange={e => setLoginData({...loginData, username: e.target.value})} className="w-full bg-[#f5f5f7] border border-black/5 rounded-2xl px-5 py-4 font-bold outline-none focus:border-blue-500 focus:bg-white transition-colors text-[#1d1d1f] appearance-none">
    <option value="" disabled>-- เลือกชื่อของคุณ --</option>
    {(allUsers || []).map(u => <option key={u.id} value={u.username}>{u.username} ({u.role})</option>)}
  </select>
  ```
- **File**: `hooks/useBuildTrackData.ts` (lines 271-278)
  ```typescript
  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await supabase.from('users').select('*').order('role', { ascending: true }).order('username', { ascending: true });
      if (data) setAllUsers(data);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }, []);
  ```
- **File**: `supabase_security_migration.sql` (lines 71-72)
  ```sql
  CREATE POLICY "Allow public read access to users" ON public.users FOR SELECT TO public USING (true);
  CREATE POLICY "Allow authenticated full access to users" ON public.users FOR ALL TO authenticated USING (true) WITH CHECK (true);
  ```

### 1.2 Insecure Authentication (4-Digit PIN + Predictable Email & Salt)
- **File**: `app/page.tsx` (lines 455-468)
  ```typescript
  const handleLogin = async () => {
    if (!loginData.username || !loginData.pin) return;
    setIsLoggingIn(true);
    try {
      // 🛡️ เข้าสู่ระบบอย่างปลอดภัยผ่าน Supabase Auth
      const email = `${loginData.username.toLowerCase().replace(/\s/g, '')}@buildtrack.local`;
      const password = `${loginData.pin}BT!`;

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  ```
- **File**: `supabase_security_migration.sql` (lines 26-27)
  ```sql
  LOWER(REPLACE(username, ' ', '')) || '@buildtrack.local',
  crypt(pin || 'BT!', gen_salt('bf')),
  ```

### 1.3 Highly Permissive RLS Policies (Lack of RBAC)
- **File**: `supabase_security_migration.sql` (lines 74-84)
  ```sql
  -- นโยบายสำหรับตารางอื่นๆ: ให้คนที่ Login แล้วอ่านและแก้ไขได้เต็มที่
  CREATE POLICY "Allow auth all projects" ON public.projects FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all plots" ON public.plots FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all task_templates" ON public.task_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all assignments" ON public.plot_task_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all schedules" ON public.plot_task_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all updates" ON public.task_updates FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all defects" ON public.defects FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all notifications" ON public.notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all contractors" ON public.contractors FOR ALL TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "Allow auth all house_types" ON public.house_types FOR ALL TO authenticated USING (true) WITH CHECK (true);
  ```

### 1.4 Redundant & Dangling Public RLS Policies
- **File**: `database_migrations.sql` (lines 137-168)
  ```sql
  ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
  ALTER TABLE task_updates ENABLE ROW LEVEL SECURITY;
  ALTER TABLE plot_task_assignments ENABLE ROW LEVEL SECURITY;

  -- Fallback permissive policies so the app continues to function with client-side auth.
  DROP POLICY IF EXISTS "Allow public select on notifications" ON notifications;
  CREATE POLICY "Allow public select on notifications" ON notifications FOR SELECT USING (true);
  DROP POLICY IF EXISTS "Allow public insert on notifications" ON notifications;
  CREATE POLICY "Allow public insert on notifications" ON notifications FOR INSERT WITH CHECK (true);
  ...
  ```

### 1.5 Defects Table Column Name Inconsistency
- **File**: `app/page.tsx` (line 987 - Defect Insert)
  ```typescript
  const { error } = await supabase.from('defects').insert([{ plot_id: defectModal.plotId, task_id: defectModal.task?.id, description: newDefectText.trim(), reported_by: loggedInUser?.username || currentUserRole, status: 'pending', image_url: imageUrls.join(',') }]);
  ```
- **File**: `app/page.tsx` (lines 1137-1142 - Automatic Defect Resolution on Task Approval)
  ```typescript
  if (isApproved) {
    await supabase.from('defects')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('plot_id', selectedPlot.id)
      .eq('task_template_id', selectedTask.id)
      .eq('status', 'pending');
  }
  ```

### 1.6 Trigger Logic Failure on Site Engineer Task Approvals
- **File**: `database_migrations.sql` (lines 51-55)
  ```sql
  -- Calculate Max End Date (Only when QC approved)
  SELECT MAX(created_at) INTO max_end
  FROM task_updates
  WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
    AND action IN ('QC อนุมัติผ่าน', 'QC อนุมัติ');
  ```
- **File**: `app/page.tsx` (lines 1097-1110)
  ```typescript
  setIsSending(true); const finalP = isApproved ? 100 : 95; const roleLabel = currentUserRole === 'Site Engineer' ? 'Site Engineer' : 'QC'; const actionLabel = isApproved ? `${roleLabel} อนุมัติ` : `${roleLabel} แจ้งแก้ไข`;
  try {
    ...
    const { error } = await supabase.from('task_updates').insert([{ plot_id: selectedPlot.id, task_template_id: selectedTask.id, user_name: loggedInUser.username, role: currentUserRole, action: actionLabel, text_content: inputText || (isApproved ? 'งานเรียบร้อยดี ตรวจผ่าน' : 'พบข้อบกพร่อง กรุณาแก้ไข'), progress: finalP, image_url: imageUrls.join(','), weather_info: weatherInfo ? `${weatherInfo.currentDetails.icon} ${weatherInfo.currentDetails.text} (${weatherInfo.currentTemp}°C)` : null }]);
  ```

### 1.7 Inefficient Full-Table Data Fetching on Startup
- **File**: `hooks/useBuildTrackData.ts` (lines 26-40 and 67-71)
  ```typescript
  const fetchWithoutLimit = async (table: string) => {
    let allData: any[] = [];
    let from = 0; let to = 999;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase.from(table).select('*').range(from, to);
      ...
  ```
  ```typescript
  fetchWithoutLimit('plot_task_assignments'),
  fetchWithoutLimit('plot_task_schedules'),
  ```

---

## 2. Logic Chain

### 2.1 Credential Harvesting Risk
1. PostgreSQL enables public read access on `public.users` via RLS (Observation 1.1).
2. The frontend fetches the entire list of users and roles on mount to display in a login select dropdown (Observation 1.1).
3. Therefore, an unauthenticated attacker can query the public API to fetch the usernames and roles of all project personnel.

### 2.2 PIN Brute-Forcing Risk
1. User emails are generated predictably from their usernames (`LOWER(REPLACE(username, ' ', '')) || '@buildtrack.local'`) (Observation 1.2).
2. The user passwords in the DB are hashed values of the 4-digit PIN concatenated with a static string suffix `'BT!'` (Observation 1.2).
3. 4-digit PINs offer only 10,000 possible permutations.
4. Using the scraped username directory and predictable email/password scheme, an attacker can brute-force the PIN code of high-privilege users (such as Admins or Owners) in a few seconds directly against Supabase GoTrue auth.

### 2.3 Escalation of Privilege and Data Destruction Risk
1. The RLS policies grant `ALL` permissions on critical tables (like `projects`, `plots`, `task_templates`) to `authenticated` users without role checks (Observation 1.3).
2. Because PostgreSQL RLS policies for a table are evaluated using `OR` logic, the lingering public write/select policies created in `database_migrations.sql` remain active alongside the new `authenticated` policies (Observation 1.4).
3. As a result, even unauthenticated guests (or low-privileged authenticated users like Foremen) can execute insert, update, or delete commands on the database, allowing them to delete projects, overwrite plans, or create arbitrary admin accounts.

### 2.4 Defect Auto-Resolution Malfunction
1. When a new defect is submitted, the frontend inserts it using the `task_id` column (Observation 1.5).
2. When a task is approved, the frontend attempts to resolve pending defects for the task by filtering on `task_template_id` (Observation 1.5).
3. If the DB schema contains `task_id`, the approval update query will fail due to referencing the non-existent `task_template_id` column. If both exist but only `task_id` is populated, the update will match 0 rows, leaving the defect in `pending` status indefinitely.

### 2.5 `actual_end_date` Wiping Bug
1. When a task is approved by a Site Engineer, the update is inserted with action `'Site Engineer อนุมัติ'` (Observation 1.6).
2. The database trigger on `task_updates` calculates `max_end` (representing the final completion time) only when the action matches `'QC อนุมัติผ่าน'` or `'QC อนุมัติ'` (Observation 1.6).
3. Consequently, the trigger resolves `max_end` to `NULL` for Site Engineer approvals, and overwrites `actual_end_date` in `plot_task_assignments` to `NULL`. The completion date is permanently lost.

### 2.6 Startup Overhead and Scalability Bottlenecks
1. Upon logging in, the frontend runs `fetchWithoutLimit` on both assignments and schedules tables, recursively loading 1,000-row pages (Observation 1.7).
2. This loads the scheduling and progress details for all plots across all projects in the system.
3. This creates a massive bandwidth, memory, and database read transaction overhead that will degrade performance linearly as the database grows, potentially hitting Supabase free-tier limits or throttling thresholds.

---

## 3. Caveats

- **No Direct DB Schema Access**: The exact schema definitions of the tables (e.g. `defects` and `task_updates`) could not be inspected via `pg_dump` or `CREATE TABLE` commands since no DDL script is versioned in the workspace. However, the exact column names were inferred with high confidence from DML queries, select filters, and database triggers.
- **Storage Buckets Configuration**: Supabase Storage bucket configurations and their associated policies are not versioned in the codebase's SQL scripts. It is assumed they are configured manually via the Supabase Dashboard, which should be verified on the live console.

---

## 4. Conclusion

The database and backend integration of the BuildTrack MVP contains critical security vulnerabilities and logical bugs.
- **Authentication & Authorization**: The combination of public directory exposure, 4-digit PINs with static salts, and permissive RLS policies makes the system highly susceptible to account compromise and unauthorized data alteration.
- **System Integrity**: Inconsistencies in column names (`task_id` vs `task_template_id`) and trigger checks (hardcoded to `'QC อนุมัติ'`) prevent defects from auto-resolving and wipe task completion dates.
- **Performance**: Full-table fetches on startup will cause scalability issues as data accumulates.

### 4.1 Recommendations for Improvement

#### 1. Secure Authentication & Directory Exposure
- Remove the public select dropdown of usernames on the login screen. Require users to type their username or email.
- Change the RLS policy on `public.users` to restrict `SELECT` access to authenticated users only.
- Force longer password requirements or implement a proper OAuth flow. If PINs must be used, enforce brute-force rate limits on the auth API and use dynamic salting.

#### 2. Implement Role-Based Access Control (RBAC) in RLS
- Drop all lingering public policies from `database_migrations.sql`.
- Update tables' policies to inspect the user's role from the JWT token:
  ```sql
  CREATE POLICY "Allow write projects to admin" ON public.projects 
  FOR ALL TO authenticated 
  USING (coalesce((auth.jwt() -> 'user_metadata' ->> 'role'), '') IN ('Admin', 'Owner', 'Project Planner'));
  ```
- Allow write permissions to `task_updates` and `defects` to only roles that require them (e.g. `Foreman`, `Site Engineer`, `QC`).

#### 3. Standardize Defects Column Names
- Modify `handleReviewAction` and any other component querying `defects` to consistently use the correct column name. If the database uses `task_id`, the update filter in `handleReviewAction` should be:
  ```typescript
  .eq('task_id', selectedTask.id)
  ```

#### 4. Fix Database Trigger for Task Completions
- Modify the database trigger function `update_task_progress_trigger()` to check for completion based on progress reaching `100` instead of a hardcoded action string:
  ```sql
  SELECT MAX(created_at) INTO max_end
  FROM task_updates
  WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
    AND progress = 100;
  ```

#### 5. Paginate and Filter Core Data Queries
- Replace full-table queries on startup (`plot_task_assignments` and `plot_task_schedules`) with scoped queries filtered by `project_name` or `plot_id` of the active dashboard view.
  - Example: `supabase.from('plot_task_assignments').select('*, plots!inner(project_name)').eq('plots.project_name', selectedProject.name)`

---

## 5. Verification Method

### 5.1 Command-Line Verification
- To verify that no code changes break the existing mocked expectations, run the Vitest test suite:
  ```bash
  npm run test
  ```
- *Note on Test Failures*: The existing test suite in `hooks/__tests__/useBuildTrackData.test.ts` was run and failed (3 tests failed). Investigation reveals this is due to outdated test mocks:
  1. The mock does not stub `supabase.channel()` which is called when `loggedInUser` mounts (throwing `supabase.channel is not a function`).
  2. The mock does not stub data for `plot_task_assignments` during the lazy-load test, which is now required by the optimized hook to initialize keys.
  3. The mock expects no calls to `supabase.from()` if `loggedInUser` is null, but the hook now unconditionally fetches users to populate the login dropdown.
  Therefore, before implementing any backend modifications, the test suite mocks should be updated to match the hook's requirements.

### 5.2 SQL Policy & Trigger Inspection (to be run on Supabase SQL Editor)
- To list all active policies and confirm if public policies are still active alongside authenticated policies, run:
  ```sql
  SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check 
  FROM pg_policies 
  WHERE schemaname = 'public';
  ```
- To verify the behavior of the database trigger on Site Engineer approvals:
  1. Insert a mock `task_update` with `progress = 100` and `action = 'Site Engineer อนุมัติ'`.
  2. Query `plot_task_assignments` for that plot and task.
  3. Verify if `actual_end_date` is `NULL` (invalid status) or set to the timestamp of the update (valid status).
