/* CellarMate module: Crop estimate and thinning scenarios (Vine Blocks tab 'Crop estimate')
   - Counts per block (crop_counts): vines, shoots with clusters, clusters per vine, grams per cluster at
     lag (with and without wings), lag factor low / middle / high. Loaded from the Results Partners lag
     files (2022 to 2025) and the Century 2026 crop estimate; new counts can be added here.
   - Estimate in tons = vines x clusters per vine x grams per cluster x lag factor / 907,185. At lag phase
     clusters are about half their final weight, so the factor sits near 2 (1.6 to 2.1 here).
   - Thinning scenarios per block (or the whole vineyard): leave as is, remove wings, one cluster per
     shoot, both, drop to a target tons per acre, drop a percent, green drop at veraison. Kept berries
     grow a little more after early thinning (compensation), which the scenarios include.
   - Ripening check: leaf area per kg of fruit against the 0.8 to 1.2 m2/kg band for VSP
     (Kliewer and Dokoozlian 2005), raised in a cool season and lowered in a warm one using heat so far
     against the average year from the saved weather.
   - Rows: the chosen block's scenario spread over its rows by vines per row (vineyard_rows).
   - History: estimate against pick by block and the realised factor (pick / lag weight), which folds in
     the thinning and dropping that happened after the count.
   Pure helpers for the smoke tests: cmCropTons, cmThinScenario, cmRipenCheck, cmSeasonHeat. */
