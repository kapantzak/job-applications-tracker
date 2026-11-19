# SOW-0049 - Show the Dashboard Journey graph in the demo video

## Status

Status: completed

Sub-state: recorded and validated on 2026-11-19 on branch `Update-docs`; committed with the work once the user approves. The GitHub attachment upload (SOW-0048 decision 16A) follows on this video.

## Requirements

### Purpose

Show viewers of the README demo the Dashboard's Journey graph (the flow chart from Applied to Offer) with enough applications for it to mean something.

### User Request

"Can we have a video that shows the flow chart on the dashboard (with many applications)?" Then "All recommended" for decisions 1-4 below.

### Assistant Understanding

Facts:

- The flow chart is the Journey view (`src/ui/components/dashboard/JourneyCard.tsx`, spec `.agents/sow/specs/product-v1.md:76`).
- Journey opens by default only from 10 sent applications (`JOURNEY_MIN_SENT`, `src/ui/dashboard-view.ts:7`) on windows of 1280 px or more (`:9`); the video is 1440 px wide.
- The SOW-0048 demo ends with two sent applications (the job marked applied, moved to interview by the accepted proposal, and the accepted Contoso Pharma), so its Dashboard shows Breakdown.
- The mock seed's main profile has 8 sent applications (`scripts/sandbox-mock/seed.ts:256-280`), also below 10.
- `POST /api/profiles/:pid/applications` creates an application without a history row; `POST .../applications/:id/status` changes status and always writes a history row (`src/server/api/applications.ts:33,62,84`). Funnel reach uses the current status and every history `to_status` (spec line 72), so applications moved through the stages by the status route count at the stage they reached.

Inferences:

- Every added history row is dated at recording time. Journey shows no dates; the Needs attention quiet list (no change for 14 days) will be empty, which the video does not claim otherwise.

Unknowns:

- None that block; the Journey layout with these numbers is checked by watching frames.

### Acceptance Criteria

- The video continues after the existing Dashboard scene with the card "A few weeks later: 42 applications sent.", then the Journey view with the two approved captions and a pointer hover that opens a red ribbon's tooltip, then the existing end card. Checked by frame inspection.
- The Dashboard summary after the additions matches decision 3 exactly (Applied 42, Screening 18, Interview 8, Offer 2, 3 saved, the per-stage exits below); the script fails otherwise.
- `npm run demo:video` stays one command on a fresh data folder; the seed and its tests are unchanged.
- No personal data in frames, poster, script or docs.

## Analysis

Sources checked:

- `src/ui/dashboard-view.ts`, `src/ui/pages/DashboardPage.tsx:137,240-280`, `src/ui/components/dashboard/JourneyCard.tsx` (`data-stage`, `data-exit` groups, hover tooltips "N rejected after applying").
- `src/server/api/applications.ts`, spec lines 70-76, `scripts/sandbox-mock/seed.ts`, `scripts/demo-video/record.mjs` (storyboard scene 10, `api()` helper).
- `.agents/sow/done/SOW-0048-20261119-demo-video.md` (storyboard decisions, post-close decision 16A: upload the final MP4 as a GitHub attachment).

Current state:

- Video is 76.4 s and ends on Breakdown; README has no Journey image.

Risks:

- A full page reload would reset the injected overlay and flash the card; navigate inside the app instead.
- A pointer move by Playwright's `click` while the card is up would desync the drawn pointer; use DOM clicks under the card.
- The ribbon's bounding-box centre may lie outside its curved shape; pick a hover point the ribbon actually covers.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- The demo never reaches 10 sent applications, so the Journey default (`chooseView`, `src/ui/dashboard-view.ts`) never selects it; showing it needs more applications in the recorded profile.

Evidence reviewed:

- Files listed under Sources checked; SOW-0048 validation and lessons.

Affected contracts and surfaces:

- `scripts/demo-video/record.mjs` (storyboard), `docs/video/demo.mp4`, `docs/video/demo-poster.png` (length changes), `README.md` (video description sentence), `AGENTS.md` (video procedure: path now includes Journey), this SOW. No app code, API, schema or spec change.

Existing patterns to reuse:

- `api()` helper with the loopback Host header and JSON content type; `director` caption/card/point helpers; SOW-0048's frame-inspection procedure.

Risk and blast radius:

- Script-only; the app, tests and seed are untouched. The recording takes about 15 s longer.

Sensitive data handling plan:

- Invented company names only (word + "Labs"/"Systems"), no real people or mail; frames checked before commit. The upload to GitHub (decision 16A in SOW-0048) is done by the user after this re-recording.

Implementation plan:

1. After scene 10's caption: show the time-jump card, add the applications through the API to reach the decision-3 numbers (computed as the difference from the current summary, failing on a negative difference), assert the summary, then navigate Applications → Dashboard with DOM clicks under the card.
2. Hide the card on the Journey view; caption 1; hover the Applied "rejected" ribbon at a point it covers until its tooltip shows; caption 2; existing end card.
3. Record, inspect frames, update README sentence and AGENTS.md, validate, review.

Validation plan:

- `npm run demo:video` twice; ffprobe length; frames at each new caption (Journey fully visible above the caption bar, tooltip open, counts as decided); `npm test` and `npm run typecheck` unaffected; independent review of the script diff; same-failure search for overlay-resetting reloads in the script.

Artifact impact plan:

- AGENTS.md: video procedure bullet names the Journey scene and the API-added applications.
- Runtime project skills: none expected; `project-testing` covers the mock and seed, which do not change.
- Specs: none; no product behaviour changes.
- End-user/operator docs: README video description and length.
- End-user/operator skills: none exist.
- SOW lifecycle: completes here; the GitHub upload and README player (SOW-0048 decision 16A) follow on the final video.

