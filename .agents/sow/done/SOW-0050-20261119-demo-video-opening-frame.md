# SOW-0050 - Open the demo video on the Journey graph

## Status

Status: completed

Sub-state: recorded, validated, uploaded by the user and linked from the README on branch `Improve-demo-video`.

## Requirements

### Purpose

Make the README demo video show something meaningful before it is played: the Dashboard's Journey graph for many applications, instead of a blank screen.

### User Request

"Currently, the demo video shows a blank screen in it's initial un-started state. I want it to show the multi-applications chart." Then "All recommended" for decisions 1-3 below.

### Assistant Understanding

Facts:

- The first frame of `docs/video/demo.mp4` (88.2 s, SOW-0049) is the app shell with "Loading..." and an empty page; by 0.5 s the first-run "Create your first profile" screen is shown (frames extracted with `ffmpeg`, kept under the session scratchpad, not committed).
- `scripts/demo-video/record.mjs` starts the DevTools screencast right after `page.goto(url)` and `document.fonts.ready`, before the UI has rendered.
- The Journey graph exists only after `addJourneyApplications` in scene 11, so it cannot be recorded at the start; a still taken after recording can be placed first.
- The README plays a bare GitHub attachment link (SOW-0048 decision 16A); a bare link has no poster setting, so the un-started player shows the video's first frame.
- `docs/video/demo-poster.png` (npm fallback) already shows the Journey view behind a play button.

Inferences:

- Some browsers (Safari in particular) may show black before playback regardless of the first frame; not verified.

Unknowns:

- None that block.

### Acceptance Criteria

- The video's first frame is the Dashboard with the Journey graph for the 42 applications: no caption, pointer, card or tooltip. Checked by extracting frame 0.
- That still is held for about 2 s, then a hard cut to the first-run screen; no "Loading..." frame appears anywhere. Checked by frames at 0, 1.9, 2.1 s and the first walkthrough frames.
- The rest of the storyboard and its captions are unchanged; `npm run demo:video` stays one command and still fails on a Journey summary mismatch.
- No personal data in frames, poster, script or docs.

## Analysis

Sources checked:

- `scripts/demo-video/record.mjs` (capture start, `startCapture().stop()` concat list, encode, poster).
- `docs/video/demo.mp4` frames 0 and 0.5 s; `docs/video/demo-poster.png`; `README.md:5-14`.
- `.agents/sow/done/SOW-0048-20261119-demo-video.md`, `.agents/sow/done/SOW-0049-20261119-demo-video-journey.md`; `AGENTS.md` demo video bullet.

Current state:

- Frame 0 shows "Loading..."; the Journey graph appears only from about 70 s.

Risks:

- A still taken while the hover tooltip or the drawn pointer is visible would leak into the opening frame; the pointer is hidden and the mouse moved off the graph before the still.
- The concat demuxer mixes the still (Playwright screenshot JPEG) with screencast JPEGs; a size or pixel-format mismatch could break or distort the encode. Checked by `ffprobe` and frame inspection.

## Pre-Implementation Gate

Status: ready

Problem / root-cause model:

- Capture starts before React renders, so frame 0 is the loading shell; GitHub's player shows frame 0 before playback. Evidence: extracted frame 0 and `record.mjs` capture order.

Evidence reviewed:

- Files listed under Sources checked.

Affected contracts and surfaces:

