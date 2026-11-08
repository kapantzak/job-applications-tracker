---
name: project-testing
description: "Mandatory workflow when adding or changing tests, or before claiming validation is complete, in this repository. Use before writing vitest tests under test/server, test/ui or test/e2e, before touching vitest.config.ts, and before stating that the suite passes."
---
# Testing in this repository

## Purpose

Keep the suite fast, hermetic and pristine: no real agents, no real Gmail, no leaked handles, and tests that assert real behaviour against a real in-memory database or a real HTTP server.

## Scope

Use this skill when:

- adding tests under `test/server/`, `test/ui/`, `test/e2e/`;
- changing `vitest.config.ts`, `test/ui/setup.ts`, `test/server/api/harness.ts`;
- claiming "tests pass" in a SOW or report.

Do not use this skill for:

- production code changes that need no new tests (rare; justify in the SOW).

## Mandatory Knowledge

- Two vitest projects: `server` (node; `test/server/**`, `test/e2e/**`) and `ui` (jsdom; `test/ui/**`). `npm test` runs both. Evidence: `vitest.config.ts`.
- Server tests open `openDatabase(':memory:')` and call `migrate(db)`; rows that need foreign keys insert a profile first (`insertTestProfile(db)` from `test/server/db/test-profile.ts`), then a `runs` row with that `profile_id` (UUID string ids). Evidence: `test/server/db/*.test.ts`.
- Migrations that rebuild tables set `foreignKeysOff: true`; the runner turns foreign keys off around the transaction and fails the migration on any `foreign_key_check` row. Test such a migration on a database built from the earlier migrations with invented rows (counts, ownership, row order, indexes, `foreign_keys` back on) and with a dangling reference to prove the rollback. Evidence: `test/server/db/migrations.test.ts` (`versionTwo()`).
- API tests go through `test/server/api/harness.ts`, which creates one profile (`h.profile`, prefix `h.base` = `/api/profiles/<id>`) and sends `Host: 127.0.0.1:4173` because the request guard rejects other hosts; JSON writes must send `Content-Type: application/json` or get 415. Evidence: `src/server/api/guard.ts`, `test/server/api/guard.test.ts`.
- The API harness (SOW-0023) gives every test its own temporary `deps.dataDir` (removed in `cleanup()`) and a real CV service; set `h.agentRun` to control what the stub adapter's `run()` returns (it throws by default). Wait for an analysis with `waitFor(() => h.deps.cvService.current()?.status === '...')`.
- Profile CV analyses (SOW-0024) are tested in `test/server/api/profile-cv-analysis.test.ts` (owners side by side, Save with `cv_analysis_id`, failure injection on `profilesRepo.setCv`, crash recovery by placing `*.new` files and calling `startup()`); the review rules are pure functions in `src/ui/cv-review.ts` tested in `test/ui/cv-review.test.ts`. The Profile page mocks `getCvAnalysis` (null by default), which it calls with the profile id.
- CV files are built in memory by `test/fixtures/cv-files.ts` (`makePdf`, `makeDocx`, `makeZip`, `makeOdt`, `makeDoc`, `makePng`, invented `CV_LINES`); never commit a binary CV fixture, because real documents carry author metadata. `makePdf([])` is a page without text, standing in for a scanned CV.
- Pages that create profiles call `getCvAnalysis` on mount; mock it (`null` by default) in every test that renders the first-run screen or New profile, including `test/ui/App.test.tsx`.
- UI tests mock `src/ui/api/client.js` with `vi.mock`, render inside `MemoryRouter`, call `afterEach(cleanup)` (globals are off), and use `userEvent`. Evidence: `test/ui/*.test.tsx`.
- Process tests use `test/fixtures/fake-agent.mjs` via `process.execPath`; timeout tests wait for the fixture's pid file instead of sleeping. Evidence: `test/server/agents/cli-adapter.test.ts`.
- The mock sandbox (SOW-0028) has its own tests in `test/server/sandbox-mock/`: `seed.test.ts` runs `seedMockData` on an in-memory database (foreign keys, state coverage, settings), and `mock-agent.test.ts` runs `scripts/sandbox-mock/mock-agent.mjs` through the real custom adapter with `--delay-ms 0` and parses its output with the task schemas. A schema, prompt heading or repository change that breaks the sandbox fails there.
- Network tests start a local `http.createServer` on `127.0.0.1` port 0 and call `closeAllConnections()` in `afterAll`. Evidence: `test/server/verify/links.test.ts`.
- Verifier rules tied to a real host (the Greenhouse `error=true` soft 404, SOW-0016) cannot be served by a local server; inject `fetchImpl` into `verifyLink` and route by URL, and keep a look-alike-host negative case. Evidence: `test/server/verify/links.test.ts` ("Greenhouse soft 404").
- UI tests that replace `fetch` use `vi.spyOn(globalThis, 'fetch')` so `vi.restoreAllMocks()` puts the real one back; older tests that assign `globalThis.fetch` are tracked in SOW-0005.
- Invented data only: companies like `Acme`, addresses at `example.com`, message ids like `msg-001`. Never paste real run logs. Evidence: `AGENTS.md` sensitive-data note.
- The UI uses shadcn/ui (Radix). Sheets and confirmation dialogs render in a portal on `document.body`: open them through their trigger, then scope queries with `within(await screen.findByRole('dialog' | 'alertdialog', { name }))`. Assert the action did not run before confirmation and add a Cancel test. Evidence: `test/ui/SettingsPage.test.tsx` (purge), `test/ui/JobsPage.test.tsx` (dismiss), `test/ui/ApplicationsPage.test.tsx` (add sheet).
- `test/ui/setup.ts` stubs `ResizeObserver`, which Radix radio and checkbox need and jsdom lacks. Selects stay native (`NativeSelect`), so `user.selectOptions` works; do not switch them to Radix `Select` without adding pointer-capture and `scrollIntoView` stubs.
- Profile pages get their profile from the shell context, not the URL (SOW-0015): wrap them in `<InProfile>` from `test/ui/profile-shell.tsx` (`TEST_PROFILE`: id `pf1`, slug `platform-roles`) and route them under `/profiles/:profileSlug/...`. Expect the id in client calls and the slug in links. `Layout` tests mock `getProfileBySlug`; `test/ui/App.test.tsx` re-imports the app per test because of its once-per-load startup flag.
- CI runs `npm ci`, `npm run typecheck` and `npm test` on `ubuntu-latest` with Node 22 and `lts/*` (`.github/workflows/ci.yml`, SOW-0022), and sets `CI=true`. Tests must pass on Linux as well as macOS, need no network beyond `127.0.0.1`, and must finish within the job's 15-minute timeout. A local pass is not proof of a CI pass; check the PR's run.
- `insertTestProfile(db, name)` also writes `slug` (from `slugBase(name)`), so give each test profile a distinct name.
- The UI project resolves the `@/` alias to `src/ui` (`vitest.config.ts`). Tests import pages by relative path as before. Pages are tested without `Layout`, so the sidebar and `matchMedia` stay out of page tests; `test/ui/theme.test.ts` stubs `matchMedia` with `vi.stubGlobal` and restores it in `afterEach`.

