/* CellarMate module: Vintage comparison
   Side by side, 2023 to the current vintage: fruit (picks, tons, harvest Brix and pH),
   fermentation (days to dry, peak temperature, yeast added, pH at press), the wine in the
   cellar now (barrels, pH, MLF, free SO2), lab (VA), and a block-by-block table showing
   tendencies of each vineyard and Estate block across years. Excel export.
   Registers in CM_MODULES. */
(function () {
  'use strict';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function avg(a) { var v = a.map(num).filter(function (x) { return x !== null; }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null; }
  function sum(a) { var v = a.map(num).filter(function (x) { return x !== null; }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) : null; }
  function by(arr, k) { var o = {}; arr.forEach(function (r) { (o[r[k]] = o[r[k]] || []).push(r); }); return o; }
  function malicNum(t) { var s = String(t || '').trim(); if (!s) return null; var m = s.match(/^<\s*([\d.]+)/); if (m) return 0; var n = parseFloat(s); return isNaN(n) ? null : n; }
  function blockList(b) { return String(b || '').split(/[\/,&+ ]+/).map(function (x) { return x.replace(/[^\d]/g, ''); }).filter(Boolean); }
  function vineyardOf(v) { var s = String(v || '').trim(); if (!s || /not (noted|recorded)/i.test(s)) return null; return /tystrya/i.test(s) ? 'Tystrya Estate' : s.replace(/\s*\(as written\)/i, ''); }

  function cmVintageCompare(X) {
    var ferms = X.ferms || [], picks = X.picks || [], adds = X.adds || [], lab = X.lab || [];
    var years = {}; ferms.concat(picks).forEach(function (r) { if (r.vintage) years[r.vintage] = 1; });
    if ((X.s25 || []).length) years[2025] = 1; if ((X.s26 || []).length) years[2026] = 1;
    var V = Object.keys(years).map(Number).sort();
    var F = by(ferms, 'vintage'), P = by(picks, 'vintage');
    var yeastF = {}; adds.forEach(function (a) { if (/yeast/i.test(a.product || '')) yeastF[a.vintage + '|' + a.fermenter] = 1; });
    ferms.forEach(function (f) { if (f.yeast) yeastF[f.vintage + '|' + f.fermenter] = 1; });
    var cellar = {};
    (X.s26 || []).forEach(function (r) { var c = cellar[2026] = cellar[2026] || []; c.push({ ph: r.ph_latest, malic: malicNum(r.malic_g_l_text), mlf: r.mlf_status, fso2: null }); });
    (X.s25 || []).forEach(function (r) { if (/confirm contents/i.test(r.action || '')) return; var c = cellar[2025] = cellar[2025] || []; c.push({ ph: r.ph_latest, malic: malicNum(r.malic_g_l_text), mlf: r.mlf_status, fso2: r.last_free_so2_ppm }); });
    (X.barrels || []).forEach(function (r) { if (r.vintage !== 2024) return; var c = cellar[2024] = cellar[2024] || []; c.push({ ph: r.latest_ph, malic: null, mlf: null, fso2: r.latest_free_so2 }); });
    var metric = function (group, label, unit, fn, digits, note) { var vals = {}; V.forEach(function (v) { vals[v] = fn(v); }); return { group: group, label: label, unit: unit || '', vals: vals, digits: digits == null ? 1 : digits, note: note || '' }; };
    var M = [
      metric('Fruit', 'Picks', '', function (v) { return (P[v] || []).length || null; }, 0),
      metric('Fruit', 'Tons picked', 't', function (v) { return sum((P[v] || []).map(function (p) { return p.tons; })); }, 1),
      metric('Fruit', 'First pick', '', function (v) { var d = (P[v] || []).map(function (p) { return p.date; }).filter(Boolean).sort(); return d[0] ? d[0].slice(5) : null; }),
      metric('Fruit', 'Last pick', '', function (v) { var d = (P[v] || []).map(function (p) { return p.date; }).filter(Boolean).sort(); return d.length ? d[d.length - 1].slice(5) : null; }),
      metric('Fruit', 'Harvest Brix (average)', '°Bx', function (v) { return avg((F[v] || []).map(function (f) { return f.start_brix; })); }, 1),
      metric('Fruit', 'Must pH (average)', '', function (v) { return avg((F[v] || []).map(function (f) { return f.must_ph; })); }, 2),
      metric('Fermentation', 'Fermenters', '', function (v) { return (F[v] || []).length || null; }, 0),
      metric('Fermentation', 'Tons in fermenters', 't', function (v) { return sum((F[v] || []).map(function (f) { return f.tons; })); }, 1),
      metric('Fermentation', 'Days to dry (average)', 'days', function (v) { return avg((F[v] || []).map(function (f) { return f.days_to_dry; })); }, 1),
      metric('Fermentation', 'Peak temperature (average)', '°F', function (v) { return avg((F[v] || []).map(function (f) { return f.peak_temp_f; })); }, 1),
      metric('Fermentation', 'Fermenters with yeast added (as recorded)', '', function (v) { var n = (F[v] || []).filter(function (f) { return yeastF[v + '|' + f.fermenter]; }).length; return n ? n : null; }, 0),
      metric('Fermentation', 'pH at press (average)', '', function (v) { return avg((F[v] || []).map(function (f) { return f.transfer_ph; })); }, 2),
      metric('In the cellar now', 'Barrels on file', '', function (v) { return (cellar[v] || []).length || null; }, 0),
      metric('In the cellar now', 'Latest pH (average)', '', function (v) { return avg((cellar[v] || []).map(function (c) { return c.ph; })); }, 2),
      metric('In the cellar now', 'Barrels at pH 3.83 or higher', '', function (v) { var c = cellar[v] || []; return c.length ? c.filter(function (x) { return num(x.ph) !== null && num(x.ph) >= 3.83; }).length : null; }, 0),
      metric('In the cellar now', 'MLF done (malic 0.1 or less)', '%', function (v) { var c = (cellar[v] || []).filter(function (x) { return x.malic !== null || /done|complete/i.test(x.mlf || ''); }); if (!c.length) return null; return 100 * c.filter(function (x) { return (x.malic !== null && x.malic <= 0.1) || /done|complete/i.test(x.mlf || ''); }).length / c.length; }, 0),
      metric('In the cellar now', 'Last free SO2 (average)', 'mg/L', function (v) { return avg((cellar[v] || []).map(function (c) { return c.fso2; })); }, 1),
      metric('Lab', 'VA (average of lab results)', 'g/L', function (v) { return avg(lab.filter(function (r) { return r.analyte === 'va' && (r.vintage === v || (!r.vintage && String(r.sampled_on || '').slice(0, 4) === String(v))); }).map(function (r) { return r.value; })); }, 2)
    ];
    /* block by block: tons from picks, Brix and pH from fermenters */
    var B = {};
    var key = function (vy, b) { return vy + (b ? ' · Block ' + b : ''); };
    var put = function (k, vy, b, v, f) { var r = B[k] = B[k] || { vineyard: vy, block: b, vals: {} }; var c = r.vals[v] = r.vals[v] || { tons: 0, hasTons: false, brix: [], ph: [], n: 0 }; f(c); };
    picks.forEach(function (p) {
      var vy = vineyardOf(p.vineyard); if (!vy || !p.vintage) return; var bl = vy === 'Tystrya Estate' ? blockList(p.blocks) : [null]; if (!bl.length) bl = [null];
      bl.forEach(function (b) { put(key(vy, b), vy, b, p.vintage, function (c) { if (num(p.tons) !== null) { c.tons += num(p.tons) / bl.length; c.hasTons = true; } }); });
    });
    ferms.forEach(function (f) {
      var vy = vineyardOf(f.vineyard); if (!vy) return; var bl = vy === 'Tystrya Estate' ? blockList(f.blocks) : [null]; if (!bl.length) bl = [null];
      bl.forEach(function (b) { put(key(vy, b), vy, b, f.vintage, function (c) { c.n++; if (num(f.start_brix) !== null) c.brix.push(num(f.start_brix)); if (num(f.must_ph) !== null) c.ph.push(num(f.must_ph)); }); });
    });
    var blocks = Object.keys(B).map(function (k) { var r = B[k]; Object.keys(r.vals).forEach(function (v) { var c = r.vals[v]; c.brixAvg = avg(c.brix); c.phAvg = avg(c.ph); }); return r; })
      .sort(function (a, b) { var ea = a.vineyard === 'Tystrya Estate' ? 0 : 1, eb = b.vineyard === 'Tystrya Estate' ? 0 : 1; return ea - eb || a.vineyard.localeCompare(b.vineyard) || (Number(a.block) || 0) - (Number(b.block) || 0); });
    return { vintages: V, metrics: M, blocks: blocks };
  }

  function fmt(v, d) { if (v === null || v === undefined) return ''; if (typeof v === 'string') return v; return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }

  function CmVintages() {
    var sD = React.useState(null), D = sD[0], setD = sD[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    var sV = React.useState('all'), vyF = sV[0], setVyF = sV[1];
    React.useEffect(function () {
      var live = true;
      Promise.all(['fermenters', 'picks', 'barrel_status_2025', 'barrel_status_2026', 'barrels', 'fermenter_additions', 'lab_results'].map(function (t) { return cmFetch(t); }))
        .then(function (a) { if (live) setD(cmVintageCompare({ ferms: a[0], picks: a[1], s25: a[2], s26: a[3], barrels: a[4], adds: a[5], lab: a[6] })); })
        .catch(function (e) { if (live) { setErr(e.message); setD(cmVintageCompare({})); } });
      return function () { live = false; };
    }, []);
    if (!D) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var th = { textAlign: 'right', padding: '4px 8px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var td = { textAlign: 'right', padding: '4px 8px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var bar = function (m, v) {
      var nums = D.vintages.map(function (y) { return m.vals[y]; }).filter(function (x) { return typeof x === 'number'; });
      var x = m.vals[v]; if (typeof x !== 'number' || nums.length < 2) return null; var mx = Math.max.apply(null, nums), mn = Math.min.apply(null, nums);
      var w = mx === mn ? 100 : 25 + 75 * (x - mn) / (mx - mn);
      return cmE('div', { style: { height: 3, width: w + '%', marginLeft: 'auto', background: C.accentLight, borderRadius: 2, marginTop: 2 } });
    };
    var groups = cmUniq(D.metrics.map(function (m) { return m.group; }));
    var vys = cmUniq(D.blocks.map(function (b) { return b.vineyard; }));
    var blocks = D.blocks.filter(function (b) { return vyF === 'all' || b.vineyard === vyF; });
    var exportX = function () {
      if (!window.XLSX) return; var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(D.metrics.map(function (m) { var o = { Group: m.group, Measure: m.label + (m.unit ? ' (' + m.unit + ')' : '') }; D.vintages.forEach(function (v) { o[v] = typeof m.vals[v] === 'number' ? Number(fmt(m.vals[v], m.digits)) : (m.vals[v] || ''); }); return o; })), 'Vintages');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(D.blocks.map(function (b) { var o = { Vineyard: b.vineyard, Block: b.block || '' }; D.vintages.forEach(function (v) { var c = b.vals[v]; o[v + ' tons'] = c && c.hasTons ? Number(c.tons.toFixed(2)) : ''; o[v + ' Brix'] = c && c.brixAvg != null ? Number(c.brixAvg.toFixed(1)) : ''; o[v + ' pH'] = c && c.phAvg != null ? Number(c.phAvg.toFixed(2)) : ''; }); return o; })), 'Blocks');
      XLSX.writeFile(wb, 'CellarMate_vintage_comparison.xlsx');
    };
    return cmE('div', null,
      err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
      cmE('div', { style: Object.assign({}, card, { display: 'flex', alignItems: 'center', gap: 8 }) },
        cmE('div', { style: Object.assign({}, small, { flex: 1 }) }, 'Each vintage side by side. Bars compare a measure across years (longest = highest). Blank means not recorded that year.'),
        cmE('button', { onClick: exportX, style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 } }, 'Excel')),
      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 520 } },
        cmE('thead', null, cmE('tr', null, cmE('th', { style: Object.assign({}, th, { textAlign: 'left' }) }, 'Measure'), D.vintages.map(function (v) { return cmE('th', { key: v, style: th }, v); }))),
        cmE('tbody', null, groups.map(function (g) {
          return [cmE('tr', { key: 'g' + g }, cmE('td', { colSpan: D.vintages.length + 1, style: { padding: '8px 8px 2px', fontWeight: 700, fontSize: 12, color: C.accentLight } }, g))].concat(
            D.metrics.filter(function (m) { return m.group === g; }).map(function (m) {
              return cmE('tr', { key: m.label }, cmE('td', { style: Object.assign({}, td, { textAlign: 'left', whiteSpace: 'normal' }) }, m.label + (m.unit ? ' (' + m.unit + ')' : '')),
                D.vintages.map(function (v) { return cmE('td', { key: v, style: td }, fmt(m.vals[v], m.digits), bar(m, v)); }));
            }));
        })))),
      cmE('div', { style: card },
        cmE('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 } },
          cmE('div', { style: { fontWeight: 700, flex: '1 1 200px' } }, 'Vineyards and blocks by year'),
          cmE('select', { value: vyF, onChange: function (e) { setVyF(e.target.value); }, style: Object.assign({}, cmSel, { flex: '0 1 220px' }) }, [cmE('option', { key: 'all', value: 'all' }, 'Every vineyard')].concat(vys.map(function (v) { return cmE('option', { key: v, value: v }, v); })))),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Tons from the pick records (shared evenly when a pick lists several blocks); harvest Brix and must pH from the fermenter sheets.'),
        cmE('div', { style: { overflowX: 'auto' } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 560 } },
          cmE('thead', null, cmE('tr', null, cmE('th', { style: Object.assign({}, th, { textAlign: 'left' }) }, 'Vineyard / block'), D.vintages.map(function (v) { return cmE('th', { key: v, style: th }, v + ': tons · Brix · pH'); }))),
          cmE('tbody', null, blocks.map(function (b) {
            return cmE('tr', { key: b.vineyard + b.block }, cmE('td', { style: Object.assign({}, td, { textAlign: 'left' }) }, b.vineyard + (b.block ? ' · Block ' + b.block : '')),
              D.vintages.map(function (v) { var c = b.vals[v]; return cmE('td', { key: v, style: td }, !c ? '' : [c.hasTons ? c.tons.toFixed(2) : '-', c.brixAvg != null ? c.brixAvg.toFixed(1) : '-', c.phAvg != null ? c.phAvg.toFixed(2) : '-'].join(' · ')); }));
          }))))));
  }

  window.cmVintageCompare = cmVintageCompare;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.vint = { label: 'Vintages', Component: CmVintages, order: 78 };
})();
