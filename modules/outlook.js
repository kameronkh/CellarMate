/* CellarMate module: Forecast year against actual years
   1. Every year side by side: first spray, bloom, veraison (sampling), first and last pick, with the
      heat (growing degree days, base 50°F from April 1) at each one, season heat and rain. A typical
      row gives the median date and the range.
   2. Site calibration: the heat at which each stage happened here, year after year. Where the
      vineyard has no record yet (bloom, until growth stages are logged), the vit library value is
      used and labelled as such.
   3. Forecast year: heat so far, then the 16-day forecast, then this vineyard's normal day by day,
      shifted by the ECMWF seasonal outlook for the months it covers. The range comes from finishing
      the season with each past year's weather.
   4. Forecast against actual: for each past year, what the model would have said on April 1 (using
      only the other years) against what happened, and the average miss for each stage.
   5. Recommendations: the season's work placed on the forecast dates, each tied to vit library
      entries, with the budget for that month and any forecast frost, heat or rain that lands in a
      critical window.
   Renders on Vineyard, Season and budget (CmOutlook). Pure helpers on window for the smoke tests:
   cmGddPath, cmCalibrate, cmProject, cmNormalGdd, cmBacktest, cmOutlookPlan. */
(function () {
  'use strict';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }
  function md(s) { return s ? +String(s).slice(5, 7) + '/' + +String(s).slice(8, 10) : ''; }
  function median(a) { var b = a.filter(function (x) { return x != null; }).sort(function (x, y) { return x - y; }), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; }
  function gdd(tmax, tmin, base) { if (tmax == null || tmin == null) return null; return Math.max(0, (tmax + tmin) / 2 - (base == null ? 50 : base)); }
  var START = '04-01', END = '10-31';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* the stages tracked; lib = vit library defaults when the vineyard has no record of its own */
  var EV = [
    { k: 'budbreak', name: 'Budbreak', acc: 'a41', regional: true, libDate: '04-15', libNote: 'vit library typical mid April' },
    { k: 'firstSpray', name: 'First spray (shoots 2 to 4 in)' },
    { k: 'bloom', name: 'Bloom', regional: true, libDate: '06-15', libNote: 'vit library typical full bloom (mid June) turned into this vineyard\'s heat on that date; log bloom in Field work to calibrate' },
    { k: 'veraison', name: 'Veraison (tissue sampling)' },
    { k: 'firstPick', name: 'First pick' },
    { k: 'lastPick', name: 'Last pick' }
  ];

  /* one year's cumulative heat: base 50°F from April 1 for the season (a50), or base 41°F from
     February 1 for budbreak (a41), which responds to late-winter warmth */
  function cmGddPath(days, year, base, start, end) {
    base = base == null ? 50 : base; start = start || START; end = end || END;
    var y = String(year), cum = 0, by = {}, daily = {}, rain = 0, n = 0, span = dayDiff(y + '-' + start, y + '-' + end) + 1;
    (days || []).forEach(function (d) {
      if (d.date.slice(0, 4) !== y) return; var m = d.date.slice(5);
      if (m < start || m > end) return;
      var g = gdd(num(d.tmax), num(d.tmin), base); if (g == null) return; cum += g; n++; by[d.date] = cum; daily[d.date] = g;
      if (m >= '04-01' && m <= '09-30') rain += num(d.p) || 0;
    });
    return { year: +year, by: by, daily: daily, total: cum, days: n, rain: rain, complete: n >= span * 0.93 };
  }
  var ACC = { a50: { base: 50, start: START }, a41: { base: 41, start: '02-01' } };
  function pathsFor(paths, e) { return paths && paths.a50 ? (e.acc === 'a41' ? paths.a41 : paths.a50) : (e.acc === 'a41' ? null : paths); }
  function gddAt(path, date) { if (!path || !date) return null; var v = path.by[date]; if (v != null) return v; var best = null; Object.keys(path.by).forEach(function (k) { if (k <= date) best = path.by[k]; }); return best; }

  /* per-year stage dates from the season records (vineyard's own) */
  function stageDates(rows) {
    return (rows || []).map(function (r) { return { year: r.year, budbreak: r.budbreak || null, firstSpray: r.firstSpray || null, bloom: r.bloom || null, veraison: r.veraison || r.veraisonSample || null, firstPick: r.firstPick || null, lastPick: r.lastPick || null }; });
  }

  /* heat at each stage across years -> threshold (median). Order of evidence: this vineyard's own
     records (logged stages and dated photos), then Oregon public reports (regional averages, exact
     dates only) turned into this site's heat on those dates, then the vit library's typical date. */
  function cmCalibrate(stageRows, paths, skipYear, regional) {
    var out = {};
    EV.forEach(function (e) {
      var pp = pathsFor(paths, e); if (!pp) return;
      var vals = [];
      stageRows.forEach(function (r) { if (r.year === skipYear || !r[e.k]) return; var p = pp[r.year]; if (!p || !p.complete && e.k !== 'firstSpray') return; var g = gddAt(p, r[e.k]); if (g != null) vals.push(g); });
      var m = median(vals);
      if (m != null) { out[e.k] = { gdd: m, n: vals.length, from: 'this vineyard', lo: Math.min.apply(null, vals), hi: Math.max.apply(null, vals) }; return; }
      if (e.regional && regional) {
        var rv = regional.filter(function (r) { return r.stage === e.k && !r.approx && r.date && r.year !== skipYear && pp[r.year] && pp[r.year].complete; }).map(function (r) { return gddAt(pp[r.year], r.date); });
        var rm = median(rv); if (rm != null) { out[e.k] = { gdd: rm, n: 0, nReg: rv.length, from: 'Oregon public reports (' + rv.length + (rv.length === 1 ? ' year' : ' years') + ' of regional averages) turned into this vineyard\'s heat on those dates' }; return; }
      }
      if (e.libDate) { var lv = Object.keys(pp).map(Number).filter(function (y) { return y !== skipYear && pp[y].complete; }).map(function (y) { return gddAt(pp[y], y + '-' + e.libDate); }); var lm = median(lv); if (lm != null) { out[e.k] = { gdd: lm, n: 0, from: e.libNote }; return; } }
      out[e.k] = null;
    });
    return out;
  }

  /* normal daily heat by month-day from the vineyard's own years (optionally leaving one out) */
  function cmNormalGdd(days, skipYear, base) {
    var by = {};
    (days || []).forEach(function (d) { var y = +d.date.slice(0, 4); if (y === skipYear) return; var m = d.date.slice(5); var g = gdd(num(d.tmax), num(d.tmin), base); if (g == null) return; (by[m] = by[m] || []).push(g); });
    var out = {}; Object.keys(by).forEach(function (m) { var a = by[m]; out[m] = a.reduce(function (s, x) { return s + x; }, 0) / a.length; });
    return out;
  }

  /* walk a season: known heat to asOf, then the supplied daily source, return the date each threshold is crossed */
  function cmProject(year, cal, known, next, acc) {
    acc = acc || 'a50';
    var cum = 0, d = year + '-' + ACC[acc].start, end = year + '-' + END, hit = {};
    var evs = EV.filter(function (e) { return (e.acc || 'a50') === acc; });
    for (var i = 0; i < 300 && d <= end; i++) {
      var g = known && known[d] != null ? known[d] : next(d); cum += g || 0;
      evs.forEach(function (e) { if (!hit[e.k] && cal[e.k] && cum >= cal[e.k].gdd) hit[e.k] = d; });
      d = addDays(d, 1);
    }
    return { dates: hit, total: cum };
  }

  /* leave-one-out: for each past year, the April 1 forecast (other years' normals) against what happened */
  function cmBacktest(stageRows, paths, days, regional) {
    var p50 = paths.a50 || paths;
    return stageRows.filter(function (r) { return p50[r.year] && p50[r.year].complete; }).map(function (r) {
      var cal = cmCalibrate(stageRows, paths, r.year, regional), nm = cmNormalGdd(days, r.year);
      var pr = cmProject(r.year, cal, null, function (d) { return nm[d.slice(5)] || 0; });
      if (paths.a41) { var n41 = cmNormalGdd(days, r.year, 41), p41 = cmProject(r.year, cal, null, function (d) { return n41[d.slice(5)] || 0; }, 'a41'); Object.assign(pr.dates, p41.dates); }
      var o = { year: r.year };
      EV.forEach(function (e) { var p = pr.dates[e.k], a = r[e.k]; o[e.k] = { pred: p || null, act: a || null, diff: p && a ? dayDiff(p, a) : null }; });
      return o;
    });
  }

  /* the season's work placed on the forecast dates; lib slugs tie each item to the vit library */
  /* pruning sized from the budget: hours / (crew x 8 h) working days, finished ~3 weeks before budbreak */
  function cmPrunePlan(budbreak, hours, crew) {
    if (!budbreak) return null; crew = crew || 6;
    var finish = addDays(budbreak, -21), workDays = hours ? Math.ceil(hours / (crew * 8)) : null;
    var latestStart = workDays ? addDays(finish, -Math.ceil(workDays * 7 / 5) - 7) : null;
    return { finish: finish, workDays: workDays, crew: crew, hours: hours || null, latestStart: latestStart };
  }
  function cmOutlookPlan(D, opts) {
    opts = opts || {};
    var P = [], add = function (name, from, to, lib, why) { if (from) P.push({ name: name, from: from, to: to || from, lib: lib || [], why: why || '' }); };
    var bb = D.budbreak, fs = D.firstSpray, bl = D.bloom, ve = D.veraison, fp = D.firstPick, lp = D.lastPick;
    var y = (bb || fs || bl || ve || fp || '').slice(0, 4);
    if (bb) {
      var pr = cmPrunePlan(bb, opts.pruneHours, opts.crew);
      add('Winter freeze watch', (+y - 1) + '-12-01', y + '-02-28', ['cold-hardiness'], 'Check bud hardiness after any hard freeze before final pruning.');
      add('Pruning' + (pr.hours ? ' (about ' + Math.round(pr.hours) + ' hours, ' + pr.workDays + ' working days for a crew of ' + pr.crew + ')' : ''), y + '-01-05', pr.finish, ['pruning-timing', 'trunk-diseases'], 'Finish by ' + md(pr.finish) + ', about 3 weeks before the forecast budbreak' + (pr.latestStart ? '; start no later than ' + md(pr.latestStart) : '') + '. Prune in dry spells.');
      add('Prune Chardonnay and frost-prone low blocks last (or double prune)', addDays(pr.finish, -14), addDays(bb, -2), ['pruning-timing', 'frost-protection'], 'Late pruning delays budbreak on the kept buds.');
      add('Pull brush, tie canes, trellis repair', addDays(pr.finish, -10), addDays(bb, -5), ['pruning-timing']);
      add('Frost watch after budbreak', addDays(bb, -5), y + '-05-15' > addDays(bb, 30) ? y + '-05-15' : addDays(bb, 30), ['frost-protection'], 'Chardonnay breaks bud first.');
    } else if (fs) add('Frost watch after budbreak', addDays(fs, -14), y + '-05-15' > addDays(fs, 21) ? y + '-05-15' : addDays(fs, 21), ['frost-protection'], 'Chardonnay breaks bud first.');
    add('First sprays for mites and powdery mildew', fs ? addDays(fs, -3) : null, fs ? addDays(fs, 3) : null, ['mites', 'powdery-mildew'], 'Shoots 2 to 4 inches.');
    if (fs && bl) add('Shoot thinning, suckering and lifting wires', addDays(fs, 14), addDays(bl, -7), ['canopy-airflow']);
    if (bl) {
      add('Protect bloom: tightest spray spacing', addDays(bl, -10), addDays(bl, 21), ['powdery-mildew', 'botrytis-bunch-rot', 'rain-at-bloom'], 'Clusters are most susceptible from just before bloom to about 4 weeks after set.');
      add('Leaf pull the fruit zone (morning side)', addDays(bl, 10), addDays(bl, 30), ['leaf-removal']);
      add('Lag-phase crop estimate', addDays(bl, 45), addDays(bl, 55), ['crop-estimation']);
    }
    if (ve) {
      add('Tissue samples and crop adjustment', addDays(ve, -3), addDays(ve, 7), ['tissue-testing', 'yield-and-quality']);
      add('Bird netting; plan last sprays against the pre-harvest interval', ve, addDays(ve, 14), ['rei-phi']);
      add('Weekly ripeness samples', addDays(ve, 14), fp || addDays(ve, 45), ['ripeness-sampling']);
    }
    if (ve && fp) add('No elemental sulfur this close to harvest', addDays(fp, -35), fp, ['h2s-and-sulfur-residue', 'rei-phi'], 'Sulfur residue on fruit can turn into hydrogen sulfide in the ferment.');
    if (fp) {
      add('Book picking crew, bins and trucking', addDays(fp, -21), addDays(fp, -14), ['ripeness-sampling']);
      add('Winery ready: yeast, nutrients, SO2, press and tanks', addDays(fp, -30), addDays(fp, -7), ['yan-and-nutrients', 'so2-molecular', 'lab-analysis-plan']);
      add('Harvest window', fp, lp || addDays(fp, 21), ['ripeness-sampling', 'botrytis-bunch-rot']);
      add('YAN, pH and TA on every lot as it comes in', fp, lp || addDays(fp, 21), ['yan-and-nutrients', 'lab-analysis-plan']);
    }
    if (lp) { add('Malolactic, then SO2 by pH once dry', addDays(lp, 14), addDays(lp, 90), ['malolactic', 'so2-molecular', 'brettanomyces']); add('Cover crop, compost and LIVE year-end reports', addDays(lp, 7), addDays(lp, 40), ['soil-and-floor', 'live-certification']); }
    return P.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
  }

  /* things to watch this year: seasonal outlook, projected timing against typical, and the risks
     that follow (each tied to vit library entries) */
  function cmWatchList(X) {
    var W = [], add = function (level, text, lib) { W.push({ level: level, text: text, lib: lib || [] }); };
    var so = X.seasonal || [], yr = String(X.year), mo = function (m) { return so.filter(function (o) { return o.month === yr + '-' + m; })[0] || {}; };
    var avg = function (ms, k) { var v = ms.map(function (m) { return mo(m)[k]; }).filter(function (x) { return x != null; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; };
    var lateWinter = avg(['02', '03'], 'tAnom'), spring = avg(['04', '05'], 'tAnom'), summer = avg(['07', '08'], 'tAnom');
    var bloomRain = avg(['05', '06'], 'rainPct'), harvestRain = avg(['09', '10'], 'rainPct');
    var D = X.dates || {}, T = X.typical || {};
    if (lateWinter != null && lateWinter >= 1.5) add('high', 'Late winter forecast ' + lateWinter.toFixed(1) + '°F above normal: budbreak may come early' + (D.budbreak ? ' (forecast ' + md(D.budbreak) + ')' : '') + ' with April frost still likely. Prune Chardonnay and low ground last; have frost protection ready.', ['pruning-timing', 'frost-protection']);
    if (spring != null && spring <= -1.5) add('medium', 'Spring forecast ' + Math.abs(spring).toFixed(1) + '°F below normal: slower shoot growth and later bloom' + (D.bloom ? ' (forecast ' + md(D.bloom) + ')' : '') + '. Expect a later harvest and more October rain risk.', ['rain-at-bloom', 'growing-degree-days']);
    if (spring != null && spring >= 1.5) add('medium', 'Warm spring forecast: fast growth; keep spray spacing tight and shoot positioning on time.', ['powdery-mildew', 'canopy-airflow']);
    if (bloomRain != null && bloomRain >= 130) add('high', 'Wet May and June forecast (' + Math.round(bloomRain) + '% of normal rain): poor set and Botrytis risk at bloom.', ['rain-at-bloom', 'botrytis-bunch-rot']);
    if (summer != null && summer >= 2) add('high', 'Hot July and August forecast: sunburn on exposed fruit, faster sugar and lower acid; plan acid checks and pick timing.', ['heat-and-sunburn', 'ripeness-sampling']);
    if (harvestRain != null && harvestRain >= 130) add('high', 'Wet harvest forecast: Botrytis and sour rot in tight Pinot noir; plan picking order, sorting and volatile acidity checks.', ['botrytis-bunch-rot', 'sour-rot', 'volatile-acidity']);
    if (D.firstPick && T.firstPick) { var dd = dayDiff(T.firstPick, D.firstPick); if (dd <= -7) add('medium', 'Harvest forecast ' + (-dd) + ' days earlier than typical (' + md(D.firstPick) + '): book crews and bins early and have the winery ready by ' + md(addDays(D.firstPick, -7)) + '.', ['ripeness-sampling', 'yan-and-nutrients']); else if (dd >= 7) add('medium', 'Harvest forecast ' + dd + ' days later than typical (' + md(D.firstPick) + '): October rain risk rises; watch Botrytis and plan bird netting.', ['botrytis-bunch-rot']); }
    if (X.sulfurGap != null && X.sulfurGap < 35) add('medium', 'In ' + X.sulfurYear + ' the last sulfur spray was ' + X.sulfurGap + ' days before the first pick; keep elemental sulfur at least 5 weeks out and watch for hydrogen sulfide in the ferments.', ['h2s-and-sulfur-residue']);
    add('low', 'Wildfire smoke season runs August to October: plan grape smoke tests before harvest if fires are near.', ['wildfire-smoke']);
    if (X.regionalBloom) add('low', 'Regional reference: North Willamette Valley average bloom ' + X.regionalBloom + ' (public vintage reports).', ['oregon-regional-timing']);
    return W;
  }

  function CmOutlook(P) {
    var site = P.site, wsite = P.wsite || site, D = P.D || {};
    var s1 = React.useState(null), F = s1[0], setF = s1[1];
    var s2 = React.useState(null), lib = s2[0], setLib = s2[1];
    var s4 = React.useState(null), REG = s4[0], setREG = s4[1];
    var today = new Date().toISOString().slice(0, 10), yNow = +today.slice(0, 4);
    var s3 = React.useState(today.slice(5) > '10-31' ? yNow + 1 : yNow), year = s3[0], setYear = s3[1];
    React.useEffect(function () {
      if (wsite && wsite.lat != null && window.cmForecastLoad) window.cmForecastLoad(wsite).then(setF).catch(function () { setF({}); }); else setF({});
      supa.schema('cellarmate').from('vit_library').select('slug,title,orgs').then(function (r) { setLib(r.data || []); });
      supa.schema('cellarmate').from('regional_phenology').select('*').order('year').then(function (r) { setREG(r.data || []); });
    }, [wsite && wsite.id]);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var th = { textAlign: 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var td = { textAlign: 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var L = function (o) { return Object.assign({}, o, { textAlign: 'left', whiteSpace: 'normal' }); };
    var days = P.days || [];
    if (!site) return null;
    if (!days.length) return cmE('div', { style: card }, 'Loading weather history for the forecast year...');
    var M = window.cmHistoryMarkers ? window.cmHistoryMarkers(D) : { rows: [] };
    var stages = stageDates(M.rows);
    var regional = REG || [];
    var yrs = {}; days.forEach(function (d) { yrs[d.date.slice(0, 4)] = 1; });
    var P50 = {}, P41 = {}; Object.keys(yrs).forEach(function (y) { P50[+y] = cmGddPath(days, +y); P41[+y] = cmGddPath(days, +y, 41, '02-01'); });
    var paths = { a50: P50, a41: P41 };
    var cal = cmCalibrate(stages, paths, null, regional);
    var norm = { a50: cmNormalGdd(days, null), a41: cmNormalGdd(days, null, 41) };

    /* forecast for the chosen year */
    var lastKnown0 = P41[year] ? Object.keys(P41[year].daily).sort().pop() : null;
    var past = year < yNow || (lastKnown0 && lastKnown0.slice(5) >= '10-30');
    /* a finished year is forecast as it would have looked before the season, from the other years only */
    var calY = past ? cmCalibrate(stages, paths, year, regional) : cal;
    var normY = past ? { a50: cmNormalGdd(days, year), a41: cmNormalGdd(days, year, 41) } : norm;
    var known = { a50: past ? {} : (P50[year] ? P50[year].daily : {}), a41: past ? {} : (P41[year] ? P41[year].daily : {}) };
    var lastKnown = past ? null : lastKnown0;
    var fc = { a50: {}, a41: {} }, fcRain = {}, fcLow = {}, fcHigh = {};
    if (F && F.fc && F.fc.daily) F.fc.daily.time.forEach(function (t, i) { var hi = num(F.fc.daily.temperature_2m_max[i]), lo = num(F.fc.daily.temperature_2m_min[i]); fc.a50[t] = gdd(hi, lo); fc.a41[t] = gdd(hi, lo, 41); fcRain[t] = num(F.fc.daily.precipitation_sum[i]); fcLow[t] = lo; fcHigh[t] = hi; });
    var anom = {}, seasonal = [];
    if (F && F.seas && F.seas.daily && window.cmSeasonalOutlook && window.cmNormalsFrom) { seasonal = window.cmSeasonalOutlook(F.seas.daily, window.cmNormalsFrom(days)); seasonal.forEach(function (o) { if (o.tAnom != null) anom[o.month] = o.tAnom; }); }
    var projectAll = function (nextFor) { var a = cmProject(year, calY, known.a50, nextFor('a50'), 'a50'), b = cmProject(year, calY, known.a41, nextFor('a41'), 'a41'); return { dates: Object.assign({}, a.dates, b.dates), total: a.total }; };
    var central = projectAll(function (acc) { return function (d) { if (past) return normY[acc][d.slice(5)] || 0; if (fc[acc][d] != null) return fc[acc][d]; var a = anom[d.slice(0, 7)] || 0; return Math.max(0, (norm[acc][d.slice(5)] || 0) + a); }; });
    var analog = Object.keys(P50).map(Number).filter(function (y) { return y !== year && P50[y].complete && P41[y].complete; }).map(function (y) {
      return projectAll(function (acc) { var src = acc === 'a41' ? P41 : P50; return function (d) { var g = src[y].daily[y + d.slice(4)]; return g != null ? g : (normY[acc][d.slice(5)] || 0); }; });
    });
    var range = {}; EV.forEach(function (e) { var ds = analog.map(function (a) { return a.dates[e.k]; }).filter(Boolean).sort(); if (ds.length) range[e.k] = { early: ds[0], late: ds[ds.length - 1] }; });
    var actualYear = stages.filter(function (r) { return r.year === year; })[0] || {};
    var bt = cmBacktest(stages, paths, days, regional);
    var mae = {}; EV.forEach(function (e) { var v = bt.map(function (b) { return b[e.k].diff; }).filter(function (x) { return x != null; }); if (v.length) mae[e.k] = { avg: v.reduce(function (a, x) { return a + Math.abs(x); }, 0) / v.length, n: v.length }; });
    /* regional check: how the model does against the public regional dates */
    var regMiss = {}; ['budbreak', 'bloom'].forEach(function (k) { var v = regional.filter(function (r) { return r.stage === k && !r.approx && P50[r.year] && P50[r.year].complete; }).map(function (r) { var b = bt.filter(function (x) { return x.year === r.year; })[0]; return b && b[k].pred ? dayDiff(b[k].pred, r.date) : null; }).filter(function (x) { return x != null; }); if (v.length) regMiss[k] = { avg: v.reduce(function (a, x) { return a + Math.abs(x); }, 0) / v.length, n: v.length }; });

    /* budget: monthly amounts for the year and pruning hours (this year, or the latest year with pruning) */
    var hist = P.history || [];
    var okRow = function (b, y) { return !(b.manager && hist.length && window.cmManagerFor && b.month && window.cmManagerFor(hist, y, b.month) !== b.manager); };
    var bud = {}; var hasFinal = (D.budget || []).some(function (x) { return x.year === year && x.version === 'final'; });
    (D.budget || []).filter(function (b) { return b.year === year && b.version !== 'actual' && b.month && okRow(b, year) && (b.version === 'final' || !hasFinal); }).forEach(function (b) { bud[b.month] = (bud[b.month] || 0) + (num(b.amount) || 0); });
    var pruneRows = function (y) { var f = (D.budget || []).some(function (x) { return x.year === y && x.version === 'final' && /prun/i.test(x.item || ''); }); return (D.budget || []).filter(function (b) { return b.year === y && /prun/i.test(b.item || '') && (f ? b.version === 'final' : b.version === 'preliminary') && okRow(b, y); }); };
    var pYear = [year].concat((D.budget || []).map(function (b) { return b.year; }).filter(function (y) { return y < year; }).sort(function (a, b) { return b - a; })).filter(function (y) { return pruneRows(y).length; })[0];
    var pruneHours = pYear ? pruneRows(pYear).reduce(function (a, b) { return a + (num(b.hours) != null ? num(b.hours) : (num(b.amount) || 0) / 24.9); }, 0) : null;
    var plan = cmOutlookPlan(central.dates, { pruneHours: pruneHours, crew: 6 });
    var libBy = {}; (lib || []).forEach(function (e) { libBy[e.slug] = e; });
    var typ = {}; EV.forEach(function (e) { var v = stages.map(function (r) { return r[e.k]; }).filter(Boolean).map(function (d) { return d.slice(5); }).sort(); if (v.length) typ[e.k] = year + '-' + v[Math.floor(v.length / 2)]; });
    var lastSulfur = (D.sprays || []).filter(function (s) { return s.date && !s.skipped && /sulfur|microthiol|thiolux|kumulus/i.test(s.products_rate_per_acre || ''); }).map(function (s) { return s.date; }).sort().pop();
    var sulfRow = stages.filter(function (r) { return r.firstPick && lastSulfur && r.year === +lastSulfur.slice(0, 4); })[0];
    var sulfurGap = sulfRow ? dayDiff(lastSulfur, sulfRow.firstPick) : null;
    var regB = regional.filter(function (r) { return r.stage === 'bloom' && !r.approx; }).map(function (r) { return r.date.slice(5); }).sort();
    var watch = cmWatchList({ year: year, seasonal: past ? [] : seasonal, dates: central.dates, typical: typ, sulfurGap: sulfurGap, sulfurYear: sulfRow ? sulfRow.year : null, regionalBloom: regB.length ? md('2000-' + regB[0]) + ' to ' + md('2000-' + regB[regB.length - 1]) + ' (' + regB.length + ' yrs)' : null });
    var alerts = [];
    Object.keys(fc.a50).sort().forEach(function (d) {
      if (d.slice(0, 4) !== String(year) || past) return;
      var inWin = function (name) { return plan.some(function (p) { return p.name.indexOf(name) === 0 && d >= p.from && d <= p.to; }); };
      if (fcLow[d] != null && fcLow[d] <= 32 && inWin('Frost watch')) alerts.push(md(d) + ': forecast low ' + Math.round(fcLow[d]) + '°F during the frost window.');
      if (fcLow[d] != null && fcLow[d] <= 15 && inWin('Winter freeze')) alerts.push(md(d) + ': forecast low ' + Math.round(fcLow[d]) + '°F; check bud damage before pruning.');
      if (fcHigh[d] != null && fcHigh[d] >= 95 && d.slice(5) >= '06-01' && d.slice(5) <= '09-30') alerts.push(md(d) + ': forecast high ' + Math.round(fcHigh[d]) + '°F; hold leaf pulling and sulfur on exposed fruit.');
      if ((fcRain[d] || 0) >= 0.5 && (inWin('Protect bloom') || inWin('Harvest window'))) alerts.push(md(d) + ': ' + fcRain[d].toFixed(2) + ' in of rain forecast in the ' + (inWin('Harvest window') ? 'harvest window; pick the tightest Pinot noir blocks first' : 'bloom window; keep spray spacing tight') + '.');
      if ((fcRain[d] || 0) >= 0.3 && inWin('Pruning')) alerts.push(md(d) + ': rain forecast; avoid fresh pruning cuts that day.');
    });
    var money = function (x) { return x ? '$' + Math.round(x).toLocaleString() : ''; };
    var ys = Object.keys(P50).map(Number).sort();
    var yearOpts = ys.concat(ys.indexOf(yNow + 1) < 0 ? [yNow + 1] : []);
    var dateCell = function (d, g, tag) { return d ? md(d) + (tag || '') + (g != null ? ' · ' + Math.round(g) : '') : ''; };
    var regFor = function (y, k) { return regional.filter(function (r) { return r.year === y && r.stage === k; })[0]; };
    var libLinks = function (sl) { return sl.map(function (x) { var e = libBy[x]; return e ? cmE('span', { key: x, style: { color: C.accentLight } }, e.title + ' (' + (e.orgs || []).join(', ') + ')  ') : null; }); };
    var regYears = Object.keys(regional.reduce(function (m, r) { m[r.year] = 1; return m; }, {})).map(Number).sort();

    return cmE('div', null,
      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 2 } }, 'Every year at this vineyard'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Date and heat at each stage (budbreak: degree days base 41°F from February 1; the rest: base 50°F from April 1). Budbreak and bloom marked (OR) are the North Willamette Valley averages from public vintage reports until this vineyard logs its own (a dated photo of the stage counts). Veraison uses the veraison tissue sampling date until veraison is logged.'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 760 } },
          cmE('thead', null, cmE('tr', null, ['Year'].concat(EV.map(function (e) { return e.name; })).concat(['Season heat', 'Rain Apr to Sep']).map(function (x, i) { return cmE('th', { key: x, style: i ? th : L(th) }, x); }))),
          cmE('tbody', null, ys.map(function (y) {
            var r = stages.filter(function (x) { return x.year === y; })[0] || {}, p = P50[y];
            return cmE('tr', { key: y }, cmE('td', { style: L(td) }, y + (p.complete ? '' : ' (so far)')), EV.map(function (e) {
              var pp = e.acc === 'a41' ? P41[y] : p, d = r[e.k], tag = '';
              if (!d && e.regional) { var rg = regFor(y, e.k); if (rg) { d = rg.date; tag = rg.approx ? ' (OR, approx)' : ' (OR)'; } }
              return cmE('td', { key: e.k, style: Object.assign({}, td, { color: tag ? C.textDim : C.text }) }, dateCell(d, gddAt(pp, d), tag));
            }), cmE('td', { style: td }, Math.round(p.total)), cmE('td', { style: td }, p.rain.toFixed(1) + '"'));
          }).concat([cmE('tr', { key: 'typ' }, cmE('td', { style: Object.assign(L(td), { fontWeight: 700 }) }, 'Typical'), EV.map(function (e) {
            var v = stages.map(function (r) { return r[e.k]; }).filter(Boolean).map(function (d) { return +d.slice(5, 7) * 100 + +d.slice(8, 10); }).sort(function (a, b) { return a - b; });
            var f = function (x) { return Math.floor(x / 100) + '/' + (x % 100); };
            return cmE('td', { key: e.k, style: Object.assign({}, td, { fontWeight: 700 }) }, v.length ? f(v[Math.floor(v.length / 2)]) + ' (' + f(v[0]) + ' to ' + f(v[v.length - 1]) + ')' + (cal[e.k] ? ' · ' + Math.round(cal[e.k].gdd) : '') : (cal[e.k] ? 'about ' + Math.round(cal[e.k].gdd) + ' GDD' : ''));
          }), cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, Math.round(median(ys.filter(function (y) { return P50[y].complete; }).map(function (y) { return P50[y].total; })) || 0)), cmE('td', { style: td }))]))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, EV.filter(function (e) { return cal[e.k] && cal[e.k].n === 0; }).map(function (e) { return e.name + ': ' + cal[e.k].from + '.'; }).join(' '))),

      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' } },
          cmE('div', { style: { fontWeight: 700, flex: 1 } }, 'Forecast year ' + year + (past ? ' against the actual year' : '')),
          cmE('select', { value: year, onChange: function (ev) { setYear(+ev.target.value); }, style: { background: C.card, color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 6, padding: '3px 6px', fontSize: 12 } }, yearOpts.map(function (y) { return cmE('option', { key: y, value: y }, y); }))),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, past ? 'The forecast as it would have looked before the season, built from the other years only (their heat at each stage and their weather), against what actually happened. The range finishes the season with each other year\'s weather.' : (lastKnown ? 'Actual weather to ' + md(lastKnown) + ', then ' : 'Starts from ') + (Object.keys(fc.a50).length ? 'the 16-day forecast, then ' : '') + 'this vineyard\'s normal day by day' + (Object.keys(anom).length ? ', shifted by the ECMWF seasonal outlook (' + Object.keys(anom).sort().map(function (m) { return MONTHS[+m.slice(5) - 1] + ' ' + (anom[m] > 0 ? '+' : '') + anom[m].toFixed(1) + '°F'; }).join(', ') + ')' : '') + '. The range finishes the season with each past year\'s weather.'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 600 } },
          cmE('thead', null, cmE('tr', null, ['Stage', 'Heat it takes here', 'Forecast', 'Early to late', 'Actual', 'Forecast miss', 'Usual miss'].map(function (x, i) { return cmE('th', { key: x, style: i ? th : L(th) }, x); }))),
          cmE('tbody', null, EV.map(function (e) {
            var f = central.dates[e.k], a = actualYear[e.k], c = calY[e.k], rg = range[e.k], ra = !a && e.regional ? regFor(year, e.k) : null;
            var miss = mae[e.k] || regMiss[e.k];
            return cmE('tr', { key: e.k }, cmE('td', { style: Object.assign(L(td), { fontWeight: e.k === 'firstPick' ? 700 : 400 }) }, e.k === 'firstPick' ? 'Harvest start (first pick)' : e.name), cmE('td', { style: td }, c ? Math.round(c.gdd) + (c.n ? ' (' + c.n + ' yrs here)' : c.nReg ? ' (Oregon, ' + c.nReg + ' yrs)' : ' (library)') : ''),
              cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, md(f) || 'not reached'), cmE('td', { style: td }, rg ? md(rg.early) + ' to ' + md(rg.late) : ''), cmE('td', { style: td }, a ? md(a) : ra ? md(ra.date) + ' (OR)' : ''),
              cmE('td', { style: Object.assign({}, td, { color: f && (a || ra) && Math.abs(dayDiff(f, a || ra.date)) > 7 ? C.orange : C.text }) }, f && (a || ra) ? (dayDiff(f, a || ra.date) > 0 ? '+' : '') + dayDiff(f, a || ra.date) + ' d' : ''),
              cmE('td', { style: td }, miss ? '±' + miss.avg.toFixed(0) + ' d (' + miss.n + ' yrs' + (mae[e.k] ? '' : ', Oregon') + ')' : ''));
          }))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Forecast miss: days the actual came after (+) or before (-) the forecast. Usual miss: average error when each past year is forecast before the season from the other years only (against this vineyard\'s records, or the Oregon regional dates where the vineyard has none).')),

      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Things to watch in ' + year),
        watch.map(function (w, i) {
          return cmE('div', { key: i, style: { padding: '5px 0', borderTop: i ? '1px solid ' + C.cardBorder : 'none', fontSize: 13 } },
            cmE('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6, background: w.level === 'high' ? C.red : w.level === 'medium' ? C.orange : C.textDim } }), w.text, ' ', cmE('span', { style: small }, libLinks(w.lib)));
        })),

      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Recommended work for ' + year + ': vineyard and winery'),
        alerts.length ? cmE('div', { style: { margin: '2px 0 8px', padding: '6px 8px', borderRadius: 8, border: '1px solid ' + C.orange, fontSize: 12 } }, cmE('b', null, 'From the forecast: '), alerts.slice(0, 6).join(' ')) : null,
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 560 } },
          cmE('thead', null, cmE('tr', null, ['When', 'Work', 'Why and where to read more', 'Budget that month'].map(function (x, i) { return cmE('th', { key: x, style: i === 3 ? th : L(th) }, x); }))),
          cmE('tbody', null, plan.map(function (p, i) {
            var m = +p.from.slice(5, 7), sameYear = p.from.slice(0, 4) === String(year);
            return cmE('tr', { key: i }, cmE('td', { style: L(td) }, md(p.from) + (p.to !== p.from ? ' to ' + md(p.to) : '')), cmE('td', { style: Object.assign(L(td), { fontWeight: 700 }) }, p.name),
              cmE('td', { style: L(td) }, (p.why ? p.why + ' ' : ''), libLinks(p.lib)),
              cmE('td', { style: td }, sameYear ? money(bud[m]) : ''));
          }))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, (pruneHours ? 'Pruning hours come from the ' + pYear + ' budget (' + Math.round(pruneHours) + ' hours at a crew rate of $24.90 where hours are not listed). ' : '') + 'Dates move as the season\'s weather comes in. Open the Vit library tab for the notes and the university sources behind each item.')),

      regYears.length ? cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Oregon public timing reports'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 560 } },
          cmE('thead', null, cmE('tr', null, ['Year', 'Budbreak', 'Bloom', 'Veraison', 'Harvest', 'Source'].map(function (x, i) { return cmE('th', { key: x, style: i && i < 5 ? th : L(th) }, x); }))),
          cmE('tbody', null, regYears.map(function (y) {
            var rr = regional.filter(function (r) { return r.year === y; }), cell = function (k) { var r = rr.filter(function (x) { return x.stage === k; })[0]; return r ? md(r.date) + (r.approx ? ' (approx)' : '') : ''; };
            var srcs = {}; rr.forEach(function (r) { srcs[r.source_url] = r.source_title; });
            return cmE('tr', { key: y }, cmE('td', { style: L(td) }, y), ['budbreak', 'bloom', 'veraison', 'harvest'].map(function (k) { return cmE('td', { key: k, style: td }, cell(k)); }),
              cmE('td', { style: L(td) }, Object.keys(srcs).map(function (u, i) { return cmE('a', { key: i, href: u, target: '_blank', rel: 'noopener', style: { color: C.accentLight, marginRight: 6 } }, srcs[u]); })));
          }))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Exact dates are regional averages of reference vineyards and are used to calibrate budbreak and bloom here. Approximate dates come from narrative reports and are shown for context only.')) : null);
  }


  window.cmGddPath = cmGddPath;
  window.cmCalibrate = cmCalibrate;
  window.cmProject = cmProject;
  window.cmNormalGdd = cmNormalGdd;
  window.cmBacktest = cmBacktest;
  window.cmOutlookPlan = cmOutlookPlan;
  window.cmPrunePlan = cmPrunePlan;
  window.cmWatchList = cmWatchList;
  window.CmOutlook = CmOutlook;
})();
