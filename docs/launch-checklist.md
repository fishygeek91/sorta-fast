# Launch checklist

## v1.0 — "The Race" (Dijkstra vs BMSSP)

Sorta Fast v1.0 "The Race" (Dijkstra vs BMSSP). Issue #21.

### Pages live

- [x] `https://fishygeek91.github.io/sorta-fast/` — GitHub Pages from `deploy.yml` (issue #4). Evidence: OG canonical URL in `index.html`; `test/pages-base.test.ts`. Bench page path `/sorta-fast/bench/` emits from Vite MPA in this PR (`dist/bench/index.html`); goes live on merge to main.

### Social unfurl (OG)

- [x] OG/Twitter meta + og-card.png shipped (#17); live URL `https://fishygeek91.github.io/sorta-fast/og-card.png`
- [x] OG platform verify: 2026-08-13 live Pages HTML contains og:image + twitter:summary_large_image; og-card.png HTTP 200 image/png (curl). Third-party debuggers (opengraph.xyz) redirected without a scrape; Facebook/Twitter validators need a browser session.

### Exports

- [x] PNG photo-finish and WebM/mp4 via MediaRecorder (#18). Seed and share URL baked in (`src/ui/exportMeta.ts`). Tests: `test/export-*.test.ts`. GIF encoder remains deferred; README hero is an offline ffmpeg conversion.

### Seeds reproduce

- [x] Full race state in URL (`src/ui/raceUrl.ts`). Same `?g=&n=&seed=` → byte-identical traces (`test/race-url-repro.test.ts`). Hero seed: `?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp,dmsy`.

### CI green

- [x] Local gate: `npm run typecheck && npm test && npm run lint` before PR. CI Vitest 1M-event guard is 200ms with sequential files; the 100ms claim is `npm run bench:trace` (#35).
- [x] Story browser smoke: `npm run test:e2e` (Playwright Chromium); separate CI job from Node Vitest (#61).

### Fairness panel accurate

- [x] `FAIRNESS_COSTS` deep-equals `OP_COST` (`test/site-copy.test.ts`). Cost table: `src/core/trace.ts`. Honesty copy discloses Dijkstra often wins wall-clock at small n.

### Hero GIF recipe

Hero seed URL:

`https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp,dmsy`

1. Record from a **local preview** of a build that includes the export-banner gate and in-app banner hold (`npm run build && npm run preview`). Do not use a cut-short take from an older or production-only build.
2. Open that hero seed URL, wait until all three lanes are photo-frozen and `#race-export-webm` is enabled, then set a high transport speed and click WebM export. WebM export holds ~1.5s on the completed banner before stopping MediaRecorder; whole clip ≤ ~10s. Export captions always show the canonical Pages URL (`https://fishygeek91.github.io/sorta-fast/…`), never `127.0.0.1` or `localhost`.
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
7. Re-verify the **completed** photo-finish banner on the 3-way take before shipping. README caption must match the banner (photo-finish work to the marked target) and must still name the **settle-all work clock** separately — do not call banner totals "the work clock." (v1.0's 2-way take named **Dijkstra** for the marked target while BMSSP won settle-all; confirm both metrics on the 3-way seed before claiming either in copy.)
8. - [x] Hero GIF path `docs/assets/hero.gif` referenced from README (asset added in this PR).

### Bench page

- [x] Wall-clock page at `https://fishygeek91.github.io/sorta-fast/bench/` after merge; Vite MPA input `bench/index.html`.

## Round 2 (v2.0 / issue #28)

DMSY announcement kit — three-lane race (Dijkstra vs BMSSP vs DMSY). First public implementation of arXiv 2602.07868.

### Pages live

- [ ] `https://fishygeek91.github.io/sorta-fast/` serves the 3-way default race after merge to main.

### Social unfurl (OG)

- [x] 3-way OG card captured via #18 exporter at 1200×630 (`sips -z 630 1200`); city n=500 seed 1729. #51 done: compressed with pngquant + oxipng from 815,118 to 225,213 bytes (72% smaller), still 1200×630.
- [ ] Twitter/OG debugger verify on the live URL after deploy.

### Exports

- [x] PNG photo-finish and WebM/mp4 still via MediaRecorder (#18); 3-way seed baked into export captions (`src/ui/exportMeta.ts`). Tests: `test/export-*.test.ts`.

### Seeds reproduce

- [x] Full 3-way race state in URL (`src/ui/raceUrl.ts`). Same `?g=&n=&seed=&race=` → byte-identical traces (`test/race-url-repro.test.ts`).
- [x] Default live race seed: `?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp,dmsy`
- [x] Featured XL settle-all preset (gallery button): `?g=sparse&n=100000&seed=4&mode=race&race=dijkstra,bmssp,dmsy&target=none` — work-clock ratios confirmed in [`bench/sparse-xl-confirm.md`](../bench/sparse-xl-confirm.md). OG card recapture from the featured export sheet is a remaining human step (100k race too long for this PR to live-capture); city n=500 seed 1729 OG remains until then.
- [x] Story seed (city graph): `?g=city&n=500&seed=1729&mode=race&race=dijkstra,bmssp,dmsy`
- [x] Maze seed (Dijkstra work-clock win): `?g=maze&n=500&seed=0&mode=race&race=dijkstra,bmssp,dmsy`

### CI green

- [x] Local gate: `npm run typecheck && npm test && npm run lint` before PR.
- [x] `test/dmsy-fuzz.test.ts` differential fuzz passes in CI.

### Fairness panel accurate

- [x] `FAIRNESS_COSTS` deep-equals `OP_COST` (`test/site-copy.test.ts`). Honesty copy covers all three lanes. BMSSP defaults to swept demo params (`k = max(4, paper k)`); DMSY defaults to paper params. **#54 (DMSY demo params sweep) is OUT OF SCOPE** for this issue; do not copy BMSSP `k=max(4, paper k)` onto DMSY.

### Hero GIF recipe

Committed hero (`docs/assets/hero.gif` / `hero.webm`) was recorded from the story city seed (`g=city&n=500&seed=1729&mode=race&race=dijkstra,bmssp,dmsy`) because sparse 25k WebM replay is too long for the announcement PR; the sparse 25k seed 4 URL remains the default live race.

- [x] README 3-way hero GIF links the city seed URL above; caption matches the completed **photo-finish** banner on that take (Dijkstra: 9,815; BMSSP '25: 14,328; DMSY '26: 69,899) and separately names the settle-all work clock (9,830 / 17,419 / 73,506). Evidence: `test/readme-launch.test.ts`.
- [x] README claims first public implementation of DMSY (arXiv 2602.07868). Evidence: `test/readme-launch.test.ts`.
- [x] ffmpeg palette encode per v1.0 recipe; committed GIF is ~3.2 MB.

### Bench page

- [x] Wall-clock bench at `/sorta-fast/bench/` includes DMSY columns alongside Dijkstra and BMSSP. Evidence: `test/wall-clock-bench.test.ts`.

### Announcement

- [x] Blog drafted at `docs/blog/implementing-dmsy.md` from `docs/paper-notes.md`. Evidence: `test/blog-dmsy.test.ts`.
- [ ] Post targets: Hacker News, Papers We Love / arXiv 2602.07868 readers, Twitter/X with OG card link.
- [ ] Tag **v2.0** only after an explicit human ask — do not bump `package.json` in this issue.
