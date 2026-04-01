# PROJECT_MAP.md — Cellar Tracker

## What It Does

A standalone, single-file winery management app for **Tystrya Estate** (Ribbon Ridge, OR). Tracks wine lots / barrels through the winemaking process — logging chemical readings, scheduling maintenance tasks, calculating additions, mapping barrel positions, and generating reports. Runs directly in Safari from the filesystem (`file://`) with no build step, server, or internet connection required (beyond the initial CDN load for React/ReactDOM).

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| UI framework | React 18 | Loaded from `cdnjs.cloudflare.com` CDN |
| JSX | Pre-transpiled | Python script converts JSX → `React.createElement` at build time; no runtime transpiler |
| State | `useState` / `useMemo` | Local React state only; no Redux / Zustand |
| Persistence | None (session only) | All data lives in-memory; page reload resets to `initialLots` seed data |
| Styling | Inline styles + CSS variables | Dark theme; all styles in JS objects using the `C` color palette |
| Build tooling | `check-build.py` | Python validator; 26 checks; run with `python3 check-build.py cellar-tracker.html` |

---

## File Structure

```
cellar-tracker.html          ← The entire app (single file, ~320KB)
check-build.py               ← Automated build validator (26 checks)
cellar-tracker-prototype.jsx ← Early prototype / reference (not in use)
cellar-tracker.html.bak      ← Backup snapshot
PROJECT_MAP.md               ← This file
```

**Working files** (in `/sessions/sweet-amazing-allen/` — not committed):
```
original_jsx.js              ← Extracted raw JSX from Babel-era backup
transformed.js               ← Output of jsx_transform.py (current pre-transpiled script 5)
jsx_transform.py             ← Python recursive-descent JSX → React.createElement transformer
```

---

## HTML Script Block Structure

The single HTML file contains five `<script>` blocks that execute in order:

| # | Type | Size | Purpose |
|---|---|---|---|
| 1 | `<script src="...react.development.js" crossorigin>` | ~0.1KB tag | React 18 from cdnjs |
| 2 | `<script src="...react-dom.development.js" crossorigin>` | ~0.1KB tag | ReactDOM 18 from cdnjs |
| 3 | `<script>` (IIFE) | ~1.7KB | Error overlay + loading spinner setup; registers `window.onerror` |
| 4 | `<script>` (plain JS) | ~136KB | Seed data + pure-JS utilities (no JSX) |
| 5 | `<script>` (pre-transpiled) | ~173KB | All React components, pre-compiled to `React.createElement` |

**Critical rule:** Scripts 4 and 5 must not share any `const` identifier names at the top level — redeclaration is a fatal `SyntaxError` in Safari.

---

## Script 4 — Pure JS Contents

All declared with `const` at the top level. These must NOT be re-declared in Script 5.

| Name | Type | Description |
|---|---|---|
| `initialLots` | `Array` | 179 seed lots — the starting wine/barrel dataset |
| `C` | Object | Color palette (`C.accent`, `C.green`, `C.red`, etc.) |
| `CELLAR_RACKS` | Array | Rack name list (`["EBS 1" … "EBS 10"]`) |
| `SLOTS` | Array | Barrel slot identifiers (`["A","B","C"]`) |
| `SCREENS` | Object | Screen name constants |
| `ROLES` | Object | Role definitions with permission levels |
| `PERMISSIONS` | Object | Per-action minimum role levels |
| `DEFAULT_SETTINGS` | Object | Default winery settings (intervals, thresholds) |
| `USER_COLORS` | Array | Avatar color palette |
| `HEALTH_FLAGS` | Array | Lot health status labels/colors |
| `INITIAL_WINERIES` | Array | Seed winery (Tystrya Estate + `initialLots`) |
| `today` | Function | Returns today's ISO date string |
| `daysAgo` | Function | Calculates days elapsed since a date |
| `addDays` | Function | Adds N days to a date |
| `fmt` | Function | Formats a date for display |
| `makeAlerts` | Function | Builds alert schedule object for a lot |
| `can` | Function | Permission check: `can(user, 'addAddition')` |
| `roleKeyMap` | Object | Maps display role names to role keys |
| `makeUser` | Function | Creates a user object with initials + color |
| `agentEngine` | Function | Winemaking alert + recommendation engine |
| `blockRecommendations` | Function | Generates recommendations for vineyard blocks |

---

## Script 5 — React Components

All React UI lives here as pre-transpiled `React.createElement` calls. Hooks destructured at top: `const { useState, useMemo, useRef } = React`.

### Utility Components

| Component | Description |
|---|---|
| `Card` | Styled card wrapper |
| `Dot` | Status indicator dot |
| `SectionLabel` | Section header label |
| `AlertBadge` | Notification badge with count |

### Tab Components

| Component | Used In | Description |
|---|---|---|
| `PHTrackingTab` | Lot detail | pH log chart + entry |
| `BrixChart` | Lot detail | Brix over time chart |

### Modal Components

| Component | Description |
|---|---|
| `CheckModal` | Log a chemical reading (SO₂, malic, pH, Brix) |

### Calculator Components (all in `ToolsScreen`)

| Component | Description |
|---|---|
| `TartaricCalc` | Tartaric acid addition calculator |
| `ChaptalCalc` | Chaptalization (sugar addition) calculator |
| `BlendCalc` | Blend percentage calculator |
| `KMBSCalc` | KMBS / SO₂ addition calculator |
| `CopperCalc` | Copper sulfate addition calculator |
| `YANCalc` | YAN (Yeast Assimilable Nitrogen) calculator |
| `BrixSugar` | Brix ↔ sugar density converter |

