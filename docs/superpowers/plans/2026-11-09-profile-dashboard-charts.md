# Profile Dashboard Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Dashboard's three count tiles with four linked tiles, a status bar, a pipeline funnel and a needs-attention list, fed by one new profile-scoped summary route.

**Architecture:** A pure function `summarizeDashboard` computes counts, funnel reach and quiet applications from a profile's applications and history; `GET /api/profiles/:pid/dashboard` serves it. The UI draws the charts with plain Tailwind flex bars, the shadcn `Tooltip`, `Card` and `Empty` components, and new status color tokens.

**Tech Stack:** TypeScript, Hono, better-sqlite3, React, react-router, Tailwind v4, shadcn/ui (Radix), vitest + Testing Library.

**Spec:** `.agents/sow/done/SOW-0034-20261109-profile-dashboard-charts.md`, section "Design" (authoritative; this plan argues from it). The SOW moved from `pending/` to `current/` before Task 1, and to `done/` at close.

> **Superseded during execution:** SOW Decisions 7 and 8 (taken after Task 3) override this plan. Bar segments and funnel tracks are not focusable, and tooltips show on hover only, so ignore "focusable `TooltipTrigger`" in Task 3 and "on keyboard focus" in Task 5. Dark-mode colours go faint to strong. Decision 6 moved the `listApplications` cleanup into Task 4.

## Global Constraints

- No new dependencies. No chart library (Decision 4).
- No raw `button`/`input`/`select`/`textarea`/`table` outside `src/ui/components/ui/` (AGENTS.md); use shadcn `Button`, `Card`, `Empty`, `Tooltip`, and `react-router` `Link`.
- "In progress" = `applied` + `screening` + `interview` (Decision 1). Never reuse or change the sync "open" rule in `applications-repo.ts:38-39`.
- `QUIET_DAYS = 14`. Quiet statuses: `applied`, `screening`, `interview` only.
- Funnel stage ranks: `applied` 1, `screening` 2, `interview` 3, `offer` 4. `rejected` and `no_response` imply at least rank 1; `saved` and `withdrawn` imply nothing.
- Invented data only in tests and docs (`Acme`, `Globex`, `example.com`).
- Match surrounding style by hand; never run `prettier --write` on an existing file.
- Commit only the files a task names; never `git add -A`. Commit messages describe the change and never mention tooling or assistants (no co-author trailer).
- The server stays bound to `127.0.0.1`; the new route sits under the existing `/api` guard.

## Review Focus

- A profile whose applications are all `saved`: total > 0, funnel all 0. Expect no `NaN`, no `%`, zero-width fills, and the bar card still shown (not the empty state). Test in Task 3 ("funnel with all zero counts").
- All applications in one status: the bar has exactly one segment, rounded at both ends. Test in Task 3 ("one status fills the bar").
- An `applied_at` in the future (a typo in the add form): negative days must not count as quiet. Test in Task 1 ("future applied_at is not quiet").
- A tile or legend link must open the Applications page with exactly that filter applied. The href format must be the repeated `?status=` form that `src/ui/table-view.ts:86-103` parses. Hrefs asserted in Tasks 3–4; click-through in Task 5.
- Long company and role names in the attention list must not widen the card or push the layout sideways at narrow widths. Manual check in Task 5 at 375 px.

---

### Task 1: Summary rules (pure function)

**Files:**
- Create: `src/server/domain/dashboard.ts`
- Test: `test/server/domain/dashboard.test.ts`

