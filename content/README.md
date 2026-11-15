# /content (Lane 4)

Everything a user reads in the app. Shapes are defined in `PLAN.md`; check them with:

```
node content/validate.mjs
```

The validator checks the shapes and the cross-references: every variable, region and route id used must exist, `seaice` is only used in regions north of 50°N, usecases cover all ten variables, and at least three variables are asked about in two or more regions (the challenge's "opposite trends" point).

| File | Purpose |
|---|---|
| `definitions.json` | Plain definition and one-sentence "why it might trend" for each of the 10 variables |
| `regions.json` | 15 region presets. No region crosses the date line, so `lonMin < lonMax` always |
| `usecases.json` | The sample-question table (no AI involved) |
| `routes.json` | Waypoints as `[lat, lon]`: Northern Sea Route, Northwest Passage, New York to London great circle |
| `cases.json` | The two guided demos: `jet` and `arctic_lane` |

## Fields beyond the PLAN.md examples

These are additive. A consumer that ignores them still works, but Lane 3 needs them to render band and route views. They are listed in `docs/OPEN_ITEMS.md` for sign-off.

- `usecases.json` rows always carry `months` (explicit array, all 12 for an all-year view). `mode: "band"` rows carry `band`. `mode: "route"` rows carry `route` (a route id) and `band: { min: null, max: 0.15 }`, where `max` is the open-water threshold passed to `routeOpen`.
- Case step `action` objects use the same optional fields: `months`, `band`, `route`. In a `map` or `series` step, `route` means "draw this route as an overlay" (used to draw the New York to London flight path in the jet case).
- Region `type` also allows `"global"` for the whole-Earth preset.

## AI-use acknowledgement

These files were written with Claude (Anthropic) and reviewed by the team. The Space Apps guide asks that SI-generated code and data be acknowledged in descriptive text and metadata; this note, the commit trailers and `docs/README.md` are that acknowledgement. JSON has no comment syntax, so we do not add keys that would break the contract shapes.
