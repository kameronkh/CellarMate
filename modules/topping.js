/* CellarMate module: Topping schedule
   Last topped date per barrel from topping_log (whole vintage, an area, a rack or row, or named
   barrels), due date from a chosen interval (gold standard: every 2 to 4 weeks), overdue list in
   walking order, topping wine on hand, and a form to log a topping. Registers in CM_MODULES. */
(function () {
  'use strict';
  var KEY = 'cm_top_interval';
  function day(s) { return new Date(String(s).slice(0, 10) + 'T12:00:00'); }
  function addDays(s, n) { var d = day(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((day(b) - day(a)) / 86400000); }
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function code(p) { return p.vintage === 2025 ? '25-' + p.barrel : p.barrel; }

  /* does this log entry cover barrel p? */
  function covers(log, p) {
    if (log.barrels && log.barrels.length) return log.barrels.indexOf(code(p)) > -1 || (p.vintage === 2026 && log.barrels.indexOf(p.barrel) > -1);
    if (log.vintage != null && log.vintage !== p.vintage) return false;
    if (log.area) {
      var a = String(log.area).split('|');
      if (a[0] && a[0] !== p.area) return false;
      if (a[1] && String(p.rack) !== a[1]) return false;
    }
    return true;
  }
  function cmToppingStatus(items, logs, interval, asOf) {
    var t = asOf || today(); var iv = interval || 21;
    return items.filter(function (p) { return p.barrel; }).map(function (p) {
      var last = null;
      logs.forEach(function (l) { if (l.topped_on && covers(l, p) && (!last || l.topped_on > last)) last = l.topped_on; });
      var due = last ? addDays(last, iv) : null;
      var left = due ? diffDays(t, due) : null;
      var status = !last ? 'never' : left < 0 ? 'overdue' : left <= 3 ? 'soon' : 'ok';
      return { p: p, last: last, due: due, left: left, status: status };
    });
  }
  function groupKey(p) { return p.area === 'EBS' ? 'EBS level ' + p.rack : p.area === 'Rows' ? 'Row ' + p.rack : p.area; }
  function sortKey(p) { return (p.area === 'EBS' ? 0 : 1) + '|' + ('0' + p.rack).slice(-2); }
  function cmToppingGroups(rows) {
    var g = {};
    rows.forEach(function (r) { var k = groupKey(r.p); (g[k] = g[k] || { key: k, sort: sortKey(r.p), area: r.p.area, rack: r.p.rack, rows: [] }).rows.push(r); });
    return Object.keys(g).map(function (k) {
      var G = g[k]; var worst = ['never', 'overdue', 'soon', 'ok'].filter(function (s) { return G.rows.some(function (r) { return r.status === s; }); })[0];
      var lasts = G.rows.map(function (r) { return r.last; }).filter(Boolean).sort();
      G.status = worst; G.oldest = lasts[0] || null; return G;
    }).sort(function (a, b) { return a.sort < b.sort ? -1 : 1; });
  }
  function litersOf(v) {
    var s = String(v.volume_text || ''); var m = s.match(/([\d.]+)\s*(L|gal)/i); if (!m) return null;
    return m[2].toLowerCase() === 'gal' ? Number(m[1]) * 3.785 : Number(m[1]);
  }

  var COLORS = { overdue: '#7a2a1a', never: '#4a2a66', soon: '#5a4a12', ok: '#1f4a33' };
  var LABEL = { overdue: 'Overdue', never: 'No topping on record', soon: 'Due in 3 days or less', ok: 'Topped recently' };

  function CmTopping() {
    var sD = React.useState(null), D = sD[0], setD = sD[1];
    var sI = React.useState(function () { try { return Number(localStorage.getItem(KEY)) || 21; } catch (e) { return 21; } }), iv = sI[0], setIv = sI[1];
    var sF = React.useState(null), form = sF[0], setForm = sF[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    var sM = React.useState(''), msg = sM[0], setMsg = sM[1];
    var sT = React.useState(0), tick = sT[0], setTick = sT[1];
    var sO = React.useState(null), open = sO[0], setOpen = sO[1];
    React.useEffect(function () {
      var live = true;
      if (tick && typeof CM_CACHE !== 'undefined') { delete CM_CACHE.topping_log; delete CM_CACHE.vessels; }
      Promise.all([cmFetch('barrel_positions'), cmFetch('barrel_status_2025'), cmFetch('barrel_status_2026'), cmFetch('topping_log'), cmFetch('vessels')])
        .then(function (a) { if (live) setD({ items: window.cmMapIndex ? cmMapIndex(a[0], a[1], a[2]) : a[0], logs: a[3], vessels: a[4] }); })
        .catch(function (e) { if (live) { setErr(e.message); setD({ items: [], logs: [], vessels: [] }); } });
      return function () { live = false; };
    }, [tick]);
    if (!D) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var rows = cmToppingStatus(D.items, D.logs, iv);
    var groups = cmToppingGroups(rows);
    var cnt = function (s) { return rows.filter(function (r) { return r.status === s; }).length; };
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var toppers = D.vessels.filter(function (v) { return v.is_topping; });
    var setIval = function (n) { setIv(n); try { localStorage.setItem(KEY, String(n)); } catch (e) {} };
    var startForm = function (G) { setErr(''); setMsg(''); setForm({ date: today(), scope: G ? 'group' : 'all26', group: G ? G.area + '|' + G.rack : '', list: '', vessel: '', liters: '', note: '' }); };
    var save = function () {
      var f = form; var rec = { organization_id: (D.items[0] && D.items[0].organization_id) || '762fc809-0341-4ee2-834f-16e707181ea7', topped_on: f.date, topping_vessel: f.vessel || null, liters_used: f.liters === '' ? null : Number(f.liters), note: f.note || null, entered_by: ((typeof CM_ME !== 'undefined' && CM_ME.full_name) || null) };
      if (!f.date) { setErr('Pick the date.'); return; }
      if (f.liters !== '' && isNaN(Number(f.liters))) { setErr('Liters used must be a number.'); return; }
      if (f.scope === 'all26') { rec.vintage = 2026; rec.scope = 'All 2026 barrels'; }
      else if (f.scope === 'all25') { rec.vintage = 2025; rec.scope = 'All 2025 barrels'; }
      else if (f.scope === 'ebs') { rec.area = 'EBS'; rec.scope = 'All EBS racks'; }
      else if (f.scope === 'rows') { rec.area = 'Rows'; rec.scope = 'All floor rows'; }
      else if (f.scope === 'group') { rec.area = f.group; var g = f.group.split('|'); rec.scope = (g[0] === 'EBS' ? 'EBS level ' : 'Row ') + g[1]; }
      else {
        var codes = f.list.split(/[\s,]+/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) { var pc = window.cmBarrelLabels ? cmBarrelLabels.parseCode(x.indexOf('-') > -1 ? x : '26-' + x) : null; return pc ? (pc.vintage === 2025 ? '25-' + pc.barrel : pc.barrel) : x; });
        if (!codes.length) { setErr('List the barrels, for example 26-022, 26-030, 25-183.'); return; }
        rec.barrels = codes; rec.scope = codes.length + ' barrels';
      }
      supa.schema('cellarmate').from('topping_log').insert(rec).then(function (r) {
        if (r.error) { setErr(r.error.message); return; }
        setMsg('Topping logged: ' + rec.scope + ' on ' + rec.topped_on + '.'); setForm(null); setTick(tick + 1);
      });
    };
    var inp = Object.assign({}, cmSel, { minWidth: 0 });
    var formCard = form ? cmE('div', { style: Object.assign({}, card, { borderColor: C.accent }) },
      cmE('div', { style: { fontWeight: 700, marginBottom: 6 } }, 'Log a topping'),
      cmE('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 } },
        cmE('input', { type: 'date', value: form.date, onChange: function (e) { setForm(Object.assign({}, form, { date: e.target.value })); }, style: inp }),
        cmE('select', { value: form.scope, onChange: function (e) { setForm(Object.assign({}, form, { scope: e.target.value })); }, style: inp },
          [['all26', 'All 2026 barrels'], ['all25', 'All 2025 barrels'], ['ebs', 'All EBS racks'], ['rows', 'All floor rows'], ['group', 'One EBS level or row'], ['list', 'Named barrels']].map(function (o) { return cmE('option', { key: o[0], value: o[0] }, o[1]); })),
        form.scope === 'group' ? cmE('select', { value: form.group, onChange: function (e) { setForm(Object.assign({}, form, { group: e.target.value })); }, style: inp },
          [cmE('option', { key: '', value: '' }, 'Pick a level or row')].concat(groups.filter(function (G) { return G.area === 'EBS' || G.area === 'Rows'; }).map(function (G) { return cmE('option', { key: G.key, value: G.area + '|' + G.rack }, G.key); }))) : null,
        form.scope === 'list' ? cmE('input', { value: form.list, placeholder: 'Barrels: 26-022, 26-030, 25-183', onChange: function (e) { setForm(Object.assign({}, form, { list: e.target.value })); }, style: inp }) : null,
        cmE('select', { value: form.vessel, onChange: function (e) { setForm(Object.assign({}, form, { vessel: e.target.value })); }, style: inp },
          [cmE('option', { key: '', value: '' }, 'Topping wine used')].concat(toppers.map(function (v) { return cmE('option', { key: v.id, value: (v.tank_code ? v.tank_code + ' ' : '') + v.contents }, (v.tank_code || v.vessel) + ': ' + v.contents); }))),
        cmE('input', { value: form.liters, placeholder: 'Liters used (optional)', inputMode: 'decimal', onChange: function (e) { setForm(Object.assign({}, form, { liters: e.target.value })); }, style: inp }),
        cmE('input', { value: form.note, placeholder: 'Note (optional)', onChange: function (e) { setForm(Object.assign({}, form, { note: e.target.value })); }, style: inp })),
      cmE('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
        cmE('button', { onClick: save, style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' } }, 'Save'),
        cmE('button', { onClick: function () { setForm(null); }, style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' } }, 'Cancel'))) : null;
    var nextDue = rows.filter(function (r) { return r.due; }).map(function (r) { return r.due; }).sort()[0];
    return cmE('div', null,
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,
      msg ? cmE('div', { style: { color: C.green || '#22c55e', fontSize: 12, marginBottom: 6, fontWeight: 700 } }, msg) : null,
      cmE('div', { style: Object.assign({}, card, { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }) },
        ['overdue', 'never', 'soon', 'ok'].map(function (s) { return cmE('div', { key: s }, cmE('div', { style: { fontSize: 20, fontWeight: 700 } }, cnt(s)), cmE('div', { style: small }, LABEL[s])); }),
        cmE('div', null, cmE('div', { style: { fontSize: 14, fontWeight: 700 } }, nextDue || '-'), cmE('div', { style: small }, 'next due')),
        cmE('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } }, cmE('span', { style: small }, 'Every'),
          cmSeg([['14', '2 wk'], ['21', '3 wk'], ['28', '4 wk']], String(iv), function (v) { setIval(Number(v)); })),
        cmE('button', { onClick: function () { startForm(null); }, style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' } }, 'Log topping')),
      formCard,
      cmE('div', { style: Object.assign({}, small, { marginBottom: 8 }) }, 'Barrels lose a little wine every week; topping every 2 to 4 weeks keeps the headspace small and the wine away from air. Rows are in walking order. Tap a row to see its barrels.'),
      groups.map(function (G) {
        var isO = open === G.key;
        return cmE('div', { key: G.key, style: Object.assign({}, card, { borderLeft: '4px solid ' + COLORS[G.status] }) },
          cmE('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
            cmE('div', { onClick: function () { setOpen(isO ? null : G.key); }, style: { flex: '1 1 200px', cursor: 'pointer' } }, cmE('div', { style: { fontWeight: 700 } }, G.key + ' · ' + G.rows.length + ' barrels'),
              cmE('div', { style: small }, LABEL[G.status] + (G.oldest ? ' · oldest topping ' + G.oldest : ''))),
            (G.area === 'EBS' || G.area === 'Rows') ? cmE('button', { onClick: function () { startForm(G); }, style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '4px 10px', fontWeight: 700, cursor: 'pointer', fontSize: 12 } }, 'Topped') : null),
          isO ? cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 } }, G.rows.map(function (r) {
            return cmE('span', { key: r.p.id, title: r.last ? 'Last topped ' + r.last + ', due ' + r.due : 'No topping on record', style: { fontSize: 11, padding: '2px 6px', borderRadius: 5, background: COLORS[r.status] } }, code(r.p) + (r.left != null ? ' · ' + (r.left < 0 ? -r.left + 'd late' : r.left + 'd') : ''));
          })) : null);
      }),
      toppers.length ? cmE('div', { style: card }, cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Topping wine on hand'),
        toppers.map(function (v) { var L = litersOf(v); return cmE('div', { key: v.id, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0', gap: 8 } }, cmE('span', null, (v.tank_code || v.vessel) + ': ' + v.contents), cmE('span', { style: { color: C.textDim, whiteSpace: 'nowrap' } }, L != null ? Math.round(L) + ' L' : (v.volume_text || 'volume not written'))); }),
        (function () {
          var used = D.logs.filter(function (l) { return l.liters_used != null; }).map(function (l) { return Number(l.liters_used); });
          var have = toppers.map(litersOf).filter(function (x) { return x != null; }).reduce(function (t, x) { return t + x; }, 0);
          if (!used.length) return cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'About ' + Math.round(have) + ' L on file. Log liters used with each topping to see how many weeks of topping wine are left.');
          var avg = used.reduce(function (t, x) { return t + x; }, 0) / used.length;
          return cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'About ' + Math.round(have) + ' L on file; ' + Math.round(avg) + ' L per topping on average, so roughly ' + Math.max(0, Math.floor(have / avg)) + ' more toppings (' + Math.max(0, Math.round(have / avg * iv / 7)) + ' weeks at this interval).');
        })()) : null);
  }

  window.cmToppingStatus = cmToppingStatus; window.cmToppingGroups = cmToppingGroups; window.cmToppingCovers = covers;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.top = { label: 'Topping', Component: CmTopping, order: 48 };
})();