**Interfaces:**
- Consumes: `Application`, `ApplicationStatus`, `StatusHistoryEntry`, `APPLICATION_STATUSES` from `src/server/domain/types.ts`.
- Produces:
  ```ts
  export const QUIET_DAYS = 14;
  export const FUNNEL_STAGES = ['applied', 'screening', 'interview', 'offer'] as const;
  export type FunnelStage = (typeof FUNNEL_STAGES)[number];
  export type QuietStatus = 'applied' | 'screening' | 'interview';
  export interface QuietApplication { id: string; company: string; role: string; status: QuietStatus; since: string; days: number }
  export interface DashboardSummary {
    total: number;
    status_counts: Record<ApplicationStatus, number>;
    funnel: Record<FunnelStage, number>;
    pending_proposals: number;
    quiet: QuietApplication[];
    quiet_days: number;
  }
  export type HistoryRow = Pick<StatusHistoryEntry, 'application_id' | 'from_status' | 'to_status' | 'changed_at'>;
  // `history` arrives ordered by changed_at, then insertion; the first row per application is its earliest.
  export function summarizeDashboard(apps: Application[], history: HistoryRow[], pendingProposals: number, now: Date): DashboardSummary;
  ```

- [ ] **Step 1: Write the failing tests**

  Use `now = new Date('2026-11-09T12:00:00Z')`, a builder `app(overrides)` with defaults `{ id, profile_id: 'p1', company: 'Acme', role: 'SRE', status: 'applied', applied_at: <now>, status_changed_at: <now>, ... }`, and `row(appId, from, to, at)`. Test names and assertions:
  - "empty profile": `total 0`, all eight `status_counts` keys present and `0`, funnel all `0`, `quiet []`, `quiet_days 14`.
  - "counts every status": statuses `[saved, applied, applied, rejected]` give `saved 1, applied 2, rejected 1`, others `0`, `total 4`.
  - "skipped step counts as passed": history `applied→interview` gives funnel `{applied 1, screening 1, interview 1, offer 0}`.
  - "creation status comes from the first row": app now `rejected`, one row `interview→rejected` gives funnel interview `1`.
  - "direct rejected and no_response count as applied": `rejected` with no history and `no_response` with no history give funnel `{applied 2, screening 0, ...}`.
  - "saved then withdrawn is not applied": row `saved→withdrawn` gives funnel applied `0`; a lone `saved` also `0`.
  - "offer reaches every stage": `offer` with no history gives all four `1`.
  - "14 days is quiet, 13 is not": `applied`, no history, `applied_at` `'2026-10-26T12:00:00.000Z'` gives `quiet[0]` `{ status: 'applied', since: '2026-10-26T12:00:00.000Z', days: 14 }` (`since` is the stored string unchanged). `applied_at` `'2026-10-26T12:00:01.000Z'` (13.99 days) is not quiet.
  - "backdated applied date counts": no history, `applied_at` 30 days ago, `status_changed_at` = now gives `days 30`.
  - "a real status change uses status_changed_at": row `saved→applied` at 20 days ago, `status_changed_at` 20 days ago, `applied_at` 3 days ago gives quiet with `days 20`.
  - "null applied_at falls back": `applied`, no history, `applied_at null`, `status_changed_at` 15 days ago gives `days 15` with `since` = `status_changed_at`.
  - "interview uses status_changed_at; offer and no_response never quiet": `interview` changed 15 days ago is quiet; `offer` and `no_response` changed 30 days ago are not.
  - "future applied_at is not quiet": `applied_at` 2 days ahead of `now` is not quiet.
  - "quiet is oldest first": days 30, 15, 20 come back as 30, 20, 15.
  - "pending proposals pass through": `pendingProposals 3` gives `pending_proposals 3`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run test/server/domain/dashboard.test.ts`
  Expected: FAIL (cannot resolve `src/server/domain/dashboard.js`).

- [ ] **Step 3: Implement `summarizeDashboard` in `src/server/domain/dashboard.ts`**

  Group history by `application_id`, keeping input order. Statuses held = first row's `from_status` (when non-null) or the current status if there is no history, plus every `to_status`, plus the current status. Reach = max rank, with `rejected`/`no_response` mapped to 1. Quiet clock: `since = (history.length === 0 && status === 'applied') ? (applied_at ?? status_changed_at) : status_changed_at`; `days = Math.floor((now.getTime() - Date.parse(since)) / 86_400_000)`; quiet when `days >= QUIET_DAYS`. Sort quiet by `days` descending.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run test/server/domain/dashboard.test.ts`
  Expected: PASS, all tests.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server/domain/dashboard.ts test/server/domain/dashboard.test.ts
  git commit -m "Add the dashboard summary rules for status counts, funnel reach and quiet applications"
  ```

### Task 2: History read, dashboard route and client call

Load `.agents/skills/project-local-api/SKILL.md` and `.agents/skills/project-testing/SKILL.md` before starting.

**Files:**
- Modify: `src/server/db/applications-repo.ts` (add `historyForProfile`, return it from the repo object)
- Create: `src/server/api/dashboard.ts`
- Modify: `src/server/api/profiles.ts:182-185` (mount)
- Modify: `src/ui/api/client.ts` (add `getDashboard`)
- Test: `test/server/db/applications-repo.test.ts`, `test/server/api/dashboard.test.ts` (new), `test/ui/client.test.ts`

**Interfaces:**
- Consumes: `summarizeDashboard`, `DashboardSummary` (Task 1); `applicationsRepo.list(profileId)`; `proposalsRepo.listPending(profileId)`.
- Produces:
  - `applicationsRepo.historyForProfile(profileId: string): StatusHistoryEntry[]`. SQL: `SELECT h.* FROM status_history h JOIN applications a ON a.id = h.application_id WHERE a.profile_id = ? ORDER BY h.changed_at ASC, h.rowid ASC`.
  - `createDashboardRouter(deps: AppDeps): Hono<ProfileEnv>` with `GET /`, which returns `summarizeDashboard(list, historyForProfile, listPending(...).length, new Date())` for `c.get('profile').id`.
  - Mounted as `scoped.route('/:pid/dashboard', createDashboardRouter(deps))`.
  - `export const getDashboard = (profileId: string): Promise<DashboardSummary> => request('GET', scoped(profileId, '/dashboard'));` with `import type { DashboardSummary } from '../../server/domain/dashboard.js'`.
- [ ] **Step 1: Write the failing tests**
  - Repo, "historyForProfile returns only that profile's rows, oldest first": two profiles (`insertTestProfile(db, 'Platform roles')`, `insertTestProfile(db, 'Data roles')`), each with an application moved `applied→screening→interview`. Expect 2 rows for profile 1, all with its application id, `to_status` order `[screening, interview]`.
  - API, "GET dashboard summarizes only this profile": create `Acme` (`interview`, via `setStatus` from `applied`) and `Globex` (`saved`) for `h.profile`, and `Initech` (`offer`) for `h.deps.profilesRepo.create(OTHER)`. Add one pending proposal on `Acme`, created through a `runsRepo.create('sync_mail', ...)` run as in `test/server/api/proposals.test.ts:17`. Expect status 200 with `total 2`, `status_counts.interview 1`, `status_counts.saved 1`, `status_counts.offer 0`, `funnel.interview 1`, `pending_proposals 1`, `quiet_days 14`.
  - API, "unknown profile is 404": `GET /api/profiles/nope/dashboard` gives 404.
  - Client, "getDashboard calls GET on the profile's dashboard": the fetch spy sees `/api/profiles/pf1/dashboard` with method `GET`, and the body comes back unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run test/server/db/applications-repo.test.ts test/server/api/dashboard.test.ts test/ui/client.test.ts`
  Expected: FAIL (missing `historyForProfile`, 404 on the route, missing `getDashboard`).