- `scripts/demo-video/record.mjs`, `docs/video/demo.mp4`, `docs/video/demo-poster.png` (length text, tooltip no longer open behind it), `README.md` attachment links (after the user's upload), `AGENTS.md` demo video bullet, this SOW. No app code, API, schema, test or spec change.

Existing patterns to reuse:

- The poster step already works on the page after capture stops; the concat list already holds each frame for a set duration.

Risk and blast radius:

- Script-only. The video grows by about 1.5 s (2 s still, about 0.5 s of loading frames removed).

Sensitive data handling plan:

- The still shows the same invented data as scene 11 ("Example Company NN" is not on the Dashboard; only counts). Frames checked before commit. The upload to GitHub is done by the user.

Implementation plan:

1. Start the screencast only after the first-run screen ("Start from your CV") is visible.
2. Split the concat-list writing out of `stop()` so a still can be listed first with a 2 s duration.
3. After capture stops: hide the end card, move the mouse off the graph, wait for tooltips to close, hide the pointer, screenshot the viewport as JPEG; write the list with the still first; then encode, probe and make the poster as before.
4. Record, inspect frames, update AGENTS.md, review, then the user uploads and both README links are replaced.

Validation plan:

- `npm run demo:video`; `ffprobe` length and stream tags; frames at 0, 1.9, 2.1 s and the tail; `npm run typecheck`, `npm test` unaffected; independent review of the script diff; same-failure search for other capture-before-render paths.

Artifact impact plan:

- AGENTS.md: demo video bullet mentions the opening still and capture starting on the first-run screen.
- Runtime project skills: none expected; no test, adapter or API work.
- Specs: none; no product behaviour changes.
- End-user/operator docs: README attachment links replaced after the user's upload; the description ("about a minute and a half") stays true.
- End-user/operator skills: none exist.
- SOW lifecycle: completes here once the README links point at the uploaded video.

Open-source reference evidence:

- None; only this repository was checked.

Open decisions:

- None; decisions 1-3 below are resolved.

## Implications And Decisions

1. Opening: **A** - prepend a still of the Journey graph held about 2 s, then a hard cut to the walkthrough. Rejected B: cross-fade (more ffmpeg filter complexity); C: a single frame (flashes on every play).
2. Still content: **A** - clean Dashboard with the Journey graph, no caption, pointer or tooltip (no new caption text). Rejected B: new title caption; C: tooltip open.
3. Loading frames: **A** - start capturing once the first-run screen is visible, so no "Loading..." flash follows the still.

## Plan

See Implementation plan.

## Execution Log

### 2026-11-19

- SOW created with decisions 1-3 (user: "All recommended").
- `scripts/demo-video/record.mjs`: capture starts after the first-run text is visible (then `document.fonts.ready`); `stop()` returns a copy of the frames and the end time; new `writeConcatList()` lists the opening still first for `INTRO_SECONDS` (2); after capture the script hides the card, moves the mouse off the graph in steps, waits for tooltips to close, hides the pointer and takes a JPEG screenshot.
- Run 1 failed: the ribbon tooltip stayed open, because a single-jump `mouse.move` puts the exit point inside Radix's hoverable-content grace area. Fixed with a stepped move (`steps: 12`) and a 5 s bounded wait.
- Run 2: 89.5 s, frame 0 clean. Independent review: no bugs; findings below. Run 3 after two fixes: 90.2 s.
- `AGENTS.md` demo video bullet updated.
- Upload: the first link the user sent came from an unsubmitted issue draft and returned 404 to anonymous requests (the SOW-0049 link returned 302); the assistant's instruction not to submit the draft was wrong. User decision (1A): post the video as a comment on the closed issue #36. The posted comment carries a new attachment id; both README links now use it.

## Validation

Acceptance criteria evidence:

- Frame 0 of the run-3 video is the Dashboard with the Journey graph (Applied 42, Screening 18 · 43%, Interview 8 · 44%, Offer 2 · 25%; tiles 17/2/2/18/1), with no caption, pointer, card or tooltip.
- Frames at 1.8-2.6 s (10 fps): the still until 1.9 s, then the first-run "Create your first profile" screen from 2.0 s; contact sheet at 0-4 s (5 fps) of run 2 shows no "Loading..." frame. `.tmp/demo-video/frames.txt` starts with `intro.jpg` / `duration 2.000`.
- Storyboard unchanged after the cut; the tail frames show the same end card; the script's Journey summary check is untouched and passed.

Tests or equivalent validation:

- `npm run typecheck` and `npm test`: exit 0, 81 files, 1299 tests passed.

Real-use evidence:

- `npm run demo:video` exit 0 (runs 2 and 3); output 1440×900, yuv420p, `color_range=tv`, `color_space=bt709`, the same tags as the previously committed video; still and screencast frames both 1440×900 `yuvj420p` (reviewer's `ffprobe`). Poster reads "Watch the demo · 1:30" over the faint Journey view, now without the open tooltip behind it.

Reviewer findings (independent reviewer on the script diff):

1. `stop()` returned the live frames array, which a late screencast frame could still extend before the list was written. Fixed: returns `frames.slice()`.
2. A tooltip that does not close fails the run after a full recording. Rejected: the failure is loud (no bad video is written) and the current geometry closes it reliably; pressing Escape would add another input path for no observed failure.
3. `document.fonts.ready` ran before the first-run screen rendered, so the fonts it uses might not be counted. Fixed: the text wait now comes first.
4. Scene 1's wait for "Start from your CV" is now redundant. Kept, so the storyboard stays self-contained.

Same-failure scan:

- `grep -n "startCapture\|goto(\|reload(" scripts/demo-video/record.mjs`: one `goto` before capture, one `startCapture` after the first-run wait; no other capture-before-render path. Other `mouse.move` calls go through `director.moveTo` (many small steps), so no other single-jump hover exit.

Sensitive data gate:

- Frames show only invented data (mock agent output, counts); no paths, settings or mail. The SOW, script comments and AGENTS.md contain no personal data.

Artifact maintenance gate:

- AGENTS.md: demo video bullet describes the opening still and capture start (SOW-0050). The upload step now says to post the comment and check the link anonymously.
- Runtime project skills: no update; no test, adapter or API change, and the recording script has no tests (as in SOW-0048/0049).
- Specs: no update; no product behaviour changed.
- End-user/operator docs: `README.md` player link and the poster's link replaced with the new attachment; the Development section's upload step says to post the comment; the description "about a minute and a half" still holds at 90 s.
- End-user/operator skills: none exist in this repository.
- SOW lifecycle: `Status: completed`, moved to `done/`, committed with the work in one commit.

Specs update:

- None needed; the video shows existing behaviour.

Project skills update:

- None needed (see above).

End-user/operator docs update:

- `README.md`: both attachment links replaced. The attachment is served anonymously (HTTP 200, `video/mp4`) and is byte-identical to `docs/video/demo.mp4` (SHA-256 match); GitHub's Markdown API renders the bare link as a `<video>` player without a `poster` attribute, so the player shows frame 0.

End-user/operator skills update:

- None exist.

Lessons:

- See Lessons Extracted.

Follow-up mapping:

- README attachment links: implemented. No other deferred items.

## Outcome

The README demo video now opens on a 2 s still of the Dashboard's Journey graph for 42 applications, so GitHub's un-started player shows the chart instead of the app's loading screen; the walkthrough starts on the first-run screen. The video is 90 s, re-recorded with the same one command.

## Lessons Extracted

- A Radix tooltip opened by hover stays open after a single-jump pointer move away: the exit point becomes part of its grace area. Move in steps to close it.
- With a bare GitHub attachment link there is no poster setting; the video's own first frame is the thumbnail, so it has to be designed.
- An attachment dropped into an unsubmitted issue or comment draft is not served to anonymous visitors (404); the comment must be posted before the link goes into the README. Check the link anonymously before using it.

## Followup

None yet.

## Regression Log

None yet.
