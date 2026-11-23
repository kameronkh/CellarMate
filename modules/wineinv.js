/* CellarMate module: Wine inventory, synced with the Tystrya CRM
   - One row per bottled wine (SKU): bottled cases and bottles from CellarMate, and stock on hand,
     sales and depletion from the CRM. In the CRM, stock at Press & Barrel comes from Zoho and stock at
     NW Distribution from OrderPort, so those syncs stay the source of truth for on-hand numbers.
   - Link each SKU to its CRM product (or create the product in the CRM from the SKU).
   - Record a bottling: adds the bottling to CellarMate, updates the SKU, and writes an adjustment in
     the CRM stock log so sales can see new wine is coming; receive it into Zoho or OrderPort to move
     stock on hand.
   - Months of supply from the last 90 days of CRM sales, inventory value at COGS, low stock flags.
   CRM tables are server-only; CellarMate reaches them through crm_products, crm_link_sku and
   crm_record_bottling, which check the caller's access to the winery first.
   Registers in CM_MODULES as 'Inventory'. Pure helper on window for the smoke tests: cmInvRows. */
(function () {
  'use strict';
  var ORG = '762fc809-0341-4ee2-834f-16e707181ea7';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function db() { return supa.schema('cellarmate'); }

  /* join SKUs with CRM products: on hand, sold, months of supply, value, flags */
  function cmInvRows(skus, prods) {
    var P = {}; (prods || []).forEach(function (p) { P[p.id] = p; });
    var used = {};
    var rows = (skus || []).map(function (s) {
      var p = s.crm_product_id ? P[s.crm_product_id] : null; if (p) used[p.id] = 1;
      var bpc = num(s.bottles_per_case) || 12, bottled = num(s.cases_bottled) != null ? Math.round(num(s.cases_bottled) * bpc) : null;
      var stock = p ? num(p.stock) : null, per30 = p ? (num(p.sold_qty_90d) || 0) / 3 : null;
      var cogs = num(s.cogs_per_bottle) != null ? num(s.cogs_per_bottle) : p ? num(p.cogs) : null;
      return { sku: s, p: p, bottled: bottled, stock: stock, pb: p ? num(p.stock_pb) : null, nw: p ? num(p.stock_nw) : null,
        sold: p ? num(p.sold_qty_all) : null, sold90: p ? num(p.sold_qty_90d) : null, months: stock != null && per30 ? stock / per30 : null,
        value: stock != null && cogs != null ? stock * cogs : null, cogs: cogs, low: p && stock != null && num(p.low_alert) != null && stock <= num(p.low_alert) && stock > 0, out: p && stock === 0,
        depleted: bottled && stock != null ? 1 - stock / bottled : null };
    });
    var unlinked = (prods || []).filter(function (p) { return !used[p.id]; });
    var tot = rows.reduce(function (t, r) { t.bottles += r.stock || 0; t.value += r.value || 0; return t; }, { bottles: 0, value: 0 });
    return { rows: rows, unlinked: unlinked, total: tot };
  }

  function guess(s, prods) {
    var k = String(s.sku || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && !/^(the|wine|tystrya|estate|pinot|noir)$/.test(w); });
    var best = null, bs = 0;
    (prods || []).forEach(function (p) { if (s.vintage && p.vintage && +p.vintage !== +s.vintage) return; var n = String(p.name).toLowerCase(); var sc = k.filter(function (w) { return n.indexOf(w) >= 0; }).length; if (sc > bs) { bs = sc; best = p; } });
    return best;
  }

  function CmWineInventory() {
    var org = (typeof CM_ME !== 'undefined' && CM_ME.org_id) || ORG;
    var s1 = React.useState(null), D = s1[0], setD = s1[1];
    var s2 = React.useState(''), err = s2[0], setErr = s2[1];
    var s3 = React.useState({ sku: '', cases: '', bpc: '12', date: new Date().toISOString().slice(0, 10), note: '', newName: '', newVintage: String(new Date().getFullYear() - 1), newType: 'Pinot Noir' }), F = s3[0], setF = s3[1];
    var load = function () {
      Promise.all([db().from('bottled_skus').select('*').eq('organization_id', org).order('vintage', { ascending: false }).order('sku'), db().rpc('crm_products', { p_org: org })])
        .then(function (a) { if (a[1].error) setErr('CRM error: ' + a[1].error.message); setD({ skus: a[0].data || [], prods: a[1].data || [] }); });
    };
    React.useEffect(load, []);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var th = { textAlign: 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var td = { textAlign: 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var L = function (o) { return Object.assign({}, o, { textAlign: 'left', whiteSpace: 'normal' }); };
    var inp = { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '5px 7px', fontSize: 12, width: '100%', boxSizing: 'border-box' };
    if (!D) return cmE('div', { style: card }, 'Loading wine inventory...');
    var R = cmInvRows(D.skus, D.prods);
    var synced = D.prods.map(function (p) { return p.synced_at; }).filter(Boolean).sort().pop();
    var money = function (x) { return x == null ? '' : '$' + Math.round(x).toLocaleString(); };
    var n0 = function (x) { return x == null ? '' : Math.round(x).toLocaleString(); };
    var link = function (s, pid, create) { db().rpc('crm_link_sku', { p_sku: s.id, p_product: pid || null, p_create: !!create }).then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); load(); } }); };
    var set = function (k) { return function (ev) { var n = Object.assign({}, F); n[k] = ev.target.value; setF(n); }; };
    var record = async function () {
      setErr('');
      var skuId = F.sku === 'new' ? null : +F.sku, cases = num(F.cases);
      if (!cases || cases <= 0) { setErr('Enter the number of cases bottled.'); return; }
      if (F.sku === 'new') {
        if (!F.newName.trim()) { setErr('Name the new wine.'); return; }
        var ins = await db().from('bottled_skus').insert({ organization_id: org, sku: F.newName.trim(), vintage: num(F.newVintage), type: F.newType, status: 'Bottled, aging', cases_planned: cases }).select('id').single();
        if (ins.error) { setErr(ins.error.message); return; }
        skuId = ins.data.id;
      }
      if (!skuId) { setErr('Choose the wine.'); return; }
      var r = await db().rpc('crm_record_bottling', { p_sku: skuId, p_cases: cases, p_bottles_per_case: num(F.bpc) || 12, p_bottled_on: F.date, p_note: F.note || null });
      if (r.error) { setErr(r.error.message); return; }
      setF(Object.assign({}, F, { cases: '', note: '', newName: '' })); load();
    };

    return cmE('div', null,
      cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 } },
          cmE('div', { style: { fontWeight: 700 } }, 'Wine inventory'),
          cmE('div', { style: small }, R.total.bottles.toLocaleString() + ' bottles on hand · ' + money(R.total.value) + ' at cost' + (synced ? ' · CRM stock synced ' + String(synced).slice(0, 16).replace('T', ' ') : ''))),
        cmE('div', { style: Object.assign({}, small, { margin: '2px 0 6px' }) }, 'Bottled numbers come from CellarMate. On hand and sales come from the Tystrya CRM: Press & Barrel stock from Zoho and NW Distribution stock from OrderPort.'),
        err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 900 } },
          cmE('thead', null, cmE('tr', null, ['Wine', 'Status', 'Bottled', 'Bottles made', 'Press & Barrel', 'NW Dist.', 'On hand', 'Sold (all)', 'Sold 90 days', 'Months left', 'COGS', 'Value', 'CRM product'].map(function (x, i) { return cmE('th', { key: x, style: i === 0 || i === 12 ? L(th) : th }, x); }))),
          cmE('tbody', null, R.rows.map(function (r) {
            var s = r.sku, g = !r.p ? guess(s, R.unlinked) : null;
            return cmE('tr', { key: s.id },
              cmE('td', { style: Object.assign(L(td), { fontWeight: 700 }) }, s.sku), cmE('td', { style: L(td) }, s.status || ''), cmE('td', { style: td }, s.bottled || ''), cmE('td', { style: td }, n0(r.bottled)),
              cmE('td', { style: td }, n0(r.pb)), cmE('td', { style: td }, n0(r.nw)),
              cmE('td', { style: Object.assign({}, td, { fontWeight: 700, color: r.out ? C.red : r.low ? C.orange : C.text }) }, r.p ? n0(r.stock) + (r.out ? ' out' : r.low ? ' low' : '') : ''),
              cmE('td', { style: td }, n0(r.sold)), cmE('td', { style: td }, n0(r.sold90)), cmE('td', { style: td }, r.months != null ? r.months.toFixed(1) : r.p && r.stock ? 'no recent sales' : ''),
              cmE('td', { style: td }, r.cogs != null ? '$' + r.cogs.toFixed(2) : ''), cmE('td', { style: td }, money(r.value)),
              cmE('td', { style: L(td) }, r.p ? r.p.name : cmE('span', null,
                g ? cmE('button', { onClick: function () { link(s, g.id, false); }, style: { fontSize: 11, marginRight: 4, cursor: 'pointer' } }, 'Link to ' + g.name) : null,
                s.bottled || /bottled|released/i.test(s.status || '') ? cmE('button', { onClick: function () { link(s, null, true); }, style: { fontSize: 11, cursor: 'pointer' } }, 'Create in CRM') : cmE('span', { style: small }, 'not bottled yet'))));
          }))),
        R.unlinked.length ? cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) }, 'In the CRM but not linked to a CellarMate wine: ' + R.unlinked.map(function (p) { return p.name + ' (' + (p.stock || 0) + ')'; }).join(', ') + '.') : null),

      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Record a bottling'),
        cmE('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' } },
          cmE('label', { style: { flex: '2 1 220px', fontSize: 11, color: C.textDim } }, 'Wine', cmE('select', { value: F.sku, onChange: set('sku'), style: inp },
            [cmE('option', { key: '', value: '' }, 'Choose...')].concat(D.skus.map(function (s) { return cmE('option', { key: s.id, value: s.id }, s.sku); })).concat([cmE('option', { key: 'new', value: 'new' }, 'A new wine...')]))),
          F.sku === 'new' ? cmE('label', { style: { flex: '2 1 200px', fontSize: 11, color: C.textDim } }, 'New wine name', cmE('input', { value: F.newName, onChange: set('newName'), placeholder: '2025 Estate Pinot Noir', style: inp })) : null,
          F.sku === 'new' ? cmE('label', { style: { flex: '1 1 80px', fontSize: 11, color: C.textDim } }, 'Vintage', cmE('input', { value: F.newVintage, onChange: set('newVintage'), style: inp })) : null,
          F.sku === 'new' ? cmE('label', { style: { flex: '1 1 120px', fontSize: 11, color: C.textDim } }, 'Type', cmE('select', { value: F.newType, onChange: set('newType'), style: inp }, ['Pinot Noir', 'Chardonnay', 'Rosé', 'Albarino', 'Other'].map(function (t) { return cmE('option', { key: t, value: t }, t); }))) : null,
          cmE('label', { style: { flex: '1 1 80px', fontSize: 11, color: C.textDim } }, 'Cases', cmE('input', { value: F.cases, onChange: set('cases'), inputMode: 'decimal', style: inp })),
          cmE('label', { style: { flex: '1 1 80px', fontSize: 11, color: C.textDim } }, 'Bottles per case', cmE('input', { value: F.bpc, onChange: set('bpc'), inputMode: 'numeric', style: inp })),
          cmE('label', { style: { flex: '1 1 130px', fontSize: 11, color: C.textDim } }, 'Date', cmE('input', { type: 'date', value: F.date, onChange: set('date'), style: inp })),
          cmE('label', { style: { flex: '2 1 200px', fontSize: 11, color: C.textDim } }, 'Note', cmE('input', { value: F.note, onChange: set('note'), placeholder: 'Bottling line, closure, lot numbers', style: inp })),
          cmBtn('Record bottling', record, true, false)),
        cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) }, 'Adds the bottling here, updates the wine, and logs it in the CRM stock history. Receive the cases into Zoho (Press & Barrel) or OrderPort (NW Distribution) to move stock on hand.')));
  }

  window.cmInvRows = cmInvRows;
  window.CmWineInventory = CmWineInventory;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.inv = { label: 'Inventory', Component: CmWineInventory, order: 62 };
})();
