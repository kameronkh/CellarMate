#!/usr/bin/env python3
"""CellarMate structure check. Run from the project folder before every commit:  python3 tests/check.py
Catches the mistakes that make a project messy: a module that is not loaded, not cached for offline use,
registered twice, or has a syntax error; a screen that is not in the navigation catalog."""
import os, re, subprocess, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)
errs, notes = [], []
def read(p): return open(p, encoding='utf-8').read()

html, sw = read('index.html'), read('sw.js')
mods = sorted(f for f in os.listdir('modules') if f.endswith('.js'))

def node_check(path, label):
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    if r.returncode: errs.append(label + ' has a syntax error: ' + r.stderr.strip().splitlines()[0])

# 1. every module is loaded, cached offline, syntax-clean and starts with a comment saying what it is
for f in mods:
    if '/modules/' + f not in html: errs.append(f + ' is not loaded by index.html')
    if "'/modules/" + f + "'" not in sw: errs.append(f + ' is not in the offline cache list in sw.js')
    node_check('modules/' + f, 'modules/' + f)
    first = read('modules/' + f).lstrip()[:2]
    if first != '/*': errs.append(f + ' has no header comment')
for ref in re.findall(r'<script src="(/modules/[^"]+)"', html):
    if not os.path.exists(ref.lstrip('/')): errs.append('index.html loads a missing file: ' + ref)

# 2. the main script and the service worker and tests
inline = max(re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>', html, re.S), key=len)
open('/tmp/cm_inline_check.js', 'w', encoding='utf-8').write(inline)
node_check('/tmp/cm_inline_check.js', 'index.html main script')
node_check('sw.js', 'sw.js'); node_check('tests/smoke.js', 'tests/smoke.js')

# 3. one owner per CM_MODULES key
seen = {}
for f in mods:
    for k in re.findall(r"CM_MODULES\.(\w+)\s*=", read('modules/' + f)):
        seen.setdefault(k, []).append(f)
for k, fs in seen.items():
    if len(fs) > 1: errs.append("CM_MODULES." + k + ' is registered by more than one file: ' + ', '.join(fs))

# 4. every registered module tab has a place in the navigation catalog
nav = read('modules/nav.js')
for k in seen:
    if "tab: '" + k + "'" not in nav: errs.append("module '" + k + "' is registered but has no entry in modules/nav.js")

# 5. cache version moves with the code
if not re.search(r"cellarmate-shell-v\d+", sw): errs.append('sw.js has no cache version')

# 6. size watch: the main file should shrink or stay put, not grow forever
lines = html.count('\n') + 1
notes.append('index.html: %d lines, %d modules, %d catalog entries' % (lines, len(mods), len(re.findall(r"^\s*[WVAR]\('", nav, re.M))))

print('\n'.join(notes))
if errs:
    print('\n'.join('FAIL: ' + e for e in errs)); sys.exit(1)
print('structure check passed')