- [ ] **Step 3: Implement the repo read, router, mount and client call as in Interfaces**

- [ ] **Step 4: Run the tests to verify they pass**

  Run: the same command. Expected: PASS. Then run `npm run typecheck`; expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/server/db/applications-repo.ts src/server/api/dashboard.ts src/server/api/profiles.ts src/ui/api/client.ts test/server/db/applications-repo.test.ts test/server/api/dashboard.test.ts test/ui/client.test.ts
  git commit -m "Serve a per-profile dashboard summary at /api/profiles/:pid/dashboard"
  ```

### Task 3: Status colors and the three dashboard cards

Load `.agents/skills/project-testing/SKILL.md` and the `dataviz` skill (for the validator) before starting.

**Files:**
- Modify: `src/ui/styles.css` (tokens in `:root` and `.dark`; `--color-status-*` in `@theme inline`)
- Create: `src/ui/components/dashboard/status-colors.ts`, `StatusBarCard.tsx`, `FunnelCard.tsx`, `AttentionCard.tsx`
- Test: `test/ui/dashboard-cards.test.tsx`

**Interfaces:**
- Consumes: `DashboardSummary`, `QuietApplication`, `FunnelStage` (Task 1); `STATUS_LABELS` (`src/ui/labels.ts`); `APPLICATION_STATUSES`.
- Produces:
  - CSS tokens `--status-saved`, `--status-applied`, `--status-screening`, `--status-interview`, `--status-offer` (one blue ramp, light → dark), and `--status-rejected`, `--status-withdrawn`, `--status-no-response` (neutral grays, `rejected` darkest). Each has a separate dark-mode value. Exposed as Tailwind colors `status-<name>` (e.g. `bg-status-no-response`).
  - `STATUS_COLOR_CLASS: Record<ApplicationStatus, string>` (`'bg-status-saved'`, …).
  - `StatusBarCard(props: { total: number; counts: Record<ApplicationStatus, number>; href: (path: string) => string })`
  - `FunnelCard(props: { funnel: DashboardSummary['funnel'] })`
  - `AttentionCard(props: { pendingProposals: number; quiet: QuietApplication[]; href: (path: string) => string })`
  - Each card wraps its tooltips in its own `TooltipProvider`, because page tests render without `Layout` and the sidebar's provider.

- [ ] **Step 1: Pick the color steps and validate them**

  Choose hex steps for both themes. Then run `node <dataviz base>/scripts/validate_palette.js "<interview>,<offer>,<rejected>" --mode light` and repeat with `--mode dark`, checking the light→dark order and contrast against the card surface (`#ffffff` light, the `.dark` `--card` dark). Lighter steps below 3:1 are allowed only because the legend prints every count (relief rule). Save the output for the SOW Validation section.