## Best Practices

- Assert stored rows and exact call arguments, not just status codes or "was called".
- Poll with a bounded `waitFor` helper for async settlement; no fixed sleeps longer than needed.
- One behaviour per test name; the name states the expected outcome.

## Bad Practices

- `expect(await screen.findBy…(x)).toHaveTextContent(…)` (or `toHaveValue`) on an element that is already rendered before the expected state, such as a location or context probe: `findBy` resolves at once and the assertion races the update. It passed locally and failed on CI Node 22. Wait for the state instead: `await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(…))`; a mock that resolves after a short `setTimeout` proves the wait. Evidence: `test/ui/ProfilePage.test.tsx` ("moves to the new slug after a rename"), `test/ui/Layout.test.tsx`.
- Bare `toThrow()` without a message match.
- Reassigning `globalThis.fetch` without restoring it.
- Running `npm test` and reporting counts without pasting the summary line.

## Workflow Checklist

1. Write the failing test first; run only that file (`npx vitest run <file>`).
2. Implement; re-run the file.
3. Run `npm test` and `npm run typecheck` once before committing; confirm "no warnings" in the output.
4. For UI, watch for `act(...)` warnings; they are failures.

## Validation Checklist

Before claiming done:

- `npm test` summary line pasted into the SOW or report.
- No new `.skip`, no `only`.
- Fixtures and data invented.
- The e2e test still passes when the change touches the API, adapter, queue, or prompts.

## Evidence

- `vitest.config.ts`, `test/server/api/harness.ts`, `test/fixtures/fake-agent.mjs`.
- `SOW-0001`: per-task reviews repeatedly flagged weak assertions; this checklist is the response.

## Update Rules

Update this skill when:

- a new project or environment is added to vitest;
- a new shared fixture or harness appears;
- a reviewer finds a test-hygiene failure this list did not prevent.
