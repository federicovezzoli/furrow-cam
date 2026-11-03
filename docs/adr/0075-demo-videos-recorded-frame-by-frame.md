# ADR-0075: Demo videos are recorded a frame at a time on a frozen page clock

- **Status:** Proposed
- **Date:** 2026-11-02
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0013 (D1–D6), PRD-0008, ADR-0042; #464

## Context

PRD-0013 asks for website videos recorded again from the current app with one command, smooth at 60 fps, the same on every run. A spike on an M1 Pro (2026-11-02) drove headless Chromium through Playwright against a production build and tried three ways to capture it:

| Approach | Result |
| --- | --- |
| Playwright `recordVideo` | VP8 at a fixed 25 fps and about 0.4 Mbps: choppy and soft |
| Chrome DevTools screencast (`Page.startScreencast`) | About 12 fps at 1920 × 1080 while orbiting the 3D view |
| Frozen page clock, one screenshot per frame | A steady 60 fps whatever the capture speed (about 15 frames a second), the same on every run |

## Options considered

1. **`recordVideo`.** Built in, but the frame rate and bitrate are fixed and too low.
2. **The screencast.** Frames come as fast as Chrome sends them, so the video's timing depends on the computer.
3. **A frozen clock and a screenshot per frame**, piped into ffmpeg.

## Decision

We will use option 3, in a private package, `apps/demos` (`@furrow/demos`), so Playwright stays out of `apps/web`.

- **Clock.** Each video's page gets Playwright's clock (`page.clock.install()`), paused at a fixed date. A frame advances it by 1/60 s (`runFor`) and takes a JPEG screenshot, written into ffmpeg at 60 fps. The clock fakes `Date`, `performance.now`, timers and `requestAnimationFrame`, so React Three Fiber's rendering, the camera controls and simulation playback (`use-playback.ts`) move by exactly one frame each time.
- **What the clock doesn't drive.** CSS animations and transitions run on the compositor's own time: screenshots are taken with `animations: "disabled"`, which finishes them. Web Workers keep real time: `waitForWork()` runs the clock without recording until the result is on screen, so the video cuts to it.
- **Setup and waits.** Loading the page, skipping the tour, starting WebGL and every `waitForWork()` take a varying number of clock steps, so after each the clock jumps to the next whole second before recording goes on. Otherwise the fake `requestAnimationFrame`, which fires on 16 ms boundaries, falls differently against the 1/60 s frames from one run to the next, and the camera's damping moves differently.
- **Input.** The script moves the mouse a step per frame, eased, to whole pixels, and waits after each move, press and release until the page has handled its pointer event: Chrome hands moves to the page on its next real frame, which could otherwise land on another video frame. A cursor drawn by an injected element follows `pointermove`, since screenshots don't show the real one. A screenshot Chrome doesn't answer within 5 s is asked for again. Controls are found by `data-tour` or `data-demo` anchors, or a form field's `id`; a missing one stops the run with the video's name and the anchor. What has no element of its own, such as a path drawn in the viewport, is clicked at an offset from an anchor, measured on a recorded frame.
- **App.** `pnpm demos [name…]` runs `next build` and `next start` (no dev indicator), with placeholder values for the database, auth and email variables `env.ts` requires, since the guest workspace needs none of them; they win over `apps/web/.env` but not over the shell. A server already on the port stops the run, and both `next` processes are stopped however the run ends. Each video gets a new browser context at 1920 × 1080, light, English; requests to any other origin are cancelled, so telemetry never fires and nothing depends on the network. The guided tour is skipped (Esc) before the first frame.
- **Output.** `<name>.mp4` (H.264, CRF 20), `<name>.webm` (VP9, from the MP4) and `<name>.jpg` (the last frame) in `apps/demos/output/`, which git ignores. Recording needs ffmpeg on the `PATH`; it isn't part of `pnpm test`, `build` or CI.

## Consequences

- Videos are smooth and repeatable. Of six pairs of runs of the trivial demo, three gave byte-identical MP4s; in the others every frame matched until the orbit drag, after which the camera ended a fraction of a degree apart (PSNR 36–48 dB), which a viewer can't tell apart (PRD-0013's criterion). The cause of that drift isn't known yet.
- Recording is slower than real time (a 60-second video takes about 4 minutes), plus a production build each run.
- An animation driven by anything other than the page clock (a worker's progress, a CSS transition) doesn't play in the video; it jumps to its end.
- Scripts depend on anchors, so an interface change breaks a video loudly instead of recording the wrong thing, and anchors added for videos (`data-demo`) become part of the markup to keep.
