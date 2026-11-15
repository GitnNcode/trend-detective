# Demo script

**Hard limits from the 2026 guide:** a video of 30 seconds or less, OR a deck of at most 7 slides including the title and intro slides. Going over either limit makes the project ineligible for Global Judging. Host it publicly (YouTube, Google Drive, etc.) with no login. See `SUBMISSION_REQUIREMENTS.md`.

**Decision needed from the team: video or slides.** Recommendation: record the video (about 28 seconds) as the official demo, because a screen recording shows the live site working, and put the fuller story in the Detailed Project Description. Choose the deck instead if nobody wants to be on a voice-over. The deck below can be built either way from the same screenshots.

Everything in `[BRACKETS]` comes from the Stage 2 real-data run. Do not write a result into the script until the engine has produced it.

---

## Option A: 30-second video (target 28 seconds)

The guide's suggested beats are: introduce yourself, lead us in, name the project, describe the idea, look to the future. Screen recording of the deployed site, voice-over, English (or any language with English subtitles).

| Time | Screen | Voice-over |
|---|---|---|
| 0:00-0:04 | Title card: project name and team name | "I'm `[NAME]` from `[TEAM]`. Our challenge: Be an Earth System Trend Detective." |
| 0:04-0:08 | Site home, question list | "Trend Detective lets anyone ask a question about our planet..." |
| 0:08-0:15 | Click "Is the Arctic losing its summer ice?", series chart and verdict card appear | "...and see NASA MERRA-2 data since 1980, the rate of change, and whether it is statistically significant: `[RATE per decade, VERDICT]`." |
| 0:15-0:22 | Shift mode, press play, ice edge moves | "Shift mode shows where it is changing: `[EDGE SHIFT km per decade]` for the Arctic ice edge." |
| 0:22-0:28 | Trend map with sign flips, then site URL | "Same variable, opposite trends in different places. Free, in any browser, built on NASA open data." |

Rehearse with a stopwatch. The voice-over is about 75 words, which is tight for 28 seconds: trim a line if a read-through runs past 28 seconds. If the result is not significant, change the 0:08-0:15 line to "`[RATE]`, not yet significant: a longer record may be needed", because that is a real finding too.

## Option B: 7-slide deck

Keep words per slide low and visuals large.

1. **Title and team.** Project name, tagline, challenge name, team name, **names of all team members**. (Required content for a slide demo.)
2. **The problem.** One variable can trend up in one place and down in another, even from the same cause. Picking variables and testing trends is hard for students. Visual: Arctic vs Antarctic temperature trend map `[from Stage 2]`.
3. **The solution.** Screenshot of the site. Four steps: ask, see, measure, test. Mention no install, no login.
4. **How it works.** Data to engine to app. NASA MERRA-2 monthly means, trend line with 95% interval, t-test plus Mann-Kendall, the significant / suggestive / none rule.
5. **Demo case 1: the jet stream.** Screenshot of Shift mode on the 250 hPa wind. `[Result sentence from bandSummary and verdict]`
6. **Demo case 2: the Arctic lane.** Screenshot of the Northern Sea Route open-months chart. `[Open months per year trend and verdict]`
7. **Data, limits, credits.** NASA MERRA-2 (GES DISC), GISTEMP and NSIDC for validation, honest limits (linear trends, coarse grid, reanalysis), SI disclosure (built with Claude), link to site and repo.

## Recording and compliance checklist

- [ ] Site loads from the public URL on a second machine and a second network, no login.
- [ ] Demo link opens in a private browser window with no sign-in.
- [ ] No NASA logos, flags or mission identifiers anywhere in the site, video or slides.
- [ ] Nobody under 18 appears or is heard in the video or slides.
- [ ] If the voice-over is not English, English subtitles are burned in.
- [ ] Any generated image has a visible SI watermark; any generated audio is acknowledged in text and metadata.
- [ ] Video is 30 seconds or less on the final export (check the file, not the timeline), or deck is 7 slides or fewer.
- [ ] Team name and member names are on a slide (deck) or said and shown (video).
- [ ] Music or stock footage, if any, is licensed for use and listed in the References field.

## Stage 2 narration fill-in

`content/cases.json` is written so it reads correctly whether or not the result is significant. In Stage 2, add the real numbers to these steps, keeping the "if the verdict is none" wording:

| Case | Step | Add |
|---|---|---|
| `jet` | 2 | Trend per decade, interval, verdict sentence |
| `jet` | 5 | Band summary sentence and km per decade |
| `arctic_lane` | 2 | Trend per decade, interval, verdict sentence |
| `arctic_lane` | 4 | Open-water area trend and edge shift |
| `arctic_lane` | 6 | Open months per year trend and choke point location |
