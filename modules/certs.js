/* CellarMate module: Certification paperwork (LIVE and organic)
   Builds the yearly LIVE pesticide use report and LIVE irrigation report straight from the
   spray and irrigation records, in the same columns as the LIVE forms in the Drive folder, and
   checks them first: products missing an active ingredient, REI or PHI, and products not marked
   approved for LIVE or organic (status kept on cellarmate.spray_products).
   Renders on the Vine Blocks screen (CmCertPapers). Pure helpers on window for the smoke tests:
   cmParseProducts, cmLivePur, cmLiveIrrigation. */
(function () {
  'use strict';
  var STATUS = ['unknown', 'approved', 'restricted', 'not allowed'];
  function key(n) { return String(n || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function md(s) { var d = String(s || ''); return d ? +d.slice(5, 7) + '/' + +d.slice(8, 10) + '/' + d.slice(0, 4) : ''; }
  function db() { return supa.schema('cellarmate'); }

  /* "Microthiol 5 lbs/acre; Nu Film P 3 oz/acre" -> [{name, rate, unit}] */
  function cmParseProducts(text) {
    return String(text || '').split(';').map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) {
      var m = /^(.*?)\s+([\d]+(?:\.\d+)?)\s*(.*)$/.exec(p);
      return m ? { name: m[1].trim(), rate: Number(m[2]), unit: m[3].trim() } : { name: p, rate: null, unit: '' };
    });
  }

  /* one row per product per spray, in the LIVE pesticide use report columns, plus the gaps */
  function cmLivePur(sprays, products, year, vineyard) {
    var P = {}; (products || []).forEach(function (p) { P[key(p.name)] = p; });
    var rows = [], issues = { missingInfo: {}, notApproved: {}, unknownStatus: {}, unmatched: {} }, used = {};
    (sprays || []).filter(function (s) { return s.date && !s.skipped && String(s.date).slice(0, 4) === String(year) && (!vineyard || !s.vineyard || s.vineyard === vineyard); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .forEach(function (s) {
        cmParseProducts(s.products_rate_per_acre).forEach(function (x) {
          var p = P[key(x.name)]; used[key(x.name)] = (used[key(x.name)] || 0) + 1;
          if (!p) issues.unmatched[x.name] = 1;
          else {
            if (!p.active_ingredient || p.rei_hours == null || p.phi_days == null) issues.missingInfo[p.name] = 1;
            if (p.live_status === 'not allowed') issues.notApproved[p.name] = 1;
            if (!p.live_status || p.live_status === 'unknown') issues.unknownStatus[p.name] = 1;
          }
          rows.push({ 'Spray Number': s.spray_label || s.spray || '', 'Date Applied': md(s.date), 'Location (Block ID)': (vineyard || s.vineyard || '') + (s.blocks ? ' · ' + s.blocks : ''),
            'Product Trade Name': p ? p.name : x.name, 'Active Ingredient(s)': p ? p.active_ingredient || '' : '', 'Target Pest': (p && p.target) || s.reason || '',
            'Amount (Units/Acre)': x.rate != null ? x.rate + ' ' + x.unit : '', 'REI (Hours)': p && p.rei_hours != null ? Number(p.rei_hours) : '', 'PHI (Days)': p && p.phi_days != null ? Number(p.phi_days) : '',
            'MOA Code': (p && p.frac_code) || '', 'Supplier': (p && p.supplier) || '', 'LIVE status': p ? p.live_status || 'unknown' : 'not in product list' });
        });
      });
    var list = function (o) { return Object.keys(o).sort(); };
    return { rows: rows, used: used, issues: { missingInfo: list(issues.missingInfo), notApproved: list(issues.notApproved), unknownStatus: list(issues.unknownStatus), unmatched: list(issues.unmatched) } };
  }

  /* irrigation entries in the LIVE irrigation report columns */
  function vineAge(planted, year) { var m = /(\d{4})/.exec(planted || ''); if (!m) return /before/i.test(planted || '') ? 'mature' : ''; var a = year - +m[1]; return a >= 0 ? a + ' yr' : ''; }
  function cmLiveIrrigation(acts, year, blocks, vineyard) {
    var B = {}; (blocks || []).forEach(function (b) { B[String(b.block)] = b; });
    return (acts || []).filter(function (a) { return a.kind === 'irrigation' && String(a.date || a.vintage).slice(0, 4) === String(year) && (!vineyard || !a.vineyard || a.vineyard === vineyard); })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })
      .map(function (a) {
        var nums = String(a.blocks || '').match(/\d+/g) || [];
        var ages = nums.map(function (n) { return B[n] ? vineAge(B[n].planted, year) : ''; }).filter(Boolean);
        return { 'DATE(S) APPLIED': md(a.date), 'LOCATION (BLOCK ID)': a.blocks || '', 'ACREAGE': a.acres != null ? Number(a.acres) : '', 'AMOUNT (GAL/VINE OR INCHES)': a.amount != null ? a.amount + ' ' + (a.unit || '') : '',
          'PLANTS/ACRE': 1452, 'VINE AGE': ages.length ? ages.filter(function (x, i) { return ages.indexOf(x) === i; }).join(', ') : '', 'METHOD USED TO DETERMINE TIMING AND QUANTITY': a.note || '', 'ADDITIONAL INFORMATION': '' };
      });
  }

  async function download(name, title, meta, rows) {
    if (typeof cmLib === 'function') await cmLib('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    if (!window.XLSX) throw new Error('The Excel library did not load.');
    var head = [[title], ['VINEYARD NAME', meta.vineyard, 'MANAGER NAME', meta.manager || '', 'YEAR', meta.year], []];
    var ws = XLSX.utils.aoa_to_sheet(head); XLSX.utils.sheet_add_json(ws, rows, { origin: 'A4' });
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Report'); XLSX.writeFile(wb, name);
  }

  function CmCertPapers(P) {
    var site = P.site;
    var s = React.useState(null), D = s[0], setD = s[1];
    var e = React.useState(''), msg = e[0], setMsg = e[1];
    var yr0 = new Date().getFullYear();
    var y = React.useState(yr0), year = y[0], setYear = y[1];
    var mg = React.useState(''), manager = mg[0], setManager = mg[1];
    var load = function () {
      ['spray_products'].forEach(function (t) { if (typeof CM_CACHE !== 'undefined') delete CM_CACHE[t]; });
      Promise.all(['vineyard_sprays', 'spray_products', 'vineyard_activities', 'vineyard_blocks'].map(function (t) { return cmFetch(t); }))
        .then(function (a) { setD({ sprays: a[0], prods: a[1].filter(function (p) { return !site || p.organization_id === site.organization_id; }), acts: a[2], blocks: a[3].filter(function (b) { return !site || b.vineyard === site.name; }) }); })
        .catch(function (x) { setMsg(x.message); });
    };
    React.useEffect(load, [site && site.id]);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    if (!site) return null;
    if (!D) return cmE('div', { style: card }, 'Loading paperwork...');
    var years = {}; D.sprays.concat(D.acts).forEach(function (r) { var v = r.vintage || (r.date ? +String(r.date).slice(0, 4) : null); if (v && (!r.vineyard || r.vineyard === site.name)) years[v] = 1; }); years[yr0] = 1;
    var ys = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
    var pur = cmLivePur(D.sprays, D.prods, year, site.name), irr = cmLiveIrrigation(D.acts, year, D.blocks, site.name);
    var meta = { vineyard: site.name, manager: manager, year: year };
    var go = function (kind) {
      setMsg('');
      (kind === 'pur' ? download('LIVE_pesticide_use_report_' + year + '_' + site.name.replace(/\W+/g, '_') + '.xlsx', 'LIVE Pesticide Use Report', meta, pur.rows)
        : download('LIVE_irrigation_report_' + year + '_' + site.name.replace(/\W+/g, '_') + '.xlsx', 'LIVE Irrigation Report', meta, irr))
        .then(function () { setMsg('Downloaded. Check it over, then send it to LIVE.'); }).catch(function (x) { setMsg(x.message); });
    };
    var setStatus = function (p, field, v) { var o = {}; o[field] = v; db().from('spray_products').update(o).eq('id', p.id).then(function (r) { if (r.error) setMsg(r.error.message); else load(); }); };
    var used = D.prods.filter(function (p) { return pur.used[key(p.name)]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var issue = function (label, arr, color) { return arr.length ? cmE('div', { style: { fontSize: 12, color: color, marginTop: 3 } }, label + ': ' + arr.join(', ')) : null; };
    var ready = !pur.issues.missingInfo.length && !pur.issues.notApproved.length && !pur.issues.unmatched.length;
    var th = { textAlign: 'left', padding: '4px 6px', color: C.textDim, fontSize: 11, borderBottom: '1px solid ' + C.cardBorder };
    var td = { padding: '4px 6px', fontSize: 12, borderBottom: '1px solid ' + C.cardBorder };
    var sel = function (p, field) { return cmE('select', { value: p[field] || 'unknown', onChange: function (ev) { setStatus(p, field, ev.target.value); }, style: Object.assign({}, cmSel, { padding: '3px 6px', fontSize: 12, color: p[field] === 'not allowed' ? C.red : p[field] === 'approved' ? C.green : C.text }) }, STATUS.map(function (x) { return cmE('option', { key: x, value: x }, x); })); };
    return cmE('div', null,
      cmE('div', { style: { fontSize: 15, fontWeight: 700, margin: '12px 0 8px' } }, 'Certification paperwork'),
      cmE('div', { style: card },
        cmE('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 } },
          cmE('div', { style: { fontWeight: 700, flex: 1 } }, 'LIVE reports for ' + site.name),
          cmE('select', { value: year, onChange: function (ev) { setYear(+ev.target.value); }, style: Object.assign({}, cmSel, { flex: '0 0 100px' }) }, ys.map(function (v) { return cmE('option', { key: v, value: v }, v); })),
          cmE('input', { value: manager, onChange: function (ev) { setManager(ev.target.value); }, placeholder: 'Vineyard manager name', style: { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 8px', fontSize: 12, flex: '1 1 160px' } })),
        cmE('div', { style: small }, 'Filled from this year\'s spray and irrigation records, in the LIVE form columns. Fix anything flagged below, then download, check and send.'),
        cmE('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', margin: '8px 0' } },
          [['Spray product lines', pur.rows.length], ['Products used', used.length + pur.issues.unmatched.length], ['Irrigation entries', irr.length]].map(function (x) { return cmE('div', { key: x[0] }, cmE('div', { style: { fontSize: 18, fontWeight: 700 } }, x[1]), cmE('div', { style: small }, x[0])); })),
        pur.rows.length ? (ready ? cmE('div', { style: { fontSize: 12, color: C.green } }, 'Pesticide use report has everything LIVE asks for.') : null) : cmE('div', { style: small }, 'No sprays recorded for ' + year + '.'),
        issue('Missing active ingredient, REI or PHI', pur.issues.missingInfo, C.orange),
        issue('Not in the product list', pur.issues.unmatched, C.orange),
        issue('Marked not allowed for LIVE', pur.issues.notApproved, C.red),
        issue('LIVE status not set yet', pur.issues.unknownStatus, C.textDim),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 } },
          cmE('button', { onClick: function () { go('pur'); }, disabled: !pur.rows.length, style: { background: pur.rows.length ? C.accent : C.cardBorder, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' } }, 'Download pesticide use report'),
          cmE('button', { onClick: function () { go('irr'); }, disabled: !irr.length, style: { background: irr.length ? C.accent : C.cardBorder, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer' } }, 'Download irrigation report')),
        msg ? cmE('div', { style: { fontSize: 12, marginTop: 6 } }, msg) : null),
      used.length ? cmE('div', { style: Object.assign({}, card, { overflowX: 'auto' }) },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Products used in ' + year + ': LIVE and organic status'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Set each product once; it carries to every year. A product marked "not allowed" is flagged on the report.'),
        cmE('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: 520 } },
          cmE('thead', null, cmE('tr', null, ['Product', 'Times used', 'Active ingredient', 'LIVE', 'Organic'].map(function (h) { return cmE('th', { key: h, style: th }, h); }))),
          cmE('tbody', null, used.map(function (p) { return cmE('tr', { key: p.id }, cmE('td', { style: td }, p.name), cmE('td', { style: td }, pur.used[key(p.name)]), cmE('td', { style: td }, p.active_ingredient || cmE('span', { style: { color: C.orange } }, 'missing')), cmE('td', { style: td }, sel(p, 'live_status')), cmE('td', { style: td }, sel(p, 'organic_status'))); })))) : null);
  }

  window.cmParseProducts = cmParseProducts;
  window.cmLivePur = cmLivePur;
  window.cmLiveIrrigation = cmLiveIrrigation;
  window.CmCertPapers = CmCertPapers;
})();
