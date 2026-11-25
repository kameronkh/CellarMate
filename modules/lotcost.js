/* CellarMate module: Costs per lot (materials only, from invoices and fermenter records)
   Unit cost = invoice spend / amount bought (per gram where the product is bought by weight).
   Fermenter additions are priced, then shared out to the lots each fermenter went into,
   in proportion to how many barrels of each lot came from it. Registers in CM_MODULES. */
(function () {
  'use strict';
  var GAL_PER_BARREL = 59.4; /* 225 L */
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function money(n) { return '$' + (Math.round((n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function cmUnitCosts(sup, lots, pl) {
    var out = {};
    sup.forEach(function (s) {
      var bought = lots.filter(function (l) { return l.supply_id === s.id; }).reduce(function (t, l) { return t + (num(l.packs) || 0); }, 0);
      var spend = pl.filter(function (p) { return p.supply_id === s.id; }).reduce(function (t, p) { return t + (num(p.amount) || 0); }, 0);
      out[s.id] = { name: s.name, unit: s.unit, perUnit: bought > 0 && spend > 0 ? spend / bought : null, spend: spend, bought: bought };
    });
    return out;
  }
  function cmFermentersOf(lotName) {
    var m = String(lotName || '').match(/\(([^)]*)\)/); if (!m) return [];
    var out = [];
    var parts = m[1].split(/[\/,]/).map(function (t) { return t.trim(); });
    if (!/^F\s*\d+$/i.test(parts[0] || '')) return [];
    parts.forEach(function (t) { var x = t.match(/^F?\s*(\d+)$/i); if (x) out.push('F' + Number(x[1])); });
    return out;
  }
  function cmLotCosts(st26, fa, unit, vintage, ferms) {
    var v = vintage || 2026;
    var byVineyard = function (name) {
      var w = String(name).split(/[ (;]/)[0].toLowerCase(); if (!w || !ferms) return [];
      var hits = ferms.filter(function (f) { return f.vintage === v && String(f.vineyard || '').toLowerCase() === w; }).map(function (f) { return f.fermenter; });
      return hits;
    };
    var lots = {};
    st26.forEach(function (b) {
      var name = (b.lot_name || '').replace(/;.*$/, '').trim(); if (!name) return;
      var fs = cmFermentersOf(name); if (!fs.length && /red/i.test(b.wine_type || '')) { fs = byVineyard(name); if (fs.length) name = name.split(/[ (;]/)[0] + ' (' + fs.join(', ') + ')'; } if (!fs.length) return;
      var L = lots[name] = lots[name] || { lot: name, owner: b.owner, fermenters: fs, barrels: 0, cost: 0, parts: {}, unpriced: [] };
      L.barrels++;
    });
    var byF = {};
    Object.keys(lots).forEach(function (k) { lots[k].fermenters.forEach(function (f) { (byF[f] = byF[f] || []).push(lots[k]); }); });
    fa.filter(function (a) { return a.vintage === v; }).forEach(function (a) {
      var share = byF[a.fermenter]; if (!share) return;
      var sid = a.supply_id || a.likely_supply_id; var u = sid ? unit[sid] : null; var g = num(a.grams);
      var tot = share.reduce(function (t, L) { return t + L.barrels; }, 0) || 1;
      var label = a.product.replace(/ \(.*\)$/, '').replace('Yeast (strain not written', 'Yeast');
      share.forEach(function (L) {
        if (u && u.perUnit != null && g != null && u.unit === 'g') {
          var c = u.perUnit * g * (L.barrels / tot);
          L.cost += c; L.parts[label] = (L.parts[label] || 0) + c;
        } else if (L.unpriced.indexOf(label) === -1) L.unpriced.push(label + (g == null ? ' (amount not written)' : ' (no price)'));
      });
    });
    return Object.keys(lots).map(function (k) { var L = lots[k]; L.perBarrel = L.barrels ? L.cost / L.barrels : 0; L.perGallon = L.barrels ? L.cost / (L.barrels * GAL_PER_BARREL) : 0; return L; })
      .sort(function (a, b) { return b.cost - a.cost; });
  }

  function CmLotCost() {
    var sD = React.useState(null), D = sD[0], setD = sD[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    var sO = React.useState(null), open = sO[0], setOpen = sO[1];
    React.useEffect(function () {
      var live = true;
      Promise.all(['supplies', 'supply_lots', 'purchase_lines', 'fermenter_additions', 'barrel_status_2026', 'fermenters'].map(function (t) { return cmFetch(t); }))
        .then(function (a) { if (live) setD({ sup: a[0], lots: a[1], pl: a[2], fa: a[3], s26: a[4], fe: a[5] }); })
        .catch(function (e) { if (live) { setErr(e.message); setD({ sup: [], lots: [], pl: [], fa: [], s26: [], fe: [] }); } });
      return function () { live = false; };
    }, []);
    if (!D) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var unit = cmUnitCosts(D.sup, D.lots, D.pl);
    var rows = cmLotCosts(D.s26, D.fa, unit, 2026, D.fe);
    var total = rows.reduce(function (t, r) { return t + r.cost; }, 0);
    var barrels = rows.reduce(function (t, r) { return t + r.barrels; }, 0);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var exportX = function () {
      if (!window.XLSX) return;
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(function (r) { var o = { Lot: r.lot, Owner: r.owner, Fermenters: r.fermenters.join(' '), Barrels: r.barrels, 'Materials cost': Math.round(r.cost * 100) / 100, 'Per barrel': Math.round(r.perBarrel * 100) / 100, 'Per gallon': Math.round(r.perGallon * 1000) / 1000, 'Not priced': r.unpriced.join('; ') }; Object.keys(r.parts).forEach(function (k) { o[k] = Math.round(r.parts[k] * 100) / 100; }); return o; })), 'Lots 2026');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(D.sup.map(function (s) { var u = unit[s.id]; return { Product: s.name, Unit: s.unit, Spend: Math.round(u.spend * 100) / 100, Bought: u.bought, 'Cost per unit': u.perUnit == null ? '' : Math.round(u.perUnit * 10000) / 10000 }; })), 'Unit costs');
      XLSX.writeFile(wb, 'CellarMate_lot_costs_2026.xlsx');
    };
    return cmE('div', null,
      err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
      cmE('div', { style: Object.assign({}, card, { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }) },
        cmE('div', null, cmE('div', { style: { fontSize: 20, fontWeight: 700 } }, money(total)), cmE('div', { style: small }, '2026 fermentation materials')),
        cmE('div', null, cmE('div', { style: { fontSize: 20, fontWeight: 700 } }, rows.length), cmE('div', { style: small }, 'lots priced')),
        cmE('div', null, cmE('div', { style: { fontSize: 20, fontWeight: 700 } }, barrels ? money(total / barrels) : '-'), cmE('div', { style: small }, 'average per barrel')),
        cmE('button', { onClick: exportX, style: { marginLeft: 'auto', background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 } }, 'Excel')),
      cmE('div', { style: Object.assign({}, small, { marginBottom: 8 }) }, 'Counted: yeast, Go-Ferm, nutrients, SO2 at crush and tartaric from the 2026 fermenter sheets, priced from the Crush2Cellar invoices. Not counted yet: SO2 tablets (box size unknown), lab strips, barrels, fruit, labor.'),
      rows.map(function (r) {
        var isO = open === r.lot;
        return cmE('div', { key: r.lot, style: card },
          cmE('div', { onClick: function () { setOpen(isO ? null : r.lot); }, style: { display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap' } },
            cmE('div', { style: { flex: '1 1 220px', minWidth: 0 } }, cmE('div', { style: { fontWeight: 700, fontSize: 13 } }, r.lot), cmE('div', { style: small }, r.barrels + ' barrel' + (r.barrels === 1 ? '' : 's') + ' · ' + r.fermenters.join(', ') + (r.owner && !/tystrya/i.test(r.owner) ? ' · ' + r.owner : ''))),
            cmE('div', { style: { textAlign: 'right' } }, cmE('div', { style: { fontWeight: 700 } }, money(r.cost)), cmE('div', { style: small }, money(r.perBarrel) + ' per barrel · ' + money(r.perGallon) + '/gal'))),
          isO ? cmE('div', { style: { marginTop: 8, borderTop: '1px solid ' + C.cardBorder, paddingTop: 6, fontSize: 12 } },
            Object.keys(r.parts).sort(function (a, b) { return r.parts[b] - r.parts[a]; }).map(function (k) { return cmE('div', { key: k, style: { display: 'flex', justifyContent: 'space-between' } }, cmE('span', null, k), cmE('span', null, money(r.parts[k]))); }),
            r.unpriced.length ? cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Not priced: ' + r.unpriced.join(', ')) : null) : null);
      }));
  }

  window.cmUnitCosts = cmUnitCosts; window.cmLotCosts = cmLotCosts; window.cmFermentersOf = cmFermentersOf;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.lotcost = { label: 'Cost per lot', Component: CmLotCost, order: 65 };
})();
