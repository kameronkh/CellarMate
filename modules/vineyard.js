/* CellarMate module: Vineyard weather and harvest
   Lives on the vineyard side (Vine Blocks screen).
   1. Weather per vineyard location (Open-Meteo daily archive, cached in cellarmate.weather_daily):
      heat units (growing degree days, base 50°F, Apr 1 to Oct 31), rain by month, rain events
      in Aug to Oct, hot days.
   2. Harvest against history: Estate tons and tons per acre by block and year (estate_harvests),
      grower tons by vintage (picks), and the heat units each block had reached when picked.
   3. Crop estimates (harvest_estimates): estimate against target tons per acre, against history,
      against the actual harvest, and a projected ripe date against the target pick window.
   4. Spray program against rain (wash-off) and heat units between sprays (vineyard_sprays).
   Pure helpers are on window for the smoke tests: cmGddSeason, cmHarvestHistory, cmProjectRipe,
   cmCropCheck, cmSprayCheck. */
(function () {
  'use strict';
  var BASE = 50, START = '2017-01-01';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function r1(x, d) { return x == null ? '' : Number(x).toFixed(d == null ? 1 : d); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function mmdd(s) { return String(s || '').slice(5, 10); }
  function db() { return supa.schema('cellarmate'); }
  function gddOf(d) { if (d.tmax == null || d.tmin == null) return 0; return Math.max(0, (d.tmax + d.tmin) / 2 - BASE); }

  /* days: [{date, tmax, tmin, p}] sorted. Returns {year: {...}} */
  function cmGddSeason(days) {
    var out = {};
    (days || []).forEach(function (d) {
      var y = d.date.slice(0, 4), m = +d.date.slice(5, 7), md = mmdd(d.date);
      var o = out[y] = out[y] || { year: +y, gdd: 0, rain: 0, rainSep: 0, rainOct: 0, months: {}, hot95: 0, cum: {}, events: [], lastDate: null };
      var p = num(d.p) || 0;
      if (md >= '04-01' && md <= '10-31') { o.gdd += gddOf(d); o.rain += p; }
      o.cum[d.date] = o.gdd;
      o.months[m] = (o.months[m] || 0) + p;
      if (m === 9) o.rainSep += p; if (m === 10) o.rainOct += p;
      if (m >= 6 && m <= 9 && d.tmax >= 95) o.hot95++;
      if (m >= 8 && m <= 10 && p >= 0.25) o.events.push({ date: d.date, p: p });
      o.lastDate = d.date;
    });
    Object.keys(out).forEach(function (y) {
      var o = out[y];
      o.at = function (date) { if (o.cum[date] != null) return o.cum[date]; var k = Object.keys(o.cum).filter(function (x) { return x <= date; }).sort(); return k.length ? o.cum[k[k.length - 1]] : null; };
    });
    return out;
  }

  /* Average daily heat units by month-day across the given seasons (for projecting ahead). */
  function normalDaily(days, skipYear) {
    var s = {}, n = {};
    (days || []).forEach(function (d) { if (skipYear && d.date.slice(0, 4) === String(skipYear)) return; var k = mmdd(d.date); s[k] = (s[k] || 0) + gddOf(d); n[k] = (n[k] || 0) + 1; });
    var o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k] / n[k]; }); return o;
  }

  /* When will the season reach `need` heat units? Uses actual heat to asOf, then normal days. */
  function cmProjectRipe(season, normal, need, asOf) {
    if (!season || need == null) return null;
    var have = season.at(asOf) || 0; if (have >= need) { var hit = Object.keys(season.cum).sort().filter(function (k) { return season.cum[k] >= need; })[0]; return { date: hit || asOf, reached: true }; }
    var d = asOf;
    for (var i = 0; i < 200; i++) { d = addDays(d, 1); if (mmdd(d) > '10-31') return { date: null, reached: false, short: need - have }; have += normal[mmdd(d)] || 0; if (have >= need) return { date: d, reached: false }; }
    return null;
  }

  function blockList(b) { return String(b || '').split(/[\/,&+ ]+/).map(function (x) { return x.replace(/[^\d]/g, ''); }).filter(Boolean).map(Number); }
  function vineyardOf(v) { var s = String(v || '').trim(); if (!s || /not (noted|recorded)/i.test(s)) return null; return /tystrya/i.test(s) ? 'Tystrya Estate' : s.replace(/\s*\(as written\)/i, ''); }

  /* Estate history by block and year, grower tons by vintage, heat units at pick. */
  function cmHarvestHistory(X) {
    var blocks = {}, years = {};
    (X.blocks || []).forEach(function (b) { blocks[b.block] = { block: b.block, clone: b.clone, variety: b.variety, acres: num(b.acres), planted: b.planted, years: {} }; });
    (X.estate || []).forEach(function (h) {
      var b = blocks[h.block] = blocks[h.block] || { block: h.block, clone: '', acres: null, years: {} };
      var c = b.years[h.year] = b.years[h.year] || { tons: 0, hasTons: false, dates: [], missing: 0, sold: 0 };
      years[h.year] = 1;
      if (num(h.tons) === null) c.missing++; else { c.tons += num(h.tons); c.hasTons = true; if (/sold/i.test(h.category || '')) c.sold += num(h.tons); }
      if (h.date) c.dates.push({ date: h.date, tons: num(h.tons) || 0 });
    });
    var Y = Object.keys(years).map(Number).sort();
    Object.keys(blocks).forEach(function (k) {
      var b = blocks[k];
      Y.forEach(function (y) { var c = b.years[y]; if (c && c.hasTons && b.acres) c.tpa = c.tons / b.acres; });
      b.avgTpa = function (exceptYear) { var v = Y.filter(function (y) { return y !== exceptYear; }).map(function (y) { return b.years[y] && b.years[y].tpa; }).filter(function (x) { return x > 0; }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null; };
      b.maxTpa = function (exceptYear) { var v = Y.filter(function (y) { return y !== exceptYear; }).map(function (y) { return b.years[y] && b.years[y].tpa; }).filter(function (x) { return x > 0; }); return v.length ? Math.max.apply(null, v) : null; };
    });
    var growers = {};
    (X.picks || []).forEach(function (p) { var v = vineyardOf(p.vineyard); if (!v || v === 'Tystrya Estate' || !p.vintage) return; var g = growers[v] = growers[v] || { vineyard: v, years: {} }; var c = g.years[p.vintage] = g.years[p.vintage] || { tons: 0, picks: 0, first: null, last: null }; c.tons += num(p.tons) || 0; c.picks++; if (p.date) { if (!c.first || p.date < c.first) c.first = p.date; if (!c.last || p.date > c.last) c.last = p.date; } });
    return { years: Y, blocks: Object.keys(blocks).map(function (k) { return blocks[k]; }).sort(function (a, b) { return a.block - b.block; }), growers: Object.keys(growers).sort().map(function (k) { return growers[k]; }) };
  }

  /* Heat units at pick for each block-year (tons weighted), plus the block's average. */
  function heatAtPick(H, seasons) {
    H.blocks.forEach(function (b) {
      var all = [];
      H.years.forEach(function (y) {
        var c = b.years[y], s = seasons[y]; if (!c || !s || !c.dates.length) return;
        var w = 0, t = 0; c.dates.forEach(function (d) { var g = s.at(d.date); if (g == null) return; var k = d.tons || 0.0001; w += k; t += g * k; });
        if (w) { c.gddPick = t / w; all.push(c.gddPick); }
      });
      b.gddPick = all.length ? all.reduce(function (s, x) { return s + x; }, 0) / all.length : null;
    });
    return H;
  }

  /* One crop estimate against target, history, actual and the window. */
  function cmCropCheck(e, X) {
    var flags = [], acres = num(X.acres), est = num(e.est_tons), target = num(e.target_tons_acre) || num(X.target);
    var tpa = est != null && acres ? est / acres : null;
    if (tpa != null && target) {
      if (tpa > target * 1.1) flags.push({ level: 'warn', text: 'Estimate ' + r1(tpa, 2) + ' t/ac is over the ' + r1(target, 2) + ' t/ac target. Dropping about ' + r1(est - target * acres, 2) + ' t would bring it to target.' });
      else if (tpa < target * 0.8) flags.push({ level: 'info', text: 'Estimate ' + r1(tpa, 2) + ' t/ac is well under the ' + r1(target, 2) + ' t/ac target.' });
      else flags.push({ level: 'ok', text: 'Estimate ' + r1(tpa, 2) + ' t/ac is on target (' + r1(target, 2) + ').' });
    }
    if (tpa != null && X.maxTpa && tpa > X.maxTpa * 1.05) flags.push({ level: 'warn', text: 'Heavier than any year on file (best was ' + r1(X.maxTpa, 2) + ' t/ac). Heavy crops ripen later.' });
    if (est != null && X.actual != null) { var diff = X.actual - est; flags.push({ level: Math.abs(diff) > est * 0.15 ? 'warn' : 'ok', text: 'Actual ' + r1(X.actual, 2) + ' t against estimate ' + r1(est, 2) + ' t (' + (diff >= 0 ? '+' : '') + r1(100 * diff / est, 0) + '%).' }); }
    if (X.proj && X.windowEnd) {
      var lead = X.proj.reached ? 'Reached its usual pick heat on ' : 'Projected to reach its usual pick heat on ';
      if (X.proj.date && X.proj.date > X.windowEnd) flags.push({ level: 'warn', text: lead + X.proj.date + ', after the window closes ' + X.windowEnd + '.' });
      else if (!X.proj.date) flags.push({ level: 'warn', text: 'At normal weather this block would not reach its usual pick heat by Oct 31.' });
      else flags.push({ level: 'ok', text: lead + X.proj.date + ', inside the window.' });
    }
    return { tpa: tpa, flags: flags };
  }


  /* Spray program against the weather: days since the last spray, rain in the 3 days after
     (0.5 in or more may wash it off), and heat units between sprays. */
  function cmSprayCheck(sprays, days) {
    var byDate = {}; (days || []).forEach(function (d) { byDate[d.date] = d; });
    var list = (sprays || []).filter(function (s) { return s.date; }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return list.map(function (s, i) {
      var prev = list[i - 1], rain = 0, heat = null, have = 0;
      for (var k = 1; k <= 3; k++) { var d = byDate[addDays(s.date, k)]; if (d) { rain += num(d.p) || 0; have++; } }
      if (prev) { heat = 0; for (var x = addDays(prev.date, 1); x <= s.date; x = addDays(x, 1)) { if (byDate[x]) heat += gddOf(byDate[x]); } }
      var gap = prev ? Math.round((new Date(s.date) - new Date(prev.date)) / 864e5) : null;
      return { spray: s.spray, date: s.date, stage: s.growth_stage, reason: s.reason, products: s.products_rate_per_acre, gap: gap, heat: heat, rain3: have ? rain : null, washoff: have > 0 && rain >= 0.5 };
    });
  }

  /* ── weather cache ── */
  async function loadCached(siteId) {
    var out = [], from = 0;
    while (true) {
      var r = await db().from('weather_daily').select('date,tmax_f,tmin_f,precip_in').eq('vineyard_id', siteId).order('date').range(from, from + 999);
      if (r.error) throw new Error(r.error.message);
      out = out.concat(r.data || []); if (!r.data || r.data.length < 1000) break; from += 1000;
    }
    return out.map(function (d) { return { date: d.date, tmax: num(d.tmax_f), tmin: num(d.tmin_f), p: num(d.precip_in) }; });
  }
  async function fetchArchive(lat, lon, start, end) {
    var u = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat + '&longitude=' + lon + '&start_date=' + start + '&end_date=' + end +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FLos_Angeles';
    var r = await fetch(u); var j = await r.json(); if (!r.ok || !j.daily) throw new Error('Weather service: ' + (j.reason || r.status));
    var D = j.daily; return D.time.map(function (t, i) { return { date: t, tmax: D.temperature_2m_max[i], tmin: D.temperature_2m_min[i], p: D.precipitation_sum[i] }; }).filter(function (d) { return d.tmax != null; });
  }
  async function cmWeatherFor(site) {
    var have = await loadCached(site.id);
    var end = addDays(iso(new Date()), -3), last = have.length ? have[have.length - 1].date : null, start = last ? addDays(last, 1) : START;
    if (start > end || site.lat == null) return { days: have, added: 0 };
    var fresh = await fetchArchive(site.lat, site.lon, start, end);
    for (var i = 0; i < fresh.length; i += 1000) {
      var rows = fresh.slice(i, i + 1000).map(function (d) { return { vineyard_id: site.id, organization_id: site.organization_id, date: d.date, tmax_f: d.tmax, tmin_f: d.tmin, precip_in: d.p }; });
      var up = await db().from('weather_daily').upsert(rows, { onConflict: 'vineyard_id,date' }); if (up.error) break; /* read-only users still see fresh data */
    }
    return { days: have.concat(fresh), added: fresh.length };
  }

  /* ── screen ── */
  function CmVineyard() {
    var s = React.useState(null), D = s[0], setD = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    var vs = React.useState('Tystrya Estate'), vy = vs[0], setVy = vs[1];
    var ws = React.useState({}), W = ws[0], setW = ws[1];
    var ys = React.useState('recent'), span = ys[0], setSpan = ys[1];
    var fs = React.useState({ vintage: new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0), block: '', est_tons: '', target_tons_acre: '', est_date: '', method: '', note: '' }), form = fs[0], setForm = fs[1];
    var ls = React.useState(null), edit = ls[0], setEdit = ls[1];
    var reload = function () {
      ['vineyards', 'harvest_estimates'].forEach(function (t) { if (typeof CM_CACHE !== 'undefined') delete CM_CACHE[t]; });
      return Promise.all(['vineyards', 'vineyard_blocks', 'estate_harvests', 'picks', 'harvest_estimates', 'vineyard_sprays'].map(function (t) { return cmFetch(t); }))
        .then(function (a) { setD({ sites: a[0], H: cmHarvestHistory({ blocks: a[1], estate: a[2], picks: a[3] }), picks: a[3], est: a[4], sprays: a[5] }); })
        .catch(function (x) { setErr(x.message); });
    };
    React.useEffect(function () { reload(); }, []);
    var site = D && (D.sites.filter(function (x) { return x.name === vy; })[0]);
    var estate = D && D.sites.filter(function (x) { return x.owner_type === 'estate'; })[0];
    var wsite = site && site.lat != null ? site : estate;
    React.useEffect(function () {
      if (!wsite || W[wsite.id]) return; var live = true;
      setW(function (o) { var n = Object.assign({}, o); n[wsite.id] = { loading: true }; return n; });
      cmWeatherFor(wsite).then(function (r) { if (live) setW(function (o) { var n = Object.assign({}, o); n[wsite.id] = { days: r.days, added: r.added }; return n; }); })
        .catch(function (x) { if (live) setW(function (o) { var n = Object.assign({}, o); n[wsite.id] = { error: x.message }; return n; }); });
      return function () { live = false; };
    }, [wsite && wsite.id]);
    if (!D) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, err || 'Loading vineyard data...');

    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var th = { textAlign: 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var td = { textAlign: 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var L = function (o) { return Object.assign({}, o, { textAlign: 'left' }); };
    var btn = { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontWeight: 600, fontSize: 12 };
    var inp = { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' };
    var flagC = { warn: C.orange, info: C.blue, ok: C.green };

    var wx = wsite && W[wsite.id] || {}, seasons = wx.days ? cmGddSeason(wx.days) : {};
    var H = heatAtPick(D.H, seasons);
    var thisYear = new Date().getFullYear();
    var showYears = Object.keys(seasons).map(Number).filter(function (y) { return span === 'all' ? y >= 2017 : y >= thisYear - 2; }).sort();
    var picksOf = function (y) {
      if (vy === 'Tystrya Estate') return H.blocks.reduce(function (a, b) { var c = b.years[y]; return a.concat(c ? c.dates.map(function (d) { return d.date; }) : []); }, []).sort();
      var g = H.growers.filter(function (x) { return x.vineyard === vy; })[0], c = g && g.years[y]; return c ? [c.first, c.last].filter(Boolean) : [];
    };
    var normal = wx.days ? normalDaily(wx.days, thisYear) : {};

    /* estimates with checks */
    var estRows = D.est.filter(function (x) { return x.vineyard === vy; }).sort(function (a, b) { return b.vintage - a.vintage || (a.block || 0) - (b.block || 0); }).map(function (x) {
      var b = x.block ? H.blocks.filter(function (k) { return k.block === x.block; })[0] : null;
      var acres = b ? b.acres : num(site && site.acres);
      var actual = b && b.years[x.vintage] && b.years[x.vintage].hasTons ? b.years[x.vintage].tons : (!x.block && vy !== 'Tystrya Estate' ? (function () { var g = H.growers.filter(function (k) { return k.vineyard === vy; })[0]; return g && g.years[x.vintage] ? g.years[x.vintage].tons : null; })() : null);
      var proj = b && b.gddPick && seasons[x.vintage] ? cmProjectRipe(seasons[x.vintage], normal, b.gddPick, seasons[x.vintage].lastDate) : null;
      return { e: x, chk: cmCropCheck(x, { acres: acres, target: site && site.target_tons_acre, maxTpa: b && b.maxTpa(x.vintage), actual: actual, proj: proj, windowEnd: site && site.target_end && String(site.target_end).slice(0, 4) === String(x.vintage) ? site.target_end : null }) };
    });

    var saveEst = function () {
      if (!site || !num(form.est_tons)) { setErr('Enter estimated tons.'); return; }
      var row = { organization_id: site.organization_id, vintage: +form.vintage, vineyard: vy, block: form.block ? +form.block : null, est_tons: num(form.est_tons), target_tons_acre: num(form.target_tons_acre), est_date: form.est_date || null, method: form.method || null, note: form.note || null, created_by: (typeof CM_ME !== 'undefined' && CM_ME && CM_ME.full_name) || null };
      db().from('harvest_estimates').insert(row).then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); setForm(Object.assign({}, form, { est_tons: '', note: '' })); reload(); } });
    };
    var delEst = function (id) { if (!confirm('Delete this estimate?')) return; db().from('harvest_estimates').delete().eq('id', id).then(function (r) { if (r.error) setErr(r.error.message); else reload(); }); };
    var saveSite = function () {
      var p = { address: edit.address || null, ava: edit.ava || null, lat: num(edit.lat), lon: num(edit.lon), target_tons_acre: num(edit.target_tons_acre), target_start: edit.target_start || null, target_end: edit.target_end || null, acres: num(edit.acres), updated_at: new Date().toISOString() };
      p.location_quality = p.lat != null && p.lon != null ? (edit.exact ? 'exact' : 'approximate') : 'missing';
      db().from('vineyards').update(p).eq('id', site.id).then(function (r) {
        if (r.error) { setErr(r.error.message); return; }
        if (site.lat !== p.lat || site.lon !== p.lon) db().from('weather_daily').delete().eq('vineyard_id', site.id).then(function () { setW({}); });
        setEdit(null); reload();
      });
    };

    var fld = function (k, label, type) { return cmE('label', { key: k, style: { flex: '1 1 120px', fontSize: 11, color: C.textDim } }, label, cmE('input', { type: type || 'text', value: (edit ? edit[k] : form[k]) == null ? '' : (edit ? edit[k] : form[k]), onChange: function (ev) { var v = ev.target.value; if (edit) setEdit(Object.assign({}, edit, (function () { var o = {}; o[k] = v; return o; })())); else setForm(Object.assign({}, form, (function () { var o = {}; o[k] = v; return o; })())); }, style: inp })); };

    return cmE('div', { style: { marginBottom: 16 } },
      cmE('div', { style: { fontSize: 15, fontWeight: 700, margin: '4px 0 8px' } }, 'Weather and harvest'),
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,
      /* vineyard picker + location */
      cmE('div', { style: card },
        cmE('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          cmE('select', { value: vy, onChange: function (ev) { setVy(ev.target.value); setEdit(null); }, style: Object.assign({}, cmSel, { flex: '1 1 200px' }) }, D.sites.map(function (x) { return cmE('option', { key: x.id, value: x.name }, x.name + (x.location_quality === 'missing' ? ' (address needed)' : '')); })),
          cmE('button', { onClick: function () { setSpan(span === 'all' ? 'recent' : 'all'); }, style: btn }, span === 'all' ? 'Last 3 years' : 'All years'),
          site ? cmE('button', { onClick: function () { setEdit(edit ? null : Object.assign({}, site, { exact: site.location_quality === 'exact' })); }, style: btn }, edit ? 'Cancel' : 'Location and targets') : null),
        site ? cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) },
          (site.address || 'No address on file') + (site.ava ? ' · ' + site.ava + ' AVA' : '') +
          (site.target_tons_acre ? ' · target ' + site.target_tons_acre + ' t/ac' : ' · no target t/ac yet') +
          (site.target_start ? ' · window ' + mmdd(site.target_start) + ' to ' + mmdd(site.target_end) : ''),
          site.lat == null ? cmE('div', { style: { color: C.orange } }, 'No location yet, so this uses the Estate weather. Add the address or coordinates for weather at this vineyard.') :
            site.location_quality === 'approximate' ? cmE('div', { style: { color: C.orange } }, 'Location is approximate (' + (site.location_note || 'AVA point') + ').') : null) : null,
        edit ? cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 } },
          fld('address', 'Address'), fld('ava', 'AVA'), fld('lat', 'Latitude', 'number'), fld('lon', 'Longitude', 'number'), fld('acres', 'Acres', 'number'),
          fld('target_tons_acre', 'Target t/ac', 'number'), fld('target_start', 'Window opens', 'date'), fld('target_end', 'Window closes', 'date'),
          cmE('label', { style: { fontSize: 11, color: C.textDim, display: 'flex', alignItems: 'center', gap: 4 } }, cmE('input', { type: 'checkbox', checked: !!edit.exact, onChange: function (ev) { setEdit(Object.assign({}, edit, { exact: ev.target.checked })); } }), 'Exact vineyard location'),
          cmE('button', { onClick: saveSite, style: Object.assign({}, btn, { background: C.accent, color: '#fff' }) }, 'Save')) : null),

      /* season table */
      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Heat units and rain' + (wsite && wsite !== site ? ' (Estate weather)' : '')),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Growing degree days, base 50°F, counted Apr 1 to Oct 31. Daily model data for the location (Open-Meteo archive), cached here. Rain in inches.'),
        wx.loading ? cmE('div', { style: small }, 'Fetching weather...') : wx.error ? cmE('div', { style: { color: C.red, fontSize: 12 } }, wx.error) :
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 640 } },
          cmE('thead', null, cmE('tr', null, ['Year', 'GDD season', 'by Aug 31', 'by Sep 15', 'by Sep 30', 'Rain Apr to Oct', 'Sep rain', 'Oct rain', 'Days 95°F+', 'First pick', 'Last pick', 'GDD at first pick'].map(function (h, i) { return cmE('th', { key: h, style: i ? th : L(th) }, h); }))),
          cmE('tbody', null, showYears.map(function (y) {
            var o = seasons[y], p = picksOf(y);
            return cmE('tr', { key: y }, cmE('td', { style: L(td) }, y + (o.lastDate < y + '-10-31' ? ' (to ' + mmdd(o.lastDate) + ')' : '')),
              cmE('td', { style: td }, r1(o.gdd, 0)), cmE('td', { style: td }, r1(o.at(y + '-08-31'), 0)), cmE('td', { style: td }, r1(o.at(y + '-09-15'), 0)), cmE('td', { style: td }, r1(o.at(y + '-09-30'), 0)),
              cmE('td', { style: td }, r1(o.rain, 2)), cmE('td', { style: td }, r1(o.rainSep, 2)), cmE('td', { style: td }, r1(o.rainOct, 2)), cmE('td', { style: td }, o.hot95),
              cmE('td', { style: td }, p[0] ? mmdd(p[0]) : ''), cmE('td', { style: td }, p.length ? mmdd(p[p.length - 1]) : ''), cmE('td', { style: td }, p[0] ? r1(o.at(p[0]), 0) : ''));
          })))),

      /* rain events */
      wx.days ? cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Rain during harvest season (Aug to Oct, days with 0.25 in or more)'),
        showYears.map(function (y) {
          var ev = seasons[y].events, p = picksOf(y), first = p[0], last = p[p.length - 1];
          return cmE('div', { key: y, style: { fontSize: 12, marginBottom: 4 } }, cmE('b', null, y + ': '),
            ev.length ? ev.map(function (x, i) { var inPick = first && x.date >= addDays(first, -3) && x.date <= last; return cmE('span', { key: i, style: { marginRight: 8, color: inPick ? C.orange : C.text } }, mmdd(x.date) + ' ' + r1(x.p, 2) + '"'); }) : 'none');
        }),
        cmE('div', { style: small }, 'Orange: within the pick window that year (3 days before the first pick to the last pick).')) : null,

      /* monthly rain */
      wx.days ? cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Rain by month (in)'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 560 } },
          cmE('thead', null, cmE('tr', null, cmE('th', { style: L(th) }, 'Year'), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(function (m) { return cmE('th', { key: m, style: th }, m); }))),
          cmE('tbody', null, showYears.map(function (y) { return cmE('tr', { key: y }, cmE('td', { style: L(td) }, y), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { var v = seasons[y].months[m]; return cmE('td', { key: m, style: td }, v == null ? '' : r1(v, 2)); })); })))) : null,

      /* estate blocks vs history */
      vy === 'Tystrya Estate' ? cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Estate blocks: tons per acre by year'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'From the Estate harvest records (sold and kept fruit), using each block\'s current acres. Orange: 25% or more above the block\'s average of the other years. GDD at pick is the heat the block had reached when picked, averaged over the years.'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 720 } },
          cmE('thead', null, cmE('tr', null, cmE('th', { style: L(th) }, 'Block'), cmE('th', { style: th }, 'Acres'), H.years.filter(function (y) { return span === 'all' || y >= thisYear - 2; }).map(function (y) { return cmE('th', { key: y, style: th }, y); }), cmE('th', { style: th }, 'Average'), cmE('th', { style: th }, 'GDD at pick'))),
          cmE('tbody', null, H.blocks.map(function (b) {
            var avg = b.avgTpa();
            return cmE('tr', { key: b.block }, cmE('td', { style: L(td) }, b.block + ' · ' + (b.clone || '')), cmE('td', { style: td }, r1(b.acres, 2)),
              H.years.filter(function (y) { return span === 'all' || y >= thisYear - 2; }).map(function (y) {
                var c = b.years[y]; if (!c) return cmE('td', { key: y, style: td }, '');
                var other = b.avgTpa(y), hi = c.tpa && other && c.tpa >= other * 1.25;
                return cmE('td', { key: y, style: Object.assign({}, td, { color: hi ? C.orange : C.text }), title: r1(c.tons, 2) + ' t' + (c.missing ? ' · ' + c.missing + ' pick(s) without tons' : '') + (c.gddPick ? ' · ' + r1(c.gddPick, 0) + ' GDD at pick' : '') }, c.tpa ? r1(c.tpa, 2) : (c.missing ? '?' : '0'));
              }),
              cmE('td', { style: td }, avg ? r1(avg, 2) : ''), cmE('td', { style: td }, b.gddPick ? r1(b.gddPick, 0) : ''));
          })))) : null,


      /* spray program */
      vy === 'Tystrya Estate' && D.sprays.length && wx.days ? cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Spray program and rain'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Orange: 0.5 in of rain or more in the 3 days after the spray, so check whether it needs to go on again. Heat units counted since the previous spray.'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 620 } },
          cmE('thead', null, cmE('tr', null, ['#', 'Date', 'Stage', 'For', 'Days since last', 'GDD since last', 'Rain next 3 days'].map(function (h, i) { return cmE('th', { key: h, style: i > 3 ? th : L(th) }, h); }))),
          cmE('tbody', null, cmSprayCheck(D.sprays, wx.days).reverse().map(function (r) {
            return cmE('tr', { key: r.date + r.spray, title: r.products || '' }, cmE('td', { style: L(td) }, r.spray), cmE('td', { style: L(td) }, r.date), cmE('td', { style: L(td) }, r.stage || ''), cmE('td', { style: L(Object.assign({}, td, { whiteSpace: 'normal' })) }, r.reason || ''),
              cmE('td', { style: td }, r.gap == null ? '' : r.gap), cmE('td', { style: td }, r.heat == null ? '' : r1(r.heat, 0)),
              cmE('td', { style: Object.assign({}, td, { color: r.washoff ? C.orange : C.text }) }, r.rain3 == null ? 'no data yet' : r1(r.rain3, 2) + '"'));
          })))) : null,
      /* grower tons */
      vy !== 'Tystrya Estate' ? cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, vy + ': fruit received by vintage'),
        (function () { var g = H.growers.filter(function (x) { return x.vineyard === vy; })[0]; if (!g) return cmE('div', { style: small }, 'No picks on file.'); return Object.keys(g.years).sort().map(function (y) { var c = g.years[y]; return cmE('div', { key: y, style: { fontSize: 12 } }, y + ': ' + r1(c.tons, 2) + ' t in ' + c.picks + ' pick(s)' + (c.first ? ', ' + mmdd(c.first) + (c.last !== c.first ? ' to ' + mmdd(c.last) : '') : '') + (num(site && site.acres) ? ' · ' + r1(c.tons / site.acres, 2) + ' t/ac' : '')); }); })()) : null,

      /* crop estimates */
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Crop estimates and pick window'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Enter a crop estimate (from cluster counts or lag phase) to check it against the target tons per acre, the best year on file, and, for Estate blocks, when the block should reach its usual pick heat against the target window.'),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' } },
          fld('vintage', 'Vintage', 'number'),
          vy === 'Tystrya Estate' ? cmE('label', { style: { flex: '1 1 120px', fontSize: 11, color: C.textDim } }, 'Block', cmE('select', { value: form.block, onChange: function (ev) { setForm(Object.assign({}, form, { block: ev.target.value })); }, style: inp }, [cmE('option', { key: '', value: '' }, 'Whole vineyard')].concat(H.blocks.map(function (b) { return cmE('option', { key: b.block, value: b.block }, b.block + ' · ' + (b.clone || '')); })))) : null,
          fld('est_tons', 'Estimated tons', 'number'), fld('target_tons_acre', 'Target t/ac', 'number'), fld('est_date', 'Estimated on', 'date'), fld('method', 'Method'), fld('note', 'Note'),
          cmE('button', { onClick: saveEst, style: Object.assign({}, btn, { background: C.accent, color: '#fff' }) }, 'Add estimate')),
        estRows.length ? estRows.map(function (r) {
          return cmE('div', { key: r.e.id, style: { borderTop: '1px solid ' + C.cardBorder, marginTop: 8, paddingTop: 6 } },
            cmE('div', { style: { display: 'flex', gap: 8, fontSize: 12 } }, cmE('b', { style: { flex: 1 } }, r.e.vintage + ' · ' + (r.e.block ? 'Block ' + r.e.block : 'Whole vineyard') + ' · ' + r1(r.e.est_tons, 2) + ' t' + (r.chk.tpa ? ' (' + r1(r.chk.tpa, 2) + ' t/ac)' : '')), cmE('button', { onClick: function () { delEst(r.e.id); }, style: Object.assign({}, btn, { padding: '2px 8px' }) }, 'Delete')),
            r.chk.flags.map(function (f, i) { return cmE('div', { key: i, style: { fontSize: 12, color: flagC[f.level] } }, f.text); }),
            !r.chk.flags.length ? cmE('div', { style: small }, 'Add a target t/ac or acres to check this estimate.') : null);
        }) : cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) }, 'No estimates for ' + vy + ' yet.')));
  }

  window.cmGddSeason = cmGddSeason;
  window.cmHarvestHistory = cmHarvestHistory;
  window.cmProjectRipe = cmProjectRipe;
  window.cmCropCheck = cmCropCheck;
  window.cmSprayCheck = cmSprayCheck;
  window.cmVineyardHeat = heatAtPick;
  window.cmWeatherFor = cmWeatherFor;
  window.CmVineyard = CmVineyard;
})();
