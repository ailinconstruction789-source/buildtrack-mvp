# QA/Testing and DevOps Code Review - BuildTrack MVP

This report details the findings and suggestions for improvement from a read-only code review of the QA/Testing and DevOps aspects of the BuildTrack MVP project.

---

## 1. Observation

### Observation 1: Vitest config does not exclude Playwright tests directory
In `vitest.config.ts` (lines 1-16):
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
```
Running `npm run test` executes Vitest, which searches the entire project for files matching test patterns, thereby scanning the `e2e/` folder. This runs `e2e/dashboard.spec.ts`, which uses `@playwright/test` and fails with the following runtime error:
```
FAIL  e2e/dashboard.spec.ts [ e2e/dashboard.spec.ts ]
Error: Playwright Test did not expect test.describe() to be called here.
Most common reasons include:
- You are calling test.describe() in a configuration file.
- You are calling test.describe() in a file that is imported by the configuration file.
- You have two different versions of @playwright/test...
```

### Observation 2: Test 1 in `useBuildTrackData.test.ts` has a flawed assertion
In `hooks/__tests__/useBuildTrackData.test.ts` (lines 19-23):
```ts
  it('initially sets loading to true and does not fetch if user is null', () => {
    const { result } = renderHook(() => useBuildTrackData(null));
    expect(result.current.loading).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });
```
However, `hooks/useBuildTrackData.ts` (lines 280-282) executes a `useEffect` that calls `fetchUsers()` unconditionally on mount:
```ts
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);
```
`fetchUsers()` (lines 271-278) queries `supabase.from('users')`:
```ts
  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await supabase.from('users').select('*').order('role', { ascending: true }).order('username', { ascending: true });
      if (data) setAllUsers(data);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }, []);
```
This causes `supabase.from` to be called with `'users'`, leading to the assertion failure:
```
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
Received:
  1st vi.fn() call:
    Array [
      "users",
    ]
```

### Observation 3: Test 2 in `useBuildTrackData.test.ts` fails due to unmocked supabase.channel()
In `hooks/__tests__/useBuildTrackData.test.ts` (lines 6-10), the mock is declared as:
```ts
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));
```
When `loggedInUser` is provided, `hooks/useBuildTrackData.ts` (lines 291-318) triggers the realtime `useEffect` block which executes:
```ts
    const channel = supabase
      .channel('realtime_task_updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_updates' },
        (payload) => { ... }
      )
      .subscribe();
```
Since `supabase.channel` is not mocked, it throws:
```
TypeError: supabase.channel is not a function
 ❯ hooks/useBuildTrackData.ts:292:8
```

### Observation 4: Test 3 in `useBuildTrackData.test.ts` fails due to functional bugs in `fetchPlotDetails` and test expectations
In `hooks/__tests__/useBuildTrackData.test.ts` (lines 83-118), Test 3 mocks:
- `plot_task_schedules` returning `[{ plot_id: 'p2', task_template_id: 2 }]`
- `task_updates` returning `[{ id: 2, plot_id: 'p2', task_template_id: 2 }]`
- `plot_task_assignments` implicitly returning `[]` (mock fallback)

It then calls:
```ts
    await act(async () => {
      await result.current.fetchPlotDetails('p2');
    });

    expect(result.current.latestUpdatesMap['p2-2']).toBeDefined();
    expect(result.current.latestUpdatesMap['p2-2'].id).toBe(2);
```
However, in `hooks/useBuildTrackData.ts` (lines 189-208), `fetchPlotDetails` handles updating state as:
```ts
      setLatestUpdatesMap(prev => {
        const newMap = { ...prev };
        assignData?.forEach((a: any) => {
          const key = `${a.plot_id}-${a.task_template_id}`;
          if (!newMap[key]) {
            newMap[key] = { plot_id: a.plot_id, task_template_id: a.task_template_id, progress: a.current_progress || 0 };
          } else {
            newMap[key].progress = a.current_progress || 0;
          }
        });
        updData?.forEach((upd: any) => {
          const key = `${upd.plot_id}-${upd.task_template_id}`;
          if (newMap[key] && !newMap[key].action) {
            newMap[key].action = upd.action;
            newMap[key].role = upd.role;
            newMap[key].created_at = upd.created_at;
          }
        });
        return newMap;
      });
```
Because `assignData` is `[]`, no key is created in `newMap['p2-2']`.
When `updData` is processed, the condition `if (newMap[key] && !newMap[key].action)` evaluates to false because `newMap['p2-2']` is undefined. The updates from `updData` are ignored. This differs from `fetchAllData` which has an `else if (!latestUpdates[key])` branch.
Furthermore, the test expects `.id` to be `2`, but the code never writes `id` to the entries of `latestUpdatesMap` (even in `fetchAllData`). This leads to the following test failure:
```
AssertionError: expected undefined to be defined
 ❯ hooks/__tests__/useBuildTrackData.test.ts:114:53
