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

- [x] Local gate: `npm run typecheck && npm test && npm run lint` before PR. Known GHA flake: issue #35 (1M-event budget on shared CPUs); not in scope for #21.

## Fairness panel accurate

- [x] `FAIRNESS_COSTS` deep-equals `OP_COST` (`test/site-copy.test.ts`). Cost table: `src/core/trace.ts`. Honesty copy discloses Dijkstra often wins wall-clock at small n.

## Hero GIF recipe

Hero seed URL:

`https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp`

1. Open that race, wait for photo-finish, set a high transport speed, click WebM export. Whole clip ≤ ~10s; hold the frozen banner ~1.5s.
2. Save as `docs/assets/hero.webm`.
3. Convert:

```
ffmpeg -i docs/assets/hero.webm -vf "fps=20,scale=960:-1:flags=lanczos,palettegen" docs/assets/palette.png
ffmpeg -i docs/assets/hero.webm -i docs/assets/palette.png -lavfi "fps=20,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" docs/assets/hero.gif
```

4. Target < 8–10 MB. Delete `docs/assets/palette.png` (do not commit it). Commit `docs/assets/hero.gif` and `docs/assets/hero.webm`.
5. - [x] Hero GIF path `docs/assets/hero.gif` referenced from README (asset added in this PR).

## Bench page

- [x] Wall-clock page at `https://fishygeek91.github.io/sorta-fast/bench/` after merge; Vite MPA input `bench/index.html`.
