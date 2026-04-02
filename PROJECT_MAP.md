# PROJECT_MAP.md — CellarMate

> **Project boundary:** This document covers **CellarMate only**.
> CrewMate (formerly CrewPay) is a completely separate product with its own GitHub repo, Vercel project, and Supabase project. The two products share no code, no database, and no deployment infrastructure.

---

## What It Does

A standalone winery management app for **Tystrya Estate** (Ribbon Ridge, OR). Tracks wine lots and barrels through the winemaking process — logging chemical readings, scheduling maintenance tasks, calculating additions, mapping barrel positions, and generating reports.

---

## Platform & Infrastructure

| Platform | Resource | Details |
|---|---|---|
| **GitHub** | `kameronkh/CellarMate` | Public repo — canonical source of truth |
| **GitHub (old)** | `kameronkh/cellar-tracker` | Archived — read-only, do not use |
| **Vercel** | `cellarmate` project | Live at `https://cellar-tracker.vercel.app` |
| **Supabase** | `CellarMate` project | Project ID: `lugqfeqocwltgvibizca` · Region: `us-west-2` |

> **Note:** The Vercel live URL still reads `cellar-tracker.vercel.app` (legacy alias preserved after project rename). The page title correctly reads "CellarMate — Tystrya Estate".

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| UI framework | React 18 | Loaded from `cdnjs.cloudflare.com` CDN |
| JSX | Pre-transpiled | Python script converts JSX → `React.createElement` at build time; no runtime transpiler |
| State | `useState` / `useMemo` | Local React state only; no Redux / Zustand |
| Persistence | **In-memory only** | All data lives in React state; page reload resets to `initialLots` seed data |
| Backend | Supabase (schema ready, not yet integrated) | See Open Items |
| Styling | Inline styles + CSS variables | Dark theme; all styles in JS objects using the `C` color palette |
| Build tooling | `check-build.py` | Python validator; 26 checks |

---

## Supabase Schema (exists, not yet wired up)

**Project:** `CellarMate` (`lugqfeqocwltgvibizca`)

| Table | Purpose |
|---|---|
| `organizations` | Winery records (name, region, owner) |
| `profiles` | Users, linked to `auth.users` |
| `lots` | Wine/barrel lots with all metadata |
| `lot_logs` | Chemical readings (Brix, pH, TA, SO₂, etc.) |
| `lot_additions` | Additions log (SO₂, nutrients, etc.) |
| `lot_alerts` | Scheduled alert rules per lot |

RLS is enabled on all tables. An auto-trigger creates an `organization` record when an owner signs up.

The static HTML app does **not yet call Supabase** — connecting it is the next major milestone.

---

## File Structure

```
index.html               ← The entire app (single file, ~320KB) — deployed to Vercel
check-build.py           ← Automated build validator (26 checks)
PROJECT_MAP.md           ← This file
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
| 5 | `<script>` (pre-transpiled) | ~173KB | All React components, compiled to `React.createElement` |

**Critical rule:** Scripts 4 and 5 must not share any `const` identifier names at the top level — redeclaration is a fatal `SyntaxError` in Safari.

---

## Script 4 — Pure JS Contents

| Name | Type | Description |
|---|---|---|
| `initialLots` | Array | 179 seed lots — the starting wine/barrel dataset |
| `C` | Object | Color palette (`C.accent`, `C.green`, `C.red`, etc.) |
| `CELLAR_RACKS` | Array | Rack name list |
| `SLOTS` | Array | Barrel slot identifiers |
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

## Auth Flow (localStorage)

Auth is gate-kept in the App component via early returns before any existing screen renders.

| Component | Role | Behavior |
|---|---|---|
| `LoginScreen` | All | Email + password form; `simpleHash` (djb2 XOR) validates against stored `passHash` |
| `SuperAdminScreen` | `super_admin` only | Wineries tab (stats + "View →" impersonate) · Accounts tab (list + Add Account form) |
| (existing app) | `winery_user` | Dropped straight into their assigned winery after login |

**localStorage keys:**
- `cellarmate_auth_accounts` — array of account objects (email, passHash, role, wineryId)
- `cellarmate_auth_session` — current session object (cleared on logout)
- `cellarmate_wineries` — persisted winery + lot data (survives page reload)

**Demo credentials:** `kameron@tystrya.com` / `tystrya` · `admin@cellarmate.app` / `admin`

**Next step:** Replace simpleHash + localStorage with Supabase Auth once the localStorage flow is validated.

---

## Screen Components

| Screen | SCREENS key | Access Level |
|---|---|---|
| Login | *(early return, no key)* | Unauthenticated visitors |
| Super Admin | `superAdmin` | `super_admin` role only |
| Dashboard | `dash` | All authenticated winery users |
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

| Role | Key | Level |
|---|---|---|
| Winemaker / Owner | `owner` | 4 |
| Lead Winemaker | `lead` | 3 |
| Asst. Winemaker | `asst` | 2 |
| Cellar Hand | `cellar` | 1 |
| Intern | `intern` | 0 |

Key permissions: `editSettings` (3+), `addLot` (2+), `deleteLot` (3+), `logReadings` (1+), `addAddition` (2+), `transfer` (2+).

---

## Safari / file:// Constraints

This app is designed to run in a browser from Vercel, but was originally built for Safari `file://`. These constraints still apply:

1. **CDN only from `cdnjs.cloudflare.com`** — `jsdelivr.net` and `unpkg.com` are blocked in Safari file:// context.
2. **No runtime transpiler** — JSX must be pre-transpiled at build time.
3. **No `const` redeclaration** — fatal `SyntaxError` if the same name appears in both Script 4 and Script 5.
4. **No modules** — everything runs in global scope.
5. **`crossorigin="anonymous"`** — required on CDN script tags for proper error reporting via `window.onerror`.

---

## Development Guardrails

This project follows the **Clean Development Protocol** (`/sessions/sweet-amazing-allen/mnt/.claude/skills/clean-dev-protocol/SKILL.md`).

CellarMate-specific rules:

1. **Never re-declare a `const` from Script 4** inside Script 5 — instant fatal error.
2. **After any JSX source edit**, re-transpile with `jsx_transform.py`, then validate with `check-build.py`.
3. **Never add CDN URLs** from non-cdnjs sources.
4. **Test in Safari** — it is the strictest environment.
5. **One change at a time** — confirm each step works before stacking.
6. **This repo is CellarMate only** — do not reference, import, or link to CrewMate code or infrastructure.

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Stable, deployed to Vercel |
| `feature/*` | New screens or major features |
| `fix/*` | Bug fixes |
| `chore/*` | Tooling, docs, build changes |

---

## Open Items

- [ ] **Supabase auth** — replace localStorage `simpleHash` auth with Supabase Auth; wire `cellarmate_auth_accounts` → `profiles` table
- [ ] **Supabase data** — connect winery/lot state to Supabase (`lots`, `lot_logs`, etc.); retire `cellarmate_wineries` localStorage key
- [ ] **Vercel URL** — optionally add `cellarmate.vercel.app` as a domain alias and retire `cellar-tracker.vercel.app`
- [ ] **Production build** — consider switching to minified React for production
- [ ] **`jsx_transform.py`** — lives outside the repo; consider committing it to `CellarMate` for reproducible builds