```

### Observation 5: Component test coverage is extremely low
- In `components/__tests__/`, only `LoginView.test.tsx` exists.
- The major application views and components (`DashboardOverview.tsx`, `HouseDetailView.tsx`, `MapVisualizer.tsx`, `TaskProgressView.tsx`, and `OwnerAnalyticsDashboard.tsx`) have no component or unit tests.

### Observation 6: TypeScript compiler errors are ignored in Next.js builds
In `next.config.ts` (lines 3-8):
```ts
const nextConfig: NextConfig = {
  typescript: {
    // สั่งให้ Vercel ข้ามการเช็ก TypeScript Error
    ignoreBuildErrors: true,
  },
};
```
This forces production builds (`npm run build`) to ignore any type checking compilation errors.

### Observation 7: Oversized memory allocation and forced webpack in dev mode
In `package.json` (line 6):
```json
"dev": "node --max-old-space-size=8192 node_modules/next/dist/bin/next dev --webpack",
```
This overrides standard V8 memory limits with `8192` MB (8GB) and forces Webpack instead of Next.js's native Turbopack compiler.

### Observation 8: Playwright tests lack Safari (WebKit) and mobile viewport coverage
In `playwright.config.ts` (lines 14-23), only Desktop Chromium and Desktop Firefox are specified:
```ts
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
```
Additionally, `webServer` is configured to run `npm run dev` (lines 24-28), which runs the application in development mode instead of production (`npm run build && npm run start`).

---

## 2. Logic Chain

1. **Vitest E2E Failure**: Since `vitest.config.ts` has no `exclude` pattern targeting `./e2e`, Vitest scans the `./e2e` directory by default. Because Playwright spec files use `@playwright/test` runner primitives (which collide with Vitest's environment), the run fails. Excluding `**/e2e/**` will resolve this issue.
2. **Hook Test 1 Failure**: `useBuildTrackData` executes `fetchUsers()` on mount inside a `useEffect`. Since `fetchUsers` calls `supabase.from('users')`, the test assertion expecting `supabase.from` not to be called fails. Adjusting the mock expectation to account for the `'users'` table query makes the test accurate.
3. **Hook Test 2 Failure**: Testing the hook under a logged-in state invokes the realtime `useEffect` block, which attempts to call `supabase.channel()`. Since the mock object lacks `channel`, a runtime exception is thrown. Mocking the channel subscription methods resolves this crash.
4. **Hook Test 3 Failure**: In `fetchPlotDetails`, task updates are only appended to `latestUpdatesMap` if the plot assignment already exists in the state. Because the test mocks assignments as empty, the task update is ignored, leaving `latestUpdatesMap` empty. Additionally, because the hook doesn't propagate database IDs to `latestUpdatesMap`, asserting on `.id` will always return `undefined`. Aligning the hook logic with `fetchAllData` and modifying the test expectations fixes both issues.
5. **Next.js Production Safety**: Setting `ignoreBuildErrors: true` allows type-unsafe code to be deployed. Removing this or implementing pre-build type checking ensures only typecheck-passing code is deployed.
6. **Dev Resource Optimization**: The `8GB` memory flag and `--webpack` flag in the dev script indicate significant compilation load or potential memory leaks. Eliminating the webpack override and testing Turbopack (`--turbo`) could lead to faster compilation cycles and a smaller memory footprint.
7. **E2E Testing Fidelity**: E2E testing against the dev server (`npm run dev`) does not replicate production behavior. Testing against a built production server (`npm run build && npm run start`) is the industry standard for catching build-time assets issues. Also, adding WebKit/mobile viewports guarantees compatibility for field devices (iOS Safari).

---

## 3. Caveats

- Playwright E2E tests were not run locally due to terminal command approval timeouts; however, their behavior and configuration were thoroughly analyzed statically.
- No other databases or third-party integrations (aside from Supabase client config) were inspected since database access is mocked in unit tests and config-based in the application.

---

## 4. Conclusion

The testing setup in the BuildTrack MVP is currently broken due to:
- A configuration conflict between Vitest and Playwright.
- Missing mock implementations and logical errors in the React custom hook tests.

Furthermore, several DevOps settings (`ignoreBuildErrors: true`, oversized memory allocations, dev server for E2E tests) introduce deployment risks and slow down developer feedback loops.

### Actionable Suggestions:

1. **Fix Vitest configuration**: Exclude the E2E directory in `vitest.config.ts`:
   ```ts
   test: {
     exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
     // ... rest of config
   }
   ```
2. **Fix `useBuildTrackData.test.ts`**:
   - Update `vi.mock` for `@/lib/supabase` to include mock implementations for `channel` and `removeChannel`.
   - Update Test 1 to expect a call for the `'users'` table.
   - Fix `fetchPlotDetails` in `hooks/useBuildTrackData.ts` to create the update map key if it does not exist, and update Test 3's assertion to check valid fields (`plot_id`, `task_template_id`) rather than `.id`.
3. **Enhance Playwright configurations**:
   - Run E2E tests against built assets by setting `webServer.command` to `npm run build && npm run start`.
   - Add `webkit` (Safari) and mobile viewports (e.g., `devices['iPhone 12']`) to the `projects` array.
4. **Enforce Type Safety**: Remove `ignoreBuildErrors: true` from `next.config.ts`.
5. **Optimize Dev Script**: Clean up the `dev` script in `package.json` to leverage Turbopack instead of enforcing legacy Webpack with massive heap allocations.

---

## 5. Verification Method

### Test suite execution
1. Run `npm run test`
   - *Expected pass condition*: All 21 tests in `LoginView.test.tsx` and `useBuildTrackData.test.ts` pass, and `e2e/dashboard.spec.ts` is excluded and not run by Vitest.
2. Run `npm run test:e2e`
   - *Expected pass condition*: Playwright starts the server, compiles, and successfully passes the login dashboard flow.

### Files to Inspect
- `vitest.config.ts`: verify `test.exclude` contains `**/e2e/**`.
- `hooks/__tests__/useBuildTrackData.test.ts`: verify that mock object has `channel` and `removeChannel`.
- `hooks/useBuildTrackData.ts`: verify `fetchPlotDetails` has the `else if (!newMap[key])` branch.
