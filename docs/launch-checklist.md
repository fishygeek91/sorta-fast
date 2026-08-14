# Launch checklist (v1.0)

Sorta Fast v1.0 "The Race" (Dijkstra vs BMSSP). Issue #21.

## Pages live

- [x] `https://fishygeek91.github.io/sorta-fast/` — GitHub Pages from `deploy.yml` (issue #4). Evidence: OG canonical URL in `index.html`; `test/pages-base.test.ts`. Bench page path `/sorta-fast/bench/` emits from Vite MPA in this PR (`dist/bench/index.html`); goes live on merge to main.

## Social unfurl (OG)

- [x] OG/Twitter meta + og-card.png shipped (#17); live URL `https://fishygeek91.github.io/sorta-fast/og-card.png`
- [x] OG platform verify: 2026-08-13 live Pages HTML contains og:image + twitter:summary_large_image; og-card.png HTTP 200 image/png (curl). Third-party debuggers (opengraph.xyz) redirected without a scrape; Facebook/Twitter validators need a browser session.

## Exports

- [x] PNG photo-finish and WebM/mp4 via MediaRecorder (#18). Seed and share URL baked in (`src/ui/exportMeta.ts`). Tests: `test/export-*.test.ts`. GIF encoder remains deferred; README hero is an offline ffmpeg conversion.

## Seeds reproduce

- [x] Full race state in URL (`src/ui/raceUrl.ts`). Same `?g=&n=&seed=` → byte-identical traces (`test/race-url-repro.test.ts`). Hero seed: `?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp`.

## CI green

- [x] Local gate: `npm run typecheck && npm test && npm run lint` before PR. CI Vitest 1M-event guard is 200ms with sequential files; the 100ms claim is `npm run bench:trace` (#35).

## Fairness panel accurate

- [x] `FAIRNESS_COSTS` deep-equals `OP_COST` (`test/site-copy.test.ts`). Cost table: `src/core/trace.ts`. Honesty copy discloses Dijkstra often wins wall-clock at small n.

## Hero GIF recipe

Hero seed URL:

`https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp`

1. Record from a **local preview** of a build that includes the export-banner gate and in-app banner hold (`npm run build && npm run preview`). Do not use a cut-short take from an older or production-only build.
2. Open that hero seed URL, wait until both lanes are photo-frozen and `#race-export-webm` is enabled, then set a high transport speed and click WebM export. WebM export holds ~1.5s on the completed banner before stopping MediaRecorder; whole clip ≤ ~10s. Export captions always show the canonical Pages URL (`https://fishygeek91.github.io/sorta-fast/…`), never `127.0.0.1` or `localhost`.
3. Save as `docs/assets/hero.webm`.
4. Optional backup only — in-app hold should already pad the banner frame; if the clip still ends too early, pad the last frame ~1.5s before palette encode:

```
ffmpeg -i docs/assets/hero.webm -vf "tpad=stop_mode=clone:stop_duration=1.5" docs/assets/hero-padded.webm
```

5. Convert (run on the padded clip, or on `hero.webm` when step 4 was skipped):

```
ffmpeg -i docs/assets/hero-padded.webm -vf "fps=20,scale=960:-1:flags=lanczos,palettegen" docs/assets/palette.png
ffmpeg -i docs/assets/hero-padded.webm -i docs/assets/palette.png -lavfi "fps=20,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" docs/assets/hero.gif
```

6. Target < 8–10 MB. Delete `docs/assets/palette.png` and `docs/assets/hero-padded.webm` (do not commit them). Commit `docs/assets/hero.gif` and `docs/assets/hero.webm`.
7. On the default seed (`sparse` / 25k / 4), the **completed** photo-finish banner names **Dijkstra** (race to the marked target). That is expected; BMSSP still wins settle-all work-clock. README caption must match the banner — do not claim the GIF shows a BMSSP photo-finish win.
8. - [x] Hero GIF path `docs/assets/hero.gif` referenced from README (asset added in this PR).

## Bench page

- [x] Wall-clock page at `https://fishygeek91.github.io/sorta-fast/bench/` after merge; Vite MPA input `bench/index.html`.
