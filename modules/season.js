/* CellarMate module: Season calendar, expected against actual, and budget
   1. Typical year for Willamette Valley Pinot noir and Chardonnay: each growth stage (E-L), its
      usual window, the vineyard work that goes with it, and this vineyard's own history next to it
      (veraison sampling dates, first and last sprays, harvest dates, clone order from the records).
   2. Expected against actual: scheduled work with expected and actual dates and amounts (for
      example the 2026 pick schedule), and crop estimates against harvest weights by block.
   3. Budget: preliminary, final and actual amounts by category and item, with the month the work
      was expected and done; enter rows or import a spreadsheet.
   Renders on Vine Blocks, Season and budget (CmSeason). Pure helpers on window for the smoke tests:
   cmTypicalCalendar, cmHistoryMarkers, cmBudgetSummary, cmExpectedActual, cmEstimateVsActual. */
(function () {
  'use strict';
  /* Typical Willamette Valley timing (cool climate). Windows are usual ranges, not rules; the
     vineyard's own dates are shown beside them. */
  var CAL = [
    { stage: 'Dormant', el: '1', window: 'Dec to mid Mar', pn: 'Prune Jan to Mar; tie canes in Feb and Mar', ch: 'Same as Pinot', work: ['Pruning', 'Brush removal and chipping', 'Cane tying', 'Trellis and post repair', 'Dormant soil and compost work'] },
    { stage: 'Budbreak', el: '4', window: 'early to late Apr', pn: 'Usually mid April', ch: 'Often a few days before Pinot noir', work: ['Frost watch', 'Mowing', 'First sprays at 2 to 4 inch shoots (mites, mildew)'] },
    { stage: 'Shoots 4 to 10 inches', el: '9 to 12', window: 'late Apr to mid May', pn: '', ch: '', work: ['Shoot thinning and suckering', 'Sprays every 10 to 14 days', 'Undervine weeding'] },
    { stage: 'Rapid shoot growth', el: '12 to 17', window: 'mid May to early Jun', pn: '', ch: '', work: ['Shoot positioning and lifting catch wires', 'Spray spacing tightens toward bloom (7 to 10 days)', 'Weed survey'] },
    { stage: 'Bloom', el: '19 to 25', window: 'early to late Jun', pn: 'Full bloom usually mid June', ch: 'Similar to Pinot noir', work: ['Key powdery mildew and Botrytis protection', 'Keep crews out of wet canopies'] },
    { stage: 'Fruit set', el: '27', window: 'late Jun to early Jul', pn: '', ch: '', work: ['Leaf pulling in the fruit zone (morning side)', 'First hedging'] },
    { stage: 'Berry growth to bunch closure', el: '29 to 33', window: 'Jul', pn: '', ch: '', work: ['Hedging', 'Botrytis spray at bunch closure', 'Irrigation of young blocks', 'Lag-phase crop estimate (late July)'] },
    { stage: 'Veraison', el: '35', window: 'early to late Aug', pn: 'Usually early to mid August', ch: 'Often a little after Pinot noir', work: ['Leaf tissue sampling at veraison', 'Crop thinning (green drop) to target', 'Bird netting', 'Last mildew sprays (watch PHI)'] },
    { stage: 'Ripening', el: '36 to 37', window: 'mid Aug to Sep', pn: '', ch: '', work: ['Weekly berry samples (Brix, pH, TA)', 'Pick planning, bins and crew', 'Bird and wildlife control'] },
    { stage: 'Harvest', el: '38', window: 'early Sep to mid Oct', pn: 'Dijon clones (667, 777, 115) usually before Pommard', ch: 'Picked by style: sparkling earliest, still wine with the Pinot', work: ['Picking', 'Weigh tags and harvest weights', 'Trucking to the winery'] },
    { stage: 'Post-harvest', el: '41 to 47', window: 'Oct to Nov', pn: '', ch: '', work: ['Compost and amendments', 'Cover crop seeding', 'Year-end LIVE reports (sprays, irrigation, sprayer checklist)'] }
  ];
  function cmTypicalCalendar() { return CAL; }
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  /* a logged E-L stage only counts as a milestone while it is near that stage: a late visit at E-L 31 must not stand in for bloom */
  function cmStageKey(el) { if (el >= 4 && el <= 12) return 'budbreak'; if (el >= 19 && el <= 27) return 'bloom'; if (el >= 35 && el <= 37) return 'veraison'; return null; }
  window.cmStageKey = cmStageKey;
  function r1(x, d) { return x == null ? '' : Number(x).toFixed(d == null ? 1 : d); }
  function md(s) { return s ? +String(s).slice(5, 7) + '/' + +String(s).slice(8, 10) : ''; }
  function doy(s) { var d = new Date(s + 'T12:00:00Z'), j = new Date(d.getUTCFullYear() + '-01-01T12:00:00Z'); return Math.round((d - j) / 864e5); }
  function fromDoy(n) { var d = new Date('2001-01-01T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Math.round(n)); return d.toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }
  function db() { return supa.schema('cellarmate'); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* the vineyard's own season markers by year, plus a typical (median) date for each */
  function cmHistoryMarkers(X) {
    var years = {};
    var put = function (y, k, d, keepMin) { if (!d) return; var o = years[y] = years[y] || { year: +y }; if (!o[k] || (keepMin ? d < o[k] : d > o[k])) o[k] = d; };
    (X.tissue || []).forEach(function (t) { if (t.sampled) put(String(t.sampled).slice(0, 4), 'veraisonSample', t.sampled, true); });
    (X.sprays || []).forEach(function (s) { if (s.date && !s.skipped) { put(String(s.date).slice(0, 4), 'firstSpray', s.date, true); put(String(s.date).slice(0, 4), 'lastSpray', s.date, false); } });
    (X.harvests || []).forEach(function (h) { if (h.date) { put(String(h.date).slice(0, 4), 'firstPick', h.date, true); put(String(h.date).slice(0, 4), 'lastPick', h.date, false); } });
    (X.obs || []).forEach(function (o) {
      if (o.kind !== 'growth stage' || o.el_stage == null) return; var y = String(o.observed_on).slice(0, 4);
      var sk = cmStageKey(o.el_stage); if (sk) put(y, sk, o.observed_on, true);
    });
    var rows = Object.keys(years).sort().map(function (y) { return years[y]; });
    var typical = {};
    ['budbreak', 'bloom', 'veraison', 'veraisonSample', 'firstSpray', 'lastSpray', 'firstPick', 'lastPick'].forEach(function (k) {
      var v = rows.map(function (r) { return r[k]; }).filter(Boolean).map(doy).sort(function (a, b) { return a - b; });
      if (v.length) typical[k] = { median: md(fromDoy(v[Math.floor(v.length / 2)])), earliest: md(fromDoy(v[0])), latest: md(fromDoy(v[v.length - 1])), years: v.length };
    });
    return { rows: rows, typical: typical };
  }

  /* clone timing from the harvest history: average first pick day and heat at pick */
  function cloneTiming(blocks) {
    var by = {};
    (blocks || []).forEach(function (b) {
      var k = (b.variety && /chard/i.test(b.variety) ? 'Chardonnay ' : 'Pinot noir ') + (b.clone || ''); var o = by[k] = by[k] || { name: k.trim(), days: [], heat: [] };
      Object.keys(b.years || {}).forEach(function (y) { var c = b.years[y]; if (c && c.dates && c.dates.length) o.days.push(doy(c.dates.map(function (d) { return d.date; }).sort()[0])); });
      if (b.gddPick) o.heat.push(b.gddPick);
    });
    return Object.keys(by).map(function (k) { var o = by[k]; return { name: o.name, day: o.days.length ? o.days.reduce(function (a, b) { return a + b; }, 0) / o.days.length : null, heat: o.heat.length ? o.heat.reduce(function (a, b) { return a + b; }, 0) / o.heat.length : null, years: o.days.length }; })
      .filter(function (o) { return o.day != null; }).sort(function (a, b) { return a.day - b.day; });
  }

  /* tasks with an expected date or amount -> how far off the actual was */
  function cmExpectedActual(tasks) {
    return (tasks || []).filter(function (t) { return t.planned_on || t.expected_qty != null; }).map(function (t) {
      return { id: t.id, title: t.title, kind: t.kind, planned: t.planned_on, done: t.done_on, skipped: !!t.skipped, daysOff: t.planned_on && t.done_on ? dayDiff(t.planned_on, t.done_on) : null,
        expected: num(t.expected_qty), actual: num(t.actual_qty), unit: t.unit || '', pct: num(t.expected_qty) && num(t.actual_qty) != null ? 100 * (num(t.actual_qty) - num(t.expected_qty)) / num(t.expected_qty) : null };
    }).sort(function (a, b) { return String(a.planned || a.done).localeCompare(String(b.planned || b.done)); });
  }

  /* crop estimates (latest per block) against harvest weights for one year */
  function cmEstimateVsActual(est, harvests, year) {
    var E = {}; (est || []).filter(function (e) { return e.vintage === year && e.block; }).forEach(function (e) { var k = e.block; if (!E[k] || String(e.est_date || e.created_at) > String(E[k].est_date || E[k].created_at)) E[k] = e; });
    var A = {}; (harvests || []).filter(function (h) { return h.year === year && h.block; }).forEach(function (h) { if (num(h.tons) != null) A[h.block] = (A[h.block] || 0) + num(h.tons); });
    var blocks = Object.keys(Object.assign({}, E, A)).map(Number).sort(function (a, b) { return a - b; });
    var rows = blocks.map(function (b) { var e = E[b] ? num(E[b].est_tons) : null, a = A[b] != null ? A[b] : null; return { block: b, est: e, actual: a, diff: e != null && a != null ? a - e : null, pct: e && a != null ? 100 * (a - e) / e : null }; });
    var tot = rows.reduce(function (o, r) { if (r.est != null && r.actual != null) { o.est += r.est; o.actual += r.actual; } return o; }, { est: 0, actual: 0 });
    tot.pct = tot.est ? 100 * (tot.actual - tot.est) / tot.est : null;
    return { rows: rows, total: tot };
  }

  /* which vineyard manager ran the vineyard in a given month: history [{manager, from: 'YYYY-MM-DD'}] */
  function cmManagerFor(history, year, month) {
    var d = year + '-' + ('0' + (month || 1)).slice(-2) + '-15', cur = null;
    (history || []).slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; }).forEach(function (h) { if (h.from <= d) cur = h.manager; });
    return cur;
  }
  /* budget rows for a year -> one line per category and item with each version and the variance.
     With a manager history, a monthly row only counts in the months its manager ran the vineyard, so a
     year that changed managers combines the first manager's months with the second's. */
  function cmBudgetSummary(rows, year, history) {
    var by = {};
    (rows || []).filter(function (r) { return r.year === year; }).filter(function (r) {
      if (!r.manager || !r.month || !history || !history.length) return true;
      var m = cmManagerFor(history, year, r.month); return !m || m === r.manager;
    }).forEach(function (r) {
      var k = r.category + '|' + r.item, o = by[k] = by[k] || { category: r.category, item: r.item, preliminary: null, final: null, actual: null, hoursFinal: null, hoursActual: null, expectedMonth: null, doneMonth: null, managers: [] };
      if (r.manager && o.managers.indexOf(r.manager) < 0) o.managers.push(r.manager);
      o[r.version] = (o[r.version] || 0) + (num(r.amount) || 0);
      if (r.version === 'final' && num(r.hours) != null) o.hoursFinal = (o.hoursFinal || 0) + num(r.hours);
      if (r.version === 'actual' && num(r.hours) != null) o.hoursActual = (o.hoursActual || 0) + num(r.hours);
      var em = r.month || (r.expected_on ? +String(r.expected_on).slice(5, 7) : null), dm = r.done_on ? +String(r.done_on).slice(5, 7) : (r.version === 'actual' ? r.month : null);
      if (r.version !== 'actual' && em && !o.expectedMonth) o.expectedMonth = em; if (dm) o.doneMonth = dm;
    });
    var list = Object.keys(by).map(function (k) { var o = by[k]; var base = o.final != null ? o.final : o.preliminary; o.variance = o.actual != null && base != null ? o.actual - base : null; return o; })
      .sort(function (a, b) { return a.category.localeCompare(b.category) || a.item.localeCompare(b.item); });
    var tot = list.reduce(function (t, o) { ['preliminary', 'final', 'actual'].forEach(function (v) { if (o[v] != null) t[v] = (t[v] || 0) + o[v]; }); return t; }, {});
    return { rows: list, total: tot };
  }

  function money(x) { return x == null ? '' : (x < 0 ? '-$' : '$') + Math.round(Math.abs(x)).toLocaleString(); }

  function CmSeason(P) {
    var site = P.site;
    var s = React.useState(null), D = s[0], setD = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    var yr0 = new Date().getFullYear();
    var y = React.useState(yr0), year = y[0], setYear = y[1];
    var f = React.useState({ version: 'final', category: '', item: '', month: '', amount: '', hours: '', note: '' }), F = f[0], setF = f[1];
    var load = function () {
      if (!site) return;
      Promise.all([cmFetch('tissue_tests'), cmFetch('vineyard_sprays'), cmFetch('estate_harvests'),
        db().from('vineyard_observations').select('*').eq('organization_id', site.organization_id).eq('vineyard', site.name).eq('kind', 'growth stage'),
        db().from('vineyard_tasks').select('*').eq('organization_id', site.organization_id).eq('vineyard', site.name),
        db().from('vineyard_budget').select('*').eq('organization_id', site.organization_id).eq('vineyard', site.name).order('year')])
        .then(function (a) {
          var mine = function (r) { return !r.vineyard || r.vineyard === site.name; };
          setD({ tissue: a[0].filter(mine), sprays: a[1].filter(mine), harvests: a[2].filter(mine), obs: a[3].data || [], tasks: a[4].data || [], budget: a[5].data || [] });
        }).catch(function (x) { setErr(x.message); });
    };
    React.useEffect(load, [site && site.id]);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var th = { textAlign: 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var td = { textAlign: 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var L = function (o) { return Object.assign({}, o, { textAlign: 'left', whiteSpace: 'normal' }); };
    var inp = { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' };
    if (!site) return null;
    if (!D) return cmE('div', { style: card }, err || 'Loading the season...');
    var M = cmHistoryMarkers(D), T = M.typical, clones = cloneTiming(P.blocks);
    var mk = function (k) { var t = T[k]; return t ? t.median + ' (range ' + t.earliest + ' to ' + t.latest + ', ' + t.years + ' yrs)' : ''; };
    var yours = { 'Budbreak': T.budbreak ? mk('budbreak') : (T.firstSpray ? 'first spray usually ' + mk('firstSpray') : ''), 'Bloom': mk('bloom'), 'Veraison': T.veraison ? mk('veraison') : (T.veraisonSample ? 'veraison sampling ' + mk('veraisonSample') : ''), 'Harvest': T.firstPick ? mk('firstPick') + ' to ' + (T.lastPick ? T.lastPick.median : '') : '' };
    var years = {}; D.tasks.forEach(function (t) { years[String(t.planned_on || t.done_on || '').slice(0, 4)] = 1; }); D.budget.forEach(function (b) { years[b.year] = 1; }); (P.est || []).forEach(function (x) { years[x.vintage] = 1; }); years[yr0] = 1;
    var ys = Object.keys(years).filter(function (k) { return /^\d{4}$/.test(k); }).map(Number).sort(function (a, b) { return b - a; });
    var ea = cmExpectedActual(D.tasks.filter(function (t) { return String(t.planned_on || t.done_on).slice(0, 4) === String(year); }));
    var eva = cmEstimateVsActual((P.est || []).filter(function (x) { return x.vineyard === site.name; }), D.harvests, year);
    var hist = site.manager_history || [];
    var bud = cmBudgetSummary(D.budget, year, hist);
    var mgrs = []; for (var mo = 1; mo <= 12; mo++) { var mm = cmManagerFor(hist, year, mo); if (mm && (!mgrs.length || mgrs[mgrs.length - 1].m !== mm)) mgrs.push({ m: mm, from: mo, to: mo }); else if (mm) mgrs[mgrs.length - 1].to = mo; }
    var setHandover = function (ev) {
      var v = ev.target.value; if (!v) return; var h = hist.filter(function (x) { return x.manager !== 'Century Vineyards'; }).concat([{ manager: 'Century Vineyards', from: v }]);
      db().from('vineyards').update({ manager_history: h }).eq('id', site.id).then(function (r) { if (r.error) setErr(r.error.message); else { site.manager_history = h; setErr(''); load(); } });
    };
    var addBudget = function () {
      if (!F.category.trim() || !F.item.trim() || num(F.amount) == null) { setErr('Enter category, item and amount.'); return; }
      db().from('vineyard_budget').insert({ organization_id: site.organization_id, vineyard: site.name, year: year, version: F.version, category: F.category.trim(), item: F.item.trim(), month: F.month ? +F.month : null, amount: num(F.amount), hours: num(F.hours), note: F.note || null })
        .then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); setF(Object.assign({}, F, { item: '', amount: '', hours: '', note: '' })); load(); } });
    };
    var importBudget = function (ev) {
      var file = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!file) return;
      (typeof cmLib === 'function' ? cmLib('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js') : Promise.resolve()).then(function () { return file.arrayBuffer(); }).then(function (buf) {
        var wb = XLSX.read(buf), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
        var g = function (r, k) { var key = Object.keys(r).filter(function (x) { return x.toLowerCase().replace(/[^a-z]/g, '') === k; })[0]; return key ? r[key] : null; };
        var out = rows.map(function (r) {
          var v = String(g(r, 'version') || 'final').toLowerCase(); if (!/^(preliminary|final|actual)$/.test(v)) v = /prelim/.test(v) ? 'preliminary' : /act/.test(v) ? 'actual' : 'final';
          var m = g(r, 'month'); if (m && isNaN(Number(m))) m = MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(String(m).slice(0, 3).toLowerCase()) + 1 || null;
          return { organization_id: site.organization_id, vineyard: site.name, year: num(g(r, 'year')) || year, version: v, category: String(g(r, 'category') || 'Other'), item: String(g(r, 'item') || g(r, 'task') || ''), month: num(m), amount: num(g(r, 'amount')), hours: num(g(r, 'hours')), note: g(r, 'note'), source_file: file.name };
        }).filter(function (r) { return r.item && r.amount != null; });
        if (!out.length) throw new Error('No rows found. Columns needed: Year, Version, Category, Item, Month, Amount (Hours and Note optional).');
        return db().from('vineyard_budget').insert(out).then(function (r) { if (r.error) throw new Error(r.error.message); setErr(''); alert('Imported ' + out.length + ' budget rows.'); load(); });
      }).catch(function (x) { setErr(x.message); });
    };
    var template = function () {
      (typeof cmLib === 'function' ? cmLib('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js') : Promise.resolve()).then(function () {
        var ws = XLSX.utils.json_to_sheet([{ Year: year, Version: 'preliminary', Category: 'Canopy', Item: 'Shoot thinning', Month: 'May', Amount: 0, Hours: 0, Note: '' }, { Year: year, Version: 'final', Category: 'Canopy', Item: 'Shoot thinning', Month: 'May', Amount: 0, Hours: 0, Note: '' }, { Year: year, Version: 'actual', Category: 'Canopy', Item: 'Shoot thinning', Month: 'May', Amount: 0, Hours: 0, Note: '' }]);
        var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Budget'); XLSX.writeFile(wb, 'CellarMate_vineyard_budget_template.xlsx');
      });
    };
    var fl = function (k, label, type, flex) { return cmE('label', { key: k, style: { flex: flex || '1 1 110px', fontSize: 11, color: C.textDim } }, label, cmE('input', { type: type || 'text', value: F[k], onChange: function (ev) { var o = Object.assign({}, F); o[k] = ev.target.value; setF(o); }, style: inp })); };
    return cmE('div', null,
      cmE('div', { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px' } }, cmE('div', { style: { fontSize: 15, fontWeight: 700, flex: 1 } }, 'Season and budget'),
        cmE('select', { value: year, onChange: function (ev) { setYear(+ev.target.value); }, style: Object.assign({}, cmSel, { flex: '0 0 100px' }) }, ys.map(function (v) { return cmE('option', { key: v, value: v }, v); }))),
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,
      window.CmOutlook ? cmE(window.CmOutlook, { site: site, wsite: P.wsite, days: P.days || [], D: D, history: hist }) : null,

      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'The typical year: Pinot noir and Chardonnay'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Usual Willamette Valley windows with the work that goes with each stage, next to this vineyard\'s own dates from its records. Log growth stages under Field work to fill in budbreak and bloom.'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 760 } },
          cmE('thead', null, cmE('tr', null, ['Stage', 'E-L', 'Usual window', 'Pinot noir', 'Chardonnay', 'Work', 'This vineyard'].map(function (x) { return cmE('th', { key: x, style: L(th) }, x); }))),
          cmE('tbody', null, CAL.map(function (c) { return cmE('tr', { key: c.stage }, cmE('td', { style: Object.assign(L(td), { fontWeight: 700 }) }, c.stage), cmE('td', { style: L(td) }, c.el), cmE('td', { style: L(td) }, c.window), cmE('td', { style: L(td) }, c.pn), cmE('td', { style: L(td) }, c.ch), cmE('td', { style: L(td) }, c.work.join('; ')), cmE('td', { style: Object.assign(L(td), { color: C.accentLight }) }, yours[c.stage] || '')); }))),
        clones.length ? cmE('div', { style: { fontSize: 12, marginTop: 6 } }, cmE('b', null, 'Pick order by clone (from the harvest records): '), clones.map(function (c) { return c.name + ' ' + md(fromDoy(c.day)) + (c.heat ? ' (' + Math.round(c.heat) + ' heat units)' : ''); }).join(' · ')) : null),

      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Season markers by year'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 560 } },
          cmE('thead', null, cmE('tr', null, ['Year', 'First spray', 'Bloom', 'Veraison (or tissue sample)', 'Last spray', 'First pick', 'Last pick'].map(function (x, i) { return cmE('th', { key: x, style: i ? th : L(th) }, x); }))),
          cmE('tbody', null, M.rows.slice().reverse().map(function (r) { return cmE('tr', { key: r.year }, cmE('td', { style: L(td) }, r.year), cmE('td', { style: td }, md(r.firstSpray)), cmE('td', { style: td }, md(r.bloom)), cmE('td', { style: td }, r.veraison ? md(r.veraison) : r.veraisonSample ? md(r.veraisonSample) + ' (sample)' : ''), cmE('td', { style: td }, md(r.lastSpray)), cmE('td', { style: td }, md(r.firstPick)), cmE('td', { style: td }, md(r.lastPick))); })))),

      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, year + ': expected against actual'),
        ea.length ? cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 600 } },
          cmE('thead', null, cmE('tr', null, ['Work', 'Planned', 'Done', 'Days off', 'Expected', 'Actual', 'Difference'].map(function (x, i) { return cmE('th', { key: x, style: i ? th : L(th) }, x); }))),
          cmE('tbody', null, ea.map(function (r) {
            return cmE('tr', { key: r.id }, cmE('td', { style: L(td) }, r.title), cmE('td', { style: td }, md(r.planned)), cmE('td', { style: td }, r.skipped ? 'skipped' : md(r.done)), cmE('td', { style: Object.assign({}, td, { color: r.daysOff > 2 ? C.orange : C.text }) }, r.daysOff == null ? '' : (r.daysOff > 0 ? '+' : '') + r.daysOff),
              cmE('td', { style: td }, r.expected != null ? r1(r.expected, 2) + ' ' + r.unit : ''), cmE('td', { style: td }, r.actual != null ? r1(r.actual, 2) + ' ' + r.unit : ''),
              cmE('td', { style: Object.assign({}, td, { color: r.pct != null && Math.abs(r.pct) > 15 ? C.orange : C.text }) }, r.pct == null ? '' : (r.pct > 0 ? '+' : '') + Math.round(r.pct) + '%'));
          }))) : cmE('div', { style: small }, 'No planned work with expected dates or amounts in ' + year + '. Add them on the schedule.'),
        eva.rows.length ? cmE('div', { style: { marginTop: 8 } },
          cmE('div', { style: { fontSize: 12, fontWeight: 700, marginBottom: 2 } }, 'Crop estimate against harvest, by block (' + r1(eva.total.est, 1) + ' t estimated, ' + r1(eva.total.actual, 1) + ' t picked' + (eva.total.pct != null ? ', ' + (eva.total.pct > 0 ? '+' : '') + Math.round(eva.total.pct) + '%' : '') + ')'),
          cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12 } }, eva.rows.map(function (r) { return cmE('span', { key: r.block, style: { color: r.pct != null && Math.abs(r.pct) > 20 ? C.orange : C.text } }, 'B' + r.block + ': ' + (r.est != null ? r1(r.est, 2) : '-') + ' → ' + (r.actual != null ? r1(r.actual, 2) : '-') + (r.pct != null ? ' (' + (r.pct > 0 ? '+' : '') + Math.round(r.pct) + '%)' : '')); }))) : null),

      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } }, cmE('div', { style: { fontWeight: 700, flex: 1 } }, year + ' budget: preliminary, final and actual'),
          cmE('button', { onClick: template, style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, 'Template'),
          cmE('label', { style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, 'Import Excel', cmE('input', { type: 'file', accept: '.xlsx,.xls,.csv', onChange: importBudget, style: { display: 'none' } }))),
        bud.rows.length ? cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 680 } },
          cmE('thead', null, cmE('tr', null, ['Category', 'Item', 'Expected', 'Done', 'Preliminary', 'Final', 'Actual', 'Actual vs budget', 'Hours (final / actual)'].map(function (x, i) { return cmE('th', { key: x, style: i > 1 ? th : L(th) }, x); }))),
          cmE('tbody', null, bud.rows.map(function (r) {
            return cmE('tr', { key: r.category + r.item }, cmE('td', { style: L(td) }, r.category), cmE('td', { style: L(td) }, r.item, r.managers && r.managers.length && mgrs.length > 1 ? cmE('span', { style: small }, ' · ' + r.managers.join(', ')) : null), cmE('td', { style: td }, r.expectedMonth ? MONTHS[r.expectedMonth - 1] : ''), cmE('td', { style: Object.assign({}, td, { color: r.doneMonth && r.expectedMonth && r.doneMonth > r.expectedMonth ? C.orange : C.text }) }, r.doneMonth ? MONTHS[r.doneMonth - 1] : ''),
              cmE('td', { style: td }, money(r.preliminary)), cmE('td', { style: td }, money(r.final)), cmE('td', { style: td }, money(r.actual)),
              cmE('td', { style: Object.assign({}, td, { color: r.variance > 0 ? C.red : r.variance < 0 ? C.green : C.text }) }, r.variance == null ? '' : (r.variance > 0 ? '+' : '') + money(r.variance)), cmE('td', { style: td }, (r.hoursFinal != null ? r1(r.hoursFinal, 0) : '-') + ' / ' + (r.hoursActual != null ? r1(r.hoursActual, 0) : '-')));
          }).concat([cmE('tr', { key: 'tot' }, cmE('td', { style: Object.assign(L(td), { fontWeight: 700 }) }, 'Total'), cmE('td', { style: td }), cmE('td', { style: td }), cmE('td', { style: td }), cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, money(bud.total.preliminary)), cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, money(bud.total.final)), cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, money(bud.total.actual)), cmE('td', { style: td }), cmE('td', { style: td }))])))
          : null,
        mgrs.length > 1 ? cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) }, year + ' combines ' + mgrs.map(function (g) { return g.m + ' (' + MONTHS[g.from - 1] + (g.to !== g.from ? ' to ' + MONTHS[g.to - 1] : '') + ')'; }).join(' and ') + ': each manager\'s monthly lines count only in their months. Change of manager on ',
          cmE('input', { type: 'date', defaultValue: (hist.filter(function (x) { return x.manager === 'Century Vineyards'; })[0] || {}).from || '', onBlur: setHandover, style: Object.assign({}, inp, { width: 140, display: 'inline-block', padding: '2px 6px' }) })) : null,
        bud.rows.length ? null : cmE('div', { style: small }, 'No budget for ' + year + ' yet. Import the vineyard manager\'s preliminary and final budgets (download the template for the columns), or add rows below.'),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 } },
          cmE('label', { style: { flex: '1 1 110px', fontSize: 11, color: C.textDim } }, 'Version', cmE('select', { value: F.version, onChange: function (ev) { setF(Object.assign({}, F, { version: ev.target.value })); }, style: inp }, ['preliminary', 'final', 'actual'].map(function (v) { return cmE('option', { key: v, value: v }, v); }))),
          fl('category', 'Category'), fl('item', 'Item', 'text', '2 1 150px'),
          cmE('label', { style: { flex: '1 1 90px', fontSize: 11, color: C.textDim } }, 'Month', cmE('select', { value: F.month, onChange: function (ev) { setF(Object.assign({}, F, { month: ev.target.value })); }, style: inp }, [cmE('option', { key: '', value: '' }, '-')].concat(MONTHS.map(function (m, i) { return cmE('option', { key: m, value: i + 1 }, m); })))),
          fl('amount', 'Amount $', 'number', '0 1 100px'), fl('hours', 'Hours', 'number', '0 1 80px'),
          cmE('button', { onClick: addBudget, style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' } }, 'Add'))));
  }

  window.cmTypicalCalendar = cmTypicalCalendar;
  window.cmHistoryMarkers = cmHistoryMarkers;
  window.cmExpectedActual = cmExpectedActual;
  window.cmEstimateVsActual = cmEstimateVsActual;
  window.cmBudgetSummary = cmBudgetSummary;
  window.cmManagerFor = cmManagerFor;
  window.CmSeason = CmSeason;
})();
