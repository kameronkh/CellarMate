/* CellarMate module: Materials (what was bought, what was used, pace, cost)
   Built from purchase_lines (Crush2Cellar invoices), supply_lots, supply_uses,
   supply_counts and fermenter_additions. Registers itself in CM_MODULES. */
(function () {
  'use strict';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function money(n) { return '$' + Math.round(n || 0).toLocaleString(); }
  function days(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

  function cmMaterialRows(D) {
    return D.sup.map(function (s) {
      var lines = D.pl.filter(function (p) { return p.supply_id === s.id; });
      var lots = D.lots.filter(function (l) { return l.supply_id === s.id; });
      var dates = cmUniq(lots.map(function (l) { return l.received_on; }).filter(Boolean)).sort();
      var bought = lots.reduce(function (t, l) { return t + (num(l.packs) || 0); }, 0);
      var spend = lines.reduce(function (t, p) { return t + (num(p.amount) || 0); }, 0);
      var upp = num(s.units_per_pack);
      var usesLogged = D.uses.filter(function (u) { return u.supply_id === s.id; }).reduce(function (t, u) { return t + (num(u.qty) || 0); }, 0);
      var fa = D.fa.filter(function (x) { return x.supply_id === s.id; });
      var faLikely = D.fa.filter(function (x) { return !x.supply_id && x.likely_supply_id === s.id; });
      var faG = fa.reduce(function (t, x) { return t + (num(x.grams) || 0); }, 0);
      var likelyG = faLikely.reduce(function (t, x) { return t + (num(x.grams) || 0); }, 0);
      var count = D.counts.filter(function (c) { return c.supply_id === s.id; }).sort(function (a, b) { return String(b.counted_on) < String(a.counted_on) ? -1 : 1; })[0];
      var pace = dates.length > 1 ? Math.round(days(dates[0], dates[dates.length - 1]) / (dates.length - 1)) : null;
      var sinceLast = dates.length ? days(dates[dates.length - 1], new Date().toISOString().slice(0, 10)) : null;
      var isGrams = s.unit === 'g';
      var usedG = isGrams ? faG + usesLogged : null;
      var left = isGrams ? bought - faG - likelyG - usesLogged : null;
      var note = [];
      if (s.unit === 'tablet' && upp == null) note.push('Pack size not known yet: answer the tablets question to see tablets on hand.');
      if (isGrams && left !== null && left < 0) note.push('More logged than bought: some stock came from before Sep 2024 or another supplier.');
      if (!count) note.push('No stock count yet, so on-hand is not shown. Uses before this app (crush additions, cleaning) were mostly not logged.');
      return { s: s, lines: lines, buys: dates.length, first: dates[0] || null, last: dates[dates.length - 1] || null, pace: pace, sinceLast: sinceLast, bought: bought, spend: spend, faG: faG, likelyG: likelyG, usesLogged: usesLogged, usedG: usedG, left: left, count: count, note: note,
        perUse: spend && (fa.length + faLikely.length) ? spend / (fa.length + faLikely.length) : null };
    });
  }

  function CmMaterials() {
    var sD = React.useState(null), D = sD[0], setD = sD[1];
    var sC = React.useState('all'), cat = sC[0], setCat = sC[1];
    var sV = React.useState('items'), view = sV[0], setView = sV[1];
    var sO = React.useState(null), open = sO[0], setOpen = sO[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    React.useEffect(function () {
      var live = true;
      Promise.all(['supplies', 'supply_lots', 'supply_uses', 'supply_counts', 'purchase_lines', 'fermenter_additions'].map(function (t) { return cmFetch(t); }))
        .then(function (a) { if (live) setD({ sup: a[0], lots: a[1], uses: a[2], counts: a[3], pl: a[4], fa: a[5] }); })
        .catch(function (e) { if (live) { setErr(e.message); setD({ sup: [], lots: [], uses: [], counts: [], pl: [], fa: [] }); } });
      return function () { live = false; };
    }, []);
    if (!D) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var rows = cmMaterialRows(D).filter(function (r) { return r.buys; });
    var cats = cmUniq(rows.map(function (r) { return r.s.category; })).sort();
    var shown = rows.filter(function (r) { return cat === 'all' || r.s.category === cat; }).sort(function (a, b) { return b.spend - a.spend; });
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var catSpend = {}; D.pl.forEach(function (p) { var k = p.category || 'Other'; catSpend[k] = (catSpend[k] || 0) + (num(p.amount) || 0); });
    var months = {}; D.pl.forEach(function (p) { var m = String(p.doc_date || '').slice(0, 7); if (!m) return; months[m] = (months[m] || 0) + (num(p.amount) || 0); });
    var total = Object.keys(catSpend).reduce(function (t, k) { return t + catSpend[k]; }, 0);

    var exportX = function () {
      if (!window.XLSX) return;
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(function (r) { return { Product: r.s.name, Category: r.s.category, Unit: r.s.unit, 'Times bought': r.buys, 'First bought': r.first, 'Last bought': r.last, 'Days between orders': r.pace, Bought: r.bought, Spend: Math.round(r.spend * 100) / 100, 'Used in ferments (g)': r.faG, 'Likely used (g, to confirm)': r.likelyG, 'Other uses logged': r.usesLogged, 'Estimated left': r.left, 'Last count': r.count ? r.count.qty + ' on ' + r.count.counted_on : '', Notes: r.note.join(' ') }; })), 'Materials');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(D.pl.map(function (p) { return { Date: p.doc_date, Document: p.doc, Code: p.code, Description: p.description, Qty: p.qty, Unit: p.unit, Amount: p.amount, Category: p.category, Lot: p.lot_no }; })), 'Purchase lines');
      XLSX.writeFile(wb, 'CellarMate_materials.xlsx');
    };

    var head = cmE('div', { style: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
      cmE('div', { style: { flex: '1 1 260px' } }, cmSeg([['items', 'Products'], ['spend', 'Spend'], ['lines', 'Invoices']], view, setView)),
      cmE('select', { value: cat, onChange: function (e) { setCat(e.target.value); }, style: Object.assign({}, cmSel, { flex: '1 1 160px' }) }, [cmE('option', { key: 'all', value: 'all' }, 'All categories')].concat(cats.map(function (c) { return cmE('option', { key: c, value: c }, c); }))),
      cmE('button', { onClick: exportX, style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 } }, 'Excel'));

    if (view === 'spend') {
      var mk = Object.keys(months).sort();
      var max = Math.max.apply(null, mk.map(function (m) { return months[m]; }).concat([1]));
      return cmE('div', null, head,
        cmE('div', { style: card }, cmE('div', { style: { fontWeight: 700, marginBottom: 6 } }, money(total) + ' on ' + D.pl.length + ' invoice lines'),
          Object.keys(catSpend).sort(function (a, b) { return catSpend[b] - catSpend[a]; }).map(function (k) {
            return cmE('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '2px 0' } }, cmE('span', { style: { minWidth: 150 } }, k),
              cmE('div', { style: { flex: 1, height: 8, background: C.cardBorder, borderRadius: 4 } }, cmE('div', { style: { width: (catSpend[k] / total * 100) + '%', height: 8, background: C.accent, borderRadius: 4 } })),
              cmE('span', { style: { minWidth: 70, textAlign: 'right', color: C.textDim } }, money(catSpend[k])));
          })),
        cmE('div', { style: card }, cmE('div', { style: { fontWeight: 700, marginBottom: 6 } }, 'By month'),
          mk.map(function (m) { return cmE('div', { key: m, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 } }, cmE('span', { style: { minWidth: 60 } }, m), cmE('div', { style: { flex: 1, height: 6, background: C.cardBorder, borderRadius: 3 } }, cmE('div', { style: { width: (months[m] / max * 100) + '%', height: 6, background: C.accentLight, borderRadius: 3 } })), cmE('span', { style: { minWidth: 70, textAlign: 'right', color: C.textDim } }, money(months[m]))); })));
    }
    if (view === 'lines') {
      var pl = D.pl.filter(function (p) { return cat === 'all' || p.category === cat; }).sort(function (a, b) { return String(b.doc_date) < String(a.doc_date) ? -1 : 1; });
      return cmE('div', null, head, cmE('div', { style: card }, pl.slice(0, 300).map(function (p) {
        return cmE('div', { key: p.id, style: { display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px solid ' + C.cardBorder } },
          cmE('span', { style: { minWidth: 80, color: C.textDim } }, p.doc_date), cmE('span', { style: { flex: 1 } }, p.description), cmE('span', { style: { minWidth: 40, textAlign: 'right' } }, p.qty), cmE('span', { style: { minWidth: 70, textAlign: 'right', color: C.textDim } }, money(p.amount)));
      }), pl.length > 300 ? cmE('div', { style: small }, 'Showing 300 of ' + pl.length + '. Use Excel for all.') : null));
    }
    return cmE('div', null, head,
      err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
      shown.map(function (r) {
        var isOpen = open === r.s.id;
        var u = r.s.unit === 'tablet' && r.s.units_per_pack == null ? 'box' : r.s.unit;
        var usedAll = r.faG + r.likelyG + r.usesLogged;
        var sub = r.count ? 'counted ' + r.count.qty + ' on ' + r.count.counted_on
          : cmQtyText(r.bought, u) + ' bought' + (usedAll ? ' · ' + cmQtyText(usedAll, r.s.unit === 'g' ? 'g' : r.s.unit) + ' use logged' : '');
        return cmE('div', { key: r.s.id, style: card },
          cmE('div', { onClick: function () { setOpen(isOpen ? null : r.s.id); }, style: { display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap' } },
            cmE('div', { style: { flex: '1 1 220px', minWidth: 0 } }, cmE('div', { style: { fontWeight: 700, fontSize: 13 } }, r.s.name), cmE('div', { style: small }, r.s.category + ' · bought ' + r.buys + 'x, last ' + r.last + (r.pace ? ' · about every ' + r.pace + ' days' : ''))),
            cmE('div', { style: { textAlign: 'right', minWidth: 120 } }, cmE('div', { style: { fontWeight: 700 } }, money(r.spend)),
              cmE('div', { style: small }, sub))),
          isOpen ? cmE('div', { style: { marginTop: 8, borderTop: '1px solid ' + C.cardBorder, paddingTop: 8, fontSize: 12 } },
            cmE('div', null, 'Bought: ' + cmQtyText(r.bought, u) + ' between ' + r.first + ' and ' + r.last),
            r.faG ? cmE('div', null, 'Used in ferments: ' + cmQtyText(r.faG, 'g')) : null,
            r.likelyG ? cmE('div', { style: { color: C.orange } }, 'Likely used in ferments (to confirm): ' + cmQtyText(r.likelyG, 'g')) : null,
            r.usesLogged ? cmE('div', null, 'Other uses logged: ' + cmQtyText(r.usesLogged, r.s.unit)) : null,
            r.count ? cmE('div', null, 'Last count: ' + r.count.qty + ' on ' + r.count.counted_on) : null,
            r.note.map(function (n, i) { return cmE('div', { key: i, style: { color: C.textDim } }, n); }),
            r.lines.map(function (p) { return cmE('div', { key: p.id, style: { display: 'flex', gap: 8, color: C.textDim } }, cmE('span', { style: { minWidth: 80 } }, p.doc_date), cmE('span', { style: { flex: 1 } }, p.qty + ' x ' + p.description + (p.lot_no ? ' (lot ' + p.lot_no + ')' : '')), cmE('span', null, money(p.amount))); })) : null);
      }));
  }

  window.cmMaterialRows = cmMaterialRows;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.mat = { label: 'Materials', Component: CmMaterials, order: 75 };
})();
