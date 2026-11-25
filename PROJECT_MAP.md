# PROJECT_MAP.md: CellarMate

CellarMate only. CrewMate is a separate product (own repo, Vercel project and database).

## What it is
Winery and vineyard management for Tystrya Estate (Ribbon Ridge, OR) and the accounts it hosts. Two sides that share a login and data but keep separate menus:
- **Winery**: lots, barrels, tanks, SO2 and malic work, barrel map, reports, supplies, costs, compliance.
- **Vineyard**: weather and ripeness, sprays, field work, season and budget, crop estimates, records, library.

An account uses one side or both (`organizations.modules` = `winery`, `vineyard` or `both`). The Winery / Vineyard switch shows only for `both`.

## Where things live
| What | Where |
|---|---|
| Live app | https://cellar-tracker.vercel.app (Vercel deploys `main` from GitHub `kameronkh/CellarMate`) |
| Database | Supabase project `qvfelrqijvvxpookotvr`, schema `cellarmate`, org id `762fc809-0341-4ee2-834f-16e707181ea7` |
| App shell | `index.html`: login, dashboard, lots, log, shared helpers (`C` colors, `cmE`, `cmSeg`, `cmFetch`), Reports screen frame |
| Feature modules | `modules/*.js`, one file per feature, each starts with a header comment |
| Navigation | `modules/nav.js`: the catalog of every screen, sides, bottom bar, More, search, Reports hub |
| Offline | `sw.js` (app shell cache, bump `cellarmate-shell-vN` each release) and the offline layer in `index.html` (IndexedDB queue, sync) |
| Tests | `tests/smoke.js` (runs in the live app), `tests/check.py` (structure check) |

## How the screens fit together
- `App()` in `index.html` holds the current screen. `go(screen)` changes it.
- Bottom bar: 5 tabs per side, the last is **More**. More lists every screen grouped by task. The box at the top of every screen finds any screen.
- **Reports** opens on a list of single reports (the hub). Each report has its own filters and PDF / Excel buttons. PDFs are letter size, landscape for wide tables, with the title on every page and "page x of y".
- A module registers its tab with `window.CM_MODULES.<key> = { label, Component, order }`. It must also have an entry in `modules/nav.js` or nobody can reach it.
- The Vineyard screen (`modules/vineyard.js`) has its own sections; nav.js links straight to each one.

## Adding a screen
1. Write `modules/<name>.js` (header comment, register in `CM_MODULES`).
2. Add `<script src="/modules/<name>.js">` to `index.html` and the file to `CM_SHELL` in `sw.js`.
3. Add one line to the catalog in `modules/nav.js` (side, group, words people would search, where it opens; `kind: 'report'` puts it on the Reports hub).
4. Run `python3 tests/check.py`, then the smoke tests.

## Release routine
Build locally, then `python3 tests/check.py`, then run `cmSmoke()` in the local app (`python3 -m http.server 8765`), then commit and push the feature branch and `main`, wait for Vercel (`/sw.js` shows the new shell version), run `cmSmoke()` on production.

## Data (tables the app uses most)
`barrel_status_2025`, `barrel_status_2026` (what to do for each barrel), `barrel_positions` (map: EBS racks, floor Rows, Pallets), `cellar_actions` (SO2 and other work logged), `supply_uses` (tablet stock), `lab_results`, `so2_log`, `malic_results`, `vessels` (tanks, toppings, kegs), `ferment_readings`, `questions`, `photo_review`, plus the vineyard tables (`vineyards`, `vineyard_blocks`, `estate_harvests`, `picks`, `vineyard_sprays`, ...).

## Conventions
- Keep the app and the questions list in step: every open question lives in the app (`questions` table) and the shared questions doc.
- AI features only on paid plans, at cost.
- Any value loaded from a notebook photo keeps a link to that page.
