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
  function gdd(tmax, tmin) { if (tmax == null || tmin == null) return null; return Math.max(0, (tmax + tmin) / 2 - 50); }
  var START = '04-01', END = '10-31';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* the stages tracked; lib = vit library defaults when the vineyard has no record of its own */
  var EV = [
    { k: 'firstSpray', name: 'First spray (shoots 2 to 4 in)' },
    { k: 'bloom', name: 'Bloom', libDate: '06-15', libNote: 'vit library typical full bloom (mid June) turned into this vineyard\'s heat on that date; log bloom in Field work to calibrate' },
    { k: 'veraison', name: 'Veraison (tissue sampling)' },
    { k: 'firstPick', name: 'First pick' },
    { k: 'lastPick', name: 'Last pick' }
  ];

  /* one year's cumulative heat from April 1: {date: cum} plus season total and Apr to Sep rain */
  function cmGddPath(days, year) {
    var y = String(year), cum = 0, by = {}, daily = {}, rain = 0, n = 0;
    (days || []).forEach(function (d) {
      if (d.date.slice(0, 4) !== y) return; var m = d.date.slice(5);
      if (m < START || m > END) return;
      var g = gdd(num(d.tmax), num(d.tmin)); if (g == null) return; cum += g; n++; by[d.date] = cum; daily[d.date] = g;
      if (m <= '09-30') rain += num(d.p) || 0;
    });
    return { year: +year, by: by, daily: daily, total: cum, days: n, rain: rain, complete: n >= 200 };
  }
  function gddAt(path, date) { if (!path || !date) return null; var v = path.by[date]; if (v != null) return v; var best = null; Object.keys(path.by).forEach(function (k) { if (k <= date) best = path.by[k]; }); return best; }

  /* per-year stage dates from the season records (vineyard's own) */
  function stageDates(rows) {
    return (rows || []).map(function (r) { return { year: r.year, firstSpray: r.firstSpray || null, bloom: r.bloom || null, veraison: r.veraison || r.veraisonSample || null, firstPick: r.firstPick || null, lastPick: r.lastPick || null }; });
  }

  /* heat at each stage across years -> site threshold (median) */
  function cmCalibrate(stageRows, paths, skipYear) {
    var out = {};
    EV.forEach(function (e) {
      var vals = [];
      stageRows.forEach(function (r) { if (r.year === skipYear || !r[e.k]) return; var p = paths[r.year]; if (!p || !p.complete && e.k !== 'firstSpray') return; var g = gddAt(p, r[e.k]); if (g != null) vals.push(g); });
      var m = median(vals);
      if (m == null && e.libDate) { var lv = Object.keys(paths).map(Number).filter(function (y) { return y !== skipYear && paths[y].complete; }).map(function (y) { return gddAt(paths[y], y + '-' + e.libDate); }); m = median(lv); if (m != null) { out[e.k] = { gdd: m, n: 0, from: e.libNote }; return; } }
      out[e.k] = m != null ? { gdd: m, n: vals.length, from: 'this vineyard', lo: Math.min.apply(null, vals), hi: Math.max.apply(null, vals) } : null;
    });
    return out;
  }

  /* normal daily heat by month-day from the vineyard's own years (optionally leaving one out) */
  function cmNormalGdd(days, skipYear) {
    var by = {};
    (days || []).forEach(function (d) { var y = +d.date.slice(0, 4); if (y === skipYear) return; var m = d.date.slice(5); var g = gdd(num(d.tmax), num(d.tmin)); if (g == null) return; (by[m] = by[m] || []).push(g); });
    var out = {}; Object.keys(by).forEach(function (m) { var a = by[m]; out[m] = a.reduce(function (s, x) { return s + x; }, 0) / a.length; });
    return out;
  }

  /* walk a season: known heat to asOf, then the supplied daily source, return the date each threshold is crossed */
  function cmProject(year, cal, known, next) {
    var cum = 0, d = year + '-' + START, end = year + '-' + END, hit = {};
    for (var i = 0; i < 260 && d <= end; i++) {
      var g = known && known[d] != null ? known[d] : next(d); cum += g || 0;
      EV.forEach(function (e) { if (!hit[e.k] && cal[e.k] && cum >= cal[e.k].gdd) hit[e.k] = d; });
      d = addDays(d, 1);
    }
    return { dates: hit, total: cum };
  }

  /* leave-one-out: for each past year, the April 1 forecast (other years' normals) against what happened */
  function cmBacktest(stageRows, paths, days) {
    return stageRows.filter(function (r) { return paths[r.year] && paths[r.year].complete; }).map(function (r) {
      var cal = cmCalibrate(stageRows, paths, r.year), nm = cmNormalGdd(days, r.year);
      var pr = cmProject(r.year, cal, null, function (d) { return nm[d.slice(5)] || 0; });
      var o = { year: r.year };
      EV.forEach(function (e) { var p = pr.dates[e.k], a = r[e.k]; o[e.k] = { pred: p || null, act: a || null, diff: p && a ? dayDiff(p, a) : null }; });
      return o;
    });
  }

  /* the season's work placed on the forecast dates; lib slugs tie each item to the vit library */
  function cmOutlookPlan(D) {
    var P = [], add = function (name, from, to, lib, why) { if (from) P.push({ name: name, from: from, to: to || from, lib: lib || [], why: why || '' }); };
    var fs = D.firstSpray, bl = D.bloom, ve = D.veraison, fp = D.firstPick, lp = D.lastPick;
    var y = (fs || bl || ve || fp || '').slice(0, 4);
    if (fs) add('Frost watch after budbreak', addDays(fs, -14), y + '-05-15' > addDays(fs, 21) ? y + '-05-15' : addDays(fs, 21), ['frost-protection'], 'Chardonnay breaks bud first.');
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
    if (fp) { add('Book picking crew, bins and trucking', addDays(fp, -21), addDays(fp, -14), ['ripeness-sampling']); add('Harvest window', fp, lp || addDays(fp, 21), ['ripeness-sampling', 'botrytis-bunch-rot']); }
    if (lp) add('Cover crop, compost and LIVE year-end reports', addDays(lp, 7), addDays(lp, 40), ['soil-and-floor', 'live-certification']);
    return P.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
  }

  function CmOutlook(P) {
    var site = P.site, wsite = P.wsite || site, D = P.D || {};
    var s1 = React.useState(null), F = s1[0], setF = s1[1];
    var s2 = React.useState(null), lib = s2[0], setLib = s2[1];
    var today = new Date().toISOString().slice(0, 10), yNow = +today.slice(0, 4);
    var s3 = React.useState(today.slice(5) > '10-31' ? yNow + 1 : yNow), year = s3[0], setYear = s3[1];
    React.useEffect(function () {
      if (wsite && wsite.lat != null && window.cmForecastLoad) window.cmForecastLoad(wsite).then(setF).catch(function () { setF({}); }); else setF({});
      supa.schema('cellarmate').from('vit_library').select('slug,title,orgs').then(function (r) { setLib(r.data || []); });
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
    var yrs = {}; days.forEach(function (d) { yrs[d.date.slice(0, 4)] = 1; });
    var paths = {}; Object.keys(yrs).forEach(function (y) { paths[+y] = cmGddPath(days, +y); });
    var cal = cmCalibrate(stages, paths, null);
    var normal = cmNormalGdd(days, null);

    /* forecast for the chosen year */
    var lastKnown0 = paths[year] ? Object.keys(paths[year].daily).sort().pop() : null;
    var past = year < yNow || (lastKnown0 && lastKnown0.slice(5) >= '10-30');
    /* a finished year is forecast as it would have looked on April 1, from the other years only */
    var calY = past ? cmCalibrate(stages, paths, year) : cal, normY = past ? cmNormalGdd(days, year) : normal;
    var daily = past ? {} : (paths[year] ? paths[year].daily : {});
    var lastKnown = past ? null : lastKnown0;
    var fc = {}, fcRain = {}, fcLow = {}, fcHigh = {};
    if (F && F.fc && F.fc.daily) F.fc.daily.time.forEach(function (t, i) { var hi = num(F.fc.daily.temperature_2m_max[i]), lo = num(F.fc.daily.temperature_2m_min[i]); fc[t] = gdd(hi, lo); fcRain[t] = num(F.fc.daily.precipitation_sum[i]); fcLow[t] = lo; fcHigh[t] = hi; });
    var anom = {};
    if (F && F.seas && F.seas.daily && window.cmSeasonalOutlook && window.cmNormalsFrom) window.cmSeasonalOutlook(F.seas.daily, window.cmNormalsFrom(days)).forEach(function (o) { if (o.tAnom != null) anom[o.month] = o.tAnom; });
    var nextDay = function (d) { if (past) return normY[d.slice(5)] || 0; if (fc[d] != null) return fc[d]; var a = anom[d.slice(0, 7)] || 0; return Math.max(0, (normal[d.slice(5)] || 0) + a); };
    var central = cmProject(year, calY, daily, nextDay);
    var analog = Object.keys(paths).map(Number).filter(function (y) { return y !== year && paths[y].complete; }).map(function (y) {
      return cmProject(year, calY, daily, function (d) { var g = paths[y].daily[y + d.slice(4)]; return g != null ? g : (normY[d.slice(5)] || 0); });
    });
    var range = {}; EV.forEach(function (e) { var ds = analog.map(function (a) { return a.dates[e.k]; }).filter(Boolean).sort(); if (ds.length) range[e.k] = { early: ds[0], late: ds[ds.length - 1] }; });
    var actualYear = stages.filter(function (r) { return r.year === year; })[0] || {};
    var seasonDone = past;
    var bt = cmBacktest(stages, paths, days);
    var mae = {}; EV.forEach(function (e) { var v = bt.map(function (b) { return b[e.k].diff; }).filter(function (x) { return x != null; }); if (v.length) mae[e.k] = { avg: v.reduce(function (a, x) { return a + Math.abs(x); }, 0) / v.length, n: v.length }; });

    /* recommendations */
    var plan = cmOutlookPlan(central.dates);
    var libBy = {}; (lib || []).forEach(function (e) { libBy[e.slug] = e; });
    var bud = {}; (D.budget || []).filter(function (b) { return b.year === year && b.version !== 'actual' && b.month; }).forEach(function (b) {
      if (b.manager && P.history && P.history.length && window.cmManagerFor && window.cmManagerFor(P.history, year, b.month) !== b.manager) return;
      if (b.version === 'final' || !(D.budget || []).some(function (x) { return x.year === year && x.version === 'final'; })) bud[b.month] = (bud[b.month] || 0) + (num(b.amount) || 0);
    });
    var alerts = [];
    Object.keys(fc).sort().forEach(function (d) {
      if (d.slice(0, 4) !== String(year)) return;
      var inWin = function (name) { return plan.some(function (p) { return p.name.indexOf(name) === 0 && d >= p.from && d <= p.to; }); };
      if (fcLow[d] != null && fcLow[d] <= 32 && d.slice(5) >= '04-01' && d.slice(5) <= '05-31') alerts.push(md(d) + ': forecast low ' + Math.round(fcLow[d]) + '°F during the frost window.');
      if (fcHigh[d] != null && fcHigh[d] >= 95 && d.slice(5) >= '06-01' && d.slice(5) <= '09-30') alerts.push(md(d) + ': forecast high ' + Math.round(fcHigh[d]) + '°F; hold leaf pulling and sulfur on exposed fruit.');
      if ((fcRain[d] || 0) >= 0.5 && (inWin('Protect bloom') || inWin('Harvest window'))) alerts.push(md(d) + ': ' + fcRain[d].toFixed(2) + ' in of rain forecast in the ' + (inWin('Harvest window') ? 'harvest window; pick the tightest Pinot noir blocks first' : 'bloom window; keep spray spacing tight') + '.');
    });
    var money = function (x) { return x ? '$' + Math.round(x).toLocaleString() : ''; };
    var ys = Object.keys(paths).map(Number).sort();
    var yearOpts = ys.concat(ys.indexOf(yNow + 1) < 0 ? [yNow + 1] : []);
    var dateCell = function (d, g) { return d ? md(d) + (g != null ? ' · ' + Math.round(g) : '') : ''; };

    return cmE('div', null,
      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 2 } }, 'Every year at this vineyard'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Date and heat (growing degree days from April 1, base 50°F) at each stage. Veraison uses the veraison tissue sampling date until veraison is logged in Field work.'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 700 } },
          cmE('thead', null, cmE('tr', null, ['Year'].concat(EV.map(function (e) { return e.name; })).concat(['Season heat', 'Rain Apr to Sep']).map(function (x, i) { return cmE('th', { key: x, style: i ? th : L(th) }, x); }))),
          cmE('tbody', null, ys.map(function (y) {
            var r = stages.filter(function (x) { return x.year === y; })[0] || {}, p = paths[y];
            return cmE('tr', { key: y }, cmE('td', { style: L(td) }, y + (p.complete ? '' : ' (so far)')), EV.map(function (e) { return cmE('td', { key: e.k, style: td }, dateCell(r[e.k], gddAt(p, r[e.k]))); }),
              cmE('td', { style: td }, Math.round(p.total)), cmE('td', { style: td }, p.rain.toFixed(1) + '"'));
          }).concat([cmE('tr', { key: 'typ' }, cmE('td', { style: Object.assign(L(td), { fontWeight: 700 }) }, 'Typical'), EV.map(function (e) {
            var v = stages.map(function (r) { return r[e.k]; }).filter(Boolean).map(function (d) { return +d.slice(5, 7) * 100 + +d.slice(8, 10); }).sort(function (a, b) { return a - b; });
            var f = function (x) { return Math.floor(x / 100) + '/' + (x % 100); };
            return cmE('td', { key: e.k, style: Object.assign({}, td, { fontWeight: 700 }) }, v.length ? f(v[Math.floor(v.length / 2)]) + ' (' + f(v[0]) + ' to ' + f(v[v.length - 1]) + ')' + (cal[e.k] ? ' · ' + Math.round(cal[e.k].gdd) : '') : (cal[e.k] ? 'about ' + Math.round(cal[e.k].gdd) + ' GDD' : ''));
          }), cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, Math.round(median(ys.filter(function (y) { return paths[y].complete; }).map(function (y) { return paths[y].total; })) || 0)), cmE('td', { style: td }))]))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, EV.filter(function (e) { return cal[e.k] && cal[e.k].n === 0; }).map(function (e) { return e.name + ': ' + cal[e.k].from + '.'; }).join(' '))),

      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' } },
          cmE('div', { style: { fontWeight: 700, flex: 1 } }, 'Forecast year ' + year + (seasonDone ? ' against the actual year' : '')),
          cmE('select', { value: year, onChange: function (ev) { setYear(+ev.target.value); }, style: { background: C.card, color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 6, padding: '3px 6px', fontSize: 12 } }, yearOpts.map(function (y) { return cmE('option', { key: y, value: y }, y); }))),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, past ? 'The forecast as it would have looked on April 1, built from the other years only (their heat at each stage and their weather), against what actually happened. The range finishes the season with each other year\'s weather.' : (lastKnown ? 'Actual weather to ' + md(lastKnown) + ', then ' : 'Starts from ') + (Object.keys(fc).length ? 'the 16-day forecast, then ' : '') + 'this vineyard\'s normal day by day' + (Object.keys(anom).length ? ', shifted by the ECMWF seasonal outlook (' + Object.keys(anom).sort().map(function (m) { return MONTHS[+m.slice(5) - 1] + ' ' + (anom[m] > 0 ? '+' : '') + anom[m].toFixed(1) + '°F'; }).join(', ') + ')' : '') + '. The range finishes the season with each past year\'s weather.'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 560 } },
          cmE('thead', null, cmE('tr', null, ['Stage', 'Heat it takes here', 'Forecast', 'Early to late', 'Actual', 'Forecast miss', 'Usual miss'].map(function (x, i) { return cmE('th', { key: x, style: i ? th : L(th) }, x); }))),
          cmE('tbody', null, EV.map(function (e) {
            var f = central.dates[e.k], a = actualYear[e.k], c = calY[e.k], rg = range[e.k];
            return cmE('tr', { key: e.k }, cmE('td', { style: L(td) }, e.name), cmE('td', { style: td }, c ? Math.round(c.gdd) + (c.n ? ' (' + c.n + ' yrs)' : ' (library)') : ''),
              cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, md(f) || 'not reached'), cmE('td', { style: td }, rg ? md(rg.early) + ' to ' + md(rg.late) : ''), cmE('td', { style: td }, md(a)),
              cmE('td', { style: Object.assign({}, td, { color: f && a && Math.abs(dayDiff(f, a)) > 7 ? C.orange : C.text }) }, f && a ? (dayDiff(f, a) > 0 ? '+' : '') + dayDiff(f, a) + ' d' : ''),
              cmE('td', { style: td }, mae[e.k] ? '±' + mae[e.k].avg.toFixed(0) + ' d (' + mae[e.k].n + ' yrs)' : ''));
          }))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Forecast miss: days the actual came after (+) or before (-) the forecast. Usual miss: average error when each past year is forecast on April 1 from the other years only.')),

      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Recommended work for ' + year),
        alerts.length ? cmE('div', { style: { margin: '2px 0 8px', padding: '6px 8px', borderRadius: 8, border: '1px solid ' + C.orange, fontSize: 12 } }, cmE('b', null, 'From the forecast: '), alerts.slice(0, 6).join(' ')) : null,
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 560 } },
          cmE('thead', null, cmE('tr', null, ['When', 'Work', 'Why and where to read more', 'Budget that month'].map(function (x, i) { return cmE('th', { key: x, style: i === 3 ? th : L(th) }, x); }))),
          cmE('tbody', null, plan.map(function (p, i) {
            var m = +p.from.slice(5, 7);
            return cmE('tr', { key: i }, cmE('td', { style: L(td) }, md(p.from) + (p.to !== p.from ? ' to ' + md(p.to) : '')), cmE('td', { style: Object.assign(L(td), { fontWeight: 700 }) }, p.name),
              cmE('td', { style: L(td) }, (p.why ? p.why + ' ' : ''), p.lib.map(function (sl) { var e = libBy[sl]; return e ? cmE('span', { key: sl, style: { color: C.accentLight } }, e.title + ' (' + (e.orgs || []).join(', ') + ')  ') : null; })),
              cmE('td', { style: td }, money(bud[m])));
          }))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Dates move as the season\'s weather comes in. Open the Vit library tab for the notes and the university sources behind each item.')));
  }

  window.cmGddPath = cmGddPath;
  window.cmCalibrate = cmCalibrate;
  window.cmProject = cmProject;
  window.cmNormalGdd = cmNormalGdd;
  window.cmBacktest = cmBacktest;
  window.cmOutlookPlan = cmOutlookPlan;
  window.CmOutlook = CmOutlook;
})();
