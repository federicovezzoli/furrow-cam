# PRD-0013: Automated demo videos

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-11-02
- **Related:** PRD-0001, PRD-0005, PRD-0008, PRD-0010, PRD-0011, ADR-0042, ADR-0050, ADR-0054, ADR-0072

## Problem

The website needs short videos that show what Furrow CAM does. Screen recordings made by hand take an afternoon each, look different from one take to the next, and go stale with every interface change, so they stop matching the app a release or two later. We want videos we can regenerate from the current app with one command.

## Users

- Visitors to the website deciding whether Furrow CAM fits their machine and their jobs.
- Maintainers who record the videos again after the interface changes.

## Goals

- Three videos for the website, each showing one real job in the app from start to finish.
- One command records all of them again from the current app, with no manual editing, and gives the same result every time it runs.
- A UI change that breaks a video's script fails loudly instead of recording a wrong video.

## Non-goals

- Narration, music, captions or zoom and pan effects added after recording. A later step could add them over the recorded videos (for example with Remotion) without changing how they are recorded.
- Videos of the desktop app, or of the web app's signed-in pages (projects, tools, machines).
- Recording in CI. The videos are recorded on a maintainer's computer.
- Tutorials or documentation videos. These are short showcases.

## Videos

| ID | Video | Shows |
| --- | --- | --- |
| V1 | **2D from an SVG** | Import an SVG of a dog paw (`dog-paw-50x50.svg`), set the stock and zero, add a profile with tabs, a pocket, a drill on mounting holes added to the sample, add a line of text and V-carve or engrave it (PRD-0010), preview the toolpaths, export G-code |
| V2 | **3D from a STEP file, both sides** | Import a STEP model of a windsurf board (`tavola3.step`, ADR-0072), place it in the stock, make the project two-sided (PRD-0011) with locating pins and holding tabs, add 3D roughing and finishing on the top and bottom sides, export a G-code file per side |
| V3 | **Simulation** | The V2 project in the simulation (ADR-0042): the top side cut, then the bottom side from the flipped stock the top left |

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| D1 | Each video is a script that drives the real app in a browser, through the workspace without an account (PRD-0008), so no account or database state is needed | Must |
| D2 | Scripts find what they click by stable anchors in the interface (such as the tour's `data-tour` anchors), not by text or layout, and fail if an anchor is missing | Must |
| D3 | Each video starts from a fixed sample file kept in the repo, which we have the right to publish, and a fixed window size, theme and language (English), so it looks the same on every run | Must |
| D4 | A visible cursor moves smoothly to each control before it is clicked, with pauses long enough to follow each step | Must |
| D5 | Output for each video: an MP4 (H.264) and a WebM at 1920 × 1080, plus a poster image, each no more than about 60 seconds long and under 10 MB | Must |
| D6 | One command records all videos, or a single one by name, builds and starts the web app itself, and writes them as local files in an ignored output folder; publishing them to the website stays a manual step | Must |
| D7 | V3 opens the project V2 built, so the two videos show the same job | Should |
| D8 | A dark-theme version of each video | Could |
| D9 | Videos in other interface languages (ADR-0054) | Could |

## Recording

Scripts drive headless Chromium through Playwright, against a production build of the web app (`next build` and `next start`), so the Next.js dev indicator isn't in the picture. The page's clock is frozen (`page.clock.install()`), and each frame of the video is made by advancing the clock by 1/60 s and taking a screenshot, which is piped into ffmpeg at a constant 60 fps. Mouse moves are spread over frames by the script, and the fake cursor is drawn by the page. Where the app waits on a Web Worker (toolpaths, simulation, STEP import), the script waits for the result with the clock frozen and only then records frames on, so the video never shows a calculation running. The guided tour is skipped at the start of each video.

What a spike on an M1 Pro (2026-11-02) found:

| Approach | Result |
| --- | --- |
| Playwright `recordVideo` | Headless Chromium uses the GPU and renders the viewport at 60 fps, but the recorder writes VP8 at a fixed 25 fps and about 0.4 Mbps: too choppy and soft for the website |
| Chrome DevTools screencast (`Page.startScreencast`) | Delivers about 12 fps at 1920 × 1080 while orbiting the 3D view |
| Frozen clock, one screenshot per frame | A steady 60 fps at any capture speed, the same on every run. Captures about 15 frames per second, so a 60-second video takes about 4 minutes to record |

## User flow

1. A maintainer changes the interface and runs the record command.
2. The app starts locally, each script runs in a fresh browser, and the videos and posters are written to an output folder.
3. They watch the videos, then copy them to the website.
4. If a script can no longer find a control, the command stops with the video's name and the missing anchor.

## Success criteria

- All three videos record from a clean checkout with one command and no manual steps.
- Two runs on the same commit give videos a viewer can't tell apart.
- After an interface change, the videos are up to date again within minutes, by changing only the scripts.

## Open questions

- Does every animation in the app (simulation playback, camera transitions) follow the page clock, or do some need the script to wait in real time?

## Changelog

- 2026-11-02: initial draft
- 2026-11-02: recording approach from a spike: headless, frozen clock, one screenshot per frame
- 2026-11-02: the record command starts the app itself; V1 drills mounting holes added to the sample
