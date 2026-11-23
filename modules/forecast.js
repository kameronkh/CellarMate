/* CellarMate module: Forecast and spray planning
   Uses the Open-Meteo services (free, no key):
   - 16-day hourly forecast ("best match" blends the leading national models, including ECMWF
     IFS and NOAA GFS/HRRR) for temperature, humidity, rain and wind;
   - the ECMWF 51-member ensemble for the chance of rain each day (share of members with
     0.1 in or more), which is more honest than a single model run;
   - the ECMWF SEAS5 seasonal forecast (6 months) compared with this vineyard's own monthly
     averages, as an outlook for the coming season.
   From those it works out, day by day: powdery mildew pressure (Gubler-Thomas, continued from the
   index so far), Botrytis infection risk (Broome wetness and temperature model), and spray
   windows (dry, calm, not too hot or cold, no rain for 24 hours after). It also says when the
   next mildew spray is due from the last spray and the current pressure.
   Renders on Vine Blocks, Forecast and sprays (CmForecast). Pure helpers on window for the smoke
   tests: cmBotrytisDaily, cmSprayWindows, cmMildewForecast, cmSeasonalOutlook, cmNextSprayDue. */
(function () {
  'use strict';
  var BASE = 'https://api.open-meteo.com/v1/forecast', ENS = 'https://ensemble-api.open-meteo.com/v1/ensemble', SEAS = 'https://seasonal-api.open-meteo.com/v1/seasonal';
  var TZ = 'America%2FLos_Angeles';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function r1(x, d) { return x == null ? '' : Number(x).toFixed(d == null ? 1 : d); }
  function md(s) { return s ? +String(s).slice(5, 7) + '/' + +String(s).slice(8, 10) : ''; }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dayName(s) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(s + 'T12:00:00Z').getUTCDay()]; }
  function fToC(f) { return (f - 32) * 5 / 9; }

  /* Broome et al. (1995) Botrytis infection model: logit = -2.647866 - 0.374927 W + 0.061601 W T
     - 0.001511 W T^2, W = wet hours, T = mean temperature (°C) while wet. A wet hour here is rain
     or relative humidity of 90% or more. Levels used: under 0.2 low, 0.2 to 0.5 moderate, over 0.5
     high (likely infection). */
  function cmBotrytisDaily(times, tempF, rh, rain) {
    var by = {};
    (times || []).forEach(function (t, i) {
      var d = t.slice(0, 10), o = by[d] = by[d] || { date: d, wet: 0, tsum: 0 };
      var wet = (num(rain[i]) || 0) > 0 || (num(rh[i]) || 0) >= 90;
      if (wet && tempF[i] != null) { o.wet++; o.tsum += fToC(tempF[i]); }
    });
    return Object.keys(by).sort().map(function (d) {
      var o = by[d], W = o.wet, T = W ? o.tsum / W : 0;
      var z = -2.647866 - 0.374927 * W + 0.061601 * W * T - 0.001511 * W * T * T, p = W ? 1 / (1 + Math.exp(-z)) : 0;
      return { date: d, wetHours: W, wetTempF: W ? T * 9 / 5 + 32 : null, risk: p, level: p > 0.5 ? 'high' : p >= 0.2 ? 'moderate' : 'low' };
    });
  }

  /* Spray windows: daytime hours (6 am to 7 pm) with no rain, wind 10 mph or less, 45 to 85°F,
     and under 0.05 in of rain in the next 24 hours. Returns the longest run each day. */
  function cmSprayWindows(times, tempF, rain, wind, popAt) {
    var days = {};
    for (var i = 0; i < (times || []).length; i++) {
      var t = times[i], h = +t.slice(11, 13), d = t.slice(0, 10);
      var next24 = 0; for (var k = i; k < i + 24 && k < times.length; k++) next24 += num(rain[k]) || 0;
      var ok = h >= 6 && h <= 19 && !(num(rain[i]) > 0) && (num(wind[i]) || 0) <= 10 && tempF[i] >= 45 && tempF[i] <= 85 && next24 < 0.05 && (!popAt || (popAt[d] == null || popAt[d] < 40));
      var o = days[d] = days[d] || { date: d, best: null, run: null };
      if (ok) { if (!o.run) o.run = { from: t, to: t, hours: 0 }; o.run.to = t; o.run.hours++; if (!o.best || o.run.hours > o.best.hours) o.best = Object.assign({}, o.run); }
      else o.run = null;
    }
    return Object.keys(days).sort().map(function (d) { var b = days[d].best; return { date: d, hours: b ? b.hours : 0, from: b ? b.from.slice(11, 16) : null, to: b ? b.to.slice(11, 16) : null }; });
  }

  /* Continue the Gubler-Thomas index through the forecast days. start = index today (or null if
     not started this season); gtDays = [{date, gt, hot}] from the forecast. */
  function cmMildewForecast(start, streak0, gtDays) {
    var idx = start, started = start != null, streak = streak0 || 0;
    return (gtDays || []).map(function (d) {
      var good = d.gt >= 6, hot = (d.hot || 0) > 0;
      if (!started) { streak = good ? streak + 1 : 0; if (streak >= 3) { started = true; idx = 60; } }
      else { idx += good ? 20 : -10; if (hot) idx -= 10; idx = Math.max(0, Math.min(100, idx)); }
      return { date: d.date, index: started ? idx : null, level: !started ? 'none' : idx >= 60 ? 'high' : idx >= 40 ? 'moderate' : 'low' };
    });
  }

  /* When is the next mildew spray due? Spacing: high pressure about 10 days, moderate 14, low 21. */
  function cmNextSprayDue(lastSprayDate, index) {
    if (!lastSprayDate) return null;
    var gap = index == null ? null : index >= 60 ? 10 : index >= 40 ? 14 : 21;
    return gap == null ? null : { due: addDays(lastSprayDate, gap), gap: gap };
  }

  /* Seasonal outlook: members' monthly mean high and rain against this vineyard's normals. */
  function cmSeasonalOutlook(daily, normals) {
    if (!daily || !daily.time) return [];
    var keysT = Object.keys(daily).filter(function (k) { return /^temperature_2m_max_member/.test(k); });
    var keysP = Object.keys(daily).filter(function (k) { return /^precipitation_sum_member/.test(k); });
    var months = {};
    daily.time.forEach(function (t, i) {
      var m = t.slice(0, 7), o = months[m] = months[m] || { month: m, days: 0, tmax: [], rain: [] };
      o.days++;
      keysT.forEach(function (k, j) { o.tmax[j] = (o.tmax[j] || 0) + (num(daily[k][i]) || 0); });
      keysP.forEach(function (k, j) { o.rain[j] = (o.rain[j] || 0) + (num(daily[k][i]) || 0); });
    });
    return Object.keys(months).sort().map(function (m) {
      var o = months[m], mm = +m.slice(5, 7), nm = normals[mm] || {};
      var tm = o.tmax.map(function (x) { return x / o.days; }).sort(function (a, b) { return a - b; });
      var full = o.days >= 25, rn = o.rain.slice().sort(function (a, b) { return a - b; });
      var med = function (a) { return a.length ? a[Math.floor(a.length / 2)] : null; };
      var tMed = med(tm), rMed = med(rn);
      return { month: m, days: o.days, tmax: tMed, tLow: tm[Math.floor(tm.length * 0.1)], tHigh: tm[Math.floor(tm.length * 0.9)], tAnom: tMed != null && nm.tmax != null ? tMed - nm.tmax : null,
        rain: full ? rMed : null, rainPct: full && rMed != null && nm.rain ? 100 * rMed / nm.rain : null, members: tm.length };
    });
  }

  /* this vineyard's monthly normals from its own weather history */
  function normalsFrom(days) {
    var m = {}; (days || []).forEach(function (d) { var mo = +d.date.slice(5, 7), y = d.date.slice(0, 4), o = m[mo] = m[mo] || { t: 0, n: 0, rainBy: {} }; if (d.tmax != null) { o.t += d.tmax; o.n++; } o.rainBy[y] = (o.rainBy[y] || 0) + (num(d.p) || 0); });
    var out = {}; Object.keys(m).forEach(function (k) { var o = m[k], ys = Object.keys(o.rainBy); out[k] = { tmax: o.n ? o.t / o.n : null, rain: ys.length ? ys.reduce(function (a, y) { return a + o.rainBy[y]; }, 0) / ys.length : null }; });
    return out;
  }

  var cache = {};
  async function loadAll(site) {
    var k = site.id + '|' + new Date().toISOString().slice(0, 13); if (cache[k]) return cache[k];
    var ll = 'latitude=' + site.lat + '&longitude=' + site.lon;
    /* each call gives up after 25 s so a slow weather service never leaves the page loading */
    var to = function () { return window.AbortSignal && AbortSignal.timeout ? { signal: AbortSignal.timeout(25000) } : {}; };
    var a = await Promise.all([
      fetch(BASE + '?' + ll + '&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph&timezone=' + TZ + '&forecast_days=16', to()).then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch(ENS + '?' + ll + '&daily=precipitation_sum&models=ecmwf_ifs025&precipitation_unit=inch&timezone=' + TZ + '&forecast_days=15', to()).then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch(SEAS + '?' + ll + '&daily=temperature_2m_max,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=' + TZ, to()).then(function (r) { return r.json(); }).catch(function () { return null; })
    ]);
    if (!a[0] || !a[0].hourly) throw new Error('The forecast service (Open-Meteo) did not answer' + (a[0] && a[0].reason ? ': ' + a[0].reason : '') + '. The rest of the page works from saved weather; try again in a few minutes.');
    cache[k] = { fc: a[0], ens: a[1], seas: a[2] }; return cache[k];
  }
  function ensembleChance(ens) {
    var out = {}; if (!ens || !ens.daily) return out;
    var keys = Object.keys(ens.daily).filter(function (k) { return /^precipitation_sum/.test(k); });
    ens.daily.time.forEach(function (t, i) { var n = 0, wet = 0; keys.forEach(function (k) { var v = num(ens.daily[k][i]); if (v != null) { n++; if (v >= 0.1) wet++; } }); out[t] = n ? Math.round(100 * wet / n) : null; });
    return out;
  }

  function CmForecast(P) {
    var site = P.site;
    var s = React.useState(null), F = s[0], setF = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    React.useEffect(function () { if (!site || site.lat == null) return; var live = true; loadAll(site).then(function (x) { if (live) setF(x); }).catch(function (x) { if (live) setErr(x.message); }); return function () { live = false; }; }, [site && site.id]);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    if (!site || site.lat == null) return cmE('div', { style: card }, 'Add the vineyard location to get the forecast.');
    if (!F) return cmE('div', { style: card }, err || 'Loading the forecast...');
    var h = F.fc.hourly, d = F.fc.daily, pop = ensembleChance(F.ens);
    var bot = cmBotrytisDaily(h.time, h.temperature_2m, h.relative_humidity_2m, h.precipitation);
    var win = cmSprayWindows(h.time, h.temperature_2m, h.precipitation, h.wind_speed_10m, pop);
    var gtf = window.cmGtFromHourly ? window.cmGtFromHourly(h.time, h.temperature_2m) : {};
    /* index so far this season from the history (only in Apr to Sep) */
    var today = d.time[0], yr = today.slice(0, 4), inSeason = today.slice(5) >= '04-01' && today.slice(5) <= '09-30';
    var hist = (P.days || []).filter(function (x) { return x.date.slice(0, 4) === yr && x.date.slice(5) >= '04-01' && x.date < today; });
    var ser = window.cmMildewIndex ? window.cmMildewIndex(hist) : [], lastI = ser.filter(function (x) { return x.index != null; }).pop();
    var streak = 0; for (var q = ser.length - 1; q >= 0 && !ser[q].started; q--) { if (hist[q] && hist[q].gt >= 6) streak++; else break; }
    var mf = cmMildewForecast(lastI ? lastI.index : null, streak, d.time.map(function (t) { var g = gtf[t] || {}; return { date: t, gt: g.gt || 0, hot: g.hot || 0 }; }));
    var sprays = (P.sprays || []).filter(function (x) { return x.date && !x.skipped && (!x.vineyard || x.vineyard === site.name); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var last = sprays[sprays.length - 1];
    var nowIdx = mf.length ? mf[0].index : null;
    var due = inSeason && last && String(last.date).slice(0, 4) === yr ? cmNextSprayDue(last.date, nowIdx) : null;
    var goodBefore = due ? win.filter(function (w) { return w.hours >= 3 && w.date <= due.due; }).slice(0, 4) : [];
    var outlook = cmSeasonalOutlook(F.seas && F.seas.daily, normalsFrom(P.days));
    var colr = { high: C.red, moderate: C.orange, low: C.green, none: C.textDim };
    var th = { textAlign: 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var td = { textAlign: 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var L = function (o) { return Object.assign({}, o, { textAlign: 'left' }); };
    return cmE('div', null,
      cmE('div', { style: { fontSize: 15, fontWeight: 700, margin: '4px 0 8px' } }, 'Forecast and spray planning'),
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Next spray'),
        !inSeason ? cmE('div', { style: { fontSize: 12 } }, 'Out of the mildew season (Apr 1 to Sep 30). The planner picks up again at budbreak.')
          : !last || String(last.date).slice(0, 4) !== yr ? cmE('div', { style: { fontSize: 12 } }, 'No spray on file yet this season.' + (mf[0] && mf[0].index != null ? ' Mildew pressure is ' + mf[0].level + '.' : ''))
          : cmE('div', { style: { fontSize: 12 } }, 'Last spray ' + md(last.date) + '. Pressure ' + (mf[0] ? mf[0].level : 'unknown') + ', so the next spray is due by ', cmE('b', null, md(due && due.due)), ' (about every ' + (due && due.gap) + ' days).',
            goodBefore.length ? cmE('div', null, 'Good windows before then: ' + goodBefore.map(function (w) { return dayName(w.date) + ' ' + md(w.date) + ' ' + w.from + ' to ' + w.to; }).join(' · ')) : cmE('div', { style: { color: C.orange } }, 'No good spray window before it is due; look for the first dry, calm stretch.'))),
      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Next 16 days'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 660 } },
          cmE('thead', null, cmE('tr', null, ['Day', 'High', 'Low', 'Rain', 'Chance', 'Wind', 'Mildew', 'Botrytis', 'Spray window'].map(function (x, i) { return cmE('th', { key: x, style: i ? th : L(th) }, x); }))),
          cmE('tbody', null, d.time.map(function (t, i) {
            var b = bot.filter(function (x) { return x.date === t; })[0] || {}, w = win.filter(function (x) { return x.date === t; })[0] || {}, m = mf[i] || {};
            return cmE('tr', { key: t }, cmE('td', { style: L(td) }, dayName(t) + ' ' + md(t)), cmE('td', { style: td }, r1(d.temperature_2m_max[i], 0) + '°'), cmE('td', { style: td }, r1(d.temperature_2m_min[i], 0) + '°'),
              cmE('td', { style: td }, r1(d.precipitation_sum[i], 2) + '"'), cmE('td', { style: td }, pop[t] != null ? pop[t] + '%' : ''), cmE('td', { style: td }, r1(d.wind_speed_10m_max[i], 0) + ' mph'),
              cmE('td', { style: Object.assign({}, td, { color: colr[m.level] }) }, inSeason && m.index != null ? m.level + ' (' + m.index + ')' : '-'),
              cmE('td', { style: Object.assign({}, td, { color: t.slice(5) >= '04-01' && t.slice(5) <= '10-31' ? colr[b.level] : C.textDim }) }, t.slice(5) < '04-01' || t.slice(5) > '10-31' ? '-' : b.wetHours ? b.level + ' (' + b.wetHours + ' wet h)' : 'dry'),
              cmE('td', { style: Object.assign({}, td, { color: w.hours >= 3 ? C.green : C.textDim }) }, w.hours >= 3 ? w.from + ' to ' + w.to : 'none'));
          }))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Chance of rain = share of the 51 ECMWF ensemble members with 0.1 in or more. Mildew uses the Gubler-Thomas index (Apr to Sep). Botrytis uses the Broome wetness model (Apr to Oct); a wet hour is rain or humidity of 90% or more. Spray window = daytime hours that are dry, 45 to 85°F, wind 10 mph or less, with under 0.05 in of rain in the 24 hours after.')),
      outlook.length ? cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Seasonal outlook (ECMWF, next 6 months)'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 520 } },
          cmE('thead', null, cmE('tr', null, ['Month', 'Average high', 'Against normal', 'Range (most members)', 'Rain', 'Of normal'].map(function (x, i) { return cmE('th', { key: x, style: i ? th : L(th) }, x); }))),
          cmE('tbody', null, outlook.map(function (o) {
            var a = o.tAnom; return cmE('tr', { key: o.month }, cmE('td', { style: L(td) }, o.month + (o.days < 25 ? ' (part)' : '')), cmE('td', { style: td }, r1(o.tmax, 0) + '°F'),
              cmE('td', { style: Object.assign({}, td, { color: a == null ? C.text : a > 1 ? C.orange : a < -1 ? C.blue : C.text }) }, a == null ? '' : (a > 0 ? '+' : '') + r1(a, 1) + '°F'),
              cmE('td', { style: td }, r1(o.tLow, 0) + ' to ' + r1(o.tHigh, 0) + '°F'), cmE('td', { style: td }, o.rain != null ? r1(o.rain, 1) + '"' : ''),
              cmE('td', { style: Object.assign({}, td, { color: o.rainPct == null ? C.text : o.rainPct > 120 ? C.blue : o.rainPct < 80 ? C.orange : C.text }) }, o.rainPct != null ? Math.round(o.rainPct) + '%' : ''));
          }))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Seasonal forecasts show tendencies, not daily weather. Normal = this vineyard\'s own averages since 2017.')) : null);
  }

  window.cmBotrytisDaily = cmBotrytisDaily;
  window.cmSprayWindows = cmSprayWindows;
  window.cmMildewForecast = cmMildewForecast;
  window.cmNextSprayDue = cmNextSprayDue;
  window.cmSeasonalOutlook = cmSeasonalOutlook;
  window.CmForecast = CmForecast;
  window.cmForecastLoad = loadAll;
  window.cmNormalsFrom = normalsFrom;
})();