(function () {
  'use strict';
  var ORG = '762fc809-0341-4ee2-834f-16e707181ea7';
  var LB = 907185; /* grams per US ton */
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function db() { return supa.schema('cellarmate'); }

  function cmCropTons(vines, clusters, grams, lag) {
    if (!vines || clusters == null || !grams || !lag) return null;
    return vines * clusters * grams * lag / LB;
  }
  var SCEN = [
    ['asis', 'Leave as is'],
    ['wings', 'Remove wings'],
    ['one', 'One cluster per shoot'],
    ['onewings', 'One cluster per shoot and wings'],
    ['target', 'Drop to target tons per acre'],
    ['pct', 'Drop a percent of clusters'],
    ['green', 'Green drop at veraison (10%)'],
    ['oneplus2', 'One per shoot plus 2, wings off (RRV 2023)'],
    ['removeN', 'Remove N per vine, declump, wings off (Roots 2023)']
  ];
  /* c: count row; o: { scenario, lag, target, pct, comp } -> clusters, grams, tons, tpa, removed */
  function cmThinScenario(c, o) {
    o = o || {};
    var lag = num(o.lag) || num(c.lag_mid) || 2, vines = num(c.vines), acres = num(c.acres) || (vines ? vines / 1450 : null);
    var cl = num(c.clusters_per_vine), gw = num(c.grams_with_wings), g0 = num(c.grams_per_cluster);
    var gAsIs = gw || g0, gNoWing = g0 && gw ? g0 : g0 ? g0 * 0.94 : null; /* wings about 6 percent when not measured */
    var comp = o.comp == null ? 0.05 : num(o.comp); /* kept berries size up a little after early thinning */
    var sh = num(c.shoots_per_vine), s = o.scenario || 'asis', clusters = cl, grams = gAsIs, note = '';
    if (s === 'wings') { grams = gNoWing; }
    if (s === 'one' || s === 'onewings') {
      var keep = sh ? Math.min(cl, sh) : cl * 0.62; if (!sh) note = 'shoots not counted: assumed 38 percent of clusters are seconds';
      clusters = keep; if (s === 'onewings') grams = gNoWing;
      if (keep < cl) grams = grams * (1 + comp);
    }
    if (s === 'target') {
      var t = num(o.target) || 2.25;
      var need = acres ? t * acres * LB / (vines * gAsIs * lag) : cl;
      clusters = Math.min(cl, need); if (clusters < cl * 0.85) { grams = gAsIs * (1 + comp); clusters = Math.min(cl, need / (1 + comp)); }
      if (clusters === cl) note = 'already at or under the target';
    }
    if (s === 'pct') { clusters = cl * (1 - (num(o.pct) || 0) / 100); if ((num(o.pct) || 0) >= 15) grams = gAsIs * (1 + comp); }
    if (s === 'green') { clusters = cl * 0.9; }
    if (s === 'oneplus2') { clusters = Math.min(cl, (sh || cl * 0.62) + (num(o.extra) || 2)); grams = gNoWing; if (clusters < cl) grams = grams * (1 + comp); }
    if (s === 'removeN') { clusters = Math.max(0, cl - (num(o.removeN) || 5)); grams = gNoWing * (1 + comp); }
    var before = cmCropTons(vines, cl, gAsIs, lag), tons = cmCropTons(vines, clusters, grams, lag);
    return { scenario: s, clusters: clusters, grams: grams, tons: tons, before: before, tpa: acres && tons != null ? tons / acres : null,
      beforeTpa: acres && before != null ? before / acres : null, removed: cl ? 1 - clusters / cl : 0, lag: lag, note: note };
  }
  /* heat so far this season against the average of other years at the same date (GDD base 50F from Apr 1) */
  function cmSeasonHeat(days, year, asOf) {
    var by = {};
    (days || []).forEach(function (d) {
      var y = d.date.slice(0, 4), m = d.date.slice(5); if (m < '04-01' || m > '10-31') return;
      var tx = num(d.tmax), tn = num(d.tmin); if (tx == null || tn == null) return;
      var g = Math.max(0, (tx + tn) / 2 - 50); by[y] = by[y] || {}; by[y][m] = g;
    });
    var end = asOf || '10-31';
    var sum = function (y) { var t = 0, n = 0; Object.keys(by[y] || {}).forEach(function (m) { if (m <= end) { t += by[y][m]; n++; } }); return { t: t, n: n }; };
    var me = sum(String(year)), others = Object.keys(by).filter(function (y) { return +y !== +year; }).map(sum).filter(function (x) { return x.n > 100 || (end < '08-01' && x.n > 30); });
    if (!me.n || !others.length) return { idx: 1, gdd: me.t || null, normal: null, label: 'no weather saved: normal season assumed' };
    var normal = others.reduce(function (t, x) { return t + x.t; }, 0) / others.length, idx = me.t / normal;
    return { idx: idx, gdd: me.t, normal: normal, label: idx < 0.95 ? 'cool season' : idx > 1.05 ? 'warm season' : 'about normal season' };
  }
  /* leaf area per kg of fruit; band 0.8 to 1.2 m2/kg for VSP, shifted by season heat */
  function cmRipenCheck(sc, shoots, laPerShoot, heatIdx) {
    var kg = sc && sc.clusters != null && sc.grams ? sc.clusters * sc.grams * sc.lag / 1000 : null;
    if (!kg || !shoots) return { ratio: null, need: null, status: 'unknown', text: 'needs shoots and clusters per vine' };
    var ratio = shoots * (num(laPerShoot) || 0.2) / kg;
    var need = heatIdx < 0.95 ? 1.0 : heatIdx > 1.05 ? 0.7 : 0.8;
    var status = ratio >= need ? 'ok' : ratio >= need * 0.85 ? 'tight' : 'risk';
    return { ratio: ratio, need: need, kg: kg, status: status,
      text: status === 'ok' ? 'canopy can ripen this crop' : status === 'tight' ? 'tight: target Brix may come late' : 'at risk: likely to stall below target Brix' };
  }

  function CmCropEstimate(props) {
    var org = (typeof CM_ME !== 'undefined' && CM_ME.org_id) || ORG;
    var site = props.site || {}, vy = site.name || 'Tystrya Estate';
    var s1 = React.useState(null), D = s1[0], setD = s1[1];
    var s2 = React.useState(null), yr = s2[0], setYr = s2[1];
    var s3 = React.useState({ lag: 'mid', all: 'asis', target: '2.25', pct: '25', removeN: '5', la: '0.2', heat: 'auto', per: {}, rowsBlock: '' }), O = s3[0], setO = s3[1];
    var s4 = React.useState(''), msg = s4[0], setMsg = s4[1];
    var s5 = React.useState({ block: '', date: new Date().toISOString().slice(0, 10), vines: '', acres: '', shoots: '', clusters: '', grams: '', gw: '', lag: '2' }), F = s5[0], setF = s5[1];
    var load = function () {
      Promise.all([db().from('crop_counts').select('*').eq('organization_id', org).order('vintage').order('block'),
        db().from('estate_harvests').select('year,block,tons').eq('organization_id', org),
        db().from('vineyard_blocks').select('block,variety,clone,acres,vines').eq('organization_id', org),
        db().from('vineyard_rows').select('block,row_label,seq,vines').eq('organization_id', org).order('seq'),
        db().from('thin_plans').select('*').eq('organization_id', org).order('created_at', { ascending: false }).limit(200)])
        .then(function (a) {
          var e = a.filter(function (x) { return x.error; })[0]; if (e) setMsg(e.error.message);
          var cc = a[0].data || []; setD({ cc: cc, eh: a[1].data || [], vb: a[2].data || [], rows: a[3].data || [], plans: a[4].data || [] });
          if (yr == null && cc.length) setYr(Math.max.apply(null, cc.map(function (c) { return c.vintage; })));
        });
    };
    React.useEffect(load, []);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var th = function (l) { return { textAlign: l ? 'left' : 'right', padding: '4px 5px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' }; };
    var td = function (l) { return { textAlign: l ? 'left' : 'right', padding: '4px 5px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' }; };
    var inp = { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' };
    if (!D) return cmE('div', { style: card }, 'Loading crop counts...');
    var set = function (k, v) { var n = Object.assign({}, O); n[k] = v; setO(n); };
    var setPer = function (b, v) { var p = Object.assign({}, O.per); if (v) p[b] = v; else delete p[b]; set('per', p); };
    var years = D.cc.map(function (c) { return c.vintage; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    var cc = D.cc.filter(function (c) { return c.vintage === yr; });
    var rank = function (c) { return (c.stage === 'post thin' ? '0' : '1') + String(c.count_date || ''); };
    var latest = {}; cc.forEach(function (c) { var k = c.block; if (!latest[k] || rank(c) >= rank(latest[k])) latest[k] = c; });
    var blocks = Object.keys(latest).map(Number).sort(function (a, b) { return a - b; });
    var VB = {}; D.vb.forEach(function (b) { VB[b.block] = b; });
    var act = {}; D.eh.forEach(function (h) { var k = h.year + ':' + h.block; act[k] = (act[k] || 0) + (num(h.tons) || 0); });
    var heat = cmSeasonHeat(props.days || [], yr, yr === new Date().getFullYear() ? new Date().toISOString().slice(5, 10) : '10-31');
    var hIdx = O.heat === 'cool' ? 0.9 : O.heat === 'warm' ? 1.1 : O.heat === 'normal' ? 1 : heat.idx;
    var lagOf = function (c) { return O.lag === 'low' ? num(c.lag_low) : O.lag === 'high' ? num(c.lag_high) : num(c.lag_mid); };
    var res = blocks.map(function (b) {
      var c = Object.assign({}, latest[b]); if (!num(c.acres) && VB[b]) c.acres = VB[b].acres;
      var sc = O.per[b] || O.all;
      var r = cmThinScenario(c, { scenario: sc, lag: lagOf(c), target: O.target, pct: O.pct, removeN: O.removeN });
      var rp = cmRipenCheck(r, num(c.shoots_per_vine), O.la, hIdx);
      return { b: b, c: c, sc: sc, r: r, rp: rp, actual: act[yr + ':' + b] };
    });
    var tot = res.reduce(function (t, x) { t.before += x.r.before || 0; t.after += x.r.tons || 0; t.acres += num(x.c.acres) || 0; t.actual += x.actual || 0; return t; }, { before: 0, after: 0, acres: 0, actual: 0 });
    var f2 = function (x, d) { return x == null || isNaN(x) ? '' : Number(x).toFixed(d == null ? 2 : d); };
    var color = function (s) { return s === 'ok' ? (C.green || '#5a5') : s === 'tight' ? (C.orange || '#d90') : s === 'risk' ? C.red : C.textDim; };
    var savePlan = function () {
      var rows = res.map(function (x) { return { organization_id: org, vineyard: vy, vintage: yr, block: x.b, scenario: x.sc, params: { lag: O.lag, target: num(O.target), pct: num(O.pct), leaf_m2_per_shoot: num(O.la), heat: O.heat, heat_idx: Math.round(hIdx * 100) / 100 }, est_before_tons: Math.round((x.r.before || 0) * 1000) / 1000, est_after_tons: Math.round((x.r.tons || 0) * 1000) / 1000, chosen: true }; });
      db().from('thin_plans').update({ chosen: false }).eq('organization_id', org).eq('vintage', yr).then(function () {
        db().from('thin_plans').insert(rows).then(function (r) { setMsg(r.error ? r.error.message : 'Thinning plan saved for ' + yr + ' (' + rows.length + ' blocks).'); if (!r.error) load(); });
      });
    };
    var addCount = function () {
      if (!num(F.block) || !num(F.clusters) || !num(F.grams)) { setMsg('Block, clusters per vine and grams per cluster are needed.'); return; }
      var vb = VB[num(F.block)] || {};
      db().from('crop_counts').insert({ organization_id: org, vineyard: vy, vintage: +F.date.slice(0, 4), block: num(F.block), count_date: F.date, counted_by: 'Entered in CellarMate', stage: 'lag',
        vines: num(F.vines) || num(vb.vines), acres: num(F.acres) || num(vb.acres), shoots_per_vine: num(F.shoots), clusters_per_vine: num(F.clusters), grams_per_cluster: num(F.grams), grams_with_wings: num(F.gw),
        lag_low: (num(F.lag) || 2) - 0.2, lag_mid: num(F.lag) || 2, lag_high: (num(F.lag) || 2) + 0.15, source: 'Entered in CellarMate' })
        .then(function (r) { setMsg(r.error ? r.error.message : 'Count saved.'); if (!r.error) { setYr(+F.date.slice(0, 4)); load(); } });
    };
    var rb = num(O.rowsBlock) || (blocks[0] || null), rr = res.filter(function (x) { return x.b === rb; })[0];
    var rowList = D.rows.filter(function (r) { return +r.block === rb && num(r.vines); });
    var rowVines = rowList.reduce(function (t, r) { return t + num(r.vines); }, 0);
    var hist = years.map(function (y) {
      var all = D.cc.filter(function (c) { return c.vintage === y; }), post = all.filter(function (c) { return c.stage === 'post thin'; });
      var list = post.length ? post : all;
      var est = 0, lagW = 0, pick = 0, n = 0;
      list.forEach(function (c) { var a = act[y + ':' + c.block]; var e = cmCropTons(num(c.vines), num(c.clusters_per_vine), num(c.grams_with_wings) || num(c.grams_per_cluster), num(c.lag_mid)); est += e || 0; if (a) { pick += a; lagW += (e || 0) / num(c.lag_mid); n++; } });
      return { y: y, est: est, pick: pick, factor: lagW ? pick / lagW : null, n: n, stage: list[0] ? list[0].stage : '', by: list[0] ? list[0].counted_by : '' };
    });
    var opt = function (v, l) { return cmE('option', { key: v, value: v }, l); };

    return cmE('div', null,
      cmE('div', { style: card },
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          cmE('div', { style: { fontWeight: 700 } }, 'Crop estimate and thinning'),
          cmE('select', { value: yr || '', onChange: function (e) { setYr(+e.target.value); }, style: inp }, years.map(function (y) { return opt(y, String(y)); })),
          cmE('label', { style: small }, 'Lag factor ', cmE('select', { value: O.lag, onChange: function (e) { set('lag', e.target.value); }, style: inp }, [opt('low', 'low'), opt('mid', 'middle'), opt('high', 'high')])),
          cmE('label', { style: small }, 'Scenario for all blocks ', cmE('select', { value: O.all, onChange: function (e) { set('all', e.target.value); }, style: inp }, SCEN.map(function (s) { return opt(s[0], s[1]); }))),
          cmE('label', { style: small }, 'Target t/a ', cmE('input', { value: O.target, onChange: function (e) { set('target', e.target.value); }, style: Object.assign({}, inp, { width: 50 }) })),
          cmE('label', { style: small }, 'Remove N ', cmE('input', { value: O.removeN, onChange: function (e) { set('removeN', e.target.value); }, style: Object.assign({}, inp, { width: 40 }) })),
          cmE('label', { style: small }, 'Drop % ', cmE('input', { value: O.pct, onChange: function (e) { set('pct', e.target.value); }, style: Object.assign({}, inp, { width: 44 }) })),
          cmE('label', { style: small }, 'Leaf m2 per shoot ', cmE('input', { value: O.la, onChange: function (e) { set('la', e.target.value); }, style: Object.assign({}, inp, { width: 50 }) })),
          cmE('label', { style: small }, 'Season ', cmE('select', { value: O.heat, onChange: function (e) { set('heat', e.target.value); }, style: inp }, [opt('auto', 'from weather'), opt('cool', 'cool'), opt('normal', 'normal'), opt('warm', 'warm')]))),
        cmE('div', { style: Object.assign({}, small, { margin: '4px 0 6px' }) }, 'Tons = vines x clusters per vine x grams per cluster at lag x lag factor / 907,185. At lag phase clusters are about half their final weight, so the factor sits near 2. Season heat ' + (heat.gdd ? Math.round(heat.gdd) + ' GDD' + (heat.normal ? ' against ' + Math.round(heat.normal) + ' usual' : '') + ': ' : '') + heat.label + '; ripening needs about ' + (hIdx < 0.95 ? '1.0' : hIdx > 1.05 ? '0.7' : '0.8') + ' m2 of leaf per kg of fruit.'),
        msg ? cmE('div', { style: { fontSize: 12, color: /saved/i.test(msg) ? C.textDim : C.red, marginBottom: 4 } }, msg) : null,
        cmE('div', { style: { overflowX: 'auto' } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 980 } },
          cmE('thead', null, cmE('tr', null, ['Block', 'Variety', 'Vines', 'Acres', 'Shoots', 'Clusters', 'g/cluster', 'As counted t', 't/a', 'Scenario', 'Clusters after', 'After t', 't/a', 'Leaf m2/kg', 'Ripening', 'Picked'].map(function (x, i) { return cmE('th', { key: x + i, style: th(i < 2 || i === 9 || i === 14) }, x); }))),
          cmE('tbody', null, res.map(function (x) {
            var vb = VB[x.b] || {};
            return cmE('tr', { key: x.b },
              cmE('td', { style: Object.assign(td(true), { fontWeight: 700 }) }, String(x.b)), cmE('td', { style: td(true) }, (vb.variety || '') + (vb.clone ? ' ' + vb.clone : '')),
              cmE('td', { style: td() }, num(x.c.vines) || ''), cmE('td', { style: td() }, f2(num(x.c.acres))), cmE('td', { style: td() }, f2(num(x.c.shoots_per_vine), 1)),
              cmE('td', { style: td() }, f2(num(x.c.clusters_per_vine), 1)), cmE('td', { style: td() }, (num(x.c.grams_with_wings) || num(x.c.grams_per_cluster) || '') + (num(x.c.grams_with_wings) ? ' (' + num(x.c.grams_per_cluster) + ' no wings)' : '')),
              cmE('td', { style: td() }, f2(x.r.before)), cmE('td', { style: td() }, f2(x.r.beforeTpa)),
              cmE('td', { style: td(true) }, cmE('select', { value: O.per[x.b] || '', onChange: function (e) { setPer(x.b, e.target.value); }, style: Object.assign({}, inp, { fontSize: 11 }) }, [opt('', 'same as all')].concat(SCEN.map(function (s) { return opt(s[0], s[1]); })))),
              cmE('td', { style: td() }, f2(x.r.clusters, 1) + (x.r.removed > 0.005 ? ' (-' + Math.round(x.r.removed * 100) + '%)' : '')),
              cmE('td', { style: Object.assign(td(), { fontWeight: 700 }) }, f2(x.r.tons)), cmE('td', { style: td() }, f2(x.r.tpa)),
              cmE('td', { style: td() }, f2(x.rp.ratio)), cmE('td', { style: Object.assign(td(true), { color: color(x.rp.status), whiteSpace: 'normal', minWidth: 140 }) }, x.rp.text + (x.r.note ? '; ' + x.r.note : '')),
              cmE('td', { style: td() }, x.actual ? f2(x.actual) : ''));
          }), cmE('tr', { key: 'tot' }, cmE('td', { colSpan: 3, style: Object.assign(td(true), { fontWeight: 700 }) }, 'Total'), cmE('td', { style: td() }, f2(tot.acres)), cmE('td', { colSpan: 3, style: td() }, ''),
            cmE('td', { style: Object.assign(td(), { fontWeight: 700 }) }, f2(tot.before, 1)), cmE('td', { style: td() }, tot.acres ? f2(tot.before / tot.acres) : ''), cmE('td', { colSpan: 2, style: td() }, ''),
            cmE('td', { style: Object.assign(td(), { fontWeight: 700 }) }, f2(tot.after, 1)), cmE('td', { style: td() }, tot.acres ? f2(tot.after / tot.acres) : ''), cmE('td', { colSpan: 2, style: td() }, ''), cmE('td', { style: Object.assign(td(), { fontWeight: 700 }) }, tot.actual ? f2(tot.actual, 1) : ''))))),
        cmE('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' } },
          cmBtn('Save this thinning plan', savePlan, true, false),
          cmE('span', { style: small }, 'Saved plans: ' + D.plans.filter(function (p) { return p.vintage === yr && p.chosen; }).length + ' blocks for ' + yr + '. Library: Thinning and dropping fruit; Lag phase counts; Vine balance.'))),

      cmE('div', { style: card },
        cmE('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, cmE('div', { style: { fontWeight: 700 } }, 'By row'),
          cmE('select', { value: rb || '', onChange: function (e) { set('rowsBlock', e.target.value); }, style: inp }, blocks.map(function (b) { return opt(b, 'Block ' + b); }))),
        rr && rowList.length ? cmE('div', { style: { overflowX: 'auto', marginTop: 4 } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 360 } },
          cmE('thead', null, cmE('tr', null, ['Row', 'Vines', 'As counted t', 'After t', 'Clusters to leave per vine'].map(function (x, i) { return cmE('th', { key: x, style: th(i === 0) }, x); }))),
          cmE('tbody', null, rowList.map(function (r) {
            var share = num(r.vines) / (num(rr.c.vines) || rowVines);
            return cmE('tr', { key: r.row_label }, cmE('td', { style: td(true) }, r.row_label), cmE('td', { style: td() }, num(r.vines)), cmE('td', { style: td() }, f2((rr.r.before || 0) * share, 3)), cmE('td', { style: td() }, f2((rr.r.tons || 0) * share, 3)), cmE('td', { style: td() }, f2(rr.r.clusters, 1)));
          })))) : cmE('div', { style: small }, 'No row list for this block yet.')),

      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Thinning directions given by each winemaker'),
        D.plans.filter(function (p) { return p.note; }).length ? cmE('div', { style: { overflowX: 'auto' } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 420 } },
          cmE('thead', null, cmE('tr', null, ['Year', 'Block', 'Rows', 'Direction'].map(function (x, i) { return cmE('th', { key: x, style: th(i > 2) }, x); }))),
          cmE('tbody', null, D.plans.filter(function (p) { return p.note; }).sort(function (a, b) { return a.vintage - b.vintage || a.block - b.block; }).map(function (p) {
            return cmE('tr', { key: p.id }, cmE('td', { style: td() }, p.vintage), cmE('td', { style: td() }, p.block), cmE('td', { style: td() }, p.row_label || ''), cmE('td', { style: td(true) }, p.note));
          })))) : cmE('div', { style: small }, 'None saved yet.'),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'From the 2023 Results Partners thinning worksheet. In 2023 the pre-thin count was 23 to 28 clusters per vine and the post-thin count 15 to 20.')),
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Estimate against pick, every year'),
        cmE('div', { style: { overflowX: 'auto' } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 460 } },
          cmE('thead', null, cmE('tr', null, ['Year', 'Counted by', 'Stage', 'Estimate t', 'Picked t (counted blocks)', 'Realised factor'].map(function (x, i) { return cmE('th', { key: x, style: th(i < 3) }, x); }))),
          cmE('tbody', null, hist.map(function (h) {
            return cmE('tr', { key: h.y }, cmE('td', { style: td(true) }, String(h.y)), cmE('td', { style: td(true) }, h.by), cmE('td', { style: td(true) }, h.stage), cmE('td', { style: td() }, f2(h.est, 1)), cmE('td', { style: td() }, h.pick ? f2(h.pick, 1) : ''), cmE('td', { style: td() }, f2(h.factor)));
          })))),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Realised factor = tons picked / lag weight. Below the factor used means fruit came off after the count (thinning, dropping, birds, rot); above means berries sized up more than expected.')),

      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Add a count'),
        cmE('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' } },
          [['block', 'Block', 50], ['date', 'Date', 130], ['vines', 'Vines', 60], ['acres', 'Acres', 55], ['shoots', 'Shoots with clusters', 70], ['clusters', 'Clusters per vine', 70], ['grams', 'g/cluster no wings', 70], ['gw', 'g/cluster with wings', 70], ['lag', 'Lag factor', 55]].map(function (f) {
            return cmE('label', { key: f[0], style: Object.assign({}, small, { width: f[2] + 20 }) }, f[1], cmE('input', { type: f[0] === 'date' ? 'date' : 'text', value: F[f[0]], onChange: function (e) { var n = Object.assign({}, F); n[f[0]] = e.target.value; setF(n); }, style: Object.assign({}, inp, { width: '100%' }) }));
          }),
          cmBtn('Save count', addCount, true, false)),
        cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Vines and acres fill in from the block list when left blank. Count 20 or more vines across the block; weigh at least 50 clusters.')));
  }

  window.cmCropTons = cmCropTons; window.cmThinScenario = cmThinScenario; window.cmRipenCheck = cmRipenCheck; window.cmSeasonHeat = cmSeasonHeat;
  window.CmCropEstimate = CmCropEstimate;
})();
