#!/usr/bin/env python3
"""
Cellar Tracker — Automated Build Checker
Run this after every change to cellar-tracker.html to catch issues early.
Usage: python3 check-build.py [path/to/cellar-tracker.html]
"""

import sys
import re
import os

FILE = sys.argv[1] if len(sys.argv) > 1 else "cellar-tracker.html"
BABEL_WARN_KB = 160
BABEL_ERROR_KB = 200

errors   = []
warnings = []
passed   = []

def err(msg):   errors.append(f"  ✗ ERROR: {msg}")
def warn(msg):  warnings.append(f"  ⚠ WARN:  {msg}")
def ok(msg):    passed.append(f"  ✓ OK:    {msg}")

# ── Load file ──────────────────────────────────────────────────────────────────
if not os.path.exists(FILE):
    print(f"File not found: {FILE}")
    sys.exit(1)

with open(FILE, "r", encoding="utf-8") as f:
    content = f.read()

print(f"\n🔍 Checking: {FILE}  ({len(content):,} bytes)\n")

# ── Script tag structure ───────────────────────────────────────────────────────
print("── Script Structure ──────────────────────────────────────────────────────")

script_opens  = [(m.start(), m.group()) for m in re.finditer(r'<script[^>]*>', content)]
script_closes = [m.start() for m in re.finditer(r'</script>', content)]

if len(script_opens) != len(script_closes):
    err(f"Script tag mismatch: {len(script_opens)} opens vs {len(script_closes)} closes")
else:
    ok(f"{len(script_opens)} script tags balanced")

# Find plain script and Babel script
plain_open  = content.find('<script>')
# Sucrase architecture: no Babel scripts, JSX is embedded as a JS string
if plain_open == -1:
    err("No plain <script> tag found (expected: initialLots data block)")
# Static architecture: JSX is pre-transpiled to React.createElement — no CDN transpiler needed
if 'sucrase.transform' in content or 'text/babel' in content:
    warn("Sucrase/Babel CDN transpiler found — should be pre-transpiled in static architecture")
if 'React.createElement' not in content:
    err("React.createElement missing — JSX was not pre-transpiled")
else:
    ok("Pre-transpiled React.createElement calls present (static architecture)")
if 'function App' not in content:
    err("function App missing from transpiled script")
else:
    ok("function App present in transpiled script")
babel_open = -1  # No babel/sucrase scripts in static architecture

# ── Script sizes ──────────────────────────────────────────────────────────────
print("\n── Script Sizes ──────────────────────────────────────────────────────────")

for i, (pos, tag) in enumerate(script_opens):
    size_chars = script_closes[i] - pos if i < len(script_closes) else 0
    kb = size_chars / 1024
    label = tag[:50].replace('<script', 'Script').replace('"', '').replace('>', '')
    if 'text/babel' in tag:
        if kb > BABEL_ERROR_KB:
            err(f"Babel script too large: {kb:.1f} KB (limit ~{BABEL_ERROR_KB} KB) — Babel CDN will fail")
        elif kb > BABEL_WARN_KB:
            warn(f"Babel script large: {kb:.1f} KB (warn at {BABEL_WARN_KB} KB) — may be slow")
        else:
            ok(f"Babel script size: {kb:.1f} KB ✓")
    else:
        ok(f"Script {i+1}: {kb:.1f} KB  [{label[:40]}]")

# ── Plain script contents ─────────────────────────────────────────────────────
print("\n── Plain Script Contents ─────────────────────────────────────────────────")

# Find the script that actually contains initialLots (not the error overlay)
plain_open_real = content.find('const initialLots')
if plain_open_real == -1:
    err("initialLots not found in any script tag!")
    plain_open = -1
if plain_open != -1:
    # Walk back to the opening <script> tag
    plain_open = content.rfind('<script', 0, plain_open_real)
    plain_end = content.find('</script>', plain_open_real)
    plain = content[plain_open:plain_end]

    required_in_plain = [
        ('initialLots',         'initialLots data array'),
        ('const C =',           'color constants (C)'),
        ('const today',         'today() utility function'),
        ('makeAlerts',          'makeAlerts() helper'),
        ('SCREENS',             'SCREENS object'),
        ('ROLES',               'ROLES object'),
        ('PERMISSIONS',         'PERMISSIONS object'),
        ('DEFAULT_SETTINGS',    'DEFAULT_SETTINGS object'),
        ('HEALTH_FLAGS',        'HEALTH_FLAGS array'),
        ('agentEngine',         'agentEngine() function'),
        ('blockRecommendations','blockRecommendations() function'),
    ]
    for key, label in required_in_plain:
        if key in plain:
            ok(f"Plain script has: {label}")
        else:
            err(f"Plain script MISSING: {label}")

    # Make sure no JSX crept into the plain script
    # Simple heuristic: no return ( <div in plain script
    if re.search(r'return\s*\(\s*<', plain):
        err("Plain script contains JSX (return (<...) — must be in Babel script only!")
    else:
        ok("Plain script has no JSX")

# ── Babel script checks ───────────────────────────────────────────────────────
print("\n── Babel Script Checks ───────────────────────────────────────────────────")