- [ ] **Step 2: Write the failing tests** (render inside `InProfile` + `MemoryRouter`; `href = (p) => '/profiles/platform-roles' + p`)
  - "status bar title and legend": counts `{saved 4, applied 12, screening 3, interview 2, offer 1, rejected 6, withdrawn 1, no_response 5}`, total 34. Heading "Where your 34 applications stand". Eight legend entries in `APPLICATION_STATUSES` order, each with label and count. The "Applied 12" entry is a link to `/profiles/platform-roles/applications?status=applied`.
  - "singular title and zero entries": total 1 (`applied 1`) gives "Where your 1 application stands"; the "Offer 0" entry is not a link.
  - "bar image label lists non-zero statuses": `getByRole('img')` has `aria-label` `"Saved: 4, Applied: 12, Screening: 3, Interview: 2, Offer: 1, Rejected: 6, Withdrawn: 1, No response: 5"`, joined in that order with `STATUS_LABELS`.
  - "one status fills the bar": counts `{applied 3}` render exactly one `[data-status]` segment.
  - "segment tooltip": hover the Applied segment and `findByRole('tooltip')` has text "Applied: 12 (35%)".
  - "funnel rows": funnel `{applied 30, screening 14, interview 6, offer 1}` shows rows Applied `30`, Screening `14` `47%`, Interview `6` `43%`, Offer `1` `17%`, and the footnote "% = share of the step above".
  - "funnel with all zero counts": all `0` gives no text matching `/%$/` on any row and no `NaN` anywhere.
  - "funnel hides % after an empty step": `{applied 3, screening 0, interview 0, offer 0}` shows no percentage on the Interview row.
  - "attention lists proposals and quiet applications": `pendingProposals 3` gives a link "3 status proposals waiting" to `/profiles/platform-roles/review`. A quiet `applied` at 21 days reads "Applied 21 days ago, no reply"; a quiet `interview` at 15 days reads "Interview, no change in 15 days". Each company · role links to `/profiles/platform-roles/applications/<id>`.
  - "one proposal is singular, none hides the line": `1` gives "1 status proposal waiting"; `0` gives no proposal line.
  - "shows five, then the rest on request": 7 quiet show 5 items and a button "Show 2 more"; clicking it shows 7 items and removes the button.
  - "nothing to do": `0` proposals and `[]` quiet show "Nothing needs you right now."

