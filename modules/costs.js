/* CellarMate module: Winemaking cost sheet and winery assets
   Cost sheet
   - Built from purchase_lines (every supplier invoice imported: Crush2Cellar, Industrial Source gases,
     filtration, glass, labels, grapes) plus oak depreciation from winery_assets.
   - Each line goes to a vintage: the vintage set on the line, else the lot on the line ("24 Signature PN"
     is 2024), else grapes by harvest year, else the wine year (August to July belongs to the vintage
     picked that August).
   - Barrels and gas equipment are assets: they are not expensed on purchase. Oak cost reaches each
     vintage as straight-line depreciation over the barrel's life.
   - Cost per ton, gallon, case and bottle uses tons crushed (fermenters, Tystrya fruit) and a yield in
     gallons per ton you can change.
   Assets
   - Barrels, tanks, kegs, gas equipment, rented cylinders and other gear, with cost, date, life and
     salvage. Current value is straight line to salvage. Rented items are listed but not counted.
   Registers CM_MODULES.cost ('Costs') and CM_MODULES.assets ('Assets').
   Pure helpers for the smoke tests: cmLineVintage, cmCostGroup, cmAssetValue, cmCostSheet. */
(function () {
  'use strict';
  var ORG = '762fc809-0341-4ee2-834f-16e707181ea7';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function db() { return supa.schema('cellarmate'); }

  var CAPITAL = { 'Barrels': 1, 'Gas equipment': 1, 'Small equipment': 1 };
  var NOTCOGS = { 'Sales and marketing': 1 }; /* selling costs, kept out of cost of goods */
  var GROUPS = [
    ['Fruit', ['Grapes']],
    ['Fermentation and cellar supplies', ['Yeast', 'Yeast nutrient', 'ML bacteria', 'Enzyme', 'Acid', 'SO2', 'Lees / mouthfeel', 'Cleaning', 'Lab']],
    ['Gases and dry ice', ['Dry ice', 'Argon', 'Nitrogen', 'CO2', 'Gas surcharges', 'Gas delivery and fees', 'Cylinder rental']],
    ['Filtration', ['Filtration']],
    ['Packaging', ['Glass', 'Labels and printing', 'Packaging', 'Closures']],
    ['Equipment, parts and repairs', ['Equipment and parts']],
    ['Oak (depreciation)', ['Oak depreciation']],
    ['Late fees and finance charges', ['Late fees']]
  ];
  function cmCostGroup(cat) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][1].indexOf(cat) >= 0) return GROUPS[i][0];
    return 'Other';
  }
  function cmLineVintage(l) {
    if (num(l.vintage)) return num(l.vintage);
    var m = /^\s*'?(\d{2})\s/.exec(l.lot_no || ''); if (m) return 2000 + +m[1];
    var d = String(l.doc_date || ''); if (!d) return null;
    var y = +d.slice(0, 4), mo = +d.slice(5, 7);
    if (l.category === 'Grapes') return y;
    return mo >= 8 ? y : y - 1;
  }
  function years(a, b) { return (b - a) / (365.25 * 864e5); }
  function cmAssetValue(a, asOf) {
    var c = num(a.unit_cost), q = num(a.qty) || 0;
    if (c == null) return { cost: null, value: null, each: null };
    if (a.owned === false) return { cost: c * q, value: 0, each: 0, rented: true };
    var life = num(a.life_years), s = num(a.salvage_each) || 0;
    var t = asOf ? new Date(asOf).getTime() : Date.now();
    var age = a.acquired_on ? Math.max(0, years(new Date(a.acquired_on).getTime(), t)) : null;
    var each = !life || age == null ? c : Math.max(s, c - (c - s) * age / life);
    return { cost: c * q, value: each * q, each: each, age: age };
  }
  /* depreciation of owned barrel assets that falls in vintage y (vintage year runs Aug y to Jul y+1) */
  function oakFor(assets, y) {
    var tot = 0, items = [];
    (assets || []).forEach(function (a) {
      if (a.kind !== 'Barrel' || a.owned === false) return;
      var c = num(a.unit_cost), life = num(a.life_years), q = num(a.qty) || 0, s = num(a.salvage_each) || 0;
      if (c == null || !life || !a.acquired_on) return;
      var d = String(a.acquired_on), y0 = +d.slice(5, 7) >= 8 ? +d.slice(0, 4) : +d.slice(0, 4) - 1;
      if (+d.slice(5, 7) >= 5 && +d.slice(5, 7) < 8) y0 = +d.slice(0, 4); /* bought in spring or summer for that harvest */
      if (y < y0 || y >= y0 + life) return;
      var amt = (c - s) / life * q; tot += amt; items.push({ name: a.name, amount: amt });
    });
    return { total: tot, items: items };
  }
  function cmCostSheet(lines, assets, ferm, y, galPerTon) {
    var byCat = {}, use = [];
    (lines || []).forEach(function (l) {
      if (CAPITAL[l.category] || NOTCOGS[l.category]) return;
      if (cmLineVintage(l) !== y) return;
      var k = l.category || 'Other'; byCat[k] = (byCat[k] || 0) + (num(l.amount) || 0); use.push(l);
    });
    var oak = oakFor(assets, y); if (oak.total) byCat['Oak depreciation'] = oak.total;
    var rows = Object.keys(byCat).map(function (k) { return { group: cmCostGroup(k), cat: k, amount: byCat[k] }; });
    var order = GROUPS.map(function (g) { return g[0]; }).concat(['Other']);
    rows.sort(function (a, b) { return order.indexOf(a.group) - order.indexOf(b.group) || b.amount - a.amount; });
    var total = rows.reduce(function (t, r) { return t + r.amount; }, 0);
    var tons = (ferm || []).filter(function (f) { return +f.vintage === y && (!f.owner || /tystrya/i.test(f.owner)); }).reduce(function (t, f) { return t + (num(f.tons) || 0); }, 0);
    var gal = tons * (num(galPerTon) || 150), cases = gal / 2.378;
    return { y: y, rows: rows, total: total, lines: use, oak: oak, tons: tons, gallons: gal, cases: cases,
      perTon: tons ? total / tons : null, perGal: gal ? total / gal : null, perCase: cases ? total / cases : null, perBottle: cases ? total / cases / 12 : null };
  }

  var card = function () { return { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }; };
  var small = function () { return { fontSize: 11, color: C.textDim }; };
  var th = function (l) { return { textAlign: l ? 'left' : 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' }; };
  var td = function (l) { return { textAlign: l ? 'left' : 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: l ? 'normal' : 'nowrap' }; };
  var inp = function () { return { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '5px 7px', fontSize: 12, width: '100%', boxSizing: 'border-box' }; };
  var money = function (x, d) { return x == null ? '' : '$' + Number(x).toLocaleString(undefined, { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };

  function CmCostSheet() {
    var org = (typeof CM_ME !== 'undefined' && CM_ME.org_id) || ORG;
    var s1 = React.useState(null), D = s1[0], setD = s1[1];
    var s2 = React.useState(2025), y = s2[0], setY = s2[1];
    var s3 = React.useState('150'), gpt = s3[0], setGpt = s3[1];
    var s4 = React.useState(''), open = s4[0], setOpen = s4[1];
    var s5 = React.useState(''), err = s5[0], setErr = s5[1];
    var load = function () {
      if (typeof CM_CACHE !== 'undefined') { delete CM_CACHE.purchase_lines; delete CM_CACHE.winery_assets; }
      Promise.all([cmFetch('purchase_lines'), cmFetch('winery_assets'), cmFetch('fermenters')])
        .then(function (a) { setD({ pl: a[0], as: a[1], f: a[2] }); }).catch(function (e) { setErr(e.message); setD({ pl: [], as: [], f: [] }); });
    };
    React.useEffect(load, []);
    if (!D) return cmE('div', { style: card() }, 'Loading costs...');
    var S = cmCostSheet(D.pl, D.as, D.f, y, gpt);
    var all = [2024, 2025, 2026].map(function (v) { return cmCostSheet(D.pl, D.as, D.f, v, gpt); });
    var setVint = function (l, v) { db().from('purchase_lines').update({ vintage: v ? +v : null }).eq('id', l.id).then(function (r) { if (r.error) setErr(r.error.message); else load(); }); };
    var sup = {}; S.lines.forEach(function (l) { sup[l.supplier || 'Unknown'] = (sup[l.supplier || 'Unknown'] || 0) + (num(l.amount) || 0); });
    var capital = D.pl.filter(function (l) { return CAPITAL[l.category]; });
    var exportX = function () {
      var wb = XLSX.utils.book_new();
      all.forEach(function (s) { XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows.map(function (r) { return { Group: r.group, Category: r.cat, Amount: Math.round(r.amount * 100) / 100, 'Per case': s.cases ? Math.round(r.amount / s.cases * 100) / 100 : null }; }).concat([{ Group: 'Total', Amount: Math.round(s.total * 100) / 100 }, { Group: 'Tons', Amount: s.tons }, { Group: 'Gallons (est.)', Amount: Math.round(s.gallons) }, { Group: 'Cases (est.)', Amount: Math.round(s.cases) }])), 'Vintage ' + s.y); });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(D.pl.map(function (p) { return { Vintage: cmLineVintage(p), Supplier: p.supplier, Date: p.doc_date, Document: p.doc, Description: p.description, Lot: p.lot_no, Qty: p.qty, Unit: p.unit, Amount: p.amount, Category: p.category, Group: CAPITAL[p.category] ? 'Asset' : NOTCOGS[p.category] ? 'Sales and marketing (not cost of goods)' : cmCostGroup(p.category) }; })), 'All invoice lines');
      XLSX.writeFile(wb, 'CellarMate_cost_sheet_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    };
    var lastG = '';
    return cmE('div', null,
      cmE('div', { style: card() },
        cmE('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          cmE('div', { style: { fontWeight: 700 } }, 'Winemaking cost sheet'),
          cmE('select', { value: y, onChange: function (e) { setY(+e.target.value); }, style: Object.assign(inp(), { width: 90 }) }, [2024, 2025, 2026].map(function (v) { return cmE('option', { key: v, value: v }, 'Vintage ' + v); })),
          cmE('label', { style: small() }, 'Gallons per ton ', cmE('input', { value: gpt, onChange: function (e) { setGpt(e.target.value); }, inputMode: 'decimal', style: Object.assign(inp(), { width: 60, display: 'inline-block' }) })),
          cmE('button', { onClick: exportX, style: { marginLeft: 'auto', background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 } }, 'Excel')),
        err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
        cmE('div', { style: Object.assign(small(), { margin: '4px 0 6px' }) }, S.tons.toFixed(2) + ' tons of Tystrya fruit crushed, about ' + Math.round(S.gallons).toLocaleString() + ' gallons and ' + Math.round(S.cases).toLocaleString() + ' cases at ' + gpt + ' gallons per ton. Invoices go to a vintage by the lot named on the line, by harvest year for grapes, otherwise August to July. Barrels are assets and reach the vintage as depreciation.'),
        cmE('div', { style: { overflowX: 'auto' } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 520 } },
          cmE('thead', null, cmE('tr', null, ['Cost', 'Amount', 'Share', 'Per ton', 'Per case', 'Per bottle'].map(function (x, i) { return cmE('th', { key: x, style: th(i === 0) }, x); }))),
          cmE('tbody', null, S.rows.map(function (r) {
            var head = r.group !== lastG; lastG = r.group;
            return [head ? cmE('tr', { key: 'g' + r.group }, cmE('td', { colSpan: 6, style: Object.assign(td(true), { fontWeight: 700, paddingTop: 8 }) }, r.group)) : null,
              cmE('tr', { key: r.cat }, cmE('td', { style: Object.assign(td(true), { paddingLeft: 16 }) }, r.cat), cmE('td', { style: td() }, money(r.amount)), cmE('td', { style: td() }, S.total ? Math.round(r.amount / S.total * 100) + '%' : ''),
                cmE('td', { style: td() }, S.tons ? money(r.amount / S.tons) : ''), cmE('td', { style: td() }, S.cases ? money(r.amount / S.cases, 2) : ''), cmE('td', { style: td() }, S.cases ? money(r.amount / S.cases / 12, 2) : ''))];
          }), cmE('tr', { key: 'tot' }, cmE('td', { style: Object.assign(td(true), { fontWeight: 700 }) }, 'Total'), cmE('td', { style: Object.assign(td(), { fontWeight: 700 }) }, money(S.total)), cmE('td', { style: td() }, ''),
            cmE('td', { style: Object.assign(td(), { fontWeight: 700 }) }, money(S.perTon)), cmE('td', { style: Object.assign(td(), { fontWeight: 700 }) }, money(S.perCase, 2)), cmE('td', { style: Object.assign(td(), { fontWeight: 700 }) }, money(S.perBottle, 2)))))),
        cmE('div', { style: Object.assign(small(), { marginTop: 6 }) }, 'Not in these numbers yet: estate vineyard farming (see Vine Blocks budget), labor, rent, consulting and compliance. Each is a question in the list.')),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Vintages side by side'),
        cmE('div', { style: { overflowX: 'auto' } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 420 } },
          cmE('thead', null, cmE('tr', null, ['', '2024', '2025', '2026'].map(function (x, i) { return cmE('th', { key: 'h' + i, style: th(i === 0) }, x); }))),
          cmE('tbody', null, GROUPS.map(function (g) { return g[0]; }).concat(['Total', 'Tons', 'Per case']).map(function (gname) {
            return cmE('tr', { key: gname }, cmE('td', { style: td(true) }, gname), all.map(function (s) {
              var v = gname === 'Total' ? money(s.total) : gname === 'Tons' ? s.tons.toFixed(1) : gname === 'Per case' ? money(s.perCase, 2) : money(s.rows.filter(function (r) { return r.group === gname; }).reduce(function (t, r) { return t + r.amount; }, 0) || null);
              return cmE('td', { key: s.y, style: td() }, v);
            }));
          }))))),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'By supplier, vintage ' + y),
        Object.keys(sup).sort(function (a, b) { return sup[b] - sup[a]; }).map(function (k) { return cmE('div', { key: k, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' } }, cmE('span', null, k), cmE('span', null, money(sup[k]))); }),
        cmE('div', { style: Object.assign(small(), { marginTop: 6 }) }, 'Bought as assets (not expensed): ' + money(capital.reduce(function (t, l) { return t + (num(l.amount) || 0); }, 0)) + ' on ' + capital.length + ' lines. See Assets. Sales and marketing kept out of cost of goods: ' + money(D.pl.filter(function (l) { return NOTCOGS[l.category]; }).reduce(function (t, l) { return t + (num(l.amount) || 0); }, 0)) + '.')),
      cmE('div', { style: card() },
        cmE('div', { style: { display: 'flex', justifyContent: 'space-between' } }, cmE('div', { style: { fontWeight: 700 } }, 'Invoice lines in vintage ' + y + ' (' + S.lines.length + ')'),
          cmE('button', { onClick: function () { setOpen(open ? '' : 'x'); }, style: { fontSize: 11, cursor: 'pointer' } }, open ? 'Hide' : 'Show')),
        open ? cmE('div', { style: { overflowX: 'auto', marginTop: 6 } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 640 } },
          cmE('thead', null, cmE('tr', null, ['Date', 'Supplier', 'Description', 'Category', 'Amount', 'Vintage'].map(function (x, i) { return cmE('th', { key: x, style: th(i < 4) }, x); }))),
          cmE('tbody', null, S.lines.slice().sort(function (a, b) { return String(b.doc_date) < String(a.doc_date) ? -1 : 1; }).slice(0, 400).map(function (l) {
            return cmE('tr', { key: l.id }, cmE('td', { style: td(true) }, l.doc_date), cmE('td', { style: td(true) }, l.supplier), cmE('td', { style: td(true) }, (l.description || '') + (l.lot_no ? ' · ' + l.lot_no : '')), cmE('td', { style: td(true) }, l.category),
              cmE('td', { style: td() }, money(l.amount, 2)),
              cmE('td', { style: td() }, cmE('select', { value: l.vintage || '', onChange: function (e) { setVint(l, e.target.value); }, style: { fontSize: 11 } }, [cmE('option', { key: 'a', value: '' }, 'auto ' + cmLineVintage(Object.assign({}, l, { vintage: null })))].concat([2023, 2024, 2025, 2026, 2027].map(function (v) { return cmE('option', { key: v, value: v }, v); })))));
          })))) : null));
  }

  function CmAssets() {
    var org = (typeof CM_ME !== 'undefined' && CM_ME.org_id) || ORG;
    var s1 = React.useState(null), D = s1[0], setD = s1[1];
    var s2 = React.useState(''), err = s2[0], setErr = s2[1];
    var blank = { kind: 'Barrel', name: '', qty: '1', unit_cost: '', acquired_on: '', life_years: '5', salvage_each: '0', note: '' };
    var s3 = React.useState(blank), F = s3[0], setF = s3[1];
    var load = function () {
      if (typeof CM_CACHE !== 'undefined') delete CM_CACHE.winery_assets;
      Promise.all([cmFetch('winery_assets'), cmFetch('barrels'), cmFetch('vessels')])
        .then(function (a) { setD({ as: a[0], b: a[1], v: a[2] }); }).catch(function (e) { setErr(e.message); setD({ as: [], b: [], v: [] }); });
    };
    React.useEffect(load, []);
    if (!D) return cmE('div', { style: card() }, 'Loading assets...');
    var set = function (k) { return function (e) { var n = Object.assign({}, F); n[k] = e.target.value; setF(n); }; };
    var add = function () {
      if (!F.name.trim()) { setErr('Name the asset.'); return; }
      db().from('winery_assets').insert({ organization_id: org, kind: F.kind, name: F.name.trim(), qty: num(F.qty) || 1, unit_cost: num(F.unit_cost), acquired_on: F.acquired_on || null, life_years: num(F.life_years), salvage_each: num(F.salvage_each) || 0, note: F.note || null, value_basis: 'Entered in CellarMate' })
        .then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); setF(blank); load(); } });
    };
    var edit = function (a) {
      var c = window.prompt('Cost each for ' + a.name, a.unit_cost == null ? '' : a.unit_cost); if (c === null) return;
      db().from('winery_assets').update({ unit_cost: num(c), value_basis: 'Entered in CellarMate', updated_at: new Date().toISOString() }).eq('id', a.id).then(function (r) { if (r.error) setErr(r.error.message); else load(); });
    };
    var kinds = {}; D.as.forEach(function (a) { (kinds[a.kind] = kinds[a.kind] || []).push(a); });
    var tot = D.as.reduce(function (t, a) { var v = cmAssetValue(a); if (a.owned !== false) { t.cost += v.cost || 0; t.value += v.value || 0; if (v.cost == null) t.unknown += 1; } else t.rented += v.cost || 0; return t; }, { cost: 0, value: 0, unknown: 0, rented: 0 });
    var y26 = D.b.filter(function (b) { return +b.vintage === 2026 && /tystrya/i.test(b.owner || ''); });
    var phys = {}; y26.forEach(function (b) { phys[b.barrel] = b.oak_category || 'Not written'; });
    var physN = Object.keys(phys).length, byCat = {}; Object.keys(phys).forEach(function (k) { byCat[phys[k]] = (byCat[phys[k]] || 0) + 1; });
    var barrelAssets = (kinds.Barrel || []).reduce(function (t, a) { return t + (num(a.qty) || 0); }, 0);
    var vessOwn = D.v.filter(function (v) { return /tystrya/i.test(v.owner || ''); }).length;
    return cmE('div', null,
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700 } }, 'Winery assets'),
        cmE('div', { style: Object.assign(small(), { margin: '2px 0 6px' }) }, 'Owned: ' + money(tot.cost) + ' at cost, about ' + money(tot.value) + ' today (straight line to salvage). ' + tot.unknown + ' items have no cost yet. Rented from suppliers: ' + money(tot.rented) + '.'),
        err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
        cmE('div', { style: { overflowX: 'auto' } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 760 } },
          cmE('thead', null, cmE('tr', null, ['Asset', 'Qty', 'Cost each', 'Bought', 'Life (yrs)', 'Value each', 'Value now', 'Basis'].map(function (x, i) { return cmE('th', { key: x, style: th(i === 0 || i === 7) }, x); }))),
          cmE('tbody', null, Object.keys(kinds).map(function (k) {
            var sum = kinds[k].reduce(function (t, a) { return t + (cmAssetValue(a).value || 0); }, 0);
            return [cmE('tr', { key: 'k' + k }, cmE('td', { colSpan: 6, style: Object.assign(td(true), { fontWeight: 700, paddingTop: 8 }) }, k), cmE('td', { style: Object.assign(td(), { fontWeight: 700 }) }, money(sum)), cmE('td', { style: td() }, ''))]
              .concat(kinds[k].map(function (a) {
                var v = cmAssetValue(a);
                return cmE('tr', { key: a.id }, cmE('td', { style: Object.assign(td(true), { paddingLeft: 16 }) }, a.name, a.note ? cmE('div', { style: small() }, a.note) : null),
                  cmE('td', { style: td() }, num(a.qty)), cmE('td', { style: td() }, a.unit_cost == null ? cmE('button', { onClick: function () { edit(a); }, style: { fontSize: 11, cursor: 'pointer' } }, 'Add cost') : cmE('span', { onClick: function () { edit(a); }, style: { cursor: 'pointer' } }, money(a.unit_cost, 2))),
                  cmE('td', { style: td() }, a.acquired_on || ''), cmE('td', { style: td() }, a.owned === false ? 'rented' : num(a.life_years) || ''),
                  cmE('td', { style: td() }, v.each == null ? '' : money(v.each, 0)), cmE('td', { style: td() }, v.rented ? '(theirs ' + money(v.cost) + ')' : money(v.value)), cmE('td', { style: td(true) }, cmE('span', { style: small() }, a.value_basis || '')));
              }));
          }))))),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Check against the cellar'),
        cmE('div', { style: { fontSize: 12 } }, 'The 2026 barrel map has ' + physN + ' Tystrya barrels (' + Object.keys(byCat).map(function (k) { return k + ' ' + byCat[k]; }).join(', ') + '). The asset list counts ' + barrelAssets + ' barrels.' + (physN !== barrelAssets ? ' The difference needs a look.' : ' They match.')),
        cmE('div', { style: { fontSize: 12, marginTop: 4 } }, vessOwn + ' tanks, kegs and topping vessels in the vessel list belong to Tystrya.')),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Add an asset'),
        cmE('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' } },
          cmE('label', { style: Object.assign(small(), { flex: '1 1 120px' }) }, 'Kind', cmE('select', { value: F.kind, onChange: set('kind'), style: inp() }, ['Barrel', 'Tank', 'Keg', 'Fermenter', 'Pump', 'Press', 'Filter', 'Gas equipment', 'Lab equipment', 'Equipment', 'Vineyard equipment'].map(function (k) { return cmE('option', { key: k, value: k }, k); }))),
          cmE('label', { style: Object.assign(small(), { flex: '3 1 220px' }) }, 'Name', cmE('input', { value: F.name, onChange: set('name'), placeholder: 'Bucher press, Sentia analyzer, 2027 Gillet barrels', style: inp() })),
          cmE('label', { style: Object.assign(small(), { flex: '1 1 60px' }) }, 'Qty', cmE('input', { value: F.qty, onChange: set('qty'), inputMode: 'decimal', style: inp() })),
          cmE('label', { style: Object.assign(small(), { flex: '1 1 90px' }) }, 'Cost each', cmE('input', { value: F.unit_cost, onChange: set('unit_cost'), inputMode: 'decimal', style: inp() })),
          cmE('label', { style: Object.assign(small(), { flex: '1 1 130px' }) }, 'Bought', cmE('input', { type: 'date', value: F.acquired_on, onChange: set('acquired_on'), style: inp() })),
          cmE('label', { style: Object.assign(small(), { flex: '1 1 60px' }) }, 'Life', cmE('input', { value: F.life_years, onChange: set('life_years'), inputMode: 'decimal', style: inp() })),
          cmE('label', { style: Object.assign(small(), { flex: '1 1 70px' }) }, 'Salvage', cmE('input', { value: F.salvage_each, onChange: set('salvage_each'), inputMode: 'decimal', style: inp() })),
          cmBtn('Add', add, true, false))));
  }

  window.cmLineVintage = cmLineVintage; window.cmCostGroup = cmCostGroup; window.cmAssetValue = cmAssetValue; window.cmCostSheet = cmCostSheet;
  window.CmCostSheet = CmCostSheet; window.CmAssets = CmAssets;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.cost = { label: 'Costs', Component: CmCostSheet, order: 64 };
  window.CM_MODULES.assets = { label: 'Assets', Component: CmAssets, order: 66 };
})();
