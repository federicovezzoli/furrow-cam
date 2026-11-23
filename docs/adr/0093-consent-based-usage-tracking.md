# ADR-0093: Detailed usage tracking with consent, the cookieless baseline without

- **Status:** Accepted
- **Date:** 2026-11-23
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0013, ADR-0044, ADR-0050, ADR-0052, ADR-0054; PRD-0007; #664. Supersedes in part ADR-0052 ("Cookieless and anonymous", "No third-party code" on autocapture and session replay, and the desktop's random ID per launch).

## Context

ADR-0052 sends cookieless page views, six events and error reports. They tell us how many people import, add operations and export, not how they get there or where they get stuck. We want to see much more of how the app is used, from the people who agree, without losing the anonymous counts from everyone else and without linking anything to an account (ADR-0013).

## Options considered

1. **Ask, and keep the cookieless baseline for those who don't agree**: PostHog's `cookieless_mode: "on_reject"`.
2. **Send nothing until the user agrees**, as the desktop app does: we lose the counts of everyone who ignores or declines the question.
3. **Track everyone in detail without asking**: needs a stored ID and recordings, which need consent.

## Decision

We will use option 1.

- **Without consent** (declined, or not answered yet), the web app sends exactly what ADR-0052 describes: cookieless page views with the route pattern, the six events and error reports. `before_send` drops every other event, so autocapture and replay events can't slip through. PostHog stores only the answer once there is one; nothing before.
- **With consent**, the web app also:
  - keeps PostHog's anonymous ID in a first-party cookie and `localStorage`, so returning visitors and funnels across days can be seen;
  - autocaptures clicks and form changes, sending each element's tag, position and our own anchors (`data-tour`, `data-demo`, `data-slot`, `id`, `role`, `type`) but never its text, classes or other attributes, which may hold names the user typed (a `title` tooltip, a link to a project);
  - records sessions with **every text node and input masked** and canvases not recorded, so the 3D viewport, drawings and the names of projects, files, tools, machines and operations never reach PostHog. Masking every text, rather than marking the user's names one by one, can't leak a name a new component forgets to mark. The recorder ships in our own bundle and loads only after consent.
- **Both modes** keep ADR-0052's scrubbing: events carry the route pattern, not the URL; errors are reported through the workspace's scrubber, so PostHog's own exception autocapture stays off. A replay's page records may still contain a page's URL with a project's opaque ID.
- **Never linked to an account.** No `identify()`, no person profiles; ADR-0013 holds.
- **Asking.** A small prompt in a corner of the page on the first visit, which blocks nothing, and a *Usage statistics* entry in the site footer and the account menu to change the answer.
- **PostHog's remote config** is now fetched (feature flags stay off): session replay is switched on there. Surveys, product tours, heatmaps, dead clicks, console logs and web vitals stay off.
- **Desktop.** With consent, a random ID is kept in `telemetry.json` instead of a new one per launch, so returning users are counted; turning telemetry off deletes it. The desktop renderer has no network (ADR-0044), so autocapture and replay are not part of the desktop app.

## Consequences

- We can see how people who agree move through the app, where they click and where they give up, and how many come back.
- The anonymous counts from everyone else are unchanged, so the totals stay comparable with ADR-0052's.
- Replays show the layout, panels and clicks but no text, so a click's meaning comes from where it is and from the anchors, not from the label.
- The privacy policy describes both modes. The project's "cookieless server hash mode" must stay on, or PostHog drops the baseline events.
- A component that puts the user's text into an anchor attribute (`data-tour`, `id`, …) would send it with autocapture; anchors stay fixed names.
