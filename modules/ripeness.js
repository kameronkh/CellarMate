/* CellarMate module: Ripeness samples and harvest watch
   1. Berry samples (cellarmate.berry_samples): Brix, pH, TA and berry weight by vineyard and block
      through veraison and harvest, each shown against the heat units on the sample day.
      From the last few samples it works out Brix gained per 100 heat units and when the block
      should reach the target Brix.
   2. Harvest watch: for each Estate block, the heat it usually has when picked (history), the
      heat so far, and the projected date it gets there using actual weather, then the 10 day
      forecast, then normal weather. Rain in the forecast is listed. Shows on Today from Aug 1 to
      Oct 31, and always on the Vine Blocks screen.
   Needs vineyard.js (cmGddSeason, cmHarvestHistory, cmVineyardHeat, cmProjectRipe,
   cmWeatherFor, cmNormalDaily). Pure helpers on window for the smoke tests. */
(function () {
  'use strict';
  var TARGET_BRIX = 23.5;
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function r1(x, d) { return x == null ? '' : Number(x).toFixed(d == null ? 1 : d); }
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function db() { return supa.schema('cellarmate'); }

  /* Least squares slope of y on x. */
  function slope(pts) {
    if (pts.length < 2) return null; var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
    var d = n * sxx - sx * sx; return d ? (n * sxy - sx * sy) / d : null;
  }

  /* samples of one block in one season -> trend toward target Brix */
  function cmRipeTrend(samples, season, target) {
    var t = target || TARGET_BRIX;
    var pts = (samples || []).filter(function (s) { return num(s.brix) != null; }).slice().sort(function (a, b) { return a.sampled_on < b.sampled_on ? -1 : 1; })
      .map(function (s) { return { date: s.sampled_on, brix: num(s.brix), ph: num(s.ph), ta: num(s.ta_g_l), gdd: season ? season.at(s.sampled_on) : null }; });
    var last = pts[pts.length - 1] || null;
    var fit = pts.filter(function (p) { return p.gdd != null; }).slice(-4).map(function (p) { return { x: p.gdd, y: p.brix }; });
    var k = slope(fit); /* Brix per heat unit */
    var needGdd = last && k > 0 && last.gdd != null ? last.gdd + Math.max(0, t - last.brix) / k : null;
    return { points: pts, last: last, per100: k != null ? k * 100 : null, needGdd: needGdd, target: t, reached: !!(last && last.brix >= t) };
  }

  /* Estate blocks -> projected date each reaches its usual pick heat */
  function cmHarvestWatch(X) {
    var year = X.year, s = X.season, asOf = X.asOf;
    return (X.blocks || []).map(function (b) {
      var c = b.years && b.years[year], picked = c && c.dates.length ? c.dates.map(function (d) { return d.date; }).sort() : [];
      var have = s ? s.at(X.now || asOf) : null;
      var proj = s && b.gddPick ? window.cmProjectRipe(s, X.normal || {}, b.gddPick, asOf) : null;
      var tr = cmRipeTrend((X.samples || []).filter(function (x) { return x.block === b.block && x.vintage === year; }), s, X.targetBrix);
      var projB = s && tr.needGdd ? window.cmProjectRipe(s, X.normal || {}, tr.needGdd, tr.last.date > asOf ? tr.last.date : asOf) : null;
      return { block: b.block, clone: b.clone, acres: b.acres, usual: b.gddPick, have: have, toGo: b.gddPick != null && have != null ? Math.max(0, b.gddPick - have) : null,
        date: proj && proj.date, picked: picked, brix: tr.last && tr.last.brix, brixOn: tr.last && tr.last.date, per100: tr.per100, brixDate: projB && projB.date };
    }).sort(function (a, b) { return (a.picked.length - b.picked.length) || String(a.date || '9').localeCompare(String(b.date || '9')); });
  }

  async function forecast(site) {
    var u = 'https://api.open-meteo.com/v1/forecast?latitude=' + site.lat + '&longitude=' + site.lon + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FLos_Angeles&past_days=5&forecast_days=10';
    var r = await fetch(u, window.cmWxOpts ? window.cmWxOpts() : {}); var j = await r.json(); if (!r.ok || !j.daily) throw new Error('Forecast: ' + (j.reason || r.status));
    var D = j.daily; return D.time.map(function (t, i) { return { date: t, tmax: D.temperature_2m_max[i], tmin: D.temperature_2m_min[i], p: D.precipitation_sum[i], pp: D.precipitation_probability_max ? D.precipitation_probability_max[i] : null }; });
  }
  function merge(arch, fc) { var have = {}; arch.forEach(function (d) { have[d.date] = 1; }); return arch.concat(fc.filter(function (d) { return !have[d.date]; })).sort(function (a, b) { return a.date < b.date ? -1 : 1; }); }

  var card = function () { return { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }; };
  var small = function () { return { fontSize: 11, color: C.textDim }; };
  var th = function (left) { return { textAlign: left ? 'left' : 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' }; };
  var td = function (left, color) { return { textAlign: left ? 'left' : 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap', color: color || C.text }; };

  /* ── Harvest watch (Today from Aug 1 to Oct 31, and Vine Blocks always) ── */
  function CmHarvestWatch(P) {
    P = P || {};
    var asOf = P.asOf || today(), m = +asOf.slice(5, 7);
    var show = P.always || (m >= 8 && m <= 10);
    var s = React.useState(null), D = s[0], setD = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    React.useEffect(function () {
      if (!show) return; var live = true;
      Promise.all(['vineyards', 'vineyard_blocks', 'estate_harvests', 'picks', 'berry_samples'].map(function (t) { return cmFetch(t); })).then(async function (a) {
        var site = a[0].filter(function (v) { return v.owner_type === 'estate'; })[0]; if (!site) throw new Error('No Estate vineyard on file.');
        var w = await window.cmWeatherFor(site), fc = [];
        try { fc = await forecast(site); } catch (x) { if (live) setErr(x.message); }
        if (live) setD({ site: site, a: a, days: merge(w.days, fc), arch: w.days, fc: fc });
      }).catch(function (x) { if (live) setErr(x.message); });
      return function () { live = false; };
    }, [show]);
    if (!show) return null;
    if (!D) return cmE('div', { style: card() }, cmE('div', { style: { fontWeight: 700 } }, 'Harvest watch'), cmE('div', { style: small() }, err || 'Loading weather and block history...'));
    var year = +asOf.slice(0, 4);
    var seasons = window.cmGddSeason(D.days), season = seasons[year];
    var H = window.cmVineyardHeat(window.cmHarvestHistory({ blocks: D.a[1], estate: D.a[2], picks: D.a[3] }), window.cmGddSeason(D.arch));
    var lastFc = D.days.length ? D.days[D.days.length - 1].date : asOf;
    var rows = cmHarvestWatch({ blocks: H.blocks, season: season, normal: window.cmNormalDaily(D.arch, year), asOf: lastFc, now: asOf, year: year, samples: D.a[4] });
    var t = today(), rain = D.fc.filter(function (d) { return d.date > t && (d.p || 0) >= 0.1; });
    var nowHeat = season ? season.at(asOf) : null;
    return cmE('div', { style: Object.assign(card(), { overflowX: 'auto' }) },
      cmE('div', { style: { fontWeight: 700 } }, 'Harvest watch: Estate ' + year),
      cmE('div', { style: Object.assign(small(), { marginBottom: 6 }) }, 'Heat units so far: ' + r1(nowHeat, 0) + '. Projected dates use actual weather, then the 10 day forecast, then normal weather, up to the heat each block usually has when picked. The Brix date uses the last samples and a ' + TARGET_BRIX + ' Brix target.'),
      err ? cmE('div', { style: { color: C.orange, fontSize: 12 } }, err) : null,
      cmE('div', { style: { fontSize: 12, marginBottom: 6 } }, cmE('b', null, 'Rain in the forecast: '), rain.length ? rain.map(function (d) { return d.date.slice(5) + ' ' + r1(d.p, 2) + '"' + (d.pp != null ? ' (' + d.pp + '%)' : ''); }).join(' · ') : 'none of 0.1 in or more in the next 10 days'),
      cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 620 } },
        cmE('thead', null, cmE('tr', null, ['Block', 'Usual pick heat', 'Heat now', 'To go', 'Projected by heat', 'Last Brix', 'Brix per 100 heat', 'Projected by Brix'].map(function (h, i) { return cmE('th', { key: h, style: th(i === 0) }, h); }))),
        cmE('tbody', null, rows.map(function (r) {
          var soon = !r.picked.length && r.date && r.date <= addDays(t, 7);
          return cmE('tr', { key: r.block }, cmE('td', { style: td(true) }, r.block + ' · ' + (r.clone || '')), cmE('td', { style: td() }, r1(r.usual, 0)), cmE('td', { style: td() }, r1(r.have, 0)),
            cmE('td', { style: td() }, r.picked.length ? '' : r1(r.toGo, 0)),
            cmE('td', { style: td(false, r.picked.length ? C.textDim : soon ? C.orange : C.text) }, r.picked.length ? 'picked ' + r.picked.map(function (d) { return d.slice(5); }).join(', ') : r.date ? r.date.slice(5) : 'after Oct 31'),
            cmE('td', { style: td() }, r.brix != null ? r1(r.brix) + ' (' + r.brixOn.slice(5) + ')' : ''), cmE('td', { style: td() }, r1(r.per100, 2)), cmE('td', { style: td() }, r.brixDate ? r.brixDate.slice(5) : ''));
        }))));
  }

  /* ── Ripeness samples (Vine Blocks) ── */
  function CmRipeness(P) {
    var s = React.useState(null), rows = s[0], setRows = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    var yr = new Date().getFullYear();
    var vs = React.useState(null), vint = vs[0], setVint = vs[1];
    var fs = React.useState({ sampled_on: today(), block: '', brix: '', ph: '', ta_g_l: '', berry_wt_g: '', note: '' }), f = fs[0], setF = fs[1];
    var load = function () { if (typeof CM_CACHE !== 'undefined') delete CM_CACHE.berry_samples; return cmFetch('berry_samples').then(setRows).catch(function (x) { setErr(x.message); }); };
    React.useEffect(function () { load(); }, []);
    if (!rows) return null;
    var mine = rows.filter(function (r) { return r.vineyard === P.vineyard; });
    var years = cmUniq(mine.map(function (r) { return r.vintage; }).concat([yr])).sort().reverse();
    var v = vint || years[0];
    var list = mine.filter(function (r) { return r.vintage === v; });
    var season = P.seasons && P.seasons[v];
    var groups = {}; list.forEach(function (r) { var k = r.block || 0; (groups[k] = groups[k] || []).push(r); });
    var inp = { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' };
    var fld = function (k, label, type) { return cmE('label', { key: k, style: { flex: '1 1 90px', fontSize: 11, color: C.textDim } }, label, cmE('input', { type: type || 'number', step: 'any', value: f[k], onChange: function (ev) { var o = Object.assign({}, f); o[k] = ev.target.value; setF(o); }, style: inp })); };
    var save = function () {
      var org = P.site && P.site.organization_id; if (!org || num(f.brix) == null) { setErr('Enter at least a Brix reading.'); return; }
      var row = { organization_id: org, vintage: +f.sampled_on.slice(0, 4), sampled_on: f.sampled_on, vineyard: P.vineyard, block: f.block ? +f.block : null, brix: num(f.brix), ph: num(f.ph), ta_g_l: num(f.ta_g_l), berry_wt_g: num(f.berry_wt_g), note: f.note || null, sampled_by: (typeof CM_ME !== 'undefined' && CM_ME && CM_ME.full_name) || null };
      db().from('berry_samples').insert(row).then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); setF(Object.assign({}, f, { brix: '', ph: '', ta_g_l: '', berry_wt_g: '', note: '' })); load(); } });
    };
    var del = function (id) { if (!confirm('Delete this sample?')) return; db().from('berry_samples').delete().eq('id', id).then(function (r) { if (r.error) setErr(r.error.message); else load(); }); };
    return cmE('div', { style: Object.assign(card(), { overflowX: 'auto' }) },
      cmE('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } }, cmE('div', { style: { fontWeight: 700, flex: 1 } }, 'Ripeness samples'),
        cmE('select', { value: v, onChange: function (ev) { setVint(+ev.target.value); }, style: Object.assign({}, cmSel, { flex: '0 0 100px' }) }, years.map(function (y) { return cmE('option', { key: y, value: y }, y); }))),
      cmE('div', { style: Object.assign(small(), { marginBottom: 6 }) }, 'Log berry samples before harvest. Each one shows the heat units on that day; with two or more, the app works out Brix gained per 100 heat units and the date the block should reach ' + TARGET_BRIX + ' Brix.'),
      err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
      cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 } },
        cmE('label', { style: { flex: '1 1 120px', fontSize: 11, color: C.textDim } }, 'Sampled on', cmE('input', { type: 'date', value: f.sampled_on, onChange: function (ev) { setF(Object.assign({}, f, { sampled_on: ev.target.value })); }, style: inp })),
        (P.blocks || []).length && P.vineyard === 'Tystrya Estate' ? cmE('label', { style: { flex: '1 1 110px', fontSize: 11, color: C.textDim } }, 'Block', cmE('select', { value: f.block, onChange: function (ev) { setF(Object.assign({}, f, { block: ev.target.value })); }, style: inp }, [cmE('option', { key: '', value: '' }, 'Whole vineyard')].concat(P.blocks.map(function (b) { return cmE('option', { key: b.block, value: b.block }, b.block + ' · ' + (b.clone || '')); })))) : null,
        fld('brix', 'Brix'), fld('ph', 'pH'), fld('ta_g_l', 'TA g/L'), fld('berry_wt_g', 'Berry wt g'), fld('note', 'Note', 'text'),
        cmE('button', { onClick: save, style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' } }, 'Add sample')),
      !list.length ? cmE('div', { style: small() }, 'No samples for ' + P.vineyard + ' in ' + v + ' yet.') :
      cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 560 } },
        cmE('thead', null, cmE('tr', null, ['Block', 'Date', 'Heat', 'Brix', 'pH', 'TA', 'Berry g', 'Trend', ''].map(function (h, i) { return cmE('th', { key: h + i, style: th(i < 2) }, h); }))),
        cmE('tbody', null, Object.keys(groups).sort(function (a, b) { return a - b; }).map(function (k) {
          var g = groups[k], tr = cmRipeTrend(g, season);
          var proj = season && tr.needGdd && window.cmProjectRipe ? window.cmProjectRipe(season, P.normal || {}, tr.needGdd, tr.last.date) : null;
          return g.slice().sort(function (a, b) { return a.sampled_on < b.sampled_on ? -1 : 1; }).map(function (r, i, all) {
            var lastRow = i === all.length - 1;
            return cmE('tr', { key: r.id }, cmE('td', { style: td(true) }, i === 0 ? (+k ? 'Block ' + k : 'Whole vineyard') : ''), cmE('td', { style: td(true) }, r.sampled_on.slice(5)),
              cmE('td', { style: td() }, season ? r1(season.at(r.sampled_on), 0) : ''), cmE('td', { style: td() }, r1(r.brix)), cmE('td', { style: td() }, r1(r.ph, 2)), cmE('td', { style: td() }, r1(r.ta_g_l, 1)), cmE('td', { style: td() }, r1(r.berry_wt_g, 2)),
              cmE('td', { style: td(false, tr.reached ? C.green : C.text) }, lastRow ? (tr.reached ? 'at target' : tr.per100 != null ? '+' + r1(tr.per100, 2) + ' per 100 heat' + (proj && proj.date ? ', ' + TARGET_BRIX + ' by ' + proj.date.slice(5) : '') : '') : ''),
              cmE('td', { style: td() }, cmE('span', { onClick: function () { del(r.id); }, style: { color: C.textDim, cursor: 'pointer' } }, '×')));
          });
        }))));
  }

  window.cmRipeTrend = cmRipeTrend;
  window.cmHarvestWatch = cmHarvestWatch;
  window.CmHarvestWatch = CmHarvestWatch;
  window.CmRipeness = CmRipeness;
})();
