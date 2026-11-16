# Open items from Lane 4

Written overnight 2026-11-14. Nothing here edits `PLAN.md` or another lane's folder. PLAN.md says contract changes go to the group chat first.

## 1. Needs a decision in the group chat (contract additions)

Lane 4's content needs a few fields that the PLAN.md examples do not show. All are additive, so a consumer that ignores them still works, but Lane 3 must read them for band and route views to work.

| Addition | Why |
|---|---|
| `usecases.json` rows and case-step `action`s carry `months` (array of 1-12) | Season matters for ice (September), jet (DJF) and monsoons |
| `mode: "band"` rows and actions carry `band: { min, max }` | Matches the contract's own usecase example |
| `mode: "route"` rows and actions carry `route: "<route id>"` and `band: { min: null, max: 0.15 }` | `routeOpen` needs a route and a `max`; there is nowhere else to put them |
| In `map` / `series` steps, `route` means "draw this route as an overlay" | Used for the New York to London flight path in the jet case. `routeOpen` is not meaningful for wind speed |
| Region `type: "global"` for the whole-Earth preset | The "where does the trend flip sign?" map questions need a global region |

Details are in `content/README.md`. Once agreed, someone with the authority should copy them into PLAN.md.

## 2. Likely bug in the contract's `edgeLat` rule (Lane 2)

PLAN.md says `edgeLat` is "the most equatorward latitude in each longitude column that is inside the band, for bands with `max` set on a field that grows toward the pole". For the Arctic case the band is open water (`seaice` at most 0.15, the contract's own example). In each longitude column that band includes everything south of the ice edge, so the most equatorward in-band cell is the same southern boundary of the grid every year and the edge would never move. The meaningful ice edge for that band is the most **poleward** in-band latitude. For the jet case (`min` set, no `max`) the useful edge depends on which side of the core is being tracked. Please have Lane 2 confirm the rule on mock `seaice` before the real-data run. The content uses the contract's own example band, so no content change is needed either way.

## 3. Route notes for Lanes 2 and 3

- The Northern Sea Route crosses the date line (waypoints go from 170°E to 175°W). Interpolation must take the short way round, not across 0°. There is no waypoint at exactly 180° to avoid the ±180 ambiguity.
- The Northwest Passage runs through channels narrower than one 1.0° by 1.25° sea ice cell. At this resolution its result is approximate; the case narration already says so for the sea route, and the NWP appears only as the last, exploratory step.
- Waypoints are placed in open water, not on land. If FRSEAICE is missing or zero over land cells, a coastal waypoint could still read as "open". Lane 1 should say how land cells are stored for `seaice`.
- `seaice` only exists from 50°N to 90°N. `content/validate.mjs` fails if any `seaice` row or step uses a region reaching south of 50°N.

## 4. Resolution caveat for small regions

`ganges_delta` is 6° by 8° (about 3 by 3 default cells) and `ne_us_corridor` 6° by 10°. They average only a handful of cells, so "estuary" and "city air" are really regional. Say "region around" in any talk about them, not "the city".

## 5. Needs the team (blank fields in the submission)

Team name, member names, Local Event, public URL of the deployed site, demo link, and the final tool and library list. Marked with `[BRACKETS]` in `SUBMISSION.md` and `DEMO_SCRIPT.md`. The SI answer is drafted but the team must state accurately how the idea originated, because the guide says SI should not be used to come up with the idea of how to solve the challenge.

## 6. Compliance reminders (from the verified 2026 guide)

- Demo: 30-second video or 7 slides, with a public link. Exceeding either limit means no Global Judging.
- The References field must list every library, font, image and text source, including open source ones.
- Code and data created with SI must be acknowledged in descriptive text and metadata. Lanes 1 to 3 should add a short note to their folder README and a footer line on the site. The content folder already has one.
- No NASA logos or branding. No minors in the demo.
- Everyone on the team must be at the same Local Event and on the Members tab. Maximum six people.
- Real deadline is Sunday Nov 15, 11:59 p.m. Local Event time. Our internal 9 PM target is a margin.

## 5-minute checks for Stage 2

1. `node content/validate.mjs` after any edit to `/content`.
2. Fill the narration table in `DEMO_SCRIPT.md`.
3. Fill the table in `VALIDATION.md` from Lane 1's output.
4. Fill every `[BRACKET]` in `SUBMISSION.md`, then paste it into the project page and use "Save Progress" often.
5. Open the demo and site links in a private window on a second machine.


## Status at 2026-11-15 16:00 (Lane 3)

- **1. Contract additions:** adopted in `PLAN.md` (commit f411210) and implemented in the app.
- **2. `edgeLat` rule:** fixed in the engine (Lane 2); the app uses `edgeKind`/`edgeUsed`.
- **3. Route notes:** routes cross the date line correctly; land cells are stored as missing; the Northwest Passage result is labelled approximate.
- **4. Resolution caveat:** stated in the app's Help → Methods dialog and in `docs/README.md`.
- **5. Team fields:** names and roles are in the README, and the site is live on Vercel at https://trend-detective-pipeline.vercel.app (deployed from `main`). Still open: Local Event, and the public link to the demo video once the voice-over is added (`docs/demo/`).
- **6. Compliance:** no NASA logos or branding; AI use acknowledged in each folder README, the docs, commit trailers and the site's Help dialog. `SUBMISSION.md` lists which product features were suggested by Claude, for the team to confirm.
