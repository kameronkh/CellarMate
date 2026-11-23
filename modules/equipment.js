/* CellarMate module: Vineyard equipment and maintenance
   Inventory of tractors, sprayers, implements, mowers, vehicles, tools, picking bins and safety
   gear (cellarmate.vineyard_equipment), a maintenance log with confirmations
   (cellarmate.equipment_maintenance), and what is due: a service past its interval, and the yearly
   LIVE sprayer inspection that each sprayer needs every season.
   Renders on Vine Blocks, Equipment (CmEquipment). Pure helper on window for the smoke tests:
   cmMaintenanceDue. */
(function () {
  'use strict';
  var KINDS = [['tractor', 'Tractor'], ['sprayer', 'Sprayer'], ['implement', 'Implement'], ['mower', 'Mower'], ['vehicle', 'Vehicle'], ['irrigation', 'Irrigation'], ['tool', 'Tool'], ['bins', 'Picking bins'], ['safety', 'Safety gear'], ['other', 'Other']];
  var MKINDS = ['service', 'repair', 'inspection', 'calibration', 'annual confirmation', 'other'];
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function addMonths(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
  function db() { return supa.schema('cellarmate'); }
  function me() { return (typeof CM_ME !== 'undefined' && CM_ME && CM_ME.full_name) || null; }
  function kindName(k) { return (KINDS.filter(function (x) { return x[0] === k; })[0] || [0, k])[1]; }

  /* what is due: services past their interval, and this year's sprayer inspection */
  function cmMaintenanceDue(equipment, logs, asOf) {
    var t = asOf || today(), y = +t.slice(0, 4), out = [];
    (equipment || []).filter(function (e) { return e.status !== 'sold' && e.status !== 'retired'; }).forEach(function (e) {
      var mine = (logs || []).filter(function (l) { return l.equipment_id === e.id; }).sort(function (a, b) { return a.done_on < b.done_on ? -1 : 1; });
      var last = mine[mine.length - 1];
      if (e.service_every_months) {
        var due = last ? addMonths(last.done_on, e.service_every_months) : null;
        if (!last) out.push({ equipment: e, kind: 'service', text: 'No service on record', due: null, level: 'warn' });
        else if (due <= t) out.push({ equipment: e, kind: 'service', text: 'Service was due ' + due, due: due, level: 'warn' });
      }
      var openNext = mine.filter(function (l) { return l.next_due_on && l.next_due_on <= t; }).pop();
      if (openNext && !mine.some(function (l) { return l.done_on > openNext.done_on; })) out.push({ equipment: e, kind: 'follow-up', text: 'Follow-up due ' + openNext.next_due_on + ': ' + openNext.description, due: openNext.next_due_on, level: 'warn' });
      if (e.kind === 'sprayer') {
        var insp = mine.filter(function (l) { return (l.kind === 'inspection' || l.kind === 'calibration') && +String(l.done_on).slice(0, 4) === y; });
        if (!insp.length) out.push({ equipment: e, kind: 'inspection', text: y + ' LIVE sprayer inspection not on file yet', due: y + '-12-31', level: t.slice(5) >= '10-01' ? 'warn' : 'info' });
        else if (!insp.some(function (l) { return l.confirmed; })) out.push({ equipment: e, kind: 'inspection', text: y + ' sprayer inspection logged but not confirmed', due: null, level: 'info' });
      }
    });
    return out;
  }

  function CmEquipment(P) {
    var site = P.site;
    var s = React.useState(null), D = s[0], setD = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    var a = React.useState({ name: '', kind: 'tractor', make: '', model: '', serial: '', model_year: '', quantity: '1', owner: '', service_every_months: '', note: '' }), A = a[0], setA = a[1];
    var m = React.useState({ equipment_id: '', done_on: today(), kind: 'service', description: '', hours_meter: '', cost: '', done_by: '', next_due_on: '', confirmed: false }), Mf = m[0], setM = m[1];
    var load = function () {
      if (!site) return;
      Promise.all([db().from('vineyard_equipment').select('*').eq('organization_id', site.organization_id).order('kind').order('name'), db().from('equipment_maintenance').select('*').eq('organization_id', site.organization_id).order('done_on', { ascending: false })])
        .then(function (r) { if (r[0].error || r[1].error) setErr((r[0].error || r[1].error).message); setD({ eq: (r[0].data || []).filter(function (x) { return !x.vineyard || x.vineyard === site.name; }), logs: r[1].data || [] }); });
    };
    React.useEffect(load, [site && site.id]);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var inp = { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' };
    var btn = { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' };
    if (!site) return null;
    if (!D) return cmE('div', { style: card }, err || 'Loading equipment...');
    var due = cmMaintenanceDue(D.eq, D.logs);
    var name = function (id) { var x = D.eq.filter(function (q) { return q.id === id; })[0]; return x ? x.name + (x.model ? ' ' + x.model : '') : ''; };
    var addEq = function () {
      if (!A.name.trim()) { setErr('Name the equipment.'); return; }
      db().from('vineyard_equipment').insert({ organization_id: site.organization_id, vineyard: site.name, name: A.name.trim(), kind: A.kind, make: A.make || null, model: A.model || null, serial: A.serial || null, model_year: num(A.model_year), quantity: num(A.quantity) || 1, owner: A.owner || null, service_every_months: num(A.service_every_months), note: A.note || null })
        .then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); setA({ name: '', kind: A.kind, make: '', model: '', serial: '', model_year: '', quantity: '1', owner: '', service_every_months: '', note: '' }); load(); } });
    };
    var addLog = function () {
      if (!Mf.equipment_id || !Mf.description.trim()) { setErr('Pick the equipment and describe the work.'); return; }
      db().from('equipment_maintenance').insert({ organization_id: site.organization_id, equipment_id: +Mf.equipment_id, done_on: Mf.done_on, kind: Mf.kind, description: Mf.description.trim(), hours_meter: num(Mf.hours_meter), cost: num(Mf.cost), done_by: Mf.done_by || null, next_due_on: Mf.next_due_on || null, confirmed: !!Mf.confirmed, confirmed_by: Mf.confirmed ? me() : null, confirmed_on: Mf.confirmed ? today() : null })
        .then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); setM(Object.assign({}, Mf, { description: '', hours_meter: '', cost: '', next_due_on: '', confirmed: false })); load(); } });
    };
    var confirm1 = function (l) { db().from('equipment_maintenance').update({ confirmed: true, confirmed_by: me(), confirmed_on: today() }).eq('id', l.id).then(function (r) { if (r.error) setErr(r.error.message); else load(); }); };
    var setStatus = function (x, v) { db().from('vineyard_equipment').update({ status: v }).eq('id', x.id).then(function (r) { if (r.error) setErr(r.error.message); else load(); }); };
    var del = function (t, id) { if (!window.confirm('Delete this entry?')) return; db().from(t).delete().eq('id', id).then(function (r) { if (r.error) setErr(r.error.message); else load(); }); };
    var fa = function (k, label, type, flex) { return cmE('label', { key: k, style: { flex: flex || '1 1 110px', fontSize: 11, color: C.textDim } }, label, cmE('input', { type: type || 'text', value: A[k], onChange: function (ev) { var o = Object.assign({}, A); o[k] = ev.target.value; setA(o); }, style: inp })); };
    var fm = function (k, label, type, flex) { return cmE('label', { key: k, style: { flex: flex || '1 1 110px', fontSize: 11, color: C.textDim } }, label, cmE('input', { type: type || 'text', value: Mf[k], onChange: function (ev) { var o = Object.assign({}, Mf); o[k] = ev.target.value; setM(o); }, style: inp })); };
    var groups = KINDS.map(function (k) { return { k: k, items: D.eq.filter(function (x) { return x.kind === k[0]; }) }; }).filter(function (g) { return g.items.length; });
    return cmE('div', null,
      cmE('div', { style: { fontSize: 15, fontWeight: 700, margin: '4px 0 8px' } }, 'Equipment and maintenance'),
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Due'),
        due.length ? due.map(function (d, i) { return cmE('div', { key: i, style: { fontSize: 12, color: d.level === 'warn' ? C.orange : C.text, padding: '2px 0' } }, cmE('b', null, d.equipment.name + (d.equipment.model ? ' ' + d.equipment.model : '') + ': '), d.text); })
          : cmE('div', { style: { fontSize: 12, color: C.green } }, 'Nothing due.')),
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Inventory (' + D.eq.reduce(function (a, x) { return a + (x.quantity || 1); }, 0) + ' items)'),
        groups.map(function (g) {
          return cmE('div', { key: g.k[0], style: { marginBottom: 6 } }, cmE('div', { style: { fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase' } }, g.k[1]),
            g.items.map(function (x) {
              var last = D.logs.filter(function (l) { return l.equipment_id === x.id; })[0];
              return cmE('div', { key: x.id, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px solid ' + C.cardBorder, flexWrap: 'wrap' } },
                cmE('span', { style: { flex: '2 1 200px' } }, cmE('b', null, x.name), (x.quantity > 1 ? ' x' + x.quantity : '') + [x.make, x.model, x.serial ? 'serial ' + x.serial : null, x.model_year].filter(Boolean).map(function (v) { return ' · ' + v; }).join(''), x.owner ? cmE('span', { style: small }, ' · owner ' + x.owner) : null),
                cmE('span', { style: Object.assign({}, small, { flex: '1 1 140px' }) }, last ? 'last ' + last.kind + ' ' + last.done_on : 'no log yet'),
                cmE('select', { value: x.status, onChange: function (ev) { setStatus(x, ev.target.value); }, style: Object.assign({}, cmSel, { padding: '3px 6px', fontSize: 12, flex: '0 0 120px' }) }, ['in use', 'needs repair', 'stored', 'sold', 'retired'].map(function (v) { return cmE('option', { key: v, value: v }, v); })),
                cmE('span', { onClick: function () { del('vineyard_equipment', x.id); }, style: { color: C.textDim, cursor: 'pointer' } }, '×'),
                x.note ? cmE('div', { style: Object.assign({}, small, { flexBasis: '100%' }) }, x.note) : null);
            }));
        }),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 } },
          fa('name', 'Name', 'text', '2 1 150px'),
          cmE('label', { style: { flex: '1 1 110px', fontSize: 11, color: C.textDim } }, 'Kind', cmE('select', { value: A.kind, onChange: function (ev) { setA(Object.assign({}, A, { kind: ev.target.value })); }, style: inp }, KINDS.map(function (k) { return cmE('option', { key: k[0], value: k[0] }, k[1]); }))),
          fa('make', 'Make'), fa('model', 'Model'), fa('serial', 'Serial'), fa('model_year', 'Year', 'number', '0 1 70px'), fa('quantity', 'Qty', 'number', '0 1 60px'), fa('owner', 'Owner'), fa('service_every_months', 'Service every (months)', 'number'),
          cmE('button', { onClick: addEq, style: btn }, 'Add'))),
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Maintenance log'),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 } },
          cmE('label', { style: { flex: '2 1 160px', fontSize: 11, color: C.textDim } }, 'Equipment', cmE('select', { value: Mf.equipment_id, onChange: function (ev) { setM(Object.assign({}, Mf, { equipment_id: ev.target.value })); }, style: inp }, [cmE('option', { key: '', value: '' }, 'Pick')].concat(D.eq.map(function (x) { return cmE('option', { key: x.id, value: x.id }, x.name + (x.model ? ' ' + x.model : '')); })))),
          fm('done_on', 'Date', 'date'),
          cmE('label', { style: { flex: '1 1 110px', fontSize: 11, color: C.textDim } }, 'Kind', cmE('select', { value: Mf.kind, onChange: function (ev) { setM(Object.assign({}, Mf, { kind: ev.target.value })); }, style: inp }, MKINDS.map(function (k) { return cmE('option', { key: k, value: k }, k); }))),
          fm('description', 'What was done', 'text', '3 1 200px'), fm('hours_meter', 'Hours meter', 'number', '0 1 90px'), fm('cost', 'Cost $', 'number', '0 1 80px'), fm('done_by', 'By'), fm('next_due_on', 'Next due', 'date'),
          cmE('label', { style: { fontSize: 11, color: C.textDim, display: 'flex', alignItems: 'center', gap: 4 } }, cmE('input', { type: 'checkbox', checked: Mf.confirmed, onChange: function (ev) { setM(Object.assign({}, Mf, { confirmed: ev.target.checked })); } }), 'Confirmed'),
          cmE('button', { onClick: addLog, style: btn }, 'Log')),
        D.logs.slice(0, 30).map(function (l) {
          return cmE('div', { key: l.id, style: { display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px solid ' + C.cardBorder, flexWrap: 'wrap' } },
            cmE('span', { style: { width: 80, color: C.textDim } }, l.done_on), cmE('span', { style: { width: 150 } }, name(l.equipment_id)), cmE('span', { style: { width: 90, color: C.textDim } }, l.kind),
            cmE('span', { style: { flex: '1 1 200px' } }, l.description + (l.cost != null ? ' · $' + l.cost : '') + (l.done_by ? ' · ' + l.done_by : '')),
            l.confirmed ? cmE('span', { style: { color: C.green } }, 'confirmed' + (l.confirmed_by ? ' by ' + l.confirmed_by : '')) : cmE('span', { onClick: function () { confirm1(l); }, style: { color: C.accentLight, cursor: 'pointer', fontWeight: 700 } }, 'Confirm'),
            cmE('span', { onClick: function () { del('equipment_maintenance', l.id); }, style: { color: C.textDim, cursor: 'pointer' } }, '×'));
        })));
  }

  window.cmMaintenanceDue = cmMaintenanceDue;
  window.CmEquipment = CmEquipment;
})();