- [ ] **Step 3: Run the tests to verify they fail**

  Run: `npx vitest run test/ui/dashboard-cards.test.tsx`
  Expected: FAIL (modules missing).

- [ ] **Step 4: Implement the tokens and the three cards as in Interfaces and SOW "Design → Layout" items 3–4**

  Bar: `flex gap-0.5 h-3.5`, one segment per non-zero status with `style={{ flexGrow: count }}`, `data-status={status}`, and outer `rounded-l`/`rounded-r` on the first and last segments. Each segment is a focusable `TooltipTrigger`. Percent = `Math.round(count / total * 100)`. Funnel percentage = `Math.round(count / previous * 100)` when `previous > 0`, else hidden; fill width = `count / funnel.applied`, or `0` when `funnel.applied` is 0. The "Show M more" control is a shadcn `Button` with `variant="link"`.

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `npx vitest run test/ui/dashboard-cards.test.tsx` and `npm run typecheck`
  Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/ui/styles.css src/ui/components/dashboard/ test/ui/dashboard-cards.test.tsx
  git commit -m "Add status color tokens and the dashboard status bar, funnel and attention cards"
  ```

### Task 4: Dashboard page in the E1 layout

**Files:**
- Modify: `src/ui/pages/DashboardPage.tsx`
- Modify: `src/ui/api/client.ts:176-177` (drop the `open` argument)
- Test: `test/ui/DashboardPage.test.tsx`, plus any test that passes `open` to `listApplications` (`grep -rn "listApplications(" test src`)

**Interfaces:**
- Consumes: `getDashboard` (Task 2); `StatusBarCard`, `FunnelCard`, `AttentionCard` (Task 3); existing `listJobs`, `listRuns`, `getSettings`, `StatCard`, `Empty*` from `@/components/ui/empty`.
- Produces: `listApplications(profileId: string): Promise<Application[]>`, with the `open` argument removed (SOW Decision 6; the Dashboard was its only caller). The server's `?open=1` query stays.

- [ ] **Step 1: Update the test mocks and write the failing tests**

  In the `vi.mock` block, replace `listApplications`/`listProposals` with `getDashboard`. Fixture: a summary with `status_counts {applied 12, screening 3, interview 2, offer 1, ...}`, `total 34`, `pending_proposals 3`, 2 quiet items. `listJobs` resolves 3 jobs.
  - "tiles show counts and link to matching lists": `count-in-progress` text `17`, href `/profiles/platform-roles/applications?status=applied&status=screening&status=interview`. `count-interviews` `2`, href `…?status=interview`. `count-offers` `1`, href `…?status=offer`. `count-proposals` `3`, href `/profiles/platform-roles/review`.
  - "shows the bar, funnel and attention cards": headings "Where your 34 applications stand", "How far applications get", "Needs attention".
  - "discovery line carries the jobs count": text matches `/Last discovery: .+ · 3 jobs/`. When `listJobs` rejects, the line has no `jobs` suffix and an error alert shows.
  - "empty profile shows the empty state": `total 0` shows "No applications yet" with a link to `/profiles/platform-roles/jobs`, no "Where your" heading, and tiles at `0`.
  - "a failed summary still shows runs and agent": `getDashboard` rejects with `Error('Summary failed')`. The alert shows "Summary failed", the tiles show `–`, and "Last successful runs" and the Agent card are present.
  - Replace "renders the three counts" and "renders what loaded when one fetch fails" with the tests above. Keep every other existing test (Find jobs, Sync, max effort, agent, sync scope) passing unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run test/ui/DashboardPage.test.tsx`
  Expected: FAIL on the new tests.

