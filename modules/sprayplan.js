/* CellarMate module: Spray history against the weather, and product use estimates
   - One row per year: sprays and skips, first and last, average spacing, sprays followed by
     wash-off rain, and (where hourly weather is loaded) powdery mildew high-pressure days and days
     past the usual spacing. Shows how each season's weather pushed the program.
   - Product use: each spray's rate per acre times the acres sprayed, totalled per product and year,
     and an estimate for next year from the last three years' use per acre, scaled to today's acres,
     plus 10% for a wet year.
   Renders on Vine Blocks, Forecast and sprays (CmSprayHistory). Pure helpers on window for the
   smoke tests: cmProductUsage, cmUsageEstimate, cmUnit. */
(function () {
  'use strict';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function r1(x, d) { return x == null ? '' : Number(x).toFixed(d == null ? 1 : d); }
  function key(n) { return String(n || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function dayDiff(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }
  function cmUnit(u) {
    var s = String(u || '').toLowerCase();
    if (/fl|fluid/.test(s)) return 'fl oz'; if (/lb|pound/.test(s)) return 'lb'; if (/oz|ounce/.test(s)) return 'oz'; if (/gal/.test(s)) return 'gal'; if (/qt|quart/.test(s)) return 'qt'; if (/pt|pint/.test(s)) return 'pt';
    return s.replace(/\s*\/\s*a(cre)?\b.*$/, '').trim() || 'units';
  }

  /* sprays -> {productKey: {name, unit, years: {y: {amount, sprays, acres}}}} */
  function cmProductUsage(sprays, defaultAcres) {
    var out = {};
    (sprays || []).forEach(function (s) {
      if (!s.date || s.skipped) return;
      var y = +String(s.date).slice(0, 4), ac = num(s.acres) || defaultAcres || 0;
      (window.cmParseProducts ? window.cmParseProducts(s.products_rate_per_acre) : []).forEach(function (p) {
        if (p.rate == null) return;
        var k = key(p.name), u = cmUnit(p.unit), o = out[k] = out[k] || { key: k, name: p.name, unit: u, years: {} };
        var c = o.years[y] = o.years[y] || { amount: 0, sprays: 0, acres: 0 };
        c.amount += p.rate * ac; c.sprays++; c.acres = Math.max(c.acres, ac);
      });
    });
    return out;
  }

  /* next year's estimate from the last three years that used the product */
  function cmUsageEstimate(prod, acresNow, lastYear) {
    var ys = Object.keys(prod.years).map(Number).filter(function (y) { return !lastYear || y <= lastYear; }).sort(function (a, b) { return b - a; }).slice(0, 3);
    if (!ys.length) return null;
    var perAcre = ys.reduce(function (a, y) { var c = prod.years[y]; return a + (c.acres ? c.amount / c.acres : 0); }, 0) / ys.length;
    return { years: ys, perAcre: perAcre, amount: perAcre * acresNow * 1.1, sprays: Math.round(ys.reduce(function (a, y) { return a + prod.years[y].sprays; }, 0) / ys.length) };
  }

  function yearSummary(sprays, days, y) {
    var list = sprays.filter(function (s) { return String(s.date || s.vintage).slice(0, 4) === String(y) || s.vintage === y; });
    var done = list.filter(function (s) { return s.date && !s.skipped; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var gaps = []; for (var i = 1; i < done.length; i++) gaps.push(dayDiff(done[i - 1].date, done[i].date));
    var chk = window.cmSprayCheck ? window.cmSprayCheck(done, days) : [];
    var season = days.filter(function (d) { return d.date.slice(0, 4) === String(y) && d.date.slice(5) >= '04-01' && d.date.slice(5) <= '09-30'; });
    var haveGt = season.length > 150 && season.every(function (d) { return d.gt != null; });
    var ser = haveGt && window.cmMildewIndex ? window.cmMildewIndex(season) : null;
    var cov = ser && window.cmMildewCoverage ? window.cmMildewCoverage(ser, done) : null;
    return { year: y, sprays: done.length, skipped: list.length - done.length, first: done[0] && done[0].date, last: done.length ? done[done.length - 1].date : null,
      avgGap: gaps.length ? gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length : null, washoff: chk.filter(function (c) { return c.washoff; }).length,
      high: ser ? ser.filter(function (d) { return d.index >= 60; }).length : null, past: cov ? cov.reduce(function (a, g) { return a + g.days; }, 0) : null,
      rain: season.reduce(function (a, d) { return a + (num(d.p) || 0); }, 0) };
  }

  function CmSprayHistory(P) {
    var site = P.site;
    var s = React.useState(null), prods = s[0], setProds = s[1];
    React.useEffect(function () { cmFetch('spray_products').then(setProds).catch(function () { setProds([]); }); }, []);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var th = { textAlign: 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var td = { textAlign: 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var L = function (o) { return Object.assign({}, o, { textAlign: 'left' }); };
    if (!site) return null;
    var sprays = (P.sprays || []).filter(function (x) { return !x.vineyard || x.vineyard === site.name; });
    if (!sprays.length) return cmE('div', { style: card }, 'No spray records for ' + site.name + ' yet.');
    var years = {}; sprays.forEach(function (x) { var y = x.vintage || (x.date ? +String(x.date).slice(0, 4) : null); if (y) years[y] = 1; });
    var ys = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
    var rows = ys.map(function (y) { return yearSummary(sprays, P.days || [], y); });
    var acresNow = num(site.acres) || 14.2, lastFull = new Date().getFullYear() - (new Date().getMonth() < 10 ? 1 : 0);
    var usage = cmProductUsage(sprays, acresNow), U = Object.keys(usage).map(function (k) { return usage[k]; });
    var nextYear = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0);
    var P0 = {}; (prods || []).forEach(function (p) { P0[key(p.name)] = p; });
    var est = U.map(function (u) { return { u: u, e: cmUsageEstimate(u, acresNow, nextYear - 1) }; }).filter(function (x) { return x.e && x.e.years[0] >= nextYear - 3; })
      .sort(function (a, b) { return b.e.sprays - a.e.sprays || a.u.name.localeCompare(b.u.name); });
    var showYs = ys.slice(0, 5).sort();
    return cmE('div', null,
      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Spray history and the weather'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 680 } },
          cmE('thead', null, cmE('tr', null, ['Year', 'Sprays', 'Skipped', 'First', 'Last', 'Avg days apart', 'Rain Apr to Sep', 'Washed off', 'Mildew high days', 'Days past spacing'].map(function (x, i) { return cmE('th', { key: x, style: i ? th : L(th) }, x); }))),
          cmE('tbody', null, rows.map(function (r) {
            return cmE('tr', { key: r.year }, cmE('td', { style: L(td) }, r.year), cmE('td', { style: td }, r.sprays), cmE('td', { style: td }, r.skipped || ''), cmE('td', { style: td }, r.first ? r.first.slice(5) : ''), cmE('td', { style: td }, r.last ? r.last.slice(5) : ''),
              cmE('td', { style: td }, r1(r.avgGap, 1)), cmE('td', { style: td }, r.rain ? r1(r.rain, 1) + '"' : ''), cmE('td', { style: Object.assign({}, td, { color: r.washoff ? C.orange : C.text }) }, r.washoff || ''),
              cmE('td', { style: td }, r.high == null ? '-' : r.high), cmE('td', { style: Object.assign({}, td, { color: r.past ? C.red : C.text }) }, r.past == null ? '-' : r.past));
          }))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Washed off = 0.5 in of rain or more in the 3 days after a spray. Mildew columns fill in for years whose hourly weather is loaded (open the mildew chart with All years).')),
      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Product use and ' + nextYear + ' estimate'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Rate per acre times acres sprayed. The estimate averages the last three years\' use per acre, scales it to ' + acresNow + ' acres and adds 10% for a wetter year.'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 640 } },
          cmE('thead', null, cmE('tr', null, [cmE('th', { key: 'p', style: L(th) }, 'Product'), cmE('th', { key: 'u', style: L(th) }, 'Unit')].concat(showYs.map(function (y) { return cmE('th', { key: y, style: th }, y); })).concat([cmE('th', { key: 'e', style: th }, nextYear + ' estimate'), cmE('th', { key: 'n', style: th }, 'Sprays'), cmE('th', { key: 'l', style: L(th) }, 'LIVE')]))),
          cmE('tbody', null, est.map(function (x) {
            var p = P0[x.u.key];
            return cmE('tr', { key: x.u.key }, cmE('td', { style: L(td) }, x.u.name), cmE('td', { style: L(td) }, x.u.unit), showYs.map(function (y) { var c = x.u.years[y]; return cmE('td', { key: y, style: td }, c ? r1(c.amount, 0) : ''); }),
              cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, r1(x.e.amount, 0)), cmE('td', { style: td }, x.e.sprays), cmE('td', { style: Object.assign(L(td), { color: p && p.live_status === 'not allowed' ? C.red : C.textDim }) }, p ? p.live_status : 'not in list'));
          })))));
  }

  window.cmProductUsage = cmProductUsage;
  window.cmUsageEstimate = cmUsageEstimate;
  window.cmUnit = cmUnit;
  window.CmSprayHistory = CmSprayHistory;
})();