Open-source reference evidence:

- None; only this repository was checked.

Open decisions:

- None; decisions 1-4 below are resolved.

## Implications And Decisions

1. Placement: **A** - append to the existing video before the end card, with a time-jump card (one video, one upload). Rejected B: a separate short video.
2. Data: **A** - `record.mjs` adds the applications through the app's API under the card; seed unchanged. Rejected B: a new seeded profile.
3. Numbers: **A** - 42 sent: Applied 42 → Screening 18 → Interview 8 → Offer 2, plus 3 saved. Exits: Applied 12 waiting, 8 rejected, 3 no response, 1 withdrawn; Screening 3 waiting, 6 rejected, 1 withdrawn; Interview 2 waiting, 4 rejected; Offer 2. Includes the demo's own applications.
4. Captions: **A** - card "A few weeks later: 42 applications sent."; caption "Journey follows every application from Applied to Offer."; pointer hovers a red ribbon to open its tooltip with caption "Branches show where applications stopped: waiting, rejected or no response."; then the existing end card.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-19

- SOW created with decisions 1-4 (user: "All recommended").
- Added `JOURNEY`, `addJourneyApplications` and scene 11 to `scripts/demo-video/record.mjs` (lines 305-350 and 451 on).
- Run 1: 88.0 s; frames showed the graph with the decided counts and the tooltip "8 rejected after applying". The graph was scrolled into view under the card, so no scroll shows on screen.
- Independent review: no failing bug; two minor findings fixed (see Validation). Run 3 after the fixes: 88.2 s.

## Validation

Acceptance criteria evidence:

- Scene order and text: frames at 66-88 s (contact sheets under `.tmp/`, not committed) show "See where every application stands." on Breakdown, the card "A few weeks later: 42 applications sent.", the Journey view with "Journey follows every application from Applied to Offer.", the pointer on the Applied rejected ribbon with its tooltip "8 rejected after applying" and the caption "Branches show where applications stopped: waiting, rejected or no response.", then the end card. A full-resolution crop at 78.5 s is sharp and readable.
- Numbers: the graph reads Applied 42, Screening 18 · 43%, Interview 8 · 44%, Offer 2 · 25%; exits 12 waiting, 8 rejected, 3 no response, 1 withdrawn; 3 waiting, 6 rejected, 1 withdrawn; 2 waiting, 4 rejected; 2 offers; caption "42 sent · 3 saved, not applied yet"; tiles In progress 17, Interviews 2, Offers 2, Rejected 18. The script compares the dashboard summary with decision 3 and throws on any difference.
- One command on a fresh data folder: `npm run demo:video` exit 0 three times (88.0 s, 88.6 s, 88.2 s). Seed, mock agent and tests unchanged (`git diff --stat` lists only `record.mjs`, README, AGENTS.md, the video files and SOW files).

Tests: `npm run typecheck` exit 0; `npm test` 81 files, 1299 tests passed.

Real use: the three recordings above; output 1440×900, yuv420p, limited range, `color_space=bt709` (same tags as the committed SOW-0048 video), 2,192,095 bytes; poster shows "Watch the demo · 1:28" over the faint Journey view.

Reviewer findings (independent reviewer on the script diff):

1. The value check could pass a missing key, because spreading the result over the expected object filled it in. Fixed: `same()` also compares key counts and rejects a missing object.
2. Word-plus-"Labs"/"Systems" company names may match real companies. Fixed: the added applications are named "Example Company 01" to "Example Company 43"; they are hidden by the card anyway.
- Confirmed correct by the reviewer: stage step sequences under the reach rules, API shapes and guard, default view choice, fresh data after in-app navigation, hover-point search with `pointer-events:none` overlays, tooltip wording.

Same-failure search: `grep -nE "reload\(|goto\(" scripts/demo-video/record.mjs` finds only the initial `page.goto(url)` before capture starts, so nothing resets the overlay mid-video.

Sensitive data gate: invented names only ("Example Company NN", the mock agent's companies, the CV's invented person); no paths, settings or mail on screen; frames checked.

Artifact maintenance gate:

- AGENTS.md: video bullet describes the Journey scene's API-added applications and the failing check, and lists Dashboard Breakdown and Journey among the screens that trigger a re-record.
- Runtime project skills: no update; `project-testing` covers the seed and mock agent, which are unchanged, and the recording script has no tests (as in SOW-0048).
- Specs: no update; no product behaviour changed.
- End-user/operator docs: README video description now mentions the Journey graph and "about a minute and a half".
- End-user/operator skills: none exist in this repository.
- SOW lifecycle: this SOW completes and moves to `done/`; SOW-0048 decision 16A (upload) is applied to this video next.

Spec update: none needed, the video shows existing behaviour (spec line 76 already describes Journey).

Project skill update: none needed (see above).

Lessons: see below.

Follow-up mapping: see Followup.

## Outcome

The README demo now ends with the Dashboard's Journey graph for 42 sent applications, with a hover tooltip and two captions, before the end card. The video is 88 s and is re-recorded with the same one command.

## Lessons Extracted

- Data needed only for a late scene can be added through the app's own API under a full-screen card, then shown by in-app navigation; a reload would reset the injected overlay.
- Hover targets in SVG ribbons need a point the shape covers; `elementFromPoint` over the bounding box finds one, since the overlays have `pointer-events:none`.
- Word-based "invented" company names can collide with real ones; when the names do not show, plainly synthetic names are safer.

## Followup

- SOW-0048 decision 16A (the user uploads the final MP4 as a GitHub attachment; README player, poster for npm, AGENTS.md upload note) is applied to the video this SOW produces, under SOW-0048's post-close record.

## Regression Log

None yet.