- [ ] **Step 3: Rewrite `DashboardPage.tsx` to SOW "Design → Layout" items 1–6**

  Load with `Promise.allSettled([getDashboard, listJobs, listRuns, getSettings])`. Tile grid `grid-cols-2 sm:grid-cols-4`. Bottom row `grid gap-4 sm:grid-cols-5`, with the funnel `sm:col-span-3` and attention `sm:col-span-2`. Remove the old Jobs tile and the `count-applications`/`count-jobs` ids.

- [ ] **Step 4: Run the full suite and typecheck**

  Run: `npm run typecheck && npm test`
  Expected: typecheck clean. vitest summary line shows 0 failed; paste it into the SOW.

- [ ] **Step 5: Commit**

  ```bash
  git add src/ui/pages/DashboardPage.tsx src/ui/api/client.ts test/ui/DashboardPage.test.tsx   # plus any test file the grep found
  git commit -m "Show status tiles, status bar, funnel and needs-attention list on the Dashboard"
  ```

### Task 5: Docs, spec, real-use check and SOW close

**Files:**
- Modify: `README.md` (add a Dashboard bullet near line 112)
- Modify: `.agents/sow/specs/product-v1.md` (Dashboard contract and the new route)
- Move and modify: `.agents/sow/current/SOW-0034-20261109-profile-dashboard-charts.md` → `.agents/sow/done/`

- [ ] **Step 1: Same-failure search**

  Run: `grep -rn "count-applications\|count-jobs\|listProposals(profileId)" src test`
  Expected: no hit in `DashboardPage.tsx` or its test. Other pages may still call `listProposals`.

- [ ] **Step 2: Write the docs and spec**

  README, one bullet: "The Dashboard shows In progress, Interviews, Offers and To review tiles, a bar of every status, how far applications get (Applied → Screening → Interview → Offer), and applications with no change in 14 days." Spec: the same contract, the quiet and funnel rules, and `GET /api/profiles/:pid/dashboard`.

  Vocabulary (SOW Decision 6), in both README and spec, next to the existing sync lines (README lines 35 and 104): "Open applications are the ones sync still checks for replies: applied, screening, interview, no response, and offers from the last 30 days. The Dashboard's In progress count is applied, screening and interview only."

- [ ] **Step 3: Real-use check**

  Run `npm run sandbox:mock -- --no-open --port 0` and open the printed URL for the rich and the sparse profile. Check, with screenshots described in the SOW (invented data only):
  - desktop and 375 px width, light and dark theme;
  - every tile and legend link opens Applications with that filter set and the matching row count;
  - a quiet item opens its detail page;
  - tooltips appear on hover and on keyboard focus;
  - long names wrap without horizontal scroll.

  Stop the server using the PID you started.

- [ ] **Step 4: Independent review**

  A fresh reviewer reviews the branch diff against the SOW Design section. Record each finding and how it was handled in the SOW.

- [ ] **Step 5: Fill the SOW Validation, Outcome, Lessons and Follow-up sections; set `Status: completed`; `git mv` it to `.agents/sow/done/`; run `bash .agents/sow/audit.sh`**

  Expected: audit verdict clean.

- [ ] **Step 6: Commit**

  ```bash
  git add README.md .agents/sow/specs/product-v1.md .agents/sow/done/SOW-0034-20261109-profile-dashboard-charts.md docs/superpowers/plans/2026-11-09-profile-dashboard-charts.md
  git commit -m "Document the dashboard charts and close SOW-0034"
  ```

  (`git mv` already staged the removal from `current/`.)
