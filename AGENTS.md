# BuildTrack AI Agent Instructions

## 1. Project Overview
**BuildTrack** is a construction progress tracking application (MVP). It provides dashboards and views for managing real estate development, including plot maps, house construction details, and task progression.

## 2. Tech Stack
- **Framework:** Next.js (App Router, v16+)
- **Styling:** Tailwind CSS v4, PostCSS
- **Database / Auth:** Supabase (PostgreSQL)
- **Icons:** Lucide React
- **Testing:** Vitest (Unit/Component tests) & Playwright (E2E tests)

## 3. Project Structure
- `app/`: Next.js App Router configuration. The main entry point is `app/page.tsx`.
- `components/`: Contains the core React components:
  - `DashboardOverview.tsx`: Main overview.
  - `HouseDetailView.tsx`: Specific house information.
  - `MapVisualizer.tsx`: Visual representation of plots.
  - `TaskProgressView.tsx`: Granular task tracking.
  - `OwnerAnalyticsDashboard.tsx`: Analytics for owners/admins.
  - `LoginView.tsx`: Authentication UI.
- `lib/` & `types/`: Utility functions, helpers, and TypeScript definitions.
- `*.sql`: Database migrations, security policies, and schema updates for Supabase.
- `e2e/` & `components/__tests__/`: Playwright and Vitest test directories.

## 4. Coding Conventions & Best Practices
- **TypeScript:** Enforce strict typing. Define interfaces for props and Supabase database models.
- **Components:** Favor functional components with React Hooks. Maintain modularity. If components like `page.tsx` grow too large, refactor them into smaller pieces in `components/`.
- **Styling:** Rely on Tailwind CSS utility classes. Avoid creating custom CSS rules unless necessary (in `app/globals.css`).
- **Database & Auth:** When interacting with Supabase, ensure Row Level Security (RLS) policies are respected. All database schema changes must be documented in `.sql` files.

## 5. Next.js Specific Rules
<!-- BEGIN:nextjs-agent-rules -->
**This is NOT the Next.js you know.**
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 6. Testing Guidelines
- Run unit tests with `npm run test` (Vitest).
- Run E2E tests with `npm run test:e2e` (Playwright).
- New components should include corresponding tests.
- Ensure all tests pass before making significant architectural or functional changes.

## 7. Workflow Directives for AI Agents
- **Don't guess:** If you are unsure about the database schema, check the `.sql` files (e.g., `database_migrations.sql`, `supabase_security_migration.sql`) before writing queries.
- **Read before write:** Always read the existing component code using `view_file` to understand its props and state before suggesting edits.
- **Context is key:** Keep the MVP scope in mind; focus on functionality, robustness, and a premium UI experience.

## 8. Subagent & Parallel Task Execution
- **Role of the Primary Agent (Manager):** The AI interacting *directly* with the user is the Manager. Only the Manager should break down tasks and delegate them.
- **Subagent Delegation Limits:** 
  - ONLY spawn subagents for complex tasks that clearly benefit from parallel execution (e.g., refactoring 3 separate files at once).
  - DO NOT spawn subagents for trivial tasks that can be done sequentially in a few steps.
  - **NO RECURSIVE SPAWNING:** Subagents must NOT spawn their own subagents. They must complete their assigned task and report back to the Manager.
  - Limit the number of concurrent subagents to a reasonable amount (e.g., max 3-4 at a time) to prevent resource loops.
- **Manager Responsibilities:**
  1. Break down the request and spawn subagents only when justified.
  2. Monitor progress, handle subagent responses, and summarize the final results for the user.
