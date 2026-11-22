/* CellarMate module: Plan, usage and data export
   Follows the ethos: fair prices from real costs, usage visible to every account, and your data
   is yours to take with you.
   - window.cmPlan: plan definitions, the account's plan (cellarmate.org_plan, a client account uses
     its host's plan), canStore (file storage is a paid feature; the database enforces it too) and
     usage (cellarmate.org_usage: records, files, storage, weather days, AI reads, support time).
   - CmPlan (Reports tab "Plan"): the plan, what it includes, a usage meter against what is
     included, and "Download all my data" as one Excel workbook for this account.
   Pure helpers on window for the smoke tests: cmPlanInfo, cmUsageBars. */
(function () {
  'use strict';
  var GB = 1024 * 1024 * 1024;
  var PLANS = {
    basic: { name: 'Basic', price: 'Free', ai: 0, gb: 0, support: 0, files: false,
      includes: ['Vineyard blocks, sprays, irrigation and harvest records', 'Weather, heat units and mildew risk', 'Cellar records, barrel map and reports', 'Help guides (no phone support)'] },
    single: { name: 'Single vineyard', price: '$35 a month', ai: 50, gb: 5, support: 30, files: true,
      includes: ['Everything in Basic', 'Files and photos stored with your records', 'AI reading of lab reports and spray sheets', 'LIVE and organic forms filled from your records', '30 minutes of support a month'] },
    up100: { name: 'Up to 100 acres', price: '$89 a month', ai: 200, gb: 25, support: 90, files: true,
      includes: ['Everything in Single vineyard', 'Several vineyards', '1.5 hours of support a month'] },
    up500: { name: 'Up to 500 acres', price: '$235 a month', ai: 800, gb: 100, support: 240, files: true,
      includes: ['Everything in Up to 100 acres', 'Owner logins for each vineyard', '4 hours of support a month'] },
    large: { name: 'Over 500 acres', price: 'Quoted at cost', ai: null, gb: null, support: null, files: true,
      includes: ['Everything in Up to 500 acres', 'Usage grows with acres'] },
    host: { name: 'Host (Tystrya)', price: 'Internal', ai: null, gb: null, support: null, files: true,
      includes: ['Every feature, for Tystrya and the accounts it hosts'] }
  };
  var EXPORT_TABLES = ['barrels', 'barrel_details', 'barrel_positions', 'barrel_moves', 'vintage_lots', 'so2_log', 'topping_log', 'lab_results', 'lab_documents',
    'malic_results', 'tartaric_additions', 'fermenters', 'fermenter_additions', 'picks', 'estate_harvests', 'vineyards', 'vineyard_blocks', 'vineyard_rows',
    'vineyard_sprays', 'vineyard_activities', 'spray_products', 'harvest_estimates', 'berry_samples', 'tissue_tests', 'soil_tests', 'vessels', 'supplies',
    'supply_lots', 'supply_uses', 'purchase_lines', 'bottlings', 'bottled_skus', 'work_orders', 'volume_moves', 'questions', 'attachments', 'wine_reviews', 'tasting_notes'];

  function cmPlanInfo(key) { return PLANS[key] || PLANS.basic; }

  /* usage against what the plan includes -> bars for the meter */
  function cmUsageBars(u, key) {
    var p = cmPlanInfo(key);
    var gbUsed = (Number(u.file_bytes) || 0) / GB;
    var bar = function (label, used, incl, fmt) { return { label: label, used: used, included: incl, text: fmt(used) + (incl == null ? '' : ' of ' + fmt(incl)), pct: incl ? Math.min(100, 100 * used / incl) : null, over: incl != null && incl > 0 && used > incl, off: incl === 0 }; };
    return [
      bar('Files and photos', gbUsed, p.gb, function (x) { return x < 0.1 ? (x * 1024).toFixed(1) + ' MB' : x.toFixed(2) + ' GB'; }),
      bar('AI reads this month', Number(u.ai_reads_month) || 0, p.ai, function (x) { return String(Math.round(x)); }),
      bar('Support this month', Number(u.support_minutes_month) || 0, p.support, function (x) { return Math.round(x) + ' min'; })
    ];
  }

  var planCache = {};
  function db() { return supa.schema('cellarmate'); }
  async function getPlan(org) {
    if (!org) return 'basic'; if (planCache[org]) return planCache[org];
    var r = await db().rpc('org_plan', { o: org }); planCache[org] = r.error ? 'basic' : r.data; return planCache[org];
  }
  async function canStore(org) { return cmPlanInfo(await getPlan(org)).files; }
  async function usage(org) { var r = await db().rpc('org_usage', { o: org }); if (r.error) throw new Error(r.error.message); return r.data; }

  /* every table this account can see, its own rows only, one sheet each */
  async function exportAll(org, orgName) {
    if (typeof cmLib === 'function') await cmLib('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    if (!window.XLSX) throw new Error('The Excel library did not load. Check the connection and try again.');
    var wb = XLSX.utils.book_new(), done = [], skipped = [];
    for (var i = 0; i < EXPORT_TABLES.length; i++) {
      var t = EXPORT_TABLES[i];
      try {
        var rows = (await cmFetch(t)).filter(function (r) { var o = r.organization_id || r.org_id; return !o || o === org; });
        if (!rows.length) continue;
        var clean = rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { var v = r[k]; o[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v; }); return o; });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clean), t.slice(0, 31)); done.push(t + ' (' + rows.length + ')');
      } catch (e) { skipped.push(t); }
    }
    var about = [{ Account: orgName || org, Exported: new Date().toISOString(), Sheets: done.length, Note: 'Your data, yours to keep. Files and photos are listed on the attachments sheet; open them in CellarMate to download.' }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(about), 'About');
    XLSX.writeFile(wb, 'CellarMate_my_data_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    return { sheets: done, skipped: skipped };
  }

  function CmPlan() {
    var org = typeof CM_ME !== 'undefined' ? CM_ME.org_id : null;
    var s = React.useState(null), U = s[0], setU = s[1];
    var e = React.useState(''), msg = e[0], setMsg = e[1];
    var b = React.useState(false), busy = b[0], setBusy = b[1];
    React.useEffect(function () { var live = true; usage(org).then(function (u) { if (live) setU(u); }).catch(function (x) { if (live) setMsg(x.message); }); return function () { live = false; }; }, [org]);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    if (!U) return cmE('div', { style: card }, msg || 'Loading your plan and usage...');
    var p = cmPlanInfo(U.plan), bars = cmUsageBars(U, U.plan);
    var exp = function () { setBusy(true); setMsg(''); exportAll(org, typeof CM_ME !== 'undefined' ? CM_ME.org_name : '').then(function (r) { setMsg('Downloaded ' + r.sheets.length + ' sheets' + (r.skipped.length ? ' (could not read: ' + r.skipped.join(', ') + ')' : '') + '.'); }).catch(function (x) { setMsg(x.message); }).then(function () { setBusy(false); }); };
    return cmE('div', null,
      cmE('div', { style: card },
        cmE('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, cmE('div', { style: { fontSize: 16, fontWeight: 700, flex: 1 } }, p.name), cmE('div', { style: { fontWeight: 700, color: C.accentLight } }, p.price)),
        cmE('ul', { style: { margin: '6px 0 0 18px', padding: 0, fontSize: 12 } }, p.includes.map(function (x) { return cmE('li', { key: x }, x); })),
        !p.files ? cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) }, 'Basic is free because it leaves out what costs us money: stored files, AI and support time. Move up any time to add them.') : null),
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 6 } }, 'Your usage'),
        bars.map(function (x) {
          return cmE('div', { key: x.label, style: { marginBottom: 8 } },
            cmE('div', { style: { display: 'flex', fontSize: 12 } }, cmE('span', { style: { flex: 1 } }, x.label), cmE('span', { style: { color: x.over ? C.orange : C.textDim } }, x.off ? 'not in this plan' : x.text)),
            x.pct != null ? cmE('div', { style: { height: 6, background: C.cardBorder, borderRadius: 3, marginTop: 3 } }, cmE('div', { style: { height: 6, width: Math.max(2, x.pct) + '%', background: x.over ? C.orange : C.accentLight, borderRadius: 3 } })) : null);
        }),
        cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, marginTop: 4 } },
          [['Records', U.records], ['Files', U.files], ['Vineyards', U.vineyards], ['Acres', Number(U.acres).toFixed(1)], ['Weather days', U.weather_days], ['People', U.users]].map(function (x) { return cmE('div', { key: x[0] }, cmE('div', { style: { fontWeight: 700, fontSize: 15 } }, x[1]), cmE('div', { style: small }, x[0])); })),
        cmE('div', { style: Object.assign({}, small, { marginTop: 8 }) }, 'Prices come from what it costs us to run CellarMate for an account your size, plus a little overhead and profit to keep a team. Use beyond what is included is passed through at cost plus 15%.')),
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Your data is yours'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Download everything in this account as one Excel workbook, one sheet per kind of record. Take it with you any time.'),
        cmE('button', { onClick: exp, disabled: busy, style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 700, cursor: busy ? 'default' : 'pointer' } }, busy ? 'Preparing...' : 'Download all my data'),
        msg ? cmE('div', { style: { fontSize: 12, marginTop: 6 } }, msg) : null));
  }

  window.cmPlanInfo = cmPlanInfo;
  window.cmUsageBars = cmUsageBars;
  window.cmPlan = { PLANS: PLANS, get: getPlan, canStore: canStore, usage: usage, exportAll: exportAll, tables: EXPORT_TABLES };
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.plan = { label: 'Plan', Component: CmPlan, order: 86 };
})();
