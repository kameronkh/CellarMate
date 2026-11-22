/* CellarMate module: Today (one screen for the cellar crew)
   Pulls together: open work orders, SO2 to add (grams and tablets), tests due, SO2 re-tests
   after recent additions, topping due this week, lab flags, and open questions. Every barrel
   is shown with its spot, in walking order. Prints as a one-page day sheet with check boxes.
   Uses helpers from the Map, Topping and Lab modules when they are loaded. */
(function () {
  'use strict';
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(String(a).slice(0, 10) + 'T12:00:00')) / 86400000); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function code(p) { return p.vintage === 2025 ? '25-' + p.barrel : p.barrel; }
  function whereOf(p) { return !p ? 'not on the map' : p.area === 'EBS' ? 'EBS ' + p.rack + ' ' + String(p.side).toLowerCase() + ' ' + p.col : p.area === 'Rows' ? 'Row ' + p.rack + ' col ' + p.col + ' ' + String(p.side).toLowerCase() + ' ' + (p.level || '') : p.area; }
  function walk(p) { return !p ? '9' : (p.area === 'EBS' ? '0' : '1') + ('0' + p.rack).slice(-2) + p.col + (p.side === 'Front' ? 0 : 1) + (p.level || ''); }

  /* pure: build the day's lists from loaded data */
  function cmTodayPlan(X, asOf) {
    var t = asOf || today();
    var items = X.items || [];
    var byCode = {}; items.forEach(function (p) { if (p.barrel) byCode[code(p)] = p; });
    var spot = function (c) { return byCode[c] || null; };
    var plan = { date: t, orders: [], add: [], test: [], retest: [], topping: [], lab: [], questions: X.openQuestions || 0 };
    (X.orders || []).filter(function (o) { return o.status !== 'Done' && o.status !== 'Cancelled'; }).forEach(function (o) {
      var left = (o.barrels || []).filter(function (b) { return (o.done_barrels || []).indexOf(b) === -1; });
      plan.orders.push({ id: o.id, title: o.title, due: o.due_on, who: o.assigned_to, barrels: left.map(function (b) { return { code: b, p: spot(b) }; }).sort(function (a, b) { return walk(a.p) < walk(b.p) ? -1 : 1; }) });
    });
    items.filter(function (p) { return p.barrel; }).forEach(function (p) {
      if (p.step === 'add') plan.add.push({ code: code(p), p: p, g: p.g, act: p.act });
      else if (p.step === 'test') plan.test.push({ code: code(p), p: p, act: p.act });
    });
    (X.so2 || []).forEach(function (r) {
      if (r.kind !== 'Addition' || !r.date) return; var d = daysBetween(r.date, t); if (d < 3 || d > 14) return;
      var c = r.vintage === 2025 ? '25-' + r.barrel : r.barrel; var later = (X.so2 || []).some(function (x) { return x.kind === 'Reading' && x.barrel === r.barrel && x.vintage === r.vintage && String(x.date) > String(r.date); });
      if (!later && !plan.retest.some(function (x) { return x.code === c; })) plan.retest.push({ code: c, p: spot(c), added: r.date, g: r.grams_added });
    });
    (X.actions || []).forEach(function (a) {
      if (a.action_type !== 'so2' || !a.done_on) return; var d = daysBetween(a.done_on, t); if (d < 3 || d > 14) return;
      var c = a.vintage === 2025 ? '25-' + a.barrel : a.barrel; if (!plan.retest.some(function (x) { return x.code === c; })) plan.retest.push({ code: c, p: spot(c), added: a.done_on, g: a.grams });
    });
    if (window.cmToppingStatus) {
      var g = {}; cmToppingStatus(items, X.toppingLogs || [], X.interval || 21, t).forEach(function (r) {
        if (r.status === 'ok') return; if (r.status === 'soon' && r.left > 7) return;
        var k = r.p.area === 'EBS' ? 'EBS level ' + r.p.rack : 'Row ' + r.p.rack; (g[k] = g[k] || { key: k, n: 0, due: r.due, status: r.status }).n++;
        if (r.status === 'overdue') g[k].status = 'overdue';
      });
      plan.topping = Object.keys(g).map(function (k) { return g[k]; });
    }
    if (window.cmLatestPanels && window.cmLabFlags) {
      cmLatestPanels(X.lab || [], X.so2 || [], X.malic || []).forEach(function (p) {
        if (p.vintage !== 2025 && p.vintage !== 2026) return;
        var f = cmLabFlags(p, !!(X.white || {})[p.vintage + '|' + p.barrel]).filter(function (x) { return /^VA|^Molecular|^Sugar/.test(x); });
        if (f.length) { var c = p.vintage === 2025 ? '25-' + p.barrel : p.barrel; plan.lab.push({ code: c, p: spot(c), flags: f }); }
      });
    }
    ['add', 'test', 'retest', 'lab'].forEach(function (k) { plan[k].sort(function (a, b) { return walk(a.p) < walk(b.p) ? -1 : 1; }); });
    plan.grams = plan.add.reduce(function (s, x) { return s + (Number(x.g) || 0); }, 0);
    return plan;
  }

  function sheetHtml(plan) {
    var sec = function (title, rows, cols) { if (!rows.length) return ''; return '<h3>' + esc(title) + ' (' + rows.length + ')</h3><table><tr><th class="ck">Done</th>' + cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr><td class="ck">&#9744;</td>' + cols.map(function (c) { return '<td>' + esc(c[1](r)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>'; };
    var bc = [['Barrel', function (r) { return r.code; }], ['Where', function (r) { return whereOf(r.p); }]];
    var html = '<h1>CellarMate: day sheet ' + esc(plan.date) + '</h1><div class="sub">Walking order: EBS bottom to top, then the floor rows. Name: ______________</div>';
    plan.orders.forEach(function (o) { html += sec('Work order: ' + o.title + (o.due ? ', due ' + o.due : ''), o.barrels, bc); });
    html += sec('Add SO2 (' + plan.grams + ' g total)', plan.add, bc.concat([['Grams', function (r) { return r.g != null ? r.g + ' g' : ''; }], ['Note', function (r) { return r.act || ''; }]]));
    html += sec('Re-test free SO2 after an addition', plan.retest, bc.concat([['Added', function (r) { return r.added + (r.g != null ? ' (' + r.g + ' g)' : ''); }], ['Free SO2', function () { return ''; }]]));
    html += sec('Tests to do', plan.test, bc.concat([['What', function (r) { return r.act || ''; }], ['Result', function () { return ''; }]]));
    html += sec('Lab flags to look at', plan.lab, bc.concat([['Flag', function (r) { return r.flags.join('; '); }]]));
    if (plan.topping.length) html += '<h3>Topping due this week</h3><table><tr><th class="ck">Done</th><th>Where</th><th>Barrels</th><th>Due</th></tr>' + plan.topping.map(function (t) { return '<tr><td class="ck">&#9744;</td><td>' + esc(t.key) + '</td><td>' + t.n + '</td><td>' + esc(t.status === 'never' ? 'no topping on record' : t.due) + '</td></tr>'; }).join('') + '</table>';
    var css = 'body{font-family:Helvetica,Arial,sans-serif;margin:16px;color:#222}h1{color:#7B1E3A;font-size:18px;margin:0}h3{font-size:12px;background:#EFE7EA;padding:3px 6px;margin:10px 0 4px}.sub{color:#666;font-size:10px;margin:2px 0 6px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;font-size:10px;padding:2px 5px;text-align:left}.ck{width:30px;text-align:center;font-size:12px}@page{margin:10mm}@media print{.noprint{display:none}}button{font-size:14px;padding:6px 14px;margin-bottom:8px}';
    return '<!doctype html><html><head><meta charset="utf-8"><title>CellarMate day sheet</title><style>' + css + '</style></head><body><div class="noprint"><button onclick="window.print()">Print</button></div>' + html + '</body></html>';
  }
  function printSheet(plan) {
    var html = sheetHtml(plan); var w = null; try { w = window.open('', '_blank'); } catch (e) {}
    if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); return; }
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f); f.srcdoc = html;
    f.onload = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} };
  }

  function CmToday() {
    var sP = React.useState(null), plan = sP[0], setPlan = sP[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    var sO = React.useState({ add: false, test: false, retest: false }), open = sO[0], setOpen = sO[1];
    React.useEffect(function () {
      var live = true;
      Promise.all([cmFetch('barrel_positions'), cmFetch('barrel_status_2025'), cmFetch('barrel_status_2026'), (typeof cmStatusRows === 'function' ? cmStatusRows() : Promise.resolve([])).catch(function () { return []; }),
        cmFetch('work_orders'), cmFetch('so2_log'), cmFetch('cellar_actions'), cmFetch('topping_log'), cmFetch('lab_results'), cmFetch('malic_results'), cmFetch('questions')])
        .then(function (a) {
          if (!live) return;
          var items = window.cmMapIndex ? cmMapIndex(a[0], a[1], a[2], a[3]) : [];
          var white = {}; a[1].forEach(function (r) { if (/white/i.test(r.wine_type || '')) white['2025|' + r.barrel] = 1; }); a[2].forEach(function (r) { if (/white/i.test(r.wine_type || '')) white['2026|' + r.barrel] = 1; });
          var iv = 21; try { iv = Number(localStorage.getItem('cm_top_interval')) || 21; } catch (e) {}
          setPlan(cmTodayPlan({ items: items, orders: a[4], so2: a[5], actions: a[6], toppingLogs: a[7], lab: a[8], malic: a[9], white: white, interval: iv, openQuestions: a[10].filter(function (q) { return q.status === 'Open'; }).length }));
        }).catch(function (e) { if (live) { setErr(e.message); setPlan(cmTodayPlan({})); } });
      return function () { live = false; };
    }, []);
    if (!plan) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var chip = function (x, extra) { return cmE('span', { key: x.code, style: { fontSize: 11, background: C.cardBorder, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' } }, x.code + ' · ' + whereOf(x.p) + (extra ? ' · ' + extra : '')); };
    var wrap = function (kids) { return cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 } }, kids); };
    var head = function (title, n, sub) { return cmE('div', null, cmE('div', { style: { fontWeight: 700 } }, title + (n != null ? ' (' + n + ')' : '')), sub ? cmE('div', { style: small }, sub) : null); };
    var more = function (k, list, render) { var all = open[k]; var shown = all ? list : list.slice(0, 24); return cmE('div', null, wrap(shown.map(render)), list.length > 24 ? cmE('div', { onClick: function () { var o = Object.assign({}, open); o[k] = !all; setOpen(o); }, style: { fontSize: 11, color: C.accentLight, cursor: 'pointer', marginTop: 4 } }, all ? 'Show fewer' : 'Show all ' + list.length) : null); };
    return cmE('div', null,
      err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
      cmE('div', { style: Object.assign({}, card, { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }) },
        [['Work orders', plan.orders.length], ['Add SO2', plan.add.length], ['Re-test SO2', plan.retest.length], ['Tests', plan.test.length], ['Topping rows', plan.topping.length], ['Lab flags', plan.lab.length], ['Questions', plan.questions]].map(function (x) { return cmE('div', { key: x[0] }, cmE('div', { style: { fontSize: 20, fontWeight: 700 } }, x[1]), cmE('div', { style: small }, x[0])); }),
        cmE('button', { onClick: function () { printSheet(plan); }, style: { marginLeft: 'auto', background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' } }, 'Print day sheet')),
      plan.orders.map(function (o) { return cmE('div', { key: 'o' + o.id, style: card }, head('Work order: ' + o.title, o.barrels.length, [o.who ? 'Assigned to ' + o.who : 'Not assigned', o.due ? 'due ' + o.due : null].filter(Boolean).join(' · ')), wrap(o.barrels.map(function (b) { return chip(b); }))); }),
      plan.retest.length ? cmE('div', { style: card }, head('Re-test free SO2 after an addition', plan.retest.length, 'SO2 went in 3 to 14 days ago and has not been tested since.'), more('retest', plan.retest, function (x) { return chip(x, 'added ' + x.added); })) : null,
      plan.add.length ? cmE('div', { style: card }, head('Add SO2', plan.add.length, plan.grams + ' g in total, in walking order.'), more('add', plan.add, function (x) { return chip(x, x.g != null ? x.g + ' g' : ''); })) : null,
      plan.test.length ? cmE('div', { style: card }, head('Tests to do', plan.test.length), more('test', plan.test, function (x) { return chip(x); })) : null,
      plan.topping.length ? cmE('div', { style: card }, head('Topping due this week', plan.topping.length), wrap(plan.topping.map(function (t) { return cmE('span', { key: t.key, style: { fontSize: 11, background: C.cardBorder, borderRadius: 5, padding: '2px 6px' } }, t.key + ' · ' + t.n + ' barrels · ' + (t.status === 'never' ? 'no topping on record' : 'due ' + t.due)); }))) : cmE('div', { style: Object.assign({}, card, small) }, 'Topping: nothing due in the next 7 days.'),
      plan.lab.length ? cmE('div', { style: card }, head('Lab flags to look at', plan.lab.length), wrap(plan.lab.map(function (x) { return chip(x, x.flags.join('; ')); }))) : null,
      plan.questions ? cmE('div', { style: Object.assign({}, card, small) }, plan.questions + ' open questions are waiting in Q&A.') : null);
  }

  window.cmTodayPlan = cmTodayPlan; window.cmTodaySheetHtml = sheetHtml;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.today = { label: 'Today', Component: CmToday, order: 1 };
})();
