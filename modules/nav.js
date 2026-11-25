/* CellarMate module: Navigation
   One place that knows every screen in the app and how to reach it.
   - Two sides, Winery and Vineyard, kept apart. An account can use one or both
     (organizations.modules: 'winery', 'vineyard' or 'both'); the switch shows only for 'both'.
   - Bottom bar: 5 short tabs per side, the last one is More.
   - More: every screen grouped by task, with a search box that finds any screen.
   - Reports hub: the Reports screen opens as a list of single reports, each with a short description.
   Pure helpers on window for the smoke tests: cmNavItems, cmNavSearch, cmNavAllowed, cmNavSide, cmNavOpen. */
(function () {
  'use strict';

  /* ---------- catalog: one row per place in the app ----------
     to: { screen, tab, rep, vy }  screen = key in SCREENS; tab = Reports screen tab; rep = report inside the Reports tab;
         vy = section inside the Vineyard screen.
     side: 'winery' | 'vineyard' | 'both'.  kind: 'report' puts it on the Reports hub. */
  function W(k, label, group, words, to, extra) { return Object.assign({ k: k, label: label, side: 'winery', group: group, words: words || '', to: to }, extra || {}); }
  function V(k, label, group, words, vy, desc) { return { k: k, label: label, side: 'vineyard', group: group, words: words || '', to: { screen: 'blocks', vy: vy }, desc: desc || '' }; }
  function A(k, label, words, to, extra) { return Object.assign({ k: k, label: label, side: 'both', group: 'Account and help', words: words || '', to: to }, extra || {}); }
  function R(k, label, rgroup, desc, words, to, extra) { return W(k, label, 'Reports', words, to, Object.assign({ kind: 'report', rgroup: rgroup, desc: desc }, extra || {})); }

  var ITEMS = [
    /* winery: daily work */
    W('home', 'Cellar overview', 'Daily work', 'home dashboard overview alerts start', { screen: 'dash' }),
    W('today', 'Today', 'Daily work', 'day sheet crew what to do add so2 tests print', { screen: 'reports', tab: 'today' }, { mod: 'today' }),
    W('log', 'Log work and readings', 'Daily work', 'record reading entry add so2 ph malic brix', { screen: 'log' }),
    W('map', 'Barrel map', 'Daily work', 'location where barrel row rack find feed sulfur floor ebs', { screen: 'reports', tab: 'map' }, { mod: 'map' }),
    W('top', 'Topping', 'Daily work', 'top up topping wine walking order', { screen: 'reports', tab: 'top' }, { mod: 'top' }),
    W('work', 'Work orders', 'Daily work', 'tasks assign crew jobs', { screen: 'reports', tab: 'work' }),
    W('sched', 'Schedule and alerts', 'Daily work', 'overdue due reminders calendar', { screen: 'alerts' }),
    /* winery: cellar */
    W('lots', 'All lots', 'Cellar', 'lots wines barrels tanks list', { screen: 'lots' }),
    W('health', 'Cellar health', 'Cellar', 'issues problems flags watch', { screen: 'health' }),
    W('ferm', 'Fermentation', 'Cellar', 'brix temperature curve ferment cold soak', { screen: 'reports', tab: 'ferm' }, { mod: 'ferm' }),
    W('vol', 'Volumes and moves', 'Cellar', 'volume racking transfer liters gallons moves', { screen: 'reports', tab: 'vol' }),
    W('vint', 'Vintages', 'Cellar', 'vintage compare years', { screen: 'reports', tab: 'vint' }, { mod: 'vint' }),
    W('inv', 'Wine inventory', 'Cellar', 'inventory wine on hand crm', { screen: 'reports', tab: 'inv' }, { mod: 'inv' }),
    W('files', 'Files and photos', 'Cellar', 'files photos documents notebook pictures', { screen: 'reports', tab: 'files' }, { mod: 'files' }),
    /* winery: lab */
    W('tools', 'Lab tools', 'Lab and tests', 'calculator so2 tartaric acid addition dose', { screen: 'tools' }),
    W('lab', 'Lab results', 'Lab and tests', 'panels results ph ta lab', { screen: 'reports', tab: 'lab' }, { mod: 'lab' }),
    W('help', 'Troubleshooter', 'Lab and tests', 'fault problem stuck aldehyde volatile reduction oxidation library', { screen: 'reports', tab: 'help' }, { mod: 'help' }),
    /* winery: reports (also listed on the Reports hub) */
    W('hub', 'All reports', 'Reports', 'reports list pick report print pdf excel', { screen: 'reports', tab: 'hub' }, { desc: 'Pick a report to view, print or export.' }),
    R('r_status', 'All barrels: status table', 'Barrel and wine status', 'Every barrel in one table you can filter by vintage, varietal and issue.', 'status table every barrel filter varietal vintage issue', { screen: 'reports', tab: 'status' }),
    R('r_malic', 'Malic / MLF status', 'Barrel and wine status', 'Which barrels are done, still in MLF, or need a malic test.', 'malic mlf malolactic done test', { screen: 'reports', tab: 'focus', rep: 'malic' }),
    R('r_so2', 'Free SO2: checks due', 'Barrel and wine status', 'Barrels to test or sulfur, estimated gaps and the heaviest users.', 'free so2 sulfur sulphur add check', { screen: 'reports', tab: 'focus', rep: 'so2' }),
    R('r_eat', 'SO2 appetite and alerts', 'Barrel and wine status', 'Barrels that keep losing free SO2.', 'so2 appetite loss alerts', { screen: 'reports', tab: 'focus', rep: 'eat' }),
    R('r_chsul', '2026 Chardonnay: SO2 by malic', 'Barrel and wine status', 'Chardonnay barrels sorted by malic, for the SO2 call.', 'chardonnay so2 malic 2026', { screen: 'reports', tab: 'focus', rep: 'chsul' }),
    R('r_chard', '2025 Chardonnay watch list', 'Barrel and wine status', 'The 2025 Chardonnay barrels with issues to watch.', 'chardonnay 2025 watch', { screen: 'reports', tab: 'focus', rep: 'chard' }),
    R('r_ml', 'ML inoculation plan (2026)', 'Barrel and wine status', 'Which lots to inoculate for malolactic, and when.', 'ml inoculation malolactic bacteria plan', { screen: 'reports', tab: 'focus', rep: 'ml' }),
    R('r_tart', 'Tartaric additions for high pH', 'Barrel and wine status', 'Tartaric acid additions and the pH they were for.', 'tartaric acid high ph addition', { screen: 'reports', tab: 'focus', rep: 'tart' }),
    R('r_top', 'Topping record', 'Barrel and wine status', 'When each barrel was last topped.', 'topping record history', { screen: 'reports', tab: 'focus', rep: 'top' }),
    R('tanks', 'Tanks, toppings and kegs', 'Tanks and cellar', 'Every vessel with contents, pH, malic and the KMBS to protect it.', 'tanks kmbs stainless keg glycol vessel topping', { screen: 'reports', tab: 'tanks' }),
    R('wines', 'Wines and bottling', 'Tanks and cellar', 'Wines, cases bottled and what is on hand.', 'wines bottled cases sku bottling', { screen: 'reports', tab: 'wines' }),
    R('sup', 'Supplies on hand', 'Supplies and costs', 'Stock of tablets, additives and dry goods, with uses.', 'supplies stock tablets additives dry goods inventory', { screen: 'reports', tab: 'sup' }),
    R('mat', 'Materials and additions', 'Supplies and costs', 'Materials used and fermenter additions.', 'materials additions fermenter nutrient', { screen: 'reports', tab: 'mat' }, { mod: 'mat' }),
    R('cost', 'Costs', 'Supplies and costs', 'Cost sheet and cost per lot.', 'cost cogs price spend', { screen: 'reports', tab: 'cost' }, { mod: 'cost' }),
    R('lotcost', 'Cost per lot', 'Supplies and costs', 'What each lot cost, shared out by barrel.', 'cost per lot barrel share', { screen: 'reports', tab: 'lotcost' }, { mod: 'lotcost' }),
    R('assets', 'Winery assets', 'Supplies and costs', 'Equipment and assets list.', 'assets equipment tanks pumps', { screen: 'reports', tab: 'assets' }, { mod: 'assets' }),
    R('ttb', 'TTB compliance', 'Compliance and data', 'Monthly TTB figures from the cellar records.', 'ttb compliance tax bond report', { screen: 'reports', tab: 'ttb' }, { perm: 'facility_view' }),
    R('fac', 'Facility checks', 'Compliance and data', 'Facility checks and certificates.', 'facility checks certificates inspection', { screen: 'reports', tab: 'fac' }, { perm: 'facility_view' }),
    R('data', 'Data tables and export', 'Compliance and data', 'Look through and export any table.', 'data tables export excel csv raw', { screen: 'reports', tab: 'data' }),
    /* vineyard */
    V('v_weather', 'Weather and harvest', 'Today in the vineyard', 'weather rain heat gdd harvest ripeness sugar sample', 'weather', 'Heat units, rain, ripeness samples and the pick window.'),
    V('v_sprays', 'Forecast and sprays', 'Today in the vineyard', 'spray mildew forecast rain wash off program', 'sprays', 'Spray program, mildew pressure and wash-off checks.'),
    V('v_field', 'Field work', 'Work', 'field work labor tasks hedging leaf pruning', 'field', 'Field jobs and labor.'),
    V('v_equipment', 'Equipment', 'Work', 'equipment tractor maintenance', 'equipment', 'Vineyard equipment and upkeep.'),
    V('v_paperwork', 'Paperwork', 'Work', 'paperwork permits certificates documents', 'paperwork', 'Vineyard paperwork.'),
    V('v_owners', 'Schedule and owners', 'Work', 'schedule owners team access tasks growers', 'owners', 'Who does what, and who can see which vineyard.'),
    V('v_season', 'Season and budget', 'Planning', 'season budget outlook calendar cost year', 'season', 'The season calendar and budget by manager.'),
    V('v_crop', 'Crop estimate', 'Planning', 'crop estimate tons thinning clusters yield', 'crop', 'Crop estimates and thinning scenarios.'),
    V('v_records', 'Records', 'Planning', 'records harvest picks tons history', 'records', 'Harvest and block records.'),
    V('v_library', 'Vit library', 'Learn', 'library viticulture reference oregon university', 'library', 'Viticulture reference library.'),
    /* both sides */
    A('plan', 'Plan and usage', 'plan usage billing storage ai', { screen: 'reports', tab: 'plan' }, { mod: 'plan' }),
    A('ask', 'Questions and answers', 'questions answers q&a clean up data', { screen: 'reports', tab: 'ask' }),
    A('admin', 'Admin: people and access', 'admin people users access roles', { screen: 'reports', tab: 'admin' }, { perm: 'manage_users' }),
    A('settings', 'Settings', 'settings account profile', { screen: 'settings' })
  ];

  var GROUP_ORDER = {
    winery: ['Daily work', 'Cellar', 'Lab and tests', 'Reports', 'Account and help'],
    vineyard: ['Today in the vineyard', 'Work', 'Planning', 'Learn', 'Account and help']
  };
  var BAR = {
    winery: [['home', '◈', 'Cellar'], ['today', '☀', 'Today'], ['log', '+', 'Log'], ['map', '▦', 'Map'], ['more', '☰', 'More']],
    vineyard: [['v_weather', '🌿', 'Vineyard'], ['v_field', '⚒', 'Field'], ['v_season', '📅', 'Season'], ['v_sprays', '💧', 'Sprays'], ['more', '☰', 'More']]
  };
  var SIDES = [['winery', 'Winery'], ['vineyard', 'Vineyard']];
  var HOME = { winery: 'home', vineyard: 'v_weather' };

  /* ---------- plan setting and chosen side ---------- */
  var listeners = [];
  var mods = (function () { try { return localStorage.getItem('cm_modules') || 'both'; } catch (e) { return 'both'; } })();
  var modsLoaded = false;
  function notify() { listeners.slice().forEach(function (f) { try { f(); } catch (e) { } }); }
  function useNav() {
    var s = React.useState(0);
    React.useEffect(function () { var f = function () { s[1](function (x) { return x + 1; }); }; listeners.push(f); return function () { listeners = listeners.filter(function (x) { return x !== f; }); }; }, []);
  }
  function allowed(m) { m = m || mods; return m === 'winery' ? ['winery'] : m === 'vineyard' ? ['vineyard'] : ['winery', 'vineyard']; }
  function curSide() {
    var a = allowed(); if (a.length === 1) return a[0];
    var s = 'winery'; try { s = localStorage.getItem('cm_side') || 'winery'; } catch (e) { }
    return a.indexOf(s) >= 0 ? s : a[0];
  }
  function setSideRaw(s) { try { localStorage.setItem('cm_side', s); } catch (e) { } }
  function loadModules() {
    if (modsLoaded) return; modsLoaded = true;
    Promise.resolve(typeof cmOrg === 'function' ? cmOrg() : (window.CM_ME && window.CM_ME.org_id)).then(function (org) {
      if (!org) return null;
      return supa.schema('cellarmate').from('organizations').select('modules').eq('id', org).maybeSingle();
    }).then(function (r) {
      var m = r && r.data && r.data.modules;
      if (m && m !== mods) { mods = m; try { localStorage.setItem('cm_modules', m); } catch (e) { } notify(); }
    }).catch(function () { });
  }
  async function saveModules(m) {
    var org = await cmOrg();
    var r = await supa.schema('cellarmate').from('organizations').update({ modules: m }).eq('id', org).select('modules');
    if (r.error) throw new Error(r.error.message);
    if (!r.data || !r.data.length) throw new Error('Only an account admin can change this.');
    mods = m; try { localStorage.setItem('cm_modules', m); } catch (e) { } notify();
  }

  /* ---------- lookups ---------- */
  function visible(it, side) {
    if (side && it.side !== 'both' && it.side !== side) return false;
    if (it.perm && typeof cmCan === 'function' && !cmCan(it.perm)) return false;
    if (it.mod && !(window.CM_MODULES && window.CM_MODULES[it.mod])) return false;
    return true;
  }
  function items(side) { return ITEMS.filter(function (it) { return visible(it, side); }); }
  function byKey(k) { return ITEMS.filter(function (it) { return it.k === k; })[0] || null; }
  function search(q) {
    var toks = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    var sides = allowed();
    return ITEMS.filter(function (it) { return visible(it, null) && (it.side === 'both' || sides.indexOf(it.side) >= 0); }).map(function (it) {
      var hay = (it.label + ' ' + it.words + ' ' + it.group + ' ' + (it.desc || '') + ' ' + (it.side === 'both' ? '' : it.side)).toLowerCase(), lab = it.label.toLowerCase(), score = 0;
      for (var i = 0; i < toks.length; i++) { if (hay.indexOf(toks[i]) < 0) return null; score += lab.indexOf(toks[i]) === 0 ? 3 : lab.indexOf(toks[i]) >= 0 ? 2 : 1; }
      return { it: it, score: score };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score || a.it.label.localeCompare(b.it.label); }).slice(0, 8).map(function (x) { return x.it; });
  }

  /* ---------- go to a place ---------- */
  function open(it, go, SC) {
    var to = it.to;
    window.CM_NAV_N = (window.CM_NAV_N || 0) + 1; window.CM_NAV_CUR = it.k;
    if (it.side === 'winery' || it.side === 'vineyard') setSideRaw(it.side);
    if (to.screen === 'reports') { CM_PRESET = { tab: to.tab }; CM_FOCUS = to.rep ? { rep: to.rep } : {}; }
    if (to.vy) { try { localStorage.setItem('cm_vy_tab', to.vy); } catch (e) { } }
    notify();
    go(SC[to.screen] || to.screen, SC.dash);
    if (window.CM_APP_BUMP) window.CM_APP_BUMP();
  }
  function openSide(s, go, SC) { setSideRaw(s); open(byKey(HOME[s]), go, SC); }

  /* ---------- screens ---------- */
  var inp = function () { return { background: C.bg, color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '9px 10px', fontSize: 13, width: '100%', outline: 'none' }; };
  var btnBase = function () { return { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', color: C.text, cursor: 'pointer', textAlign: 'left' }; };

  function Results(P) {
    if (!P.list.length) return cmE('div', { style: { fontSize: 12, color: C.textDim, padding: '6px 2px' } }, 'Nothing found. Try another word, for example "so2", "spray" or "tank".');
    return cmE('div', { style: { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, marginTop: 6, overflow: 'hidden' } }, P.list.map(function (it) {
      return cmE('button', { key: it.k, 'data-nav': it.k, onClick: function () { P.pick(it); }, style: { display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8, background: 'transparent', border: 'none', borderBottom: '1px solid ' + C.cardBorder, padding: '10px 12px', color: C.text, cursor: 'pointer', textAlign: 'left' } },
        cmE('span', { style: { fontWeight: 700, fontSize: 13 } }, it.label),
        cmE('span', { style: { fontSize: 11, color: C.textDim, whiteSpace: 'nowrap' } }, (it.side === 'both' ? '' : (it.side === 'winery' ? 'Winery' : 'Vineyard') + ' · ') + it.group));
    }));
  }

  function CmNavTop(P) {
    useNav(); React.useEffect(loadModules, []);
    var sq = React.useState(''), q = sq[0], setQ = sq[1];
    var sides = allowed(), side = curSide();
    var list = q.trim() ? search(q) : [];
    var pick = function (it) { setQ(''); open(it, P.go, P.SCREENS); };
    return cmE('div', { className: 'cm-noprint', style: { marginBottom: 12 } },
      cmE('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        sides.length > 1 ? cmE('div', { style: { flex: '0 0 auto', minWidth: 170 } }, cmSeg(SIDES, side, function (s) { setQ(''); openSide(s, P.go, P.SCREENS); })) : null,
        cmE('input', { value: q, placeholder: 'Find anything: so2, tanks, spray, map...', 'aria-label': 'Find anything', onChange: function (e) { setQ(e.target.value); }, style: inp() }),
        q ? cmE('button', { onClick: function () { setQ(''); }, 'aria-label': 'Clear search', style: Object.assign({}, btnBase(), { padding: '8px 12px', textAlign: 'center' }) }, '×') : null),
      q.trim() ? cmE(Results, { list: list, pick: pick }) : null);
  }

  function CmNavBottom(P) {
    useNav();
    var side = curSide();
    return cmE('div', { className: 'cm-noprint', style: { position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 1100, background: C.card, borderTop: '1px solid ' + C.cardBorder, display: 'flex', justifyContent: 'space-around', padding: '10px 0 18px', zIndex: 10 } },
      BAR[side].map(function (b) {
        var it = b[0] === 'more' ? { k: 'more', side: side, to: { screen: 'more' } } : byKey(b[0]);
        if (!it || !visible(it, side)) return null;
        var on = it.to.screen === P.screen && (!(it.to.tab || it.to.vy) || window.CM_NAV_CUR === it.k);
        return cmE('button', { key: b[0], 'data-bar': b[0], onClick: function () { if (b[0] === 'more') { window.CM_NAV_CUR = 'more'; P.go(P.SCREENS.more, P.SCREENS.dash); } else open(it, P.go, P.SCREENS); }, style: { background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: on ? C.accentLight : C.textDim, fontWeight: on ? 700 : 400, padding: '4px 8px', position: 'relative' } },
          cmE('span', { style: { fontSize: b[0] === 'log' ? 24 : 18, lineHeight: 1 } }, b[1]), cmE('span', { style: { fontSize: 10 } }, b[2]),
          b[0] === 'more' && P.badge > 0 ? cmE('span', { style: { position: 'absolute', top: 0, right: 2, background: C.red, color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 99, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' } }, P.badge) : null);
      }));
  }

  function CmMore(P) {
    useNav();
    var side = curSide(), sides = allowed();
    var se = React.useState(''), err = se[0], setErr = se[1];
    var list = items(side);
    var groups = GROUP_ORDER[side].map(function (g) { return { g: g, rows: list.filter(function (it) { return it.group === g; }) }; }).filter(function (x) { return x.rows.length; });
    var canAdmin = typeof cmCan === 'function' && cmCan('manage_users');
    return cmE('div', null,
      cmE('div', { style: { fontSize: 12, color: C.textDim, marginBottom: 10 } }, (side === 'winery' ? 'Winery' : 'Vineyard') + ' side. ' + (sides.length > 1 ? 'Use the switch at the top to change sides.' : 'This account uses the ' + side + ' side only.')),
      groups.map(function (x) {
        return cmE('div', { key: x.g, style: { marginBottom: 14 } },
          cmE('div', { style: { fontSize: 11, fontWeight: 800, color: C.textDim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 } }, x.g),
          cmE('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 } }, x.rows.map(function (it) {
            return cmE('button', { key: it.k, 'data-more': it.k, onClick: function () { open(it, P.go, P.SCREENS); }, style: btnBase() },
              cmE('div', { style: { fontWeight: 700, fontSize: 13 } }, it.label),
              it.desc ? cmE('div', { style: { fontSize: 11, color: C.textDim, marginTop: 2 } }, it.desc) : null);
          })));
      }),
      canAdmin ? cmE('div', { style: { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 12, padding: 12, marginTop: 6 } },
        cmE('div', { style: { fontWeight: 700, fontSize: 13, marginBottom: 4 } }, 'Which parts does this account use?'),
        cmE('div', { style: { fontSize: 11, color: C.textDim, marginBottom: 8 } }, 'Winery and vineyard share the login and data but keep separate menus. Pick one to show only that side.'),
        cmSeg([['winery', 'Winery only'], ['vineyard', 'Vineyard only'], ['both', 'Both']], mods, function (m) { setErr(''); saveModules(m).catch(function (e) { setErr(e.message); }); }),
        err ? cmE('div', { style: { color: C.red, fontSize: 12, marginTop: 6 } }, err) : null) : null);
  }

  function CmReportsHub(P) {
    useNav();
    var sq = React.useState(''), q = sq[0], setQ = sq[1];
    var sides = allowed();
    if (sides.indexOf('winery') < 0) return cmE('div', { style: { color: C.textDim, fontSize: 13, padding: 20, textAlign: 'center' } }, 'This account uses the vineyard side only. Vineyard reports are under the Vineyard tabs.');
    var all = items('winery').filter(function (it) { return it.kind === 'report'; });
    var toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    var shown = all.filter(function (it) { var h = (it.label + ' ' + it.words + ' ' + it.desc + ' ' + it.rgroup).toLowerCase(); return toks.every(function (t) { return h.indexOf(t) >= 0; }); });
    var order = ['Barrel and wine status', 'Tanks and cellar', 'Supplies and costs', 'Compliance and data'];
    return cmE('div', null,
      cmE('div', { style: { fontSize: 12, color: C.textDim, marginBottom: 8 } }, 'Pick a report. Each one opens on its own with its own filters, and has PDF and Excel buttons for printing.'),
      cmE('input', { value: q, placeholder: 'Filter reports', 'aria-label': 'Filter reports', onChange: function (e) { setQ(e.target.value); }, style: Object.assign(inp(), { marginBottom: 12 }) }),
      order.map(function (g) {
        var rows = shown.filter(function (it) { return it.rgroup === g; }); if (!rows.length) return null;
        return cmE('div', { key: g, style: { marginBottom: 14 } },
          cmE('div', { style: { fontSize: 11, fontWeight: 800, color: C.textDim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 } }, g),
          cmE('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 } }, rows.map(function (it) {
            return cmE('button', { key: it.k, 'data-report': it.k, onClick: function () { P.open(it.to); }, style: btnBase() },
              cmE('div', { style: { fontWeight: 700, fontSize: 13 } }, it.label), cmE('div', { style: { fontSize: 11, color: C.textDim, marginTop: 2 } }, it.desc));
          })));
      }),
      !shown.length ? cmE('div', { style: { color: C.textDim, fontSize: 13, textAlign: 'center', padding: 20 } }, 'No report matches that.') : null);
  }

  function CmReportsBar(P) {
    if (P.tab === 'hub') return null;
    var it = ITEMS.filter(function (x) { return x.to && x.to.screen === 'reports' && x.to.tab === P.tab; })[0];
    return cmE('div', { className: 'cm-noprint', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } },
      cmE('button', { 'data-back': 'reports', onClick: function () { P.setTab('hub'); }, style: Object.assign({}, btnBase(), { padding: '7px 12px', fontSize: 12, fontWeight: 700, color: C.accentLight }) }, '← All reports'),
      it && it.to.tab !== 'focus' ? cmE('span', { style: { fontWeight: 700, fontSize: 13 } }, it.label) : null);
  }

  /* keep the app chrome out of printouts */
  (function () { var s = document.createElement('style'); s.textContent = '@media print{.cm-noprint{display:none !important}}'; document.head.appendChild(s); })();

  window.cmNavItems = items; window.cmNavSearch = search; window.cmNavAllowed = allowed; window.cmNavSide = curSide; window.cmNavOpen = open; window.cmNavByKey = byKey;
  window.cmNavSetModules = function (m) { mods = m; notify(); }; window.cmNavModules = function () { return mods; };
  window.CM_NAV = { ITEMS: ITEMS, BAR: BAR, GROUP_ORDER: GROUP_ORDER, HOME: HOME };
  window.CmNavTop = CmNavTop; window.CmNavBottom = CmNavBottom; window.CmMore = CmMore; window.CmReportsHub = CmReportsHub; window.CmReportsBar = CmReportsBar;
})();
