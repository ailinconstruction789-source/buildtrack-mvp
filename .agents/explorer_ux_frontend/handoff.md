# Handoff Report — UX/UI and Frontend Code Review

## 1. Observation

During a comprehensive, read-only review of the BuildTrack MVP frontend and UX/UI, the following issues were observed:

### A. Tailwind CSS Syntax Typos
1. **Invalid color opacity syntax in Dashboard**:
   * File: `components/DashboardOverview.tsx` (Lines 112, 120)
     ```typescript
     className="flex bg-slate-200/60 p-1 rounded-xl w-fit border border-black/5/80"
     className="flex bg-slate-200/60 p-1 rounded-xl shrink-0 border border-black/5/80"
     ```
   * File: `components/DashboardOverview.tsx` (Line 209)
     ```typescript
     className="text-[10px] sm:text-xs text-slate-400 flex items-center gap-1.5 mt-3 pt-3 border-t border-black/5/60"
     ```
2. **Invalid color opacity syntax in Gantt grid**:
   * File: `components/HouseDetailView.tsx` (Line 290)
     ```typescript
     className={`border-l h-full relative ${m.isMonth ? 'border-black/10 bg-slate-200/20' : 'border-black/5/50'}`}
     ```
   * *Verbatim code*: Classes like `border-black/5/80`, `border-black/5/60`, and `border-black/5/50` are invalid. Tailwind CSS color opacity syntax expects `color/opacity` (e.g. `border-black/10` or `border-black/5`). Adding multiple slashes/numbers leads to Tailwind compiler ignoring the rule.

### B. Mobile Preview Layout Bug
* File: `app/page.tsx` (Lines 1180, 1337)
  ```typescript
  const isMobileLayout = isMobilePreview || isRealMobile;
  ...
  <div className={`${isMobilePreview ? 'w-[390px] h-[844px] bg-slate-50 border-[14px] ...' : 'flex h-screen w-full ...'}`}>
  ```
* *Behavior*: The "Mobile Preview" mode on desktop wraps the app in a fixed-size `div` (`w-[390px] h-[844px]`). However, because Tailwind's responsive modifiers (`sm:`, `md:`, `lg:`, `xl:`) evaluate against the browser's viewport width rather than the container's width, the layout inside the mobile wrapper still applies desktop styles (e.g., large padding, multi-column grids) instead of mobile ones.

### C. Incomplete Geolocation Error Handling
* File: `app/page.tsx` (Lines 187-232, 1768)
  ```typescript
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (position) => {
      ...
    });
  }
  ```
* *Behavior*: `getCurrentPosition` is called without an error callback. If the user declines geolocation permission or if the browser blocks it, the state `weatherInfo` remains `null`, causing the weather widget to display `กำลังโหลด...` with an active spinner indefinitely.

