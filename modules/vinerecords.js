/* CellarMate module: Vineyard records (Tystrya Estate)
   Everything the vineyard manager hands over each year, in one place on the Vine Blocks screen:
   1. Spray history by year (vineyard_sprays) and the product list with REI, PHI and FRAC codes
      (spray_products).
   2. Irrigation, soil amendments and herbicide (vineyard_activities).
   3. Leaf tissue at veraison and soil tests by block (tissue_tests, soil_tests).
   4. Rows and vines by block (vineyard_rows, from the vineyard map data) with a crop estimate
      helper: vines x clusters per vine x cluster weight, saved to harvest_estimates.
   5. The original files (attachments linked as vineyard / Tystrya Estate), grouped by year.
   Pure helpers on window for the smoke tests: cmSprayYears, cmIrrigationYears, cmClusterTons. */
(function () {
  'use strict';
  var VY = 'Tystrya Estate';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function r1(x, d) { return x == null ? '' : Number(x).toFixed(d == null ? 1 : d); }
  function db() { return supa.schema('cellarmate'); }

  /* sprays -> one summary row per year */
  function cmSprayYears(sprays) {
    var by = {};
    (sprays || []).forEach(function (s) {
      var y = s.vintage || (s.date ? +String(s.date).slice(0, 4) : null); if (!y) return;
      var o = by[y] = by[y] || { year: y, sprays: 0, skipped: 0, first: null, last: null, products: {} };
      if (s.skipped || !s.date) { o.skipped++; return; }
      o.sprays++; if (!o.first || s.date < o.first) o.first = s.date; if (!o.last || s.date > o.last) o.last = s.date;
      String(s.products_rate_per_acre || '').split(';').forEach(function (p) { var n = p.trim().replace(/\s+[\d.]+.*$/, '').trim(); if (n) { var k = n.toLowerCase().replace(/[\s-]+/g, ''); o.products[k] = o.products[k] || { name: n, n: 0 }; o.products[k].n++; } });
    });
    return Object.keys(by).map(function (y) { var o = by[y]; o.top = Object.keys(o.products).map(function (k) { return o.products[k]; }).sort(function (a, b) { return b.n - a.n; }); return o; }).sort(function (a, b) { return b.year - a.year; });
  }

  /* irrigation events -> one summary row per year */
  function cmIrrigationYears(acts) {
    var by = {};
    (acts || []).filter(function (a) { return a.kind === 'irrigation'; }).forEach(function (a) {
      var y = a.vintage || (a.date ? +String(a.date).slice(0, 4) : null); if (!y) return;
      var o = by[y] = by[y] || { year: y, events: 0, dates: {}, first: null, last: null, blocks: {} };
      o.events++; if (a.date) { o.dates[a.date] = 1; if (!o.first || a.date < o.first) o.first = a.date; if (!o.last || a.date > o.last) o.last = a.date; }
      String(a.blocks || '').split(/[,&]| and /).forEach(function (b) { var t = b.trim(); if (t) o.blocks[t] = (o.blocks[t] || 0) + (num(a.amount) || 0); });
    });
    return Object.keys(by).map(function (y) { var o = by[y]; o.days = Object.keys(o.dates).length; return o; }).sort(function (a, b) { return b.year - a.year; });
  }

  /* crop estimate from a cluster count: tons = vines x clusters per vine x grams per cluster / 907,185 */
  function cmClusterTons(vines, clustersPerVine, gramsPerCluster) {
    var v = num(vines), c = num(clustersPerVine), g = num(gramsPerCluster);
    if (v == null || c == null || g == null) return null;
    return v * c * g / 907185;
  }

  var card = function () { return { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }; };
  var small = function () { return { fontSize: 11, color: C.textDim }; };
  var th = function (left) { return { textAlign: left ? 'left' : 'right', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: 'nowrap' }; };
  var td = function (left, wrap) { return { textAlign: left ? 'left' : 'right', padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder, whiteSpace: wrap ? 'normal' : 'nowrap' }; };
  var table = function (min, head, body) { return cmE('div', { style: { overflowX: 'auto' } }, cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: min } }, cmE('thead', null, cmE('tr', null, head.map(function (h, i) { return cmE('th', { key: h + i, style: th(i === 0 || h.charAt(0) === '<') }, h.replace(/^</, '')); }))), cmE('tbody', null, body))); };

  function Section(P) {
    var s = React.useState(!!P.open), open = s[0], setOpen = s[1];
    return cmE('div', { style: card() },
      cmE('div', { onClick: function () { setOpen(!open); }, style: { display: 'flex', alignItems: 'center', cursor: 'pointer' } },
        cmE('div', { style: { fontWeight: 700, flex: 1 } }, P.title), cmE('span', { style: small() }, (P.count != null ? P.count + ' · ' : '') + (open ? 'hide' : 'show'))),
      open ? cmE('div', { style: { marginTop: 6 } }, P.sub ? cmE('div', { style: Object.assign(small(), { marginBottom: 6 }) }, P.sub) : null, P.children) : null);
  }

  function CmVineRecords(P) {
    var s = React.useState(null), D = s[0], setD = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    var cs = React.useState({ block: '', clusters: '', grams: '', vintage: new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0) }), ce = cs[0], setCe = cs[1];
    React.useEffect(function () {
      var live = true;
      Promise.all(['vineyard_sprays', 'spray_products', 'vineyard_activities', 'tissue_tests', 'soil_tests', 'vineyard_rows'].map(function (t) { return cmFetch(t); }))
        .then(async function (a) { var files = window.cmFiles ? await window.cmFiles.forRef('vineyard', null, VY) : []; if (live) setD({ sprays: a[0], prods: a[1], acts: a[2], tissue: a[3], soil: a[4], rows: a[5], files: files }); })
        .catch(function (x) { if (live) setErr(x.message); });
      return function () { live = false; };
    }, []);
    if (!D) return cmE('div', { style: card() }, cmE('div', { style: { fontWeight: 700 } }, 'Vineyard records'), cmE('div', { style: small() }, err || 'Loading...'));
    var sy = cmSprayYears(D.sprays), iy = cmIrrigationYears(D.acts);
    var other = D.acts.filter(function (a) { return a.kind !== 'irrigation'; }).sort(function (a, b) { return String(b.date || b.vintage).localeCompare(String(a.date || a.vintage)); });
    var blocks = {}; D.rows.filter(function (r) { return r.vineyard === VY; }).forEach(function (r) { var b = blocks[r.block] = blocks[r.block] || { block: r.block, rows: 0, vines: 0, unplanted: 0, acres: 0 }; b.rows++; b.vines += num(r.vines) || 0; b.unplanted += num(r.unplanted) || 0; b.acres += num(r.acres) || 0; });
    var bl = Object.keys(blocks).map(function (k) { return blocks[k]; }).sort(function (a, b) { return a.block - b.block; });
    var tis = D.tissue.slice().sort(function (a, b) { return (b.year - a.year) || (a.block - b.block); });
    var soil = D.soil.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var byYear = {}; D.files.forEach(function (f) { var m = /^(\d{4}) · /.exec(f.title || ''); var y = m ? m[1] : 'Reference'; (byYear[y] = byYear[y] || []).push(f); });
    var years = Object.keys(byYear).sort(function (a, b) { return a === 'Reference' ? -1 : b === 'Reference' ? 1 : b - a; });
    var openFile = function (f) { supa.storage.from('cellar-files').createSignedUrl(f.path, 600).then(function (r) { if (r.data) window.open(r.data.signedUrl, '_blank'); else setErr('Could not open ' + f.filename); }); };
    var selB = blocks[ce.block], estT = selB ? cmClusterTons(selB.vines, ce.clusters, ce.grams) : null;
    var inp = { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' };
    var saveEst = function () {
      if (estT == null || !P.site) return;
      db().from('harvest_estimates').insert({ organization_id: P.site.organization_id, vintage: +ce.vintage, vineyard: VY, block: +ce.block, est_tons: Math.round(estT * 1000) / 1000, method: 'cluster count', note: ce.clusters + ' clusters per vine x ' + ce.grams + ' g per cluster x ' + selB.vines + ' vines', created_by: (typeof CM_ME !== 'undefined' && CM_ME && CM_ME.full_name) || null })
        .then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); if (typeof CM_CACHE !== 'undefined') delete CM_CACHE.harvest_estimates; setCe(Object.assign({}, ce, { clusters: '', grams: '' })); if (P.onSaved) P.onSaved(); } });
    };
    return cmE('div', null,
      cmE('div', { style: { fontSize: 15, fontWeight: 700, margin: '12px 0 8px' } }, 'Vineyard records'),
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,

      cmE(Section, { title: 'Spray history', count: D.sprays.filter(function (x) { return x.date && !x.skipped; }).length + ' sprays', open: true, sub: 'From the yearly spray records, the 2025 pesticide use report and the 2026 fungicide record. Skipped means the column was on the record without an application date.' },
        table(560, ['Year', 'Sprays', 'Skipped', 'First', 'Last', '<Main products (times used)'], sy.map(function (o) {
          return cmE('tr', { key: o.year }, cmE('td', { style: td(true) }, o.year), cmE('td', { style: td() }, o.sprays), cmE('td', { style: td() }, o.skipped || ''), cmE('td', { style: td() }, o.first ? o.first.slice(5) : ''), cmE('td', { style: td() }, o.last ? o.last.slice(5) : ''),
            cmE('td', { style: td(true, true) }, o.top.slice(0, 5).map(function (p) { return p.name + ' ' + p.n; }).join(', ')));
        }))),

      cmE(Section, { title: 'Spray products', count: D.prods.length, sub: 'REI is the hours before people can re-enter the block; PHI is the days before harvest the product must be off. FRAC groups help rotate modes of action.' },
        table(620, ['Product', '<Active ingredient', 'REI h', 'PHI days', 'FRAC', '<Target'], D.prods.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) {
          return cmE('tr', { key: p.id }, cmE('td', { style: td(true) }, p.name), cmE('td', { style: td(true, true) }, p.active_ingredient || ''), cmE('td', { style: td() }, p.rei_hours == null ? '' : p.rei_hours), cmE('td', { style: td() }, p.phi_days == null ? '' : p.phi_days), cmE('td', { style: td() }, p.frac_code || ''), cmE('td', { style: td(true, true) }, [p.target, p.secondary_target].filter(Boolean).join(', ')));
        }))),

      cmE(Section, { title: 'Irrigation', count: iy.length + ' years', sub: 'Drip irrigation as reported each year. Amounts are gallons per vine per application (2024 is the client\'s weekly sheet).' },
        table(560, ['Year', 'Applications', 'Days', 'First', 'Last', '<Blocks (gal per vine, total)'], iy.map(function (o) {
          return cmE('tr', { key: o.year }, cmE('td', { style: td(true) }, o.year), cmE('td', { style: td() }, o.events), cmE('td', { style: td() }, o.days), cmE('td', { style: td() }, o.first ? o.first.slice(5) : ''), cmE('td', { style: td() }, o.last ? o.last.slice(5) : ''),
            cmE('td', { style: td(true, true) }, Object.keys(o.blocks).map(function (b) { return b + ': ' + r1(o.blocks[b], 1); }).join(' · ')));
        }))),

      cmE(Section, { title: 'Soil amendments and herbicide', count: other.length },
        table(560, ['Date', '<Kind', '<Product and rate', '<Blocks', 'Acres', '<Note'], other.map(function (a) {
          return cmE('tr', { key: a.id }, cmE('td', { style: td(true) }, a.date || a.vintage), cmE('td', { style: td(true) }, a.kind), cmE('td', { style: td(true, true) }, a.product || ''), cmE('td', { style: td(true, true) }, a.blocks || ''), cmE('td', { style: td() }, r1(a.acres, 2)), cmE('td', { style: td(true, true) }, a.note || ''));
        }))),

      cmE(Section, { title: 'Leaf tissue at veraison', count: tis.length + ' samples', sub: 'Leaf blades sampled at veraison. The sample date is a good marker for veraison each year.' },
        table(620, ['Sampled', 'Block', 'N %', 'P %', 'K %', 'Ca %', 'Mg %', 'B ppm', 'Zn ppm', 'Mn ppm'], tis.map(function (t) {
          return cmE('tr', { key: t.id }, cmE('td', { style: td(true) }, t.sampled || t.year), cmE('td', { style: td() }, t.block), ['n_pct', 'p_pct', 'k_pct', 'ca_pct', 'mg_pct', 'b_ppm', 'zn_ppm', 'mn_ppm'].map(function (k) { return cmE('td', { key: k, style: td() }, t[k] == null ? '' : t[k]); }));
        }))),

      cmE(Section, { title: 'Soil tests', count: soil.length },
        table(620, ['Date', '<Sample', 'pH', 'OM %', 'P ppm', 'K ppm', 'Ca meq', 'Mg meq', 'B ppm'], soil.map(function (t) {
          return cmE('tr', { key: t.id }, cmE('td', { style: td(true) }, t.date), cmE('td', { style: td(true, true) }, t.sample || (t.block ? 'Block ' + t.block : '')), ['ph', 'om_pct', 'p_ppm', 'k_ppm', 'ca_meq', 'mg_meq', 'b_ppm'].map(function (k) { return cmE('td', { key: k, style: td() }, t[k] == null ? '' : t[k]); }));
        }))),

      cmE(Section, { title: 'Rows, vines and cluster count estimate', count: bl.reduce(function (a, b) { return a + b.vines; }, 0) + ' vines', sub: 'Rows and vines by block from the vineyard map data. Enter a cluster count and cluster weight to estimate tons for a block, then save it as a crop estimate.' },
        table(420, ['Block', 'Rows', 'Vines', 'Unplanted spaces', 'Acres'], bl.map(function (b) {
          return cmE('tr', { key: b.block }, cmE('td', { style: td(true) }, b.block), cmE('td', { style: td() }, b.rows), cmE('td', { style: td() }, b.vines), cmE('td', { style: td() }, b.unplanted || ''), cmE('td', { style: td() }, r1(b.acres, 2)));
        })),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 } },
          cmE('label', { style: { flex: '1 1 90px', fontSize: 11, color: C.textDim } }, 'Vintage', cmE('input', { type: 'number', value: ce.vintage, onChange: function (ev) { setCe(Object.assign({}, ce, { vintage: ev.target.value })); }, style: inp })),
          cmE('label', { style: { flex: '1 1 110px', fontSize: 11, color: C.textDim } }, 'Block', cmE('select', { value: ce.block, onChange: function (ev) { setCe(Object.assign({}, ce, { block: ev.target.value })); }, style: inp }, [cmE('option', { key: '', value: '' }, 'Pick a block')].concat(bl.map(function (b) { return cmE('option', { key: b.block, value: b.block }, 'Block ' + b.block + ' (' + b.vines + ' vines)'); })))),
          cmE('label', { style: { flex: '1 1 110px', fontSize: 11, color: C.textDim } }, 'Clusters per vine', cmE('input', { type: 'number', step: 'any', value: ce.clusters, onChange: function (ev) { setCe(Object.assign({}, ce, { clusters: ev.target.value })); }, style: inp })),
          cmE('label', { style: { flex: '1 1 110px', fontSize: 11, color: C.textDim } }, 'Grams per cluster', cmE('input', { type: 'number', step: 'any', value: ce.grams, onChange: function (ev) { setCe(Object.assign({}, ce, { grams: ev.target.value })); }, style: inp })),
          cmE('div', { style: { flex: '1 1 140px', fontSize: 13, fontWeight: 700 } }, estT != null ? r1(estT, 2) + ' t (' + r1(estT / (selB.acres || 1), 2) + ' t/ac)' : ''),
          cmE('button', { onClick: saveEst, disabled: estT == null, style: { background: estT == null ? C.cardBorder : C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: estT == null ? 'default' : 'pointer' } }, 'Save as estimate'))),

      cmE(Section, { title: 'Original files', count: D.files.length + ' files', sub: 'Stored in CellarMate from the vineyard Google Drive folder. Tap a file to open it.' },
        years.map(function (y) {
          return cmE('div', { key: y, style: { marginBottom: 6 } }, cmE('div', { style: { fontSize: 12, fontWeight: 700, marginBottom: 2 } }, y),
            cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, byYear[y].sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); }).map(function (f) {
              return cmE('span', { key: f.id, onClick: function () { openFile(f); }, title: f.filename, style: { fontSize: 11, background: C.cardBorder, borderRadius: 5, padding: '4px 6px', cursor: 'pointer' } }, String(f.title || f.filename).replace(/^\d{4} · /, '') + ' (' + String(f.filename).split('.').pop() + ')');
            })));
        })));
  }

  window.cmSprayYears = cmSprayYears;
  window.cmIrrigationYears = cmIrrigationYears;
  window.cmClusterTons = cmClusterTons;
  window.CmVineRecords = CmVineRecords;
})();
