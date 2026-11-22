/* CellarMate module: Powdery mildew pressure (Gubler-Thomas risk index)
   Uses hourly temperatures (Open-Meteo archive) reduced to two numbers per day and cached in
   cellarmate.weather_daily: gt_hours (longest run of hours between 70 and 85°F) and hot_hours
   (hours at 95°F or above).
   Index rules (UC Davis): it starts after 3 days in a row with 6+ hours at 70 to 85°F, at 60.
   Then each day with 6+ such hours adds 20, any other day takes off 10, and a day reaching
   95°F takes off another 10. Kept between 0 and 100. 0 to 30 low, 40 to 50 moderate, 60+ high.
   Spray spacing used for the coverage check (sulfur type products): high about 10 days,
   moderate about 14, low about 21.
   Renders inside the Vineyard screen (Estate). Pure helpers on window for the smoke tests. */
(function () {
  'use strict';
  var SEASON = ['04-01', '09-30'];
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }
  function db() { return supa.schema('cellarmate'); }

  /* hourly times + °F temps -> {date: {gt, hot}} */
  function cmGtFromHourly(times, temps) {
    var out = {};
    (times || []).forEach(function (t, i) {
      var d = t.slice(0, 10), v = temps[i]; var o = out[d] = out[d] || { gt: 0, hot: 0, run: 0, n: 0 };
      if (v == null) { o.run = 0; return; } o.n++;
      if (v >= 70 && v <= 85) { o.run++; if (o.run > o.gt) o.gt = o.run; } else o.run = 0;
      if (v >= 95) o.hot++;
    });
    Object.keys(out).forEach(function (d) { delete out[d].run; });
    return out;
  }

  /* days [{date, gt, hot}] for one season -> [{date, index, started}] */
  function cmMildewIndex(days) {
    var list = (days || []).filter(function (d) { return d.gt != null; }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var started = false, streak = 0, idx = 0, out = [];
    list.forEach(function (d) {
      var good = d.gt >= 6, hot = (d.hot || 0) > 0;
      if (!started) {
        streak = good ? streak + 1 : 0;
        if (streak >= 3) { started = true; idx = 60; }
      } else {
        idx += good ? 20 : -10; if (hot) idx -= 10; idx = Math.max(0, Math.min(100, idx));
      }
      out.push({ date: d.date, index: started ? idx : null, started: started });
    });
    return out;
  }
  function level(i) { return i == null ? 'none' : i >= 60 ? 'high' : i >= 40 ? 'moderate' : 'low'; }
  function allowed(i) { return i >= 60 ? 10 : i >= 40 ? 14 : 21; }

  /* Days with moderate or high pressure that are past the spray spacing for that pressure. */
  function cmMildewCoverage(series, sprays) {
    var dates = (sprays || []).map(function (s) { return s.date; }).filter(Boolean).sort();
    var gaps = [], cur = null;
    series.forEach(function (d) {
      if (d.index == null || d.index < 40) { cur = null; return; }
      var last = dates.filter(function (x) { return x <= d.date; }).pop();
      var since = last ? dayDiff(last, d.date) : null;
      if (since === null || since > allowed(d.index)) {
        if (cur && dayDiff(cur.to, d.date) === 1) { cur.to = d.date; cur.days++; cur.peak = Math.max(cur.peak, d.index); }
        else { cur = { from: d.date, to: d.date, days: 1, peak: d.index, lastSpray: last || null }; gaps.push(cur); }
      } else cur = null;
    });
    return gaps;
  }

  /* fill gt_hours / hot_hours for a season from the hourly archive */
  async function fillSeason(site, year) {
    var start = year + '-' + SEASON[0], endS = year + '-' + SEASON[1];
    var lim = addDays(new Date().toISOString().slice(0, 10), -3); var end = endS < lim ? endS : lim;
    if (start > end || site.lat == null) return {};
    var u = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + site.lat + '&longitude=' + site.lon + '&start_date=' + start + '&end_date=' + end +
      '&hourly=temperature_2m&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles';
    var r = await fetch(u); var j = await r.json(); if (!r.ok || !j.hourly) throw new Error('Weather service: ' + (j.reason || r.status));
    var per = cmGtFromHourly(j.hourly.time, j.hourly.temperature_2m);
    var rows = Object.keys(per).filter(function (d) { return per[d].n >= 20; }).map(function (d) { return { vineyard_id: site.id, organization_id: site.organization_id, date: d, gt_hours: per[d].gt, hot_hours: per[d].hot }; });
    if (site.organization_id) for (var i = 0; i < rows.length; i += 500) { var up = await db().from('weather_daily').upsert(rows.slice(i, i + 500), { onConflict: 'vineyard_id,date' }); if (up.error) break; }
    return per;
  }

  function CmMildew(P) {
    var s = React.useState(null), extra = s[0], setExtra = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    var years = (P.years || []).filter(function (y) { return y >= 2017; });
    React.useEffect(function () {
      var live = true, add = {};
      var need = years.filter(function (y) { return P.days.some(function (d) { return d.date.slice(0, 4) === String(y) && d.date.slice(5) >= SEASON[0] && d.date.slice(5) <= SEASON[1] && d.gt == null; }); });
      (async function () {
        for (var i = 0; i < need.length; i++) { try { Object.assign(add, await fillSeason(P.site, need[i])); } catch (x) { if (live) setErr(x.message); } }
        if (live) setExtra(add);
      })();
      return function () { live = false; };
    }, [P.site && P.site.id, years.join(',')]);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    if (!extra) return cmE('div', { style: card }, cmE('div', { style: { fontWeight: 700 } }, 'Powdery mildew pressure'), cmE('div', { style: small }, 'Reading hourly temperatures...'));
    var days = P.days.map(function (d) { var x = extra[d.date]; return x ? Object.assign({}, d, { gt: x.gt, hot: x.hot }) : d; });
    var colors = { high: C.red, moderate: C.orange, low: C.green };
    return cmE('div', { style: card },
      cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Powdery mildew pressure (Gubler-Thomas index)'),
      cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Built from hourly temperatures at the vineyard point, Apr 1 to Sep 30. Green line 30, orange line 60. Ticks along the bottom are sprays. Red stretches below the chart are moderate or high pressure days past the usual spray spacing (about 10 days at high, 14 at moderate).'),
      err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
      years.map(function (y) {
        var ser = cmMildewIndex(days.filter(function (d) { return d.date.slice(0, 4) === String(y) && d.date.slice(5) >= SEASON[0] && d.date.slice(5) <= SEASON[1]; }));
        if (!ser.length) return null;
        var sp = (P.sprays || []).filter(function (x) { return String(x.date).slice(0, 4) === String(y); });
        var gaps = cmMildewCoverage(ser, sp);
        var x0 = y + '-' + SEASON[0], W = 366, H = 70, X = function (d) { return 2 * dayDiff(x0, d); }, Y = function (v) { return H - 6 - (v / 100) * (H - 12); };
        var pts = ser.filter(function (d) { return d.index != null; }).map(function (d) { return X(d.date) + ',' + Y(d.index).toFixed(1); }).join(' ');
        var start = ser.filter(function (d) { return d.started; })[0];
        var high = ser.filter(function (d) { return d.index >= 60; }).length, mod = ser.filter(function (d) { return d.index >= 40 && d.index < 60; }).length;
        var gapDays = gaps.reduce(function (a, g) { return a + g.days; }, 0);
        return cmE('div', { key: y, style: { marginBottom: 8 } },
          cmE('div', { style: { fontSize: 12 } }, cmE('b', null, y + ': '), start ? 'index started ' + start.date.slice(5) + ' · ' + high + ' high days · ' + mod + ' moderate days · ' + sp.length + ' sprays on file' + (gapDays ? ' · ' : '') : 'index never started', gapDays ? cmE('span', { style: { color: C.red } }, gapDays + ' days past spray spacing') : null),
          cmE('svg', { viewBox: '0 0 ' + W + ' ' + (H + 8), style: { width: '100%', maxWidth: 720, height: 'auto', display: 'block' } },
            ['04', '05', '06', '07', '08', '09'].map(function (m) { var x = X(y + '-' + m + '-01'); return [cmE('line', { key: 'l' + m, x1: x, x2: x, y1: 0, y2: H, stroke: C.cardBorder, strokeWidth: 0.5 }), cmE('text', { key: 't' + m, x: x + 2, y: 8, fontSize: 7, fill: C.textDim }, ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'][+m - 4])]; }),
            cmE('line', { x1: 0, x2: W, y1: Y(30), y2: Y(30), stroke: C.green, strokeWidth: 0.5, strokeDasharray: '2,2' }),
            cmE('line', { x1: 0, x2: W, y1: Y(60), y2: Y(60), stroke: C.orange, strokeWidth: 0.5, strokeDasharray: '2,2' }),
            pts ? cmE('polyline', { points: pts, fill: 'none', stroke: C.accentLight, strokeWidth: 1.4 }) : null,
            sp.map(function (x, i) { var px = X(x.date); return cmE('line', { key: 's' + i, x1: px, x2: px, y1: H - 6, y2: H + 2, stroke: C.text, strokeWidth: 1.5 }); }),
            gaps.map(function (g, i) { return cmE('rect', { key: 'g' + i, x: X(g.from), y: H + 3, width: Math.max(2, 2 * g.days), height: 4, fill: C.red }); })),
          gaps.length ? cmE('div', { style: small }, gaps.slice(0, 6).map(function (g) { return g.from.slice(5) + (g.days > 1 ? ' to ' + g.to.slice(5) : '') + ' (' + level(g.peak) + ', last spray ' + (g.lastSpray ? g.lastSpray.slice(5) : 'none') + ')'; }).join(' · ') + (gaps.length > 6 ? ' · and ' + (gaps.length - 6) + ' more' : '')) : null);
      }));
  }

  window.cmGtFromHourly = cmGtFromHourly;
  window.cmMildewIndex = cmMildewIndex;
  window.cmMildewCoverage = cmMildewCoverage;
  window.CmMildew = CmMildew;
})();