### Screen Components

| Component | SCREENS key | Description |
|---|---|---|
| `MapScreen` | `map` | Visual barrel rack map |
| `ToolsScreen` | `tools` | All calculators in one screen |
| `AlertsScreen` | `alerts` | Upcoming / overdue maintenance alerts |
| `TransferScreen` | `transfer` | Barrel / tank transfer workflow |
| `BlocksScreen` | `blocks` | Vineyard block management |
| `ReportScreen` | `report` | Winery summary + export |
| `SettingsScreen` | `settings` | Winery settings + user management |
| `ToolsBarrelMap` | (sub) | Inline barrel map in tools screen |

### Root Component

| Component | Description |
|---|---|
| `App` | Top-level: manages all global state, navigation, multi-winery, auth |

---

## App State (inside `App`)

All state lives in `App` via `useState`:

| State | Description |
|---|---|
| `wineries` | Array of all wineries; initialized from `INITIAL_WINERIES` |
| `activeWineryId` | Currently selected winery |
| `screen` | Current screen from `SCREENS` |
| `activeUser` | Logged-in user object (or `null`) |
| `selectedLotId` | Lot open in detail view |
| `detailTab` | Active tab within lot detail |

---

## Navigation / Screens

| Screen | Key | Access Level |
|---|---|---|
| Dashboard | `dash` | All |
| Lot List | `lots` | All |
| Lot Detail | `detail` | All |
| Alerts | `alerts` | All |
| Barrel Map | `map` | All |
| Transfer | `transfer` | `asst` (level 2+) |
| Tools / Calculators | `tools` | All |
| Vineyard Blocks | `blocks` | All |
| Reports | `report` | `cellar` (level 1+) |
| Settings | `settings` | `lead` (level 3+) |

---

## Role / Permission System

Roles have numeric levels (0–4). Permissions require a minimum level:

| Role | Key | Level |
|---|---|---|
| Winemaker / Owner | `owner` | 4 |
| Lead Winemaker | `lead` | 3 |
| Asst. Winemaker | `asst` | 2 |
| Cellar Hand | `cellar` | 1 |
| Intern | `intern` | 0 |

Key permissions: `editSettings` (3+), `addLot` (2+), `deleteLot` (3+), `logReadings` (1+), `addAddition` (2+), `transfer` (2+).

---

## Known Safari / file:// Constraints

This app is designed to open directly in Safari from the filesystem. This creates hard constraints:

1. **CDN restrictions** — Only `cdnjs.cloudflare.com` is reliably accessible from `file://` in Safari. `jsdelivr.net` and `unpkg.com` are blocked.
2. **No runtime transpiler** — Babel and Sucrase CDN both fail (Babel: too large for Safari's JavaScriptCore to eval; Sucrase: CDN blocked). JSX must be pre-transpiled at build time.
3. **No `const` redeclaration** — Each `<script>` tag shares global scope. Re-declaring the same `const` across scripts is a fatal `SyntaxError`.
4. **No modules** — `type="module"` is not used; everything is global scope.
5. **crossorigin="anonymous"** — Required on CDN script tags so Safari reports real error messages through `window.onerror` instead of masking them as "Script error." at line 0.

---

## Build & Validation

```bash
# Validate the build (26 checks)
python3 check-build.py cellar-tracker.html

# Re-transpile JSX after source changes (requires jsx_transform.py)
python3 jsx_transform.py          # runs smoke tests
# Then rebuild via the full pipeline in jsx_transform.py
```

### Build checks include:
- 5 balanced `<script>` tags
- No Babel/Sucrase CDN references
- Script sizes in expected ranges
- Script 4 contains all required constants/functions
- Script 4 has no JSX
- Script 5 has 1000+ `React.createElement` calls
- `ReactDOM.createRoot` present
- `function App` present
- No jsdelivr/unpkg CDN URLs
- `#root` div present
- React 18 and ReactDOM 18 CDN tags present

---

## Development Guardrails

This project follows the **Clean Development Protocol** (`/sessions/sweet-amazing-allen/mnt/.claude/skills/clean-dev-protocol/`).

Key rules for this specific project:

1. **Never re-declare a `const` that exists in Script 4** inside Script 5 or any other script block.
2. **After any JSX source edit**, re-run `jsx_transform.py` to regenerate Script 5, then run `check-build.py` to validate before shipping.
3. **Never introduce new CDN URLs** from non-cdnjs sources — they will break in Safari file:// context.
4. **Test in Safari** — Chrome/Firefox may be more lenient; Safari's JavaScriptCore is the constraint.
5. **One change at a time** — the build pipeline is fragile in Safari; confirm each step works before stacking changes.

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Stable, tested, buildable |
| `feature/*` | New screens or major features |
| `fix/*` | Bug fixes |
| `chore/*` | Tooling, documentation, build changes |

---

## Open Items / Follow-up

- [ ] Data persistence: currently in-memory only; localStorage or file export would enable persistence across page reloads
- [ ] `jsx_transform.py` lives outside the outputs folder — consider adding it to the repo
- [ ] The `.bak` file should be removed before production tagging
- [ ] Consider production build (minified, production React) vs development build
