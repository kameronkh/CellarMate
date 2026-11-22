/* CellarMate module: Lab results
   Paste or type lab panels (ETS report rows, a spreadsheet copy, or a quick line per barrel),
   check the preview, save to lab_results. Latest panel per barrel merges lab_results with the
   free SO2 / pH log and malic results, and flags values against gold-standard limits.
   Registers in CM_MODULES. */
(function () {
  'use strict';
  var ANALYTES = [
    ['ph', 'pH', '', /^p\s*h$/i],
    ['ta', 'TA', 'g/L', /^(ta|titratable acid(ity)?)$/i],
    ['va', 'VA', 'g/L', /^(va|volatile acid(ity)?|acetic( acid)?)$/i],
    ['fso2', 'Free SO2', 'mg/L', /^(f\s*so2|free so2|free sulfur( dioxide)?|fso2)$/i],
    ['tso2', 'Total SO2', 'mg/L', /^(t\s*so2|total so2|total sulfur( dioxide)?|tso2)$/i],
    ['malic', 'Malic', 'g/L', /^(malic( acid)?|ma)$/i],
    ['rs', 'Glucose + fructose', 'g/L', /^(rs|g\s*\+\s*f|glucose\s*\+\s*fructose|residual sugar|sugar)$/i],
    ['alc', 'Alcohol', '% v/v', /^(alc(ohol)?|abv|ethanol)$/i],
    ['yan', 'YAN', 'mg N/L', /^(yan|yeast assimilable nitrogen)$/i],
    ['brix', 'Brix', '°Bx', /^(brix|°bx|bx)$/i],
    ['turb', 'Turbidity', 'NTU', /^(turbidity|ntu)$/i]
  ];
  var BY_KEY = {}; ANALYTES.forEach(function (a) { BY_KEY[a[0]] = a; });
  function analyteOf(h) { h = String(h || '').trim().replace(/\s*\(.*\)$/, ''); var a = ANALYTES.filter(function (x) { return x[3].test(h); })[0]; return a ? a[0] : null; }
  function normSample(s) {
    var t = String(s || '').trim(); var m = t.match(/^(?:barrel\s*)?(25|26)\s*-\s*0*(\d{1,3})$/i);
    if (m) return m[1] === '26' ? { vintage: 2026, barrel: '26-' + ('00' + m[2]).slice(-3) } : { vintage: 2025, barrel: String(Number(m[2])) };
    return { vintage: null, barrel: null };
  }
  function normDate(s, fallback) {
    var t = String(s || '').trim(); if (!t) return fallback || null;
    var m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (m) { var y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear()); return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2); }
    return fallback || null;
  }
  function parseVal(v) {
    var t = String(v == null ? '' : v).trim(); if (!t || t === '-' || /^n\/?a$/i.test(t)) return null;
    var m = t.match(/^([<>])\s*([\d.]+)/); if (m) return { value: Number(m[2]) * (m[1] === '<' ? 0.5 : 1), text: t };
    m = t.match(/^-?[\d.]+/); if (m && !isNaN(Number(m[0]))) return { value: Number(m[0]), text: t };
    return null;
  }
  /* Two formats: (1) a table with a header row (tabs or commas): Sample, Date, pH, TA, VA, Free SO2 ...
     (2) quick lines: "26-022 11/20 pH 3.41 TA 6.2 VA 0.42 FSO2 22" */
  function cmParseLab(text, defDate) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return { rows: [], problems: ['Nothing pasted.'] };
    var sep = lines[0].indexOf('\t') > -1 ? '\t' : (lines[0].indexOf(',') > -1 ? ',' : null);
    var out = [], problems = [];
    if (sep) {
      var head = lines[0].split(sep).map(function (h) { return h.trim(); });
      var cols = head.map(analyteOf);
      var si = head.findIndex(function (h) { return /^(sample|barrel|lot|id|sample id|description)$/i.test(h); });
      var di = head.findIndex(function (h) { return /^(date|sampled|sample date|date sampled)$/i.test(h); });
      if (si < 0) si = 0;
      if (!cols.some(Boolean)) problems.push('No lab columns found in the header. Use names like pH, TA, VA, Free SO2, Malic.');
      lines.slice(1).forEach(function (l, i) {
        var c = l.split(sep); var sample = (c[si] || '').trim(); if (!sample) return;
        var date = normDate(di > -1 ? c[di] : '', defDate);
        cols.forEach(function (a, j) { if (!a) return; var pv = parseVal(c[j]); if (!pv) return; var ns = normSample(sample); out.push({ sample: sample, vintage: ns.vintage, barrel: ns.barrel, sampled_on: date, analyte: a, value: pv.value, value_text: pv.text, unit: BY_KEY[a][2] }); });
        if (!date) problems.push('Row ' + (i + 2) + ': no date.');
      });
    } else {
      lines.forEach(function (l, i) {
        var toks = l.split(/\s+/); var sample = toks.shift(); var date = defDate;
        if (toks[0] && normDate(toks[0])) date = normDate(toks.shift(), defDate);
        var ns = normSample(sample); var n = 0;
        for (var k = 0; k < toks.length - 1; k++) {
          var name = toks[k]; var a = analyteOf(name);
          if (!a && toks[k + 2] && analyteOf(name + ' ' + toks[k + 1])) { a = analyteOf(name + ' ' + toks[k + 1]); k++; }
          if (!a) continue; var pv = parseVal(toks[k + 1]); if (!pv) continue;
          out.push({ sample: sample, vintage: ns.vintage, barrel: ns.barrel, sampled_on: date, analyte: a, value: pv.value, value_text: pv.text, unit: BY_KEY[a][2] }); n++; k++;
        }
        if (!n) problems.push('Line ' + (i + 1) + ': no results read ("' + l.slice(0, 40) + '").');
        if (!date) problems.push('Line ' + (i + 1) + ': no date.');
      });
    }
    out.forEach(function (r) { if (!r.barrel) problems.push(r.sample + ' is not a barrel code like 26-022 or 25-183; it is saved as a sample name only.'); });
    return { rows: out, problems: cmUniq(problems) };
  }
  /* latest value per barrel per analyte, merging lab_results, so2_log (free SO2, pH) and malic_results */
  function cmLatestPanels(lab, so2, malic) {
    var P = {};
    var put = function (v, b, a, d, val, txt, src) {
      if (!b || val == null) return; var k = v + '|' + b; var p = P[k] = P[k] || { vintage: v, barrel: b, vals: {} };
      var cur = p.vals[a]; if (!cur || String(d) >= String(cur.d)) p.vals[a] = { d: d, v: Number(val), t: txt || String(val), src: src };
    };
    lab.forEach(function (r) { put(r.vintage, r.barrel, r.analyte, r.sampled_on, r.value, r.value_text, r.lab || 'Lab'); });
    so2.forEach(function (r) {
      if (r.kind === 'Reading') { put(r.vintage, r.barrel, 'fso2', r.date, r.free_so2_ppm, null, 'SO2 log'); put(r.vintage, r.barrel, 'ph', r.date, r.ph, null, 'SO2 log'); }
      else if (r.kind === 'Addition' && r.grams_added != null && r.barrel) { var k = r.vintage + '|' + r.barrel; var p = P[k] = P[k] || { vintage: r.vintage, barrel: r.barrel, vals: {} }; if (!p.lastAdd || String(r.date) > String(p.lastAdd.d)) p.lastAdd = { d: r.date, g: Number(r.grams_added) }; }
    });
    malic.forEach(function (r) { var b = r.vintage === 2026 && !/^26-/.test(r.barrel) ? r.barrel : r.barrel; put(r.vintage, b, 'malic', r.date, r.malic_g_l != null ? r.malic_g_l : parseVal(r.result_text) && parseVal(r.result_text).value, r.result_text, 'Malic'); });
    return Object.keys(P).map(function (k) { return P[k]; });
  }
  function molecular(fso2, ph) { return fso2 / (1 + Math.pow(10, ph - 1.81)); }
  function cmLabFlags(p, white) {
    var v = p.vals, f = [];
    if (v.va && v.va.v >= 0.6) f.push('VA ' + v.va.t + (v.va.v >= 1.0 ? ' (high: act now)' : ' (watch)'));
    if (v.fso2 && v.ph) { var m = molecular(v.fso2.v, v.ph.v); var need = white ? 0.8 : 0.5; if (m < need) { if (p.lastAdd && String(p.lastAdd.d) >= String(v.fso2.d)) f.push('SO2 added ' + p.lastAdd.d + ' (' + p.lastAdd.g + ' g) after the last reading: test free SO2'); else f.push('Molecular SO2 ' + m.toFixed(2) + ' (target ' + need + ')'); } }
    if (v.ph && v.ph.v >= 3.83) f.push('pH ' + v.ph.t + ' (3.83 or higher: SO2 binds poorly)');
    if (v.malic && v.malic.v > 0.1 && v.malic.v < 5) f.push('Malic ' + v.malic.t + ' (MLF not done)');
    if (v.rs && v.rs.v > 2) f.push('Sugar ' + v.rs.t + ' g/L (not dry)');
    return f;
  }

  function CmLab() {
    var sD = React.useState(null), D = sD[0], setD = sD[1];
    var sT = React.useState(''), txt = sT[0], setTxt = sT[1];
    var sDd = React.useState(new Date().toISOString().slice(0, 10)), defDate = sDd[0], setDefDate = sDd[1];
    var sLab = React.useState('ETS Laboratories'), lab = sLab[0], setLab = sLab[1];
    var sRep = React.useState(''), rep = sRep[0], setRep = sRep[1];
    var sP = React.useState(null), prev = sP[0], setPrev = sP[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    var sM = React.useState(''), msg = sM[0], setMsg = sM[1];
    var sK = React.useState(0), tick = sK[0], setTick = sK[1];
    var sF = React.useState('flag'), filt = sF[0], setFilt = sF[1];
    var sQ = React.useState(''), q = sQ[0], setQ = sQ[1];
    React.useEffect(function () {
      var live = true;
      if (tick && typeof CM_CACHE !== 'undefined') delete CM_CACHE.lab_results;
      Promise.all([cmFetch('lab_results'), cmFetch('so2_log'), cmFetch('malic_results'), cmFetch('barrel_status_2025'), cmFetch('barrel_status_2026')])
        .then(function (a) { if (live) setD({ lab: a[0], so2: a[1], malic: a[2], s25: a[3], s26: a[4] }); })
        .catch(function (e) { if (live) { setErr(e.message); setD({ lab: [], so2: [], malic: [], s25: [], s26: [] }); } });
      return function () { live = false; };
    }, [tick]);
    if (!D) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var inp = Object.assign({}, cmSel, { minWidth: 0 });
    var isWhite = {}; D.s25.forEach(function (r) { if (/white/i.test(r.wine_type || '')) isWhite['2025|' + r.barrel] = 1; }); D.s26.forEach(function (r) { if (/white/i.test(r.wine_type || '')) isWhite['2026|' + r.barrel] = 1; });
    var panels = cmLatestPanels(D.lab, D.so2, D.malic).map(function (p) { p.flags = cmLabFlags(p, isWhite[p.vintage + '|' + p.barrel]); return p; })
      .filter(function (p) { return (filt === 'all' || p.flags.length) && (!q || String(p.barrel).indexOf(q.replace(/^25-/, '')) > -1); })
      .sort(function (a, b) { return (b.flags.length - a.flags.length) || (b.vintage - a.vintage) || String(a.barrel).localeCompare(String(b.barrel), undefined, { numeric: true }); });
    var preview = function () { setErr(''); setMsg(''); var r = cmParseLab(txt, defDate); setPrev(r); };
    var save = function () {
      if (!prev || !prev.rows.length) return;
      var org = (D.s26[0] && D.s26[0].organization_id) || '762fc809-0341-4ee2-834f-16e707181ea7';
      var recs = prev.rows.filter(function (r) { return r.sampled_on; }).map(function (r) { return Object.assign({}, r, { organization_id: org, lab: lab || null, report_no: rep || null, source: 'Pasted in app', entered_by: ((typeof CM_ME !== 'undefined' && CM_ME.full_name) || null) }); });
      supa.schema('cellarmate').from('lab_results').insert(recs).then(function (r) {
        if (r.error) { setErr(r.error.message); return; }
        setMsg('Saved ' + recs.length + ' results.'); setPrev(null); setTxt(''); setTick(tick + 1);
      });
    };
    var A = function (p, k) { var x = p.vals[k]; return x ? x.t : ''; };
    return cmE('div', null,
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,
      msg ? cmE('div', { style: { color: C.green || '#22c55e', fontSize: 12, marginBottom: 6, fontWeight: 700 } }, msg) : null,
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Add lab results'),
        cmE('div', { style: small }, 'Paste rows copied from a lab report or spreadsheet (first row: Sample, Date, pH, TA, VA, Free SO2, Total SO2, Malic, Alcohol...) or type one line per barrel, for example: 26-022 11/20 pH 3.41 TA 6.2 VA 0.42 FSO2 22'),
        cmE('textarea', { value: txt, onChange: function (e) { setTxt(e.target.value); setPrev(null); }, rows: 5, placeholder: 'Sample\tDate\tpH\tVA\tFree SO2\n26-022\t11/20/2026\t3.41\t0.42\t22', style: Object.assign({}, inp, { width: '100%', boxSizing: 'border-box', marginTop: 6, fontFamily: 'monospace', fontSize: 12 }) }),
        cmE('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 6 } },
          cmE('input', { type: 'date', value: defDate, onChange: function (e) { setDefDate(e.target.value); }, title: 'Date used when a row has none', style: inp }),
          cmE('input', { value: lab, onChange: function (e) { setLab(e.target.value); }, placeholder: 'Lab', style: inp }),
          cmE('input', { value: rep, onChange: function (e) { setRep(e.target.value); }, placeholder: 'Report number (optional)', style: inp }),
          cmE('button', { onClick: preview, style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' } }, 'Check')),
        prev ? cmE('div', { style: { marginTop: 8 } },
          prev.problems.map(function (p, i) { return cmE('div', { key: i, style: { fontSize: 12, color: C.orange } }, p); }),
          cmE('div', { style: Object.assign({}, small, { margin: '4px 0' }) }, prev.rows.length + ' results read:'),
          cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, prev.rows.slice(0, 60).map(function (r, i) { return cmE('span', { key: i, style: { fontSize: 11, background: C.cardBorder, borderRadius: 5, padding: '2px 6px' } }, r.sample + ' · ' + BY_KEY[r.analyte][1] + ' ' + r.value_text + ' · ' + (r.sampled_on || 'no date')); })),
          prev.rows.length ? cmE('button', { onClick: save, style: { marginTop: 8, background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' } }, 'Save ' + prev.rows.filter(function (r) { return r.sampled_on; }).length + ' results') : null) : null),
      cmE('div', { style: { display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
        cmE('div', { style: { flex: '2 1 240px' } }, cmSeg([['flag', 'Needs a look'], ['all', 'Every barrel']], filt, setFilt)),
        cmE('input', { value: q, onChange: function (e) { setQ(e.target.value.trim()); }, placeholder: 'Find barrel', style: Object.assign({}, inp, { flex: '1 1 120px' }) })),
      cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Latest value for each barrel from lab reports, the free SO2 log and malic tests. Flags: VA 0.6 g/L or more, molecular SO2 under 0.5 (reds) or 0.8 (whites), pH 3.83 or higher, malic over 0.1, sugar over 2 g/L.'),
      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 12 } },
        cmE('thead', null, cmE('tr', null, ['Barrel', 'pH', 'Free SO2', 'Malic', 'VA', 'TA', 'Sugar', 'Alcohol', 'Flags'].map(function (h) { return cmE('th', { key: h, style: { textAlign: 'left', padding: '4px 6px', color: C.textDim, borderBottom: '1px solid ' + C.cardBorder } }, h); }))),
        cmE('tbody', null, panels.slice(0, 300).map(function (p) {
          return cmE('tr', { key: p.vintage + p.barrel, style: { borderBottom: '1px solid ' + C.cardBorder } },
            cmE('td', { style: { padding: '4px 6px', fontWeight: 700 } }, (p.vintage === 2025 ? '25-' : '') + p.barrel),
            ['ph', 'fso2', 'malic', 'va', 'ta', 'rs', 'alc'].map(function (k) { return cmE('td', { key: k, style: { padding: '4px 6px' }, title: p.vals[k] ? p.vals[k].d + ' · ' + p.vals[k].src : '' }, A(p, k)); }),
            cmE('td', { style: { padding: '4px 6px', color: p.flags.length ? C.orange : C.textDim } }, p.flags.join('; ') || 'OK'));
        })))));
  }

  window.cmParseLab = cmParseLab; window.cmLatestPanels = cmLatestPanels; window.cmLabFlags = cmLabFlags;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.lab = { label: 'Lab', Component: CmLab, order: 49 };
})();
