/* CellarMate smoke test. Run in a signed-in page:
   fetch('/tests/smoke.js').then(r => r.text()).then(eval)  then  await cmSmoke()
   Returns {pass, fail, results}. Read-only: it never writes to the database. */
window.cmSmoke = async function(opts) {
  opts = opts || {};
  const results = []; const ok = function(name, cond, info) { results.push({name:name, pass:!!cond, info:info == null ? '' : String(info).slice(0, 160)}); };
  const wait = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
  const bad = function() { const t = document.body.innerText; const m = t.match(/.{0,30}(Something went wrong|undefined|NaN|\[object Object\]|Invalid Date).{0,30}/); return m ? m[0] : ''; };
  const click = function(t, tag) { const e = Array.from(document.querySelectorAll(tag || 'button,div,span')).filter(function(e) { return e.innerText && e.innerText.trim() === t; }).pop(); if (e) { e.click(); return true; } return false; };
  const nav = function(n) { const e = Array.from(document.querySelectorAll('button,div')).filter(function(e) { return e.innerText && new RegExp('^(\\S+\\s)?' + n + '$').test(e.innerText.trim()); }).pop(); if (e) { e.click(); return true; } return false; };
  const errs = []; const onErr = function(e) { errs.push(e.message || String(e)); }; window.addEventListener('error', onErr);

  /* 1. pure calculations */
  ok('tablets 7 g', JSON.stringify(cmTabletsFor(7)) === JSON.stringify({g:7, tab:'1' + String.fromCharCode(215) + '5 + 1' + String.fromCharCode(215) + '2'}), JSON.stringify(cmTabletsFor(7)));
  ok('tablets 3 g rounds up to 4', cmTabletsFor(3).g === 4);
  ok('target red pH 3.78 is 47', cmTargetFor({ph:3.78, var:'Pinot Noir'}) === 47);
  ok('target white pH 3.34 is 28', cmTargetFor({ph:3.34, var:'Chardonnay'}) === 28);
  ok('target capped at 50', cmTargetFor({ph:3.99, var:'Pinot Noir'}) === 50);
  ok('tablets parsed from sheet text', JSON.stringify(cmParseTabs('1' + String.fromCharCode(215) + '5 + 2' + String.fromCharCode(215) + '2', null)) === JSON.stringify({n5:1, n2:2}));
  ok('tablets worked out from grams', JSON.stringify(cmParseTabs(null, 12)) === JSON.stringify({n5:2, n2:1}));
  ok('presumed loss faster at high pH', cmLossPerDay(3.9) > cmLossPerDay(3.5));
  ok('number swap keeps other numbers', cmSubNum('a=-123&b=-1234', -123, 9) === 'a=9&b=-1234');

  /* 1b. lots from the database (built-in data retired) */
  ok('built-in lot list is empty', typeof initialLots !== 'undefined' && initialLots.length === 0);
  ok('lots loaded from database', CM_LOTS.ready && CM_LOTS.count >= 490, CM_LOTS.count);
  ok('no lot sync errors', !CM_LOTS.err, CM_LOTS.err);
  ok('lot sync helpers present', typeof cmLotsSync === 'function' && typeof cmLoadDbLots === 'function');
  /* 1c. feature modules (modules/*.js) */
  ok('module registry has Ferment and Materials', !!(window.CM_MODULES && CM_MODULES.ferm && CM_MODULES.mat));
  const fz = await Promise.all([cmFetch('fermenters'), cmFetch('ferment_readings'), cmFetch('fermenter_additions')]);
  const f26 = fz[0].filter(function(f) { return f.vintage === 2026; }).map(function(f) { return cmFermSummary(f, fz[1].filter(function(r) { return r.vintage === 2026; }), fz[2].filter(function(r) { return r.vintage === 2026; })); });
  ok('2026 fermenters summarised', f26.length >= 38, f26.length);
  ok('2026 inoculated fermenters found', f26.filter(function(x) { return x.yeast.length; }).length >= 11, f26.filter(function(x) { return x.yeast.length; }).map(function(x) { return x.f.fermenter; }).join(','));
  ok('days to dry are sensible', f26.every(function(x) { return x.daysDry == null || (x.daysDry >= 0 && x.daysDry < 60); }));
  const mz = await Promise.all(['supplies','supply_lots','supply_uses','supply_counts','purchase_lines','fermenter_additions'].map(function(t) { return cmFetch(t); }));
  const mrows = cmMaterialRows({sup:mz[0], lots:mz[1], uses:mz[2], counts:mz[3], pl:mz[4], fa:mz[5]});
  ok('materials rows have no NaN', mrows.every(function(r) { return !isNaN(r.spend) && !isNaN(r.bought); }));
  const plTotal = mz[4].reduce(function(t, p) { return t + Number(p.amount || 0); }, 0);
  ok('invoice total is about 40,703', Math.abs(plTotal - 40703.38) < 1, plTotal.toFixed(2));
  ok('BRG use matches log (427 g)', (mrows.filter(function(r) { return /BRG/.test(r.s.name); })[0] || {}).faG === 427);
  /* 2. data */
  const rows = await cmStatusRows();
  const r26 = rows.filter(function(r) { return r.v === 2026; }); const r25 = rows.filter(function(r) { return r.v === 2025; });
  ok('2026 barrels load', r26.length >= 140, r26.length); ok('2025 barrels load', r25.length >= 120, r25.length);
  const codes = {}; let dup = []; rows.forEach(function(r) { if (codes[r.b]) dup.push(r.b); codes[r.b] = 1; });
  ok('no duplicate barrel codes', !dup.length, dup.join(', '));
  ok('every barrel has a category', rows.every(function(r) { return ['add','test','hold','decide','ok','other'].indexOf(r.cat) !== -1; }));
  ok('SO2 adds have grams', rows.filter(function(r) { return r.cat === 'add'; }).every(function(r) { return r.g != null && r.g > 0; }), rows.filter(function(r) { return r.cat === 'add' && !(r.g > 0); }).map(function(r) { return r.b; }).join(', '));
  ok('presumed values are sane', rows.every(function(r) { return r.est == null || (r.est >= 0 && r.est < 200); }));
  const ves = await cmFetch('vessels');
  ok('vessel volumes not negative', ves.every(function(x) { const g = cmVesselGal(x); return g == null || g >= 0; }));
  let wo = []; try { wo = await cmFresh('work_orders'); } catch (e) {}
  const missing = []; wo.filter(function(o) { return o.status === 'Open'; }).forEach(function(o) { (o.barrels || []).forEach(function(b) { if (!codes[b]) missing.push(o.id + ':' + b); }); });
  ok('open work orders point at real barrels', !missing.length, missing.join(', '));
  ok('signed-in access loaded', CM_ME.loaded && CM_ME.has_access, CM_ME.email);

  /* 3. screens */
  const g = Array.from(document.querySelectorAll('div')).filter(function(e) { return e.children.length === 0 && e.innerText.trim() === 'Kameron'; })[0];
  if (g && /logging today/.test(document.body.innerText.slice(0, 300))) { g.click(); await wait(1500); }
  for (const n of ['Cellar', 'Lots', 'Health', 'Schedule', 'Reports']) { nav(n); await wait(1600); ok('screen ' + n, document.body.innerText.length > 500 && !bad(), bad()); }
  for (const t of ['Reports', 'Work', 'Log', 'Volumes', 'Tanks', 'Wines', 'Supplies', 'Ferment', 'Materials', 'Data', 'Q&A', 'Facility', 'TTB', 'Admin', 'Status']) {
    if (!click(t, 'button')) continue; await wait(1800);
    const tx = document.body.innerText; ok('tab ' + t, !bad() && !/You are offline and this has not been saved/.test(tx), bad());
  }
  const sel = Array.from(document.querySelectorAll('select')).filter(function(e) { return Array.from(e.options).some(function(x) { return x.value === 'malic'; }); })[0];
  if (click('Reports', 'button')) { await wait(1500); }
  const sel2 = Array.from(document.querySelectorAll('select')).filter(function(e) { return Array.from(e.options).some(function(x) { return x.value === 'malic'; }); })[0];
  if (sel2) { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    for (const rep of ['malic','so2','tart','top','chard','ml','chsul','eat']) { set.call(sel2, rep); sel2.dispatchEvent(new Event('change', {bubbles:true})); await wait(1300); ok('report ' + rep, document.querySelectorAll('tbody tr').length > 0 && !bad(), bad()); } }

  /* 4. layout at this width */
  const over = Array.from(document.querySelectorAll('button,input,select,table')).filter(function(e) { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 2 && !e.closest('[style*=overflow-x]'); }).length;
  ok('nothing cut off at ' + innerWidth + ' px', document.documentElement.scrollWidth <= innerWidth + 2 && !over, over + ' cut off');

  /* 5. offline layer */
  ok('offline layer loaded', typeof cmOfflineFetch === 'function' && CM_NET.loaded);
  ok('no failed offline changes', !CM_NET.failed.length, CM_NET.failed.map(function(f) { return f.q.table + ': ' + f.error; }).join('; '));
  ok('device copy saved', !!CM_NET.savedAt, CM_NET.savedAt ? new Date(CM_NET.savedAt).toLocaleString() : 'never');

  window.removeEventListener('error', onErr);
  ok('no page errors during run', !errs.length, errs.join(' | '));
  const fail = results.filter(function(r) { return !r.pass; });
  return {pass:results.length - fail.length, fail:fail.length, failed:fail, results:opts.all ? results : undefined};
};