### D. Missing Image Extensions in Upload Paths
* File: `app/page.tsx` (Line 1030)
  ```typescript
  const path = `${selectedPlot.id}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  ```
* *Behavior*: Image files uploaded to Supabase Storage do not have file extensions (e.g. `.jpg` or `.png`). This causes files to be served with default or empty MIME types on some clients, potentially triggering download behaviors instead of in-browser rendering.

### E. Session Activity Tracker Bug
* File: `app/page.tsx` (Line 384-386)
  ```typescript
  const updateActivity = () => {
    if (localStorage.getItem('buildtrack_user')) {
      const last = parseInt(localStorage.getItem('buildtrack_last_active') || '0');
      ...
  ```
* *Behavior*: The session activity tracker checks `localStorage.getItem('buildtrack_user')`. However, in the updated authentication migration to Supabase Auth, `buildtrack_user` is never set in `localStorage`. This means the tracker never updates the activity timestamp, resulting in a forced logout after exactly 60 minutes, even if the user is actively working.

### F. Gantt Chart DOM Bloat
* File: `components/HouseDetailView.tsx` (Lines 290, 680)
  * Vertical grid lines are drawn by mapping `timeMarkers` (representing each day) inside the header and every task row:
    ```typescript
    {timeMarkers.map((m: any, i: any) => ( <div key={i} className={`border-l h-full ...`} style={{ left: `${m.left}%`, width: `${(1 / totalChartDays) * 100}%` }}></div> ))}
    ```
  * *DOM Count*: With a 6-month timeline (180 days) and 25 tasks, this renders `25 * 180 = 4,500` absolute-positioned `div`s as a background grid. On low-end site tablets, this causes noticeable layout lag.

### G. Unit and E2E Test Suite Failures
Running `npm run test` generates the following test failures:
1. **Vitest E2E Conflict**: Vitest scans and runs Playwright's `e2e/dashboard.spec.ts` under jsdom, causing it to crash:
   ```
   FAIL  e2e/dashboard.spec.ts
   Error: Playwright Test did not expect test.describe() to be called here.
   ```
2. **`fetchUsers` assertion fail**:
   ```
   FAIL  hooks/__tests__/useBuildTrackData.test.ts > useBuildTrackData Hook > initially sets loading to true and does not fetch if user is null
   AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times (with "users")
   ```
   * *Cause*: `fetchUsers` is executed in a `useEffect` on mount regardless of whether `loggedInUser` is null, but the test asserts `expect(supabase.from).not.toHaveBeenCalled()`.
3. **`channel` function crash**:
   ```
   FAIL  hooks/__tests__/useBuildTrackData.test.ts > useBuildTrackData Hook > fetches all data when loggedInUser is provided
   TypeError: supabase.channel is not a function
   ```
   * *Cause*: The unit test mock for Supabase does not mock `.channel()`, `.on()`, and `.subscribe()` required for real-time `task_updates` listening.
4. **Missing `.range()` mock**:
   * *Cause*: The mock helper `createMockChain` lacks the `range` method required by `fetchWithoutLimit` calls:
     `TypeError: __vite_ssr_import_1__.supabase.from(...).select(...).range is not a function`
5. **Logic Inconsistency in `fetchPlotDetails`**:
   ```
   FAIL  hooks/__tests__/useBuildTrackData.test.ts > useBuildTrackData Hook > fetchPlotDetails lazily loads specific plot data and updates state atomically
   AssertionError: expected undefined to be defined
   ```
   * *Cause*: In `useBuildTrackData.ts` (line 199), `fetchPlotDetails` only updates existing keys in `latestUpdatesMap` when parsing updates:
     `if (newMap[key] && !newMap[key].action) { ... }`
     Unlike `fetchAllData` (line 108), it lacks the fallback `else if (!latestUpdates[key])` initialization block. Thus, if a task has updates but no assignment, it is excluded from `latestUpdatesMap`.

---

## 2. Logic Chain

1. **Tailwind Oppacity Slashes**: Slashes in Tailwind are strictly parsed for opacity (e.g. `opacity/value`). Classes containing multiple slashes (like `/5/80`) violate parser grammar and are ignored, leaving components with no border colors.
2. **Viewport vs Container Queries**: Responsive Tailwind classes like `lg:grid-cols-3` match the window object size. Placing them inside a fixed `div` of `390px` width on a `1920px` desktop window applies large screen styles in a cramped container, breaking the UI.
3. **Indefinite Spacing**: Calling an asynchronous geolocator without handling the failure callback means state updates are never dispatched if it fails. The spinner stays in its loading state forever.
4. **Unextended Paths**: Supabase storage paths are served as generic content streams without file extensions. Without a proper extension (like `.jpg`), browsers might not know how to render the binary data directly, leading to display issues.
5. **Activity Expiry**: `localStorage.getItem('buildtrack_user')` is a legacy key from the initial login system. Since authentication was migrated to Supabase Auth, this key is never written, preventing the throttle tracker from updating `buildtrack_last_active` and triggering session timeouts during active use.
6. **DOM Bloat**: Absolute layout grids mapping every single day per row creates an exponential number of DOM nodes (`tasks * days`). Replacing individual `div` elements with repeating linear gradients reduces DOM nodes to zero for the background grid.
7. **Test suite crashes**:
   * Vitest uses default configuration patterns and matches `*.spec.ts`, which includes Playwright E2E tests. Excluding `e2e` in `vitest.config.ts` will restrict Vitest to unit tests.
   * Testing client-side mocks must fully implement the target API surfaces (like `.channel()`, `.range()`) to prevent `TypeError: X is not a function` errors.

---

## 3. Caveats

* Review was conducted entirely via read-only static analysis and logs. Local browser execution of visual states (e.g., actual look of the Gantt chart or 2.5D layer stacking) was not inspected interactively.
* The Supabase database migrations were analyzed statically. Actual Row Level Security (RLS) policies were not tested against SQL injections or direct access bypasses.

---

## 4. Conclusion

The BuildTrack MVP is a feature-rich, interactive portal, but contains critical UX/UI bugs (broken session tracking, infinite geolocator spinners, broken mobile preview styling, invalid border classes), performance hazards (DOM bloat in the Gantt grid), and test configuration mismatches. 

### Actionable Recommendations:
1. **Fix typos in Tailwind classes**:
   * Replace `border-black/5/80` and `border-black/5/60` with `border-black/5` or `border-black/10`.
   * Replace `border-black/5/50` with `border-black/10` or a standard opacity class.
2. **Correct Session Tracker**:
   * In `app/page.tsx` line 385, replace `localStorage.getItem('buildtrack_user')` with `loggedInUser` to allow the active session heartbeat to function.
3. **Handle Geolocation Failures**:
   * Supply an error callback to `getCurrentPosition` to set a default fallback (e.g. Bangkok coordinates) and hide the loader spinner.
4. **Optimize Gantt Grid Drawing**:
   * Instead of rendering `div` elements for every day cell, apply a CSS repeating grid background on the task row containers.
5. **Update Vitest Configuration**:
   * Add `exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**']` to `vitest.config.ts` to stop Vitest from trying to run Playwright E2E tests.
6. **Fix Unit Test Mocks**:
   * Add mock implementations for `supabase.channel()`, `.on()`, `.subscribe()`, and `.range()` to resolve type errors in `useBuildTrackData.test.ts`.
7. **Resolve `fetchPlotDetails` logic discrepancy**:
   * Add the missing `else if (!newMap[key])` block in `fetchPlotDetails` to populate updates for plots lacking assignments.

---

## 5. Verification Method

To independently verify these findings:
1. Inspect the test suite run with:
   `npm run test`
   Observe the failures under `useBuildTrackData.test.ts` and the Playwright E2E crash under Vitest.
2. Open `app/page.tsx` and navigate to the `updateActivity` function (Line 384) to verify the legacy `buildtrack_user` check.
3. Open `components/DashboardOverview.tsx` and search for `/5/` to verify the broken Tailwind classes.