if babel_open != -1:
    babel_start = content.find('>', babel_open) + 1  # skip to end of opening tag
    babel_end   = content.rfind('</script>')
    babel       = content[babel_start:babel_end]

    # Brace/paren/bracket balance
    brace_diff   = babel.count('{') - babel.count('}')
    paren_diff   = babel.count('(') - babel.count(')')
    bracket_diff = babel.count('[') - babel.count(']')

    if brace_diff != 0:
        err(f"Babel: unbalanced braces ({brace_diff:+d}) — missing {'}}' if brace_diff > 0 else '{'}")
    else:
        ok("Babel: braces balanced")

    if paren_diff != 0:
        err(f"Babel: unbalanced parentheses ({paren_diff:+d})")
    else:
        ok("Babel: parentheses balanced")

    if bracket_diff != 0:
        err(f"Babel: unbalanced brackets ({bracket_diff:+d})")
    else:
        ok("Babel: brackets balanced")

    # Backtick balance
    bt = babel.count('`')
    if bt % 2 != 0:
        err(f"Babel: odd backtick count ({bt}) — unclosed template literal")
    else:
        ok(f"Babel: backticks balanced ({bt})")

    # Python artifacts (common mistake when generating JS from Python)
    py_arts = re.findall(r'(?<!["\'])\b(None|True|False)\b(?!["\'])', babel)
    if py_arts:
        err(f"Babel contains Python literals: {set(py_arts)} — replace with null/true/false")
    else:
        ok("Babel: no Python artifacts (None/True/False)")

    # ReactDOM.createRoot must be present and at the end
    if 'ReactDOM.createRoot' not in babel:
        err("Babel: ReactDOM.createRoot missing — app will not mount")
    else:
        ok("Babel: ReactDOM.createRoot present")

    # Core components
    required_components = [
        'function App', 'PHTrackingTab', 'MapScreen',
        'AlertsScreen', 'ToolsScreen', 'BlocksScreen',
        'ReportScreen', 'SettingsScreen', 'TransferScreen',
    ]
    missing = [c for c in required_components if c not in babel]
    if missing:
        err(f"Babel missing components: {missing}")
    else:
        ok(f"Babel: all {len(required_components)} core components present")

    # No duplicate definitions of things that should be in plain script
    should_not_be_in_babel = ['const agentEngine', 'const blockRecommendations',
                               'const initialLots', 'const SCREENS =', 'const ROLES =']
    dupes = [x for x in should_not_be_in_babel if x in babel]
    if dupes:
        warn(f"Babel has duplicate definitions (also in plain script): {dupes}")
    else:
        ok("Babel: no duplicate pure-JS definitions")

    # Check JSX self-closing vs regular divs
    open_divs  = len(re.findall(r'<div[\s/>]', babel))
    close_divs = len(re.findall(r'</div>', babel))
    self_divs  = len(re.findall(r'<div[^>]*/>', babel))
    real_diff  = open_divs - close_divs - self_divs
    if real_diff != 0:
        err(f"Babel: JSX div mismatch — {open_divs} open, {close_divs} close, {self_divs} self-closing => net {real_diff}")
    else:
        ok(f"Babel: JSX divs balanced ({open_divs} open, {close_divs} close, {self_divs} self-closing)")

# ── Static architecture checks ────────────────────────────────────────────────
print("\n── Static Architecture ───────────────────────────────────────────────────")

if 'ReactDOM.createRoot' in content:
    ok("ReactDOM.createRoot present in transpiled script")
else:
    err("ReactDOM.createRoot missing — app will not mount")

ce_count = content.count('React.createElement')
if ce_count > 100:
    ok(f"React.createElement calls: {ce_count} (pre-transpiled JSX looks complete)")
elif ce_count > 0:
    warn(f"Only {ce_count} React.createElement calls — JSX may be partially transpiled")
else:
    err("No React.createElement calls found — JSX was not transpiled")

if 'cdn.jsdelivr.net' in content or 'unpkg.com' in content:
    warn("Non-cdnjs CDN URLs found (jsdelivr/unpkg) — may fail in Safari file:// context")
else:
    ok("No jsdelivr/unpkg CDNs (Safari file:// safe)")

# ── Root element check ────────────────────────────────────────────────────────
print("\n── HTML Structure ────────────────────────────────────────────────────────")

if '<div id="root">' in content or '<div id="root"/>' in content:
    ok("Root div (#root) present")
else:
    err("Root div (#root) missing — ReactDOM.createRoot will fail")

cdns = [
    ('react.development.js',    'React 18'),
    ('react-dom.development.js','ReactDOM 18'),
]
for cdn, label in cdns:
    if cdn in content:
        ok(f"CDN loaded: {label}")
    else:
        err(f"CDN missing: {label}")

# ── Summary ───────────────────────────────────────────────────────────────────
print("\n══════════════════════════════════════════════════════════════════════════")

for line in passed:   print(line)
for line in warnings: print(line)
for line in errors:   print(line)

print("\n══════════════════════════════════════════════════════════════════════════")
print(f"  Result:  {len(passed)} passed  |  {len(warnings)} warnings  |  {len(errors)} errors")

if errors:
    print("  Status:  ❌ BUILD INVALID — fix errors above before opening in browser")
    sys.exit(1)
elif warnings:
    print("  Status:  ⚠️  BUILD OK with warnings — may work but review warnings")
    sys.exit(0)
else:
    print("  Status:  ✅ BUILD CLEAN — safe to open in browser")
    sys.exit(0)
