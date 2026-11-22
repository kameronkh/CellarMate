/* CellarMate module: Fermentation (yeast, nutrients, SO2 at crush, Brix curves)
   Loaded as its own file after index.html. Registers itself in CM_MODULES.
   Uses shared helpers from index.html: cmE, C, cmSeg, cmFetch, cmUniq. */
(function () {
  'use strict';
  var GOLD = {
    hotF: 88,          /* red ferments above about 88 F risk stuck ferments and cooked fruit */
    slowDays: 14,      /* still above 0 Brix two weeks after intake */
    nutrientRate: [15, 30], /* typical organic nutrient dose, g/hL */
  };

  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function fnum(f) { var m = String(f || '').match(/[0-9]+/); return m ? Number(m[0]) : 999; }
  function day(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

  function cmFermSummary(f, reads, adds) {
    var r = reads.filter(function (x) { return x.vessel === f.fermenter; }).sort(function (a, b) { return String(a.date) < String(b.date) ? -1 : 1; });
    var a = adds.filter(function (x) { return x.fermenter === f.fermenter; });
    var first = r.length ? r[0].date : (f.intake || null);
    var dry = r.filter(function (x) { return num(x.brix) !== null && num(x.brix) <= 0; })[0];
    var temps = r.map(function (x) { return num(x.temp_f); }).filter(function (x) { return x !== null; });
    var peakT = temps.length ? Math.max.apply(null, temps) : num(f.peak_temp_f);
    var yeast = a.filter(function (x) { return /yeast/i.test(x.product); });
    var nutr = a.filter(function (x) { return /optiflore|nutristart|fermaid|go-ferm|dap/i.test(x.product); });
    var so2 = a.filter(function (x) { return /^SO2/.test(x.product); });
    var last = r.length ? r[r.length - 1] : null;
    var flags = [];
    if (!yeast.length) flags.push('No yeast recorded (native or not written)');
    if (peakT !== null && peakT > GOLD.hotF) flags.push('Peak ' + peakT + ' F, above ' + GOLD.hotF);
    var daysDry = dry && first ? day(first, dry.date) : num(f.days_to_dry);
    if (!dry && last && first && day(first, last.date) > GOLD.slowDays && num(last.brix) > 0) flags.push('Still ' + last.brix + ' Brix after ' + day(first, last.date) + ' days');
    if (daysDry !== null && daysDry > GOLD.slowDays) flags.push('Slow: ' + daysDry + ' days to dry');
    if (!so2.length && f.kmbs_at_crush_g == null) flags.push('No SO2 at crush recorded');
    if (f.must_ph == null) flags.push('No must pH');
    a.forEach(function (x) { if (x.likely_note) flags.push(x.likely_note); });
    return { f: f, reads: r, adds: a, first: first, daysDry: daysDry, peakT: peakT, yeast: yeast, nutr: nutr, so2: so2, flags: flags };
  }

  function spark(reads) {
    var pts = reads.filter(function (x) { return num(x.brix) !== null; });
    if (pts.length < 2) return null;
    var t0 = new Date(pts[0].date).getTime(), t1 = new Date(pts[pts.length - 1].date).getTime() || t0 + 1;
    var w = 120, h = 30, lo = -2, hi = 26;
    var d = pts.map(function (p, i) {
      var x = ((new Date(p.date).getTime() - t0) / Math.max(1, t1 - t0)) * w;
      var y = h - ((Math.max(lo, Math.min(hi, num(p.brix))) - lo) / (hi - lo)) * h;
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
    var zero = h - ((0 - lo) / (hi - lo)) * h;
    return cmE('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, style: { display: 'block' } },
      cmE('line', { x1: 0, x2: w, y1: zero, y2: zero, stroke: C.cardBorder, strokeDasharray: '2 2' }),
      cmE('path', { d: d, fill: 'none', stroke: C.accentLight, strokeWidth: 1.6 }));
  }

  function CmFerment() {
    var sV = React.useState('2026'), v = sV[0], setV = sV[1];
    var sD = React.useState(null), D = sD[0], setD = sD[1];
    var sO = React.useState(null), open = sO[0], setOpen = sO[1];
    var sF = React.useState('all'), filt = sF[0], setFilt = sF[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    React.useEffect(function () {
      var live = true;
      Promise.all([cmFetch('fermenters'), cmFetch('ferment_readings'), cmFetch('fermenter_additions')]).then(function (a) { if (live) setD({ f: a[0], r: a[1], a: a[2] }); })
        .catch(function (e) { if (live) { setErr(e.message); setD({ f: [], r: [], a: [] }); } });
      return function () { live = false; };
    }, []);
    if (!D) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var vint = Number(v);
    var fs = D.f.filter(function (x) { return x.vintage === vint; }).sort(function (a, b) { return fnum(a.fermenter) - fnum(b.fermenter); });
    var reads = D.r.filter(function (x) { return x.vintage === vint && x.kind === 'Fermenter'; });
    var adds = D.a.filter(function (x) { return x.vintage === vint; });
    var rows = fs.map(function (f) { return cmFermSummary(f, reads, adds); });
    var shown = rows.filter(function (s) {
      if (filt === 'yeast') return s.yeast.length; if (filt === 'native') return !s.yeast.length; if (filt === 'flag') return s.flags.length; return true;
    });
    var tot = {};
    adds.forEach(function (x) { var k = x.product.replace(/ \(product not written; likely\)/, ''); tot[k] = tot[k] || { g: 0, n: 0, miss: 0, f: {} }; if (num(x.grams) !== null) tot[k].g += num(x.grams); else tot[k].miss++; tot[k].f[x.fermenter] = 1; });
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var inoc = rows.filter(function (s) { return s.yeast.length; }).length;
    var dd = rows.map(function (s) { return s.daysDry; }).filter(function (x) { return x !== null; });
    var avgDry = dd.length ? Math.round(dd.reduce(function (a, b) { return a + b; }, 0) / dd.length * 10) / 10 : null;

    var exportX = function () {
      if (!window.XLSX) return;
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(function (s) { return { Fermenter: s.f.fermenter, Vineyard: s.f.vineyard, Blocks: s.f.blocks, Intake: s.first, 'Days to dry': s.daysDry, 'Peak F': s.peakT, Yeast: s.yeast.map(function (y) { return y.product + (y.grams ? ' ' + y.grams + ' g' : ''); }).join('; '), Nutrients: s.nutr.map(function (y) { return y.product + (y.grams ? ' ' + y.grams + ' g' : ''); }).join('; '), 'SO2 at crush': s.so2.map(function (y) { return (y.grams || '') + ' g ' + (y.rate || ''); }).join('; '), Flags: s.flags.join(' | ') }; })), 'Fermenters');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(adds.map(function (x) { return { Fermenter: x.fermenter, Date: x.added_on, Product: x.product, Grams: x.grams, Rate: x.rate, Note: x.note, Likely: x.likely_note }; })), 'Additions');
      XLSX.writeFile(wb, 'CellarMate_fermentation_' + v + '.xlsx');
    };

    return cmE('div', null,
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 8 } }, err) : null,
      cmE('div', { style: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
        cmE('div', { style: { flex: '1 1 220px' } }, cmSeg([['2026', '2026'], ['2025', '2025'], ['2024', '2024']], v, setV)),
        cmE('div', { style: { flex: '2 1 320px' } }, cmSeg([['all', 'All'], ['yeast', 'Inoculated'], ['native', 'No yeast recorded'], ['flag', 'Needs a look']], filt, setFilt))),
      cmE('div', { style: Object.assign({}, card, { display: 'flex', gap: 16, flexWrap: 'wrap' }) },
        cmE('div', null, cmE('div', { style: { fontSize: 20, fontWeight: 700 } }, rows.length), cmE('div', { style: small }, 'fermenters')),
        cmE('div', null, cmE('div', { style: { fontSize: 20, fontWeight: 700 } }, inoc), cmE('div', { style: small }, 'yeast added')),
        cmE('div', null, cmE('div', { style: { fontSize: 20, fontWeight: 700 } }, rows.length - inoc), cmE('div', { style: small }, 'no yeast recorded')),
        cmE('div', null, cmE('div', { style: { fontSize: 20, fontWeight: 700 } }, avgDry == null ? '-' : avgDry), cmE('div', { style: small }, 'avg days to dry')),
        cmE('button', { onClick: exportX, style: { marginLeft: 'auto', background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 } }, 'Excel')),
      Object.keys(tot).length ? cmE('div', { style: card },
        cmE('div', { style: { fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6, textTransform: 'uppercase' } }, 'Products used in ' + v + ' ferments'),
        Object.keys(tot).sort().map(function (k) { var t = tot[k]; return cmE('div', { key: k, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' } }, cmE('span', null, k), cmE('span', { style: { color: C.textDim } }, (t.g ? Math.round(t.g) + ' g' : 'amount not written') + ' in ' + Object.keys(t.f).length + (Object.keys(t.f).length === 1 ? ' fermenter' : ' fermenters') + (t.miss && t.g ? ' (' + t.miss + ' without an amount)' : ''))); }))
        : cmE('div', { style: Object.assign({}, card, small) }, 'No additions recorded for ' + v + ' yet.'),
      shown.map(function (s) {
        var isOpen = open === s.f.fermenter;
        return cmE('div', { key: s.f.fermenter, style: card },
          cmE('div', { onClick: function () { setOpen(isOpen ? null : s.f.fermenter); }, style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexWrap: 'wrap' } },
            cmE('div', { style: { fontWeight: 800, minWidth: 40 } }, s.f.fermenter),
            cmE('div', { style: { flex: '1 1 200px', minWidth: 0 } },
              cmE('div', { style: { fontSize: 13 } }, [s.f.vineyard, s.f.blocks ? 'Blk ' + s.f.blocks : null, s.f.clone].filter(Boolean).join(' · ')),
              cmE('div', { style: small }, (s.yeast.length ? s.yeast.map(function (y) { return y.product.replace(' (strain not written)', ', strain not written'); }).join(', ') : 'No yeast recorded') + (s.nutr.length ? ' · ' + cmUniq(s.nutr.map(function (n) { return n.product.replace(/ \(.*\)/, ''); })).join(', ') : ''))),
            spark(s.reads),
            cmE('div', { style: Object.assign({}, small, { minWidth: 90, textAlign: 'right' }) }, (s.daysDry != null ? s.daysDry + ' d to dry' : '') + (s.peakT != null ? ' · ' + s.peakT + ' F' : '')),
            s.flags.length ? cmE('span', { style: { fontSize: 10, fontWeight: 700, color: C.orange, background: C.orangeDim, borderRadius: 6, padding: '2px 6px' } }, s.flags.length) : null),
          isOpen ? cmE('div', { style: { marginTop: 8, borderTop: '1px solid ' + C.cardBorder, paddingTop: 8 } },
            s.flags.map(function (fl, i) { return cmE('div', { key: 'f' + i, style: { fontSize: 12, color: C.orange, marginBottom: 3 } }, fl); }),
            s.adds.length ? s.adds.slice().sort(function (a, b) { return String(a.added_on || '') < String(b.added_on || '') ? -1 : 1; }).map(function (x) {
              return cmE('div', { key: x.id, style: { fontSize: 12, display: 'flex', gap: 8, padding: '2px 0' } },
                cmE('span', { style: { color: C.textDim, minWidth: 78 } }, x.added_on || 'at crush'),
                cmE('span', { style: { flex: 1 } }, x.product + (x.grams != null ? ', ' + x.grams + ' g' : '') + (x.rate ? ' (' + x.rate + ')' : '')));
            }) : cmE('div', { style: small }, 'No additions recorded.'),
            s.f.notes ? cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) }, s.f.notes) : null) : null);
      }),
      cmE('div', { style: Object.assign({}, small, { marginTop: 8 }) }, 'Gold-standard checks: yeast and nutrients recorded per fermenter, SO2 and pH at crush, peak temperature under ' + GOLD.hotF + ' F, dry within ' + GOLD.slowDays + ' days. YAN is not measured yet, so nutrient doses cannot be checked against need.'));
  }

  window.cmFermSummary = cmFermSummary;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.ferm = { label: 'Ferment', Component: CmFerment, order: 45 };
})();
