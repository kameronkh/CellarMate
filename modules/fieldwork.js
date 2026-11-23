/* CellarMate module: Field work (block board, safety windows, scouting, growth stages, labor)
   What the leading vineyard tools offer, built on the records CellarMate already keeps:
   - Re-entry (REI) and pre-harvest (PHI) windows worked out from each spray and its products,
     shown per block so nobody walks into a sprayed block or picks too soon.
   - A scouting and growth stage log (cellarmate.vineyard_observations) using the modified
     Eichhorn-Lorenz (E-L) stages, which also gives budbreak, bloom and veraison dates each year.
   - A labor log (cellarmate.vineyard_labor) with hours and cost per block and per acre.
   - A block board: one tile per block with its stage, safety window, last scouting and hours.
   Renders on Vine Blocks (CmFieldWork). The owner portal uses cmSafetyWindows and cmStageName.
   Pure helpers on window for the smoke tests: cmSafetyWindows, cmPhenology, cmLaborByBlock,
   cmStageName. */
(function () {
  'use strict';
  var STAGES = [[1, 'Winter bud'], [4, 'Budbreak (green tip)'], [7, 'First leaf'], [12, 'Five leaves'], [15, 'Eight leaves'], [17, 'Twelve leaves'], [19, 'Flowering begins'],
    [23, 'Full bloom (half the caps off)'], [27, 'Fruit set'], [29, 'Peppercorn berries'], [31, 'Pea-size berries'], [33, 'Bunch closure'], [35, 'Veraison'], [36, 'Berries softening'],
    [38, 'Ripe for harvest'], [41, 'After harvest'], [43, 'Leaf fall begins'], [47, 'Leaf fall done']];
  var KINDS = ['growth stage', 'scouting', 'pest', 'disease', 'weed', 'frost', 'hail', 'wind', 'heat', 'other'];
  var MILESTONES = [[4, 'Budbreak'], [23, 'Bloom'], [35, 'Veraison']];
  function cmStageName(n) { var s = null; STAGES.forEach(function (x) { if (n != null && x[0] <= n) s = x[1]; }); return n == null ? '' : 'E-L ' + n + (s ? ' · ' + s : ''); }
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function md(s) { return s ? String(s).slice(5, 10) : ''; }
  function key(n) { return String(n || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function db() { return supa.schema('cellarmate'); }
  function me() { return (typeof CM_ME !== 'undefined' && CM_ME && CM_ME.full_name) || null; }
  function blockNums(text, all) { if (!text || /all/i.test(text)) return all.slice(); var m = String(text).match(/\d+/g) || []; return m.map(Number).filter(function (n) { return all.indexOf(n) >= 0; }); }

  /* sprays + products -> re-entry and pre-harvest windows per block. A spray is treated as
     finished at 6 pm on its last day, so REI runs from then. */
  function cmSafetyWindows(sprays, products, blockList, now) {
    var P = {}; (products || []).forEach(function (p) { P[key(p.name)] = p; });
    var all = (blockList || []).map(function (b) { return Number(b.block); });
    var t = now ? new Date(now) : new Date(), todayStr = now ? String(now).slice(0, 10) : today();
    var per = {}; all.forEach(function (b) { per[b] = { block: b, reiUntil: null, phiUntil: null, rei: [], phi: [] }; });
    (sprays || []).forEach(function (s) {
      if (!s.date || s.skipped) return;
      var last = s.end_date || s.date, done = new Date(last + 'T18:00:00');
      var parse = window.cmParseProducts ? window.cmParseProducts(s.products_rate_per_acre) : [];
      var rei = 0, phi = 0, reiBy = [], phiBy = [];
      parse.forEach(function (x) { var p = P[key(x.name)]; if (!p) return; var r = num(p.rei_hours) || 0, h = num(p.phi_days) || 0; if (r > rei) { rei = r; } if (r) reiBy.push(p.name + ' ' + r + ' h'); if (h > phi) phi = h; if (h) phiBy.push(p.name + ' ' + h + ' d'); });
      var reiUntil = rei ? new Date(done.getTime() + rei * 3600000) : null, phiUntil = phi ? addDays(last, phi) : null;
      blockNums(s.blocks, all).forEach(function (b) {
        var o = per[b];
        if (reiUntil && reiUntil > t && (!o.reiUntil || reiUntil > o.reiUntil)) { o.reiUntil = reiUntil; o.rei = reiBy; }
        if (phiUntil && phiUntil >= todayStr && (!o.phiUntil || phiUntil > o.phiUntil)) { o.phiUntil = phiUntil; o.phi = phiBy; }
      });
    });
    var list = Object.keys(per).map(function (k) { return per[k]; });
    return { blocks: per, active: list.filter(function (o) { return o.reiUntil || o.phiUntil; }) };
  }

  /* observations -> first date each year a block reached budbreak, bloom and veraison */
  function cmPhenology(obs) {
    var out = {};
    (obs || []).forEach(function (o) {
      if (o.kind !== 'growth stage' || o.el_stage == null || !o.observed_on) return;
      var y = o.observed_on.slice(0, 4), r = out[y] = out[y] || {};
      MILESTONES.forEach(function (m) { if (o.el_stage >= m[0] && (!r[m[1]] || o.observed_on < r[m[1]])) r[m[1]] = o.observed_on; });
    });
    return out;
  }

  /* labor -> hours and cost per block for one year; a job over several blocks is split by acres */
  function cmLaborByBlock(labor, blockList, year, defaultRate) {
    var A = {}, all = []; (blockList || []).forEach(function (b) { A[b.block] = num(b.acres) || 0; all.push(Number(b.block)); });
    var per = {}; all.forEach(function (b) { per[b] = { block: b, acres: A[b], hours: 0, cost: 0 }; });
    var unassigned = { hours: 0, cost: 0 };
    (labor || []).forEach(function (l) {
      if (String(l.worked_on).slice(0, 4) !== String(year)) return;
      var hrs = (num(l.hours) || 0) * (num(l.people) || 1), cost = hrs * (num(l.rate) != null ? num(l.rate) : (defaultRate || 0));
      var bl = blockNums(l.blocks, all); if (!bl.length) { unassigned.hours += hrs; unassigned.cost += cost; return; }
      var ac = bl.reduce(function (a, b) { return a + (A[b] || 0); }, 0);
      bl.forEach(function (b) { var share = ac ? (A[b] || 0) / ac : 1 / bl.length; per[b].hours += hrs * share; per[b].cost += cost * share; });
    });
    var rows = all.sort(function (a, b) { return a - b; }).map(function (b) { var o = per[b]; o.perAcre = o.acres ? o.cost / o.acres : null; return o; });
    var tot = rows.reduce(function (a, r) { a.hours += r.hours; a.cost += r.cost; a.acres += r.acres; return a; }, { hours: unassigned.hours, cost: unassigned.cost, acres: 0 });
    return { rows: rows, unassigned: unassigned, total: tot };
  }

  var card = function () { return { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }; };
  var small = function () { return { fontSize: 11, color: C.textDim }; };
  var inp = function () { return { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' }; };
  var lab = function (k, label, el, flex) { return cmE('label', { key: k, style: { flex: flex || '1 1 110px', fontSize: 11, color: C.textDim } }, label, el); };
  var sevColor = function (s) { return s === 'high' ? C.red : s === 'moderate' ? C.orange : s === 'low' ? C.accentLight : C.textDim; };
  function fmtTime(d) { return d ? (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; }

  function CmFieldWork(P) {
    var site = P.site;
    var s = React.useState(null), D = s[0], setD = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    var yr = new Date().getFullYear();
    var y = React.useState(yr), year = y[0], setYear = y[1];
    var rateKey = 'cm_labor_rate_' + (site ? site.organization_id : '');
    var rs = React.useState(function () { try { return Number(localStorage.getItem(rateKey)) || 25; } catch (x) { return 25; } }), rate = rs[0], setRate = rs[1];
    var f = React.useState({ observed_on: today(), block: '', kind: 'scouting', el_stage: '', subject: '', severity: 'low', note: '', owner_visible: true }), F = f[0], setF = f[1];
    var l = React.useState({ worked_on: today(), blocks: '', task: '', people: '1', hours: '', rate: '' }), L = l[0], setL = l[1];
    var load = function () {
      if (!site) return; if (typeof CM_CACHE !== 'undefined') delete CM_CACHE.spray_products;
      Promise.all([db().from('vineyard_observations').select('*').eq('organization_id', site.organization_id).eq('vineyard', site.name).order('observed_on', { ascending: false }).limit(500),
        db().from('vineyard_labor').select('*').eq('organization_id', site.organization_id).eq('vineyard', site.name).order('worked_on', { ascending: false }).limit(2000),
        cmFetch('spray_products'), cmFetch('vineyard_blocks')])
        .then(function (a) { if (a[0].error || a[1].error) setErr((a[0].error || a[1].error).message); setD({ obs: a[0].data || [], labor: a[1].data || [], prods: a[2], blocks: a[3].filter(function (b) { return b.vineyard === site.name; }) }); })
        .catch(function (x) { setErr(x.message); });
    };
    React.useEffect(load, [site && site.id]);
    if (!site) return null;
    if (!D) return cmE('div', { style: card() }, 'Loading field work...');
    var blocks = D.blocks.slice().sort(function (a, b) { return a.block - b.block; });
    var sprays = (P.sprays || []).filter(function (x) { return !x.vineyard || x.vineyard === site.name; });
    var safe = cmSafetyWindows(sprays, D.prods, blocks);
    var pheno = cmPhenology(D.obs), labor = cmLaborByBlock(D.labor, blocks, year, rate);
    var latest = {}; D.obs.forEach(function (o) { var b = o.block || 0; if (o.kind === 'growth stage' && o.el_stage != null && !(latest[b] && latest[b].stage)) latest[b] = Object.assign(latest[b] || {}, { stage: o }); if (o.kind !== 'growth stage' && !(latest[b] && latest[b].scout)) latest[b] = Object.assign(latest[b] || {}, { scout: o }); });
    var stageOf = function (b) { return (latest[b] && latest[b].stage) || (latest[0] && latest[0].stage) || null; };
    var addObs = function () {
      if (F.kind === 'growth stage' && !F.el_stage) { setErr('Pick the growth stage.'); return; }
      if (F.kind !== 'growth stage' && !F.note.trim() && !F.subject.trim()) { setErr('Add what you saw.'); return; }
      db().from('vineyard_observations').insert({ organization_id: site.organization_id, vineyard: site.name, block: F.block ? +F.block : null, observed_on: F.observed_on, kind: F.kind, el_stage: F.el_stage ? +F.el_stage : null, subject: F.subject || null, severity: F.kind === 'growth stage' ? null : F.severity, note: F.note || null, owner_visible: !!F.owner_visible, observed_by: me() })
        .then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); setF(Object.assign({}, F, { subject: '', note: '' })); load(); } });
    };
    var addLabor = function () {
      if (!L.task.trim() || !num(L.hours)) { setErr('Enter the job and the hours.'); return; }
      db().from('vineyard_labor').insert({ organization_id: site.organization_id, vineyard: site.name, worked_on: L.worked_on, blocks: L.blocks || null, task: L.task.trim(), people: num(L.people) || 1, hours: num(L.hours), rate: num(L.rate), entered_by: me() })
        .then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); setL(Object.assign({}, L, { task: '', hours: '' })); load(); } });
    };
    var del = function (t, id) { if (!confirm('Delete this entry?')) return; db().from(t).delete().eq('id', id).then(function (r) { if (r.error) setErr(r.error.message); else load(); }); };
    var saveRate = function (v) { setRate(v); try { localStorage.setItem(rateKey, String(v)); } catch (x) { } };
    var years = {}; D.labor.forEach(function (x) { years[String(x.worked_on).slice(0, 4)] = 1; }); D.obs.forEach(function (x) { years[String(x.observed_on).slice(0, 4)] = 1; }); years[yr] = 1;
    var ys = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
    var blockOpts = [cmE('option', { key: '', value: '' }, 'Whole vineyard')].concat(blocks.map(function (b) { return cmE('option', { key: b.block, value: b.block }, 'Block ' + b.block + ' · ' + (b.clone || '')); }));
    var th = { textAlign: 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var td = { textAlign: 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' };
    var L0 = function (o) { return Object.assign({}, o, { textAlign: 'left' }); };
    return cmE('div', null,
      cmE('div', { style: { fontSize: 15, fontWeight: 700, margin: '12px 0 8px' } }, 'Field work'),
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,

      /* block board */
      blocks.length ? cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 6 } }, 'Block board'),
        cmE('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 } }, blocks.map(function (b) {
          var sw = safe.blocks[b.block] || {}, st = stageOf(b.block), sc = latest[b.block] && latest[b.block].scout, lb = labor.rows.filter(function (r) { return r.block === Number(b.block); })[0];
          return cmE('div', { key: b.block, style: { border: '1px solid ' + (sw.reiUntil ? C.red : sw.phiUntil ? C.orange : C.cardBorder), borderRadius: 8, padding: 8, fontSize: 11 } },
            cmE('div', { style: { fontWeight: 700, fontSize: 13 } }, 'Block ' + b.block, cmE('span', { style: Object.assign(small(), { fontWeight: 400 }) }, ' · ' + (b.clone || '') + ' · ' + (num(b.acres) || 0).toFixed(2) + ' ac')),
            cmE('div', null, st ? cmStageName(st.el_stage) + ' (' + md(st.observed_on) + ')' : cmE('span', { style: small() }, 'No stage logged')),
            sw.reiUntil ? cmE('div', { style: { color: C.red, fontWeight: 700 } }, 'Keep out until ' + fmtTime(sw.reiUntil)) : null,
            sw.phiUntil ? cmE('div', { style: { color: C.orange } }, 'No harvest before ' + md(sw.phiUntil)) : null,
            sc ? cmE('div', { style: { color: sevColor(sc.severity) } }, md(sc.observed_on) + ' ' + (sc.subject || sc.kind) + (sc.severity ? ' (' + sc.severity + ')' : '')) : null,
            lb && lb.hours ? cmE('div', { style: small() }, Math.round(lb.hours) + ' labor hours in ' + year) : null);
        }))) : null,

      /* safety */
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Re-entry and pre-harvest windows'),
        safe.active.length ? safe.active.map(function (o) { return cmE('div', { key: o.block, style: { fontSize: 12, padding: '3px 0' } }, cmE('b', null, 'Block ' + o.block + ': '), o.reiUntil ? cmE('span', { style: { color: C.red } }, 'keep out until ' + fmtTime(o.reiUntil) + ' (' + o.rei.join(', ') + ') ') : null, o.phiUntil ? cmE('span', { style: { color: C.orange } }, 'no harvest before ' + o.phiUntil + ' (' + o.phi.join(', ') + ')') : null); })
          : cmE('div', { style: { fontSize: 12, color: C.green } }, 'No re-entry or pre-harvest limits in effect.'),
        cmE('div', { style: Object.assign(small(), { marginTop: 4 }) }, 'From each spray\'s products and their REI and PHI in the product list. A spray counts as finished at 6 pm on its last day.')),

      /* scouting and growth stage */
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Scouting and growth stages'),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 } },
          lab('d', 'Date', cmE('input', { type: 'date', value: F.observed_on, onChange: function (ev) { setF(Object.assign({}, F, { observed_on: ev.target.value })); }, style: inp() })),
          lab('b', 'Block', cmE('select', { value: F.block, onChange: function (ev) { setF(Object.assign({}, F, { block: ev.target.value })); }, style: inp() }, blockOpts)),
          lab('k', 'What', cmE('select', { value: F.kind, onChange: function (ev) { setF(Object.assign({}, F, { kind: ev.target.value })); }, style: inp() }, KINDS.map(function (k) { return cmE('option', { key: k, value: k }, k.charAt(0).toUpperCase() + k.slice(1)); }))),
          F.kind === 'growth stage' ? lab('s', 'Stage (E-L)', cmE('select', { value: F.el_stage, onChange: function (ev) { setF(Object.assign({}, F, { el_stage: ev.target.value })); }, style: inp() }, [cmE('option', { key: '', value: '' }, 'Pick a stage')].concat(STAGES.map(function (x) { return cmE('option', { key: x[0], value: x[0] }, x[0] + ' · ' + x[1]); }))), '2 1 180px')
            : lab('u', 'Pest, disease or weed', cmE('input', { value: F.subject, onChange: function (ev) { setF(Object.assign({}, F, { subject: ev.target.value })); }, placeholder: 'e.g. powdery mildew', style: inp() })),
          F.kind !== 'growth stage' ? lab('v', 'Severity', cmE('select', { value: F.severity, onChange: function (ev) { setF(Object.assign({}, F, { severity: ev.target.value })); }, style: inp() }, ['none', 'low', 'moderate', 'high'].map(function (x) { return cmE('option', { key: x, value: x }, x); }))) : null,
          lab('n', 'Note', cmE('input', { value: F.note, onChange: function (ev) { setF(Object.assign({}, F, { note: ev.target.value })); }, style: inp() }), '2 1 180px'),
          cmE('label', { style: { fontSize: 11, color: C.textDim, display: 'flex', alignItems: 'center', gap: 4 } }, cmE('input', { type: 'checkbox', checked: F.owner_visible, onChange: function (ev) { setF(Object.assign({}, F, { owner_visible: ev.target.checked })); } }), 'Show to owner'),
          cmE('button', { onClick: addObs, style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' } }, 'Add')),
        Object.keys(pheno).length ? cmE('div', { style: { fontSize: 12, marginBottom: 6 } }, Object.keys(pheno).sort().reverse().map(function (yy) {
          var r = pheno[yy], sea = P.seasons && P.seasons[yy];
          return cmE('div', { key: yy }, cmE('b', null, yy + ': '), MILESTONES.map(function (m) { var d = r[m[1]]; return d ? m[1] + ' ' + md(d) + (sea && sea.at(d) != null ? ' (' + Math.round(sea.at(d)) + ' heat units)' : '') : null; }).filter(Boolean).join(' · '));
        })) : cmE('div', { style: Object.assign(small(), { marginBottom: 6 }) }, 'Log growth stages as the season moves; budbreak, bloom and veraison dates fill in on their own.'),
        D.obs.slice(0, 20).map(function (o) {
          return cmE('div', { key: o.id, style: { display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px solid ' + C.cardBorder } },
            cmE('span', { style: { width: 44, color: C.textDim } }, md(o.observed_on)), cmE('span', { style: { width: 60, color: C.textDim } }, o.block ? 'Block ' + o.block : 'All'),
            cmE('span', { style: { flex: 1, color: o.kind === 'growth stage' ? C.text : sevColor(o.severity) } }, o.kind === 'growth stage' ? cmStageName(o.el_stage) : (o.subject || o.kind) + (o.severity ? ' (' + o.severity + ')' : ''), o.note ? cmE('span', { style: { color: C.textDim } }, ' · ' + o.note) : null, o.owner_visible ? null : cmE('span', { style: small() }, ' · not shown to owner')),
            cmE('span', { onClick: function () { del('vineyard_observations', o.id); }, style: { color: C.textDim, cursor: 'pointer' } }, '×'));
        })),

      /* labor */
      cmE('div', { style: Object.assign(card(), { overflowX: 'auto' }) },
        cmE('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } }, cmE('div', { style: { fontWeight: 700, flex: 1 } }, 'Labor and cost per block'),
          cmE('select', { value: year, onChange: function (ev) { setYear(+ev.target.value); }, style: Object.assign({}, cmSel, { flex: '0 0 90px' }) }, ys.map(function (v) { return cmE('option', { key: v, value: v }, v); })),
          cmE('label', { style: small() }, 'Default $/hour ', cmE('input', { type: 'number', value: rate, onChange: function (ev) { saveRate(Number(ev.target.value) || 0); }, style: Object.assign(inp(), { width: 70 }) }))),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 } },
          lab('ld', 'Date', cmE('input', { type: 'date', value: L.worked_on, onChange: function (ev) { setL(Object.assign({}, L, { worked_on: ev.target.value })); }, style: inp() })),
          lab('lt', 'Job', cmE('input', { value: L.task, onChange: function (ev) { setL(Object.assign({}, L, { task: ev.target.value })); }, placeholder: 'e.g. shoot thinning', style: inp() }), '2 1 160px'),
          lab('lb', 'Blocks', cmE('input', { value: L.blocks, onChange: function (ev) { setL(Object.assign({}, L, { blocks: ev.target.value })); }, placeholder: '2, 3 or all', style: inp() })),
          lab('lp', 'People', cmE('input', { type: 'number', value: L.people, onChange: function (ev) { setL(Object.assign({}, L, { people: ev.target.value })); }, style: inp() }), '0 1 70px'),
          lab('lh', 'Hours each', cmE('input', { type: 'number', step: 'any', value: L.hours, onChange: function (ev) { setL(Object.assign({}, L, { hours: ev.target.value })); }, style: inp() }), '0 1 80px'),
          lab('lr', '$/hour', cmE('input', { type: 'number', step: 'any', value: L.rate, placeholder: String(rate), onChange: function (ev) { setL(Object.assign({}, L, { rate: ev.target.value })); }, style: inp() }), '0 1 80px'),
          cmE('button', { onClick: addLabor, style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' } }, 'Add hours')),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 420 } },
          cmE('thead', null, cmE('tr', null, ['Block', 'Acres', 'Hours', 'Cost', 'Cost per acre'].map(function (h, i) { return cmE('th', { key: h, style: i ? th : L0(th) }, h); }))),
          cmE('tbody', null, labor.rows.map(function (r) { return cmE('tr', { key: r.block }, cmE('td', { style: L0(td) }, 'Block ' + r.block), cmE('td', { style: td }, r.acres.toFixed(2)), cmE('td', { style: td }, r.hours ? r.hours.toFixed(1) : ''), cmE('td', { style: td }, r.cost ? '$' + Math.round(r.cost).toLocaleString() : ''), cmE('td', { style: td }, r.perAcre ? '$' + Math.round(r.perAcre).toLocaleString() : '')); })
            .concat([cmE('tr', { key: 'tot' }, cmE('td', { style: Object.assign(L0(td), { fontWeight: 700 }) }, 'Total' + (labor.unassigned.hours ? ' (incl. ' + labor.unassigned.hours.toFixed(1) + ' h not tied to a block)' : '')), cmE('td', { style: td }, labor.total.acres.toFixed(2)), cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, labor.total.hours.toFixed(1)), cmE('td', { style: Object.assign({}, td, { fontWeight: 700 }) }, '$' + Math.round(labor.total.cost).toLocaleString()), cmE('td', { style: td }, labor.total.acres ? '$' + Math.round(labor.total.cost / labor.total.acres).toLocaleString() : ''))]))),
        D.labor.filter(function (x) { return String(x.worked_on).slice(0, 4) === String(year); }).slice(0, 12).map(function (x) {
          return cmE('div', { key: x.id, style: { display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px solid ' + C.cardBorder } }, cmE('span', { style: { width: 44, color: C.textDim } }, md(x.worked_on)), cmE('span', { style: { flex: 1 } }, x.task + (x.blocks ? ' · blocks ' + x.blocks : '') + ' · ' + (num(x.people) || 1) + ' x ' + x.hours + ' h'), cmE('span', { onClick: function () { del('vineyard_labor', x.id); }, style: { color: C.textDim, cursor: 'pointer' } }, '×'));
        }),
        cmE('div', { style: Object.assign(small(), { marginTop: 4 }) }, 'Hours are people x hours each; a job over several blocks is shared by acres. Labor is never shown to vineyard owners.')));
  }

  window.cmStageName = cmStageName;
  window.cmSafetyWindows = cmSafetyWindows;
  window.cmPhenology = cmPhenology;
  window.cmLaborByBlock = cmLaborByBlock;
  window.cmEL_STAGES = STAGES;
  window.CmFieldWork = CmFieldWork;
})();
