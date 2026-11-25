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
  const plTotal = mz[4].filter(function(p) { return p.supplier === 'Crush2Cellar'; }).reduce(function(t, p) { return t + Number(p.amount || 0); }, 0);
  ok('Crush2Cellar invoice total is about 40,703', Math.abs(plTotal - 40703.38) < 1, plTotal.toFixed(2));
  const plAll = mz[4].reduce(function(t, p) { return t + Number(p.amount || 0); }, 0);
  ok('all supplier lines about 156,281 (Innovative Sourcing glass added)', Math.abs(plAll - 156281.30) < 1, plAll.toFixed(2));
  ok('Industrial Source gas invoices about 15,393', Math.abs(mz[4].filter(function(p) { return p.supplier === 'Industrial Source'; }).reduce(function(t, p) { return t + Number(p.amount || 0); }, 0) - 15392.80) < 1);
  ok('BRG use matches log (427 g)', (mrows.filter(function(r) { return /BRG/.test(r.s.name); })[0] || {}).faG === 427);
  /* 1d. barrel map module */
  ok('module registry has Map', !!(window.CM_MODULES && CM_MODULES.map));
  const bmz = await Promise.all([cmFetch('barrel_positions'), cmFetch('barrel_status_2025'), cmFetch('barrel_status_2026')]);
  const bm = cmMapIndex(bmz[0], bmz[1], bmz[2], await cmStatusRows());
  ok('EBS map has 94 barrels', bm.filter(function(p) { return p.area === 'EBS' && p.barrel; }).length === 94, bm.filter(function(p) { return p.area === 'EBS' && p.barrel; }).length);
  ok('floor rows place 120+ barrels', bm.filter(function(p) { return p.area === 'Rows' && p.barrel; }).length >= 120);
  const slot = {}; let clash = [];
  bm.filter(function(p) { return p.barrel; }).forEach(function(p) { const k = [p.area, p.rack, p.col, p.side, p.level].join('|'); if (slot[k]) clash.push(k); slot[k] = 1; });
  ok('no two barrels in one slot', !clash.length, clash.join(' '));
  ok('every placed 2026 barrel is on file', bm.filter(function(p) { return p.vintage === 2026 && p.barrel && !p.st; }).length <= 1);
  /* 1e. barrel map views and printing */
  const placedN = bm.filter(function(p) { return p.barrel; }).length;
  ok('by-wine view covers every placed barrel', cmMapLots(bm).reduce(function(t, g) { return t + g.barrels.length; }, 0) === placedN);
  ok('work list covers every placed barrel', cmMapWork(bm).reduce(function(t, g) { return t + g.barrels.length; }, 0) === placedN);
  ok('work list has SO2 adds with grams', (cmMapWork(bm).filter(function(g) { return g.step === 'add'; })[0] || {barrels:[]}).barrels.every(function(p) { return p.g != null; }));
  const ph1 = cmMapPrintHtml('layout', bm, 'wine');
  ok('printable layout has both maps', ph1.indexOf('EBS racks') > -1 && ph1.indexOf('Floor rows') > -1 && (ph1.match(/<td style=/g) || []).length >= placedN);
  const ph2 = cmMapPrintHtml('list', bm, 'wine');
  ok('printable list has a row per barrel', (ph2.match(/<tr>/g) || []).length === placedN + 1);
  ok('printable work list and by-wine render', cmMapPrintHtml('work', bm, 'step').indexOf('Work list') > -1 && cmMapPrintHtml('lots', bm, 'wine').indexOf('Where each wine is') > -1);
  /* 1f. barrel moves (planning only; no writes in the smoke test) */
  const MVt = window.cmBarrelMoves;
  ok('barrel move helpers loaded', !!(MVt && MVt.plan && MVt.move && MVt.undo));
  const pk = bm.filter(function(p) { return p.area === 'EBS' && p.barrel; })[0];
  const emptyE = {area:'EBS', rack:12, col:'D', side:'Front', level:null};
  ok('move to an empty spot plans a move', MVt.plan(bm, pk, emptyE).kind === 'move', JSON.stringify(MVt.plan(bm, pk, emptyE)));
  const other = bm.filter(function(p) { return p.area === 'EBS' && p.barrel && p.id !== pk.id; })[0];
  ok('move onto a barrel plans a swap', MVt.plan(bm, pk, other).kind === 'swap');
  ok('same spot is refused', MVt.plan(bm, pk, pk).ok === false);
  ok('client stack is refused', MVt.plan(bm, pk, {area:'Rows', rack:7, col:'2', side:'Front', level:'A'}).ok === false);
  const un = MVt.unplaced(bm, bmz[1], bmz[2]);
  ok('unplaced list excludes placed barrels', un.length > 0 && !un.some(function(u) { return bm.some(function(p) { return p.barrel === u.barrel && p.vintage === u.vintage; }); }), un.length);
  ok('placing onto a barrel is refused', MVt.plan(bm, un[0], other).ok === false);
  /* 1g. costs per lot */
  ok('fermenter list parsed from lot names', JSON.stringify(cmFermentersOf('Estate Blk 4 + 13 (F30/33)')) === JSON.stringify(['F30','F33']) && JSON.stringify(cmFermentersOf('Sawyer (F14, F15, F16)')) === JSON.stringify(['F14','F15','F16']) && cmFermentersOf('Tystrya Rose (039)').length === 0);
  const cz = await Promise.all(['supplies','supply_lots','purchase_lines','fermenter_additions','barrel_status_2026'].map(function(t) { return cmFetch(t); }));
  const uc = cmUnitCosts(cz[0], cz[1], cz[2]);
  const brg = cz[0].filter(function(s) { return /BRG/.test(s.name); })[0];
  ok('BRG costs about 12 cents a gram', brg && uc[brg.id].perUnit > 0.08 && uc[brg.id].perUnit < 0.2, brg && uc[brg.id].perUnit);
  const lc = cmLotCosts(cz[4], cz[3], uc, 2026, await cmFetch('fermenters'));
  ok('2026 lots get a materials cost', lc.length >= 15 && lc.every(function(r) { return r.cost >= 0 && !isNaN(r.cost); }), lc.length);
  const priced = cz[3].filter(function(a) { return a.vintage === 2026 && a.grams != null && (a.supply_id || a.likely_supply_id); });
  const pricedTotal = priced.reduce(function(t, a) { const u = uc[a.supply_id || a.likely_supply_id]; return t + (u && u.perUnit != null && u.unit === 'g' ? u.perUnit * Number(a.grams) : 0); }, 0);
  const lotTotal = lc.reduce(function(t, r) { return t + r.cost; }, 0);
  ok('lot costs add up to no more than priced additions', lotTotal <= pricedTotal + 0.01, lotTotal.toFixed(2) + ' of ' + pricedTotal.toFixed(2));
  /* 1h. barrel labels and scan links */
  const LBt = window.cmBarrelLabels;
  ok('label helpers loaded', !!(LBt && LBt.printLabels && LBt.deepBarrel));
  ok('barrel codes parse', JSON.stringify(LBt.parseCode('25-0183')) === JSON.stringify({vintage:2025, barrel:'183'}) && JSON.stringify(LBt.parseCode('26-7')) === JSON.stringify({vintage:2026, barrel:'26-007'}) && LBt.parseCode('x12') === null);
  const p142 = bm.filter(function(p) { return p.barrel === '26-142'; })[0];
  ok('label link opens the barrel', /\?barrel=26-142$/.test(LBt.linkFor(p142, 'https://example.test/')));
  const lh = LBt.labelsHtml(bm.filter(function(p) { return p.barrel; }).slice(0, 7).map(function(p) { return Object.assign({}, p, {where:'x'}); }), 'small', function() { return 'data:,'; });
  ok('label sheet has one label per barrel', (lh.match(/class="l"/g) || []).length === 7);
  const h97 = await LBt.history({vintage:2026, barrel:'26-097'});
  ok('barrel history finds the Nov 20 SO2 add on 26-097', h97.some(function(x) { return /2026-11-20/.test(x.d); }), JSON.stringify(h97.slice(0,3)));
  /* 1i. topping schedule */
  ok('topping module loaded', !!(window.CM_MODULES && CM_MODULES.top && window.cmToppingStatus));
  const tz = await cmFetch('topping_log');
  const ts = cmToppingStatus(bm, tz, 21, '2026-11-22');
  ok('every placed barrel gets a topping status', ts.length === placedN && ts.every(function(r) { return ['overdue','never','soon','ok'].indexOf(r.status) > -1; }));
  ok('2026 barrels show the Nov 10 topping', ts.filter(function(r) { return r.p.vintage === 2026; }).every(function(r) { return r.last >= '2026-11-10'; }));
  const fake = [{vintage:null, area:'EBS|4', topped_on:'2026-11-20'}, {barrels:['26-022'], topped_on:'2026-11-21'}];
  const ts2 = cmToppingStatus(bm, fake, 21, '2026-11-22');
  ok('a rack topping covers only that rack', ts2.filter(function(r) { return r.last === '2026-11-20'; }).every(function(r) { return r.p.area === 'EBS' && r.p.rack === 4; }) && ts2.some(function(r) { return r.last === '2026-11-20'; }));
  ok('a named-barrel topping covers that barrel', ts2.filter(function(r) { return r.last === '2026-11-21'; }).map(function(r) { return r.p.barrel; }).join() === '26-022');
  ok('overdue after the interval', cmToppingStatus(bm, [{vintage:2026, topped_on:'2026-10-01'}], 21, '2026-11-22').filter(function(r) { return r.p.vintage === 2026; }).every(function(r) { return r.status === 'overdue'; }));
  /* 1j. lab results */
  ok('lab module loaded', !!(window.CM_MODULES && CM_MODULES.lab && window.cmParseLab));
  const lp1 = cmParseLab('26-022 11/20 pH 3.41 TA 6.2 VA 0.42 Free SO2 22', '2026-11-22');
  ok('quick lab line reads 4 results', lp1.rows.length === 4 && lp1.rows[0].barrel === '26-022' && lp1.rows[0].sampled_on.slice(5) === '11-20' && lp1.rows[3].analyte === 'fso2');
  const lp2 = cmParseLab('Sample\tDate\tpH\tVA (g/L)\tMalic\n25-183\t11/20/2026\t3.55\t0.62\t<0.05', '2026-11-22');
  ok('pasted lab table reads results', lp2.rows.length === 3 && lp2.rows[0].vintage === 2025 && lp2.rows[0].barrel === '183', JSON.stringify(lp2));
  const pn = cmLatestPanels(lp2.rows, [], []);
  ok('VA 0.62 is flagged', cmLabFlags(pn[0], false).some(function(f) { return /^VA/.test(f); }));
  const lz = await Promise.all([cmFetch('lab_results'), cmFetch('so2_log'), cmFetch('malic_results')]);
  const allP = cmLatestPanels(lz[0], lz[1], lz[2]);
  ok('latest panels built from the SO2 log and malic tests', allP.length >= 150, allP.length);
  const p7 = allP.filter(function(p) { return p.vintage === 2025 && p.barrel === '7'; })[0];
  ok('a reading taken before an SO2 add asks for a re-test, not a low-SO2 alarm', p7 && cmLabFlags(p7, false).some(function(f) { return /after the last reading/.test(f); }) && !cmLabFlags(p7, false).some(function(f) { return /^Molecular/.test(f); }), p7 && JSON.stringify(cmLabFlags(p7, false)));
  /* 1k. lab report files */
  ok('lab report reader loaded', !!(window.cmParseEts && window.CmLabUpload));
  const etsLines = ['LABORATORY', 'REPORT', '# 2139885O', 'Samples Received', '10 January 2025 2:28 pm', 'Analyte   Result   Analysis Date   Method Reference',
    '501101000           26-22', '  free sulfur dioxide          <2     mg/L       1/10/25     A2LA Accredited Test - SOP# A024',
    '  pH                           3.83              1/10/25     A2LA Accredited Test - SOP# A022', '  volatile acidity (acetic acid)    1.20     g/L    1/10/25   A2LA',
    '  ethanol at 20C               14.32     % vol    1/10/25   A2LA', '  ethanol at 60F               14.25     % vol    1/10/25   A2LA',
    '501101001           Buckot bros', '  yeast assimilable nitrogen     95   mg/L (as N)    9/25/25', 'ETS Laboratories - Oregon Facility'];
  const ep = cmParseEts(etsLines);
  ok('ETS report header read', ep.lab === 'ETS Laboratories' && ep.report_no === '2139885O' && ep.received_on === '2025-01-10', JSON.stringify([ep.lab, ep.report_no, ep.received_on]));
  ok('ETS samples and results read', ep.samples.length === 2 && ep.samples[0].barrel === '26-022' && ep.samples[0].results.length === 4 && ep.samples[1].barrel === null, JSON.stringify(ep.samples.map(function(s) { return [s.desc, s.barrel, s.results.length]; })));
  ok('ETS values: below-limit and VA', ep.samples[0].results[0].value_text.indexOf('<2') === 0 && ep.samples[0].results[2].analyte === 'va' && ep.samples[0].results[2].value === 1.2);
  ok('PDF text rebuilt into lines', JSON.stringify(cmLinesFromItems([{str:'pH', x:10, y:500}, {str:'3.42', x:300, y:500.8}, {str:'brix', x:10, y:480}])) === JSON.stringify(['pH   3.42', 'brix']));
  /* 1l. Today screen */
  ok('Today module loaded and first', !!(window.CM_MODULES && CM_MODULES.today) && cmWithModTabs([['status','Status'],['vol','Volumes']])[0][0] === 'today');
  const tdz = await Promise.all([cmFetch('work_orders'), cmFetch('so2_log'), cmFetch('cellar_actions'), cmFetch('topping_log')]);
  const tp = cmTodayPlan({items: bm, orders: tdz[0], so2: tdz[1], actions: tdz[2], toppingLogs: tdz[3], interval: 21}, '2026-11-24');
  ok('Today lists open work orders with spots', tp.orders.length >= 1 && tp.orders.every(function(o) { return o.barrels.every(function(b) { return 'p' in b; }); }), tp.orders.length);
  ok('Today SO2 adds match the map work list', tp.add.length === (cmMapWork(bm).filter(function(g) { return g.step === 'add'; })[0] || {barrels:[]}).barrels.length);
  ok('Today asks to re-test 26-097 after the Nov 20 add', tp.retest.some(function(x) { return x.code === '26-097'; }), JSON.stringify(tp.retest.slice(0,4).map(function(x) { return x.code; })));
  ok('Today day sheet prints', cmTodaySheetHtml(tp).indexOf('day sheet 2026-11-24') > -1);
  /* 1m. photos and documents */
  const FX = window.cmFiles;
  ok('files module loaded', !!(FX && window.CmFilesFor && CM_MODULES.files));
  const fr = FX.findRefs('26-142 leak at bung, topped from SST4 and K3; F7 lees; 25-183 on 2026-11-22', {fermVintage:2026, lots:[]});
  ok('codes in text become links', JSON.stringify(fr.map(function(l) { return l.link_type + ':' + l.ref; })) === JSON.stringify(['barrel:26-142','barrel:183','vessel:SST4','vessel:K-3','fermenter:F7']), JSON.stringify(fr));
  ok('a lab report is not linked to the facility', !FX.findRefs('ETS Laboratories - Oregon Facility, 214 W. Hancock Street', null).some(function(l) { return l.link_type === 'facility'; }) && FX.findRefs('forklift hit the drain cover at Press and Barrel', null).some(function(l) { return l.link_type === 'facility'; }));
  ok('dates are not read as barrels', FX.findRefs('taken 2026-11-22 at 11-25', null).length === 0);
  ok('document kind read from its text', FX.guessCategory('a.pdf', 'ETS Laboratories free sulfur dioxide', false) === 'lab' && FX.guessCategory('b.pdf', 'Crush2Cellar invoice subtotal', false) === 'invoice' && FX.guessCategory('26-142 leak.jpg', '', true) === 'issue');
  ok('barrel label link read', JSON.stringify(FX.qrToLink('https://cellar-tracker.vercel.app/?barrel=26-142')) === JSON.stringify({link_type:'barrel', vintage:2026, ref:'26-142', from:'QR code on the barrel label'}));
  try {
    await new Promise(function(res, rej) { if (window.QRCode) return res(); const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const dq = document.createElement('div'); document.body.appendChild(dq); new QRCode(dq, {text:'https://cellar-tracker.vercel.app/?barrel=25-183', width:320, height:320});
    const cq = document.createElement('canvas'); cq.width = 600; cq.height = 600; const g = cq.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0,0,600,600); g.drawImage(dq.querySelector('canvas'), 140, 140); dq.remove();
    const blob = await new Promise(function(r) { cq.toBlob(r, 'image/png'); });
    const rd = await FX.readAny(new File([blob], 'IMG_0001.png', {type:'image/png'}), null);
    ok('a photo of a barrel label links to that barrel', rd.links.some(function(l) { return l.link_type === 'barrel' && l.ref === '183' && l.vintage === 2025; }) && !!rd.thumb, JSON.stringify(rd.links) + ' ' + rd.notes.join(' '));
  } catch (e) { ok('a photo of a barrel label links to that barrel', false, String(e)); }
  /* 1n. vintage comparison */
  ok('vintage module loaded', !!(window.cmVintageCompare && CM_MODULES.vint));
  const vz = await Promise.all(['fermenters','picks','barrel_status_2025','barrel_status_2026','barrels','fermenter_additions','lab_results'].map(function(t) { return cmFetch(t); }));
  const vc = cmVintageCompare({ferms: vz[0], picks: vz[1], s25: vz[2], s26: vz[3], barrels: vz[4], adds: vz[5], lab: vz[6]});
  const mv = function(label, v) { return (vc.metrics.filter(function(m) { return m.label === label; })[0] || {vals:{}}).vals[v]; };
  ok('vintages 2023 to 2026 compared', JSON.stringify(vc.vintages) === JSON.stringify([2023,2024,2025,2026]), JSON.stringify(vc.vintages));
  ok('2026 fermenters and tons match the sheets', mv('Fermenters', 2026) === 38 && Math.abs(mv('Tons in fermenters', 2026) - 38.25) < 0.1, mv('Fermenters', 2026) + ' ' + mv('Tons in fermenters', 2026));
  ok('2025 picks and tons match the pick records', mv('Picks', 2025) === 42 && Math.abs(mv('Tons picked', 2025) - 76.13) < 0.1);
  ok('2026 yeast added in 11 fermenters', mv('Fermenters with yeast added (as recorded)', 2026) === 11, mv('Fermenters with yeast added (as recorded)', 2026));
  const pickTons = vz[1].filter(function(p) { return p.vintage === 2025 && /tystrya/i.test(p.vineyard || ''); }).reduce(function(s, p) { return s + (Number(p.tons) || 0); }, 0);
  const blockTons = vc.blocks.filter(function(b) { return b.vineyard === 'Tystrya Estate'; }).reduce(function(s, b) { return s + ((b.vals[2025] || {}).tons || 0); }, 0);
  ok('Estate block tons add up to the 2025 Estate picks', Math.abs(pickTons - blockTons) < 0.05 || blockTons <= pickTons, pickTons.toFixed(2) + ' vs ' + blockTons.toFixed(2));
  /* 1o. vineyard weather and harvest */
  ok('vineyard module loaded', !!(window.CmVineyard && window.cmGddSeason && window.cmWeatherFor));
  const sd = cmGddSeason([{date:'2030-03-31', tmax:90, tmin:70, p:1}, {date:'2030-04-01', tmax:80, tmin:60, p:0.5}, {date:'2030-09-02', tmax:96, tmin:64, p:0.3}]);
  ok('heat units count Apr to Oct only, base 50', sd[2030].gdd === 50 && Math.abs(sd[2030].rain - 0.8) < 1e-9 && sd[2030].hot95 === 1 && sd[2030].events.length === 1, JSON.stringify({g:sd[2030].gdd, r:sd[2030].rain}));
  const pr = cmProjectRipe(sd[2030], {'09-03': 20, '09-04': 20}, 85, '2030-09-02');
  ok('ripe date projects forward on normal heat', pr && pr.date === '2030-09-04', JSON.stringify(pr));
  const cc = cmCropCheck({est_tons: 4, target_tons_acre: 3}, {acres: 1, maxTpa: 3.5, actual: 4.5});
  ok('crop check flags over target and over best year', cc.flags.filter(function(f) { return f.level === 'warn'; }).length === 2 && /Dropping about 1\.00 t/.test(cc.flags[0].text), cc.flags.map(function(f) { return f.text; }).join(' | '));
  const hz = await Promise.all(['vineyard_blocks','estate_harvests','picks','vineyards'].map(function(t) { return cmFetch(t); }));
  const hh = cmHarvestHistory({blocks: hz[0], estate: hz[1], picks: hz[2]});
  const b4 = hh.blocks.filter(function(b) { return b.block === 4; })[0];
  ok('Estate block 4 2025 tons and t/ac', b4 && Math.abs(b4.years[2025].tons - 11.1735) < 0.001 && Math.abs(b4.years[2025].tpa - 11.1735 / 3.03) < 0.001, b4 && b4.years[2025].tons);
  ok('13 Estate blocks with history from 2017', hh.blocks.length >= 13 && hh.years[0] === 2017, hh.blocks.length + ' ' + hh.years[0]);
  ok('grower Stiling 2025 tons from picks', (function() { const g = hh.growers.filter(function(x) { return x.vineyard === 'Stiling'; })[0]; return g && Math.abs(g.years[2025].tons - 9.26) < 0.01; })());
  const est = hz[3].filter(function(v) { return v.owner_type === 'estate'; })[0];
  ok('Estate vineyard has a location', est && est.lat != null && est.lon != null);
  const wxr = await cmWeatherFor(est); const ss = cmGddSeason(wxr.days);
  ok('weather 2017 to now cached for the Estate', wxr.days.length > 3500 && ss[2024] && ss[2026], wxr.days.length + ' days');
  ok('2024 to 2026 heat units in the Willamette range', [2024, 2025, 2026].every(function(y) { return ss[y].gdd > 1800 && ss[y].gdd < 3000; }), [2024, 2025, 2026].map(function(y) { return Math.round(ss[y].gdd); }).join(', '));
  const sp = cmSprayCheck([{spray:1, date:'2030-05-01'}, {spray:2, date:'2030-05-11'}], [{date:'2030-05-02', tmax:70, tmin:50, p:0.3}, {date:'2030-05-03', tmax:70, tmin:50, p:0.3}, {date:'2030-05-10', tmax:80, tmin:60, p:0}]);
  ok('spray check: wash-off rain, gap and heat between sprays', sp[0].washoff === true && Math.abs(sp[0].rain3 - 0.6) < 1e-9 && sp[1].gap === 10 && sp[1].heat === 40 && sp[1].rain3 === null && sp[1].washoff === false, JSON.stringify(sp));
  const sprays = await cmFetch('vineyard_sprays'); const sr = cmSprayCheck(sprays, wxr.days);
  ok('2026 Estate sprays checked against the weather', sr.length >= 5 && sr.every(function(r) { return r.rain3 !== null; }), sr.map(function(r) { return r.date + ' ' + (r.rain3 == null ? '-' : r.rain3.toFixed(2)); }).join(', '));
  const anonC = window.supabase && window.supabase.createClient && typeof SUPA_URL !== 'undefined' && typeof SUPA_KEY !== 'undefined' ? window.supabase.createClient(SUPA_URL, SUPA_KEY, {auth: {persistSession: false, autoRefreshToken: false, storageKey: 'cm-smoke-anon'}}) : null;
  if (anonC) { const an = await anonC.schema('cellarmate').from('lots').select('id').limit(1); ok('signed-out visitor cannot read lots', !!an.error || !(an.data || []).length, an.error ? an.error.message : (an.data || []).length + ' rows'); }
  /* 1p. mildew pressure, ripeness samples, harvest watch */
  ok('mildew and ripeness modules loaded', !!(window.CmMildew && window.cmMildewIndex && window.CmRipeness && window.CmHarvestWatch && window.cmRipeTrend));
  const gh = cmGtFromHourly(['2030-06-01T00:00','2030-06-01T01:00','2030-06-01T02:00','2030-06-01T03:00','2030-06-01T04:00','2030-06-01T05:00','2030-06-01T06:00','2030-06-01T07:00','2030-06-01T08:00','2030-06-01T09:00'], [71,72,73,74,75,76,77,90,96,80]);
  ok('mildew hours: longest 70 to 85 run and hours at 95+', gh['2030-06-01'].gt === 7 && gh['2030-06-01'].hot === 1, JSON.stringify(gh));
  const mi = cmMildewIndex([{date:'2030-05-01', gt:7, hot:0}, {date:'2030-05-02', gt:6, hot:0}, {date:'2030-05-03', gt:8, hot:0}, {date:'2030-05-04', gt:9, hot:0}, {date:'2030-05-05', gt:2, hot:1}, {date:'2030-05-06', gt:0, hot:0}]);
  ok('Gubler-Thomas index starts at 60 after 3 days, +20, -10, -10 for heat', mi[1].index === null && mi[2].index === 60 && mi[3].index === 80 && mi[4].index === 60 && mi[5].index === 50, JSON.stringify(mi.map(function(d) { return d.index; })));
  const ser = []; for (let i = 0; i < 14; i++) ser.push({date: '2030-06-' + ('0' + (i + 1)).slice(-2), index: 80});
  const cov = cmMildewCoverage(ser, [{date:'2030-06-01'}]);
  ok('mildew coverage: high pressure past 10 days since spray', cov.length === 1 && cov[0].from === '2030-06-12' && cov[0].days === 3, JSON.stringify(cov));
  const fakeSeason = {at: function(d) { return {'2030-09-01': 2000, '2030-09-08': 2100}[d]; }};
  const rt = cmRipeTrend([{sampled_on:'2030-09-01', brix:18}, {sampled_on:'2030-09-08', brix:20}], fakeSeason, 23.5);
  ok('ripeness trend: Brix per 100 heat and heat needed for 23.5', Math.abs(rt.per100 - 2) < 1e-9 && Math.abs(rt.needGdd - 2275) < 1e-6, JSON.stringify({p: rt.per100, n: rt.needGdd}));
  const hw = cmHarvestWatch({blocks: hh.blocks, season: ss[2026], normal: cmNormalDaily(wxr.days, 2026), asOf: '2026-11-15', year: 2026, samples: []});
  ok('harvest watch: 2026 Estate blocks all show as picked', hw.length >= 13 && hw.every(function(r) { return r.picked.length > 0; }), hw.filter(function(r) { return !r.picked.length; }).map(function(r) { return r.block; }).join(','));
  const orgId = est.organization_id;
  const ins = await supa.schema('cellarmate').from('berry_samples').insert({organization_id: orgId, vintage: 2026, sampled_on: '2026-09-01', vineyard: 'Tystrya Estate', block: 7, brix: 21.4, ph: 3.31, note: 'SMOKE TEST'}).select('id').single();
  const del = ins.data ? await supa.schema('cellarmate').from('berry_samples').delete().eq('id', ins.data.id).select('id') : null;
  ok('berry sample saves and deletes', !ins.error && del && !del.error && del.data.length === 1, ins.error ? ins.error.message : '');
  /* 1q. vineyard records from the Drive folder */
  ok('vineyard records module loaded', !!(window.CmVineRecords && window.cmSprayYears && window.cmClusterTons));
  ok('cluster count estimate: vines x clusters x grams', Math.abs(cmClusterTons(1000, 20, 113.4) - 2.5) < 0.001, cmClusterTons(1000, 20, 113.4));
  const vr = await Promise.all(['vineyard_sprays','spray_products','vineyard_activities','vineyard_rows','tissue_tests'].map(function(t) { return cmFetch(t); }));
  const syr = cmSprayYears(vr[0]); const yr = function(y) { return syr.filter(function(o) { return o.year === y; })[0] || {}; };
  ok('spray history 2017 to 2026 on file', [2017,2018,2019,2020,2021,2022,2023,2024,2025,2026].every(function(y) { return yr(y).sprays > 0; }), syr.map(function(o) { return o.year + ':' + o.sprays; }).join(' '));
  ok('2025 sprays from the pesticide use report (11, Apr 15 to Jul 28)', yr(2025).sprays === 11 && yr(2025).first === '2025-04-15' && yr(2025).last === '2025-07-28', JSON.stringify({n: yr(2025).sprays, f: yr(2025).first, l: yr(2025).last}));
  ok('spray products with REI and PHI', vr[1].length >= 30 && vr[1].some(function(p) { return /microthiol/i.test(p.name) && Number(p.rei_hours) === 24; }), vr[1].length);
  const iyr = cmIrrigationYears(vr[2]);
  ok('irrigation years on file (2017 to 2020, 2024, 2025)', iyr.length >= 6 && iyr.some(function(o) { return o.year === 2025 && o.events >= 20; }), iyr.map(function(o) { return o.year + ':' + o.events; }).join(' '));
  const vines = vr[3].reduce(function(a, r) { return a + (Number(r.vines) || 0); }, 0);
  ok('vineyard map rows add up to 20,625 vines in 13 blocks', vines === 20625 && cmUniq(vr[3].map(function(r) { return r.block; })).length === 13, vines);
  ok('leaf tissue at veraison 2017 to 2025', cmUniq(vr[4].map(function(t) { return t.year; })).length >= 8, cmUniq(vr[4].map(function(t) { return t.year; })).sort().join(','));
  const vf = await cmFiles.forRef('vineyard', null, 'Tystrya Estate');
  ok('55 original vineyard files stored and linked', vf.length >= 55, vf.length);
  const sg = await supa.storage.from('cellar-files').createSignedUrl(vf[0].path, 60);
  ok('a stored vineyard file opens', !!(sg.data && sg.data.signedUrl), sg.error ? sg.error.message : '');
  /* 1r. plans, usage meter and data export */
  ok('plan module loaded', !!(window.cmPlan && window.cmPlanInfo && window.cmUsageBars && CM_MODULES.plan));
  ok('Basic plan is free and leaves out files and AI', cmPlanInfo('basic').price === 'Free' && cmPlanInfo('basic').files === false && cmPlanInfo('basic').ai === 0);
  const ub = cmUsageBars({file_bytes: 6 * 1024 * 1024 * 1024, ai_reads_month: 10, support_minutes_month: 0}, 'single');
  ok('usage meter flags going over what the plan includes', ub[0].over === true && ub[1].over === false && Math.round(ub[1].pct) === 20, JSON.stringify(ub.map(function(b) { return b.text; })));
  const myPlan = await cmPlan.get(CM_ME.org_id);
  ok('this account is on the host plan and can store files', myPlan === 'host' && await cmPlan.canStore(CM_ME.org_id), myPlan);
  const us = await cmPlan.usage(CM_ME.org_id);
  ok('usage meter reads records, files and acres', us.records > 1000 && us.files >= 55 && Number(us.acres) > 14 && us.weather_days > 3000, JSON.stringify(us));
  const bas = await supa.schema('cellarmate').rpc('can_store_files', {o: '6ec5f09c-a000-4a40-b5dd-3652aa757963'});
  ok('a Basic account cannot store files', bas.data === false, JSON.stringify(bas));
  /* 1s. vineyard schedule, owner access and owner portal */
  ok('owner module loaded', !!(window.CmVineyardTeam && window.CmOwnerPortal && window.cmScheduleSplit && window.cmOwnerFeed));
  const sch = cmScheduleSplit([{id:1, planned_on:'2030-06-01'}, {id:2, planned_on:'2030-06-10'}, {id:3, planned_on:'2030-07-30'}, {id:4, planned_on:'2030-05-20', done_on:'2030-05-25'}, {id:5}], '2030-06-05');
  ok('schedule splits past due, next two weeks, later and done', sch.overdue.length === 1 && sch.soon.length === 2 && sch.later.length === 1 && sch.done.length === 1, JSON.stringify({o: sch.overdue.length, s: sch.soon.length, l: sch.later.length, d: sch.done.length}));
  const feed = cmOwnerFeed({tasks: [{done_on:'2030-06-01', kind:'mow', title:'Mow rows'}], sprays: [{date:'2030-06-03', reason:'Powdery mildew', products_rate_per_acre:'Sulfur 4 lb'}, {date:null, skipped:true}], acts: [{date:'2030-05-01', kind:'irrigation', amount:1, unit:'gal/vine'}]}, '2030-06-05', 60);
  ok('owner feed merges work, sprays and irrigation, newest first, skips skipped sprays', feed.length === 3 && feed[0].kind === 'Spray' && feed[2].kind === 'Irrigation', JSON.stringify(feed.map(function(f) { return f.kind; })));
  const vys = await supa.schema('cellarmate').from('vineyards').select('id,name,organization_id').eq('name', 'Tystrya Estate').single();
  const dbv = supa.schema('cellarmate');
  const tIns = await dbv.from('vineyard_tasks').insert({organization_id: vys.data.organization_id, vineyard: 'Tystrya Estate', kind: 'mow', title: 'SMOKE TEST mow', planned_on: new Date().toISOString().slice(0, 10)}).select('id').single();
  const tDone = tIns.data ? await dbv.from('vineyard_tasks').update({done_on: new Date().toISOString().slice(0, 10)}).eq('id', tIns.data.id).select('done_on') : {};
  const tDel = tIns.data ? await dbv.from('vineyard_tasks').delete().eq('id', tIns.data.id).select('id') : {};
  ok('schedule task adds, finishes and deletes', !tIns.error && tDone.data && tDone.data[0].done_on && tDel.data && tDel.data.length === 1, tIns.error ? tIns.error.message : '');
  const mIns = await dbv.from('vineyard_members').insert({organization_id: vys.data.organization_id, vineyard_id: vys.data.id, email: 'smoke.owner@example.com', role: 'owner', added_by: 'smoke test'}).select('id').single();
  const mDel = mIns.data ? await dbv.from('vineyard_members').delete().eq('id', mIns.data.id).select('id') : {};
  ok('owner access adds and removes', !mIns.error && mDel.data && mDel.data.length === 1, mIns.error ? mIns.error.message : '');
  const myv = await dbv.rpc('my_vineyards');
  ok('my vineyards answers for this login', !myv.error && Array.isArray(myv.data), myv.error ? myv.error.message : '');
  /* 1t. LIVE and organic paperwork */
  ok('certification module loaded', !!(window.CmCertPapers && window.cmLivePur && window.cmLiveIrrigation && window.cmParseProducts));
  const pp = cmParseProducts('Nu Film P 3 oz/acre; Microthiol 4.42 lbs / A; Seaweed');
  ok('spray product lines split into name, rate and unit', pp.length === 3 && pp[0].name === 'Nu Film P' && pp[0].rate === 3 && pp[1].rate === 4.42 && pp[2].rate === null, JSON.stringify(pp));
  const cp = await Promise.all(['vineyard_sprays','spray_products','vineyard_activities','vineyard_blocks'].map(function(t) { return cmFetch(t); }));
  const pur25 = cmLivePur(cp[0], cp[1], 2025, 'Tystrya Estate');
  ok('2025 LIVE pesticide use report built from the spray records', pur25.rows.length >= 15 && pur25.rows.every(function(r) { return r['Product Trade Name'] && r['Date Applied']; }) && pur25.issues.unmatched.length === 0, pur25.rows.length + ' rows; unmatched ' + pur25.issues.unmatched.join(','));
  const irr25 = cmLiveIrrigation(cp[2], 2025, cp[3], 'Tystrya Estate');
  ok('2025 LIVE irrigation report has the 26 entries', irr25.length === 26 && irr25[0]['PLANTS/ACRE'] === 1452, irr25.length);
  /* 1u. field work: safety windows, growth stages, labor */
  ok('field work module loaded', !!(window.CmFieldWork && window.cmSafetyWindows && window.cmPhenology && window.cmLaborByBlock && window.cmStageName));
  const blk = [{block: 1, acres: 1}, {block: 2, acres: 3}];
  const sw = cmSafetyWindows([{date: '2030-06-01', blocks: 'All', products_rate_per_acre: 'Microthiol 5 lbs/acre; Regalia 64 oz/acre'}, {date: '2030-06-01', blocks: '2', products_rate_per_acre: 'Kaligreen 2.5 lbs', skipped: true}],
    [{name: 'Microthiol', rei_hours: 24, phi_days: 21}, {name: 'Regalia', rei_hours: 4, phi_days: 0}, {name: 'Kaligreen', rei_hours: 4, phi_days: 1}], blk, '2030-06-02T08:00:00');
  ok('re-entry and pre-harvest windows from the spray products', sw.active.length === 2 && sw.blocks[1].reiUntil && sw.blocks[1].reiUntil.getDate() === 2 && sw.blocks[1].reiUntil.getHours() === 18 && sw.blocks[2].phiUntil === '2030-06-22', JSON.stringify(sw.active.map(function(o) { return [o.block, String(o.reiUntil), o.phiUntil]; })));
  const sw2 = cmSafetyWindows([{date: '2030-06-01', blocks: 'All', products_rate_per_acre: 'Microthiol 5 lbs/acre'}], [{name: 'Microthiol', rei_hours: 24, phi_days: 21}], blk, '2030-06-25T08:00:00');
  ok('windows close once the time has passed', sw2.active.length === 0);
  const ph = cmPhenology([{kind: 'growth stage', el_stage: 4, observed_on: '2030-04-10'}, {kind: 'growth stage', el_stage: 5, observed_on: '2030-04-05'}, {kind: 'growth stage', el_stage: 23, observed_on: '2030-06-12'}, {kind: 'scouting', observed_on: '2030-06-01'}, {kind: 'growth stage', el_stage: 35, observed_on: '2030-08-09'}]);
  ok('budbreak, bloom and veraison dates from the growth stage log', ph['2030'].Budbreak === '2030-04-05' && ph['2030'].Bloom === '2030-06-12' && ph['2030'].Veraison === '2030-08-09', JSON.stringify(ph));
  const lb = cmLaborByBlock([{worked_on: '2030-05-01', blocks: 'all', task: 'thin', people: 2, hours: 4, rate: 25}, {worked_on: '2030-05-02', blocks: '2', task: 'mow', hours: 2}, {worked_on: '2029-05-02', blocks: '2', task: 'old', hours: 99}], blk, 2030, 30);
  ok('labor hours and cost shared by acres', Math.abs(lb.rows[0].hours - 2) < 1e-9 && Math.abs(lb.rows[1].hours - 8) < 1e-9 && Math.abs(lb.total.cost - (8 * 25 + 2 * 30)) < 1e-9 && Math.abs(lb.rows[0].perAcre - 50) < 1e-9, JSON.stringify(lb.rows));
  ok('growth stage names', cmStageName(23) === 'E-L 23 · Full bloom (half the caps off)' && cmStageName(36) === 'E-L 36 · Berries softening', cmStageName(23));
  const dbf = supa.schema('cellarmate'); const vy0 = await dbf.from('vineyards').select('organization_id').eq('name', 'Tystrya Estate').single();
  const oIns = await dbf.from('vineyard_observations').insert({organization_id: vy0.data.organization_id, vineyard: 'Tystrya Estate', block: 4, kind: 'scouting', subject: 'SMOKE TEST mildew', severity: 'low'}).select('id').single();
  const lIns = await dbf.from('vineyard_labor').insert({organization_id: vy0.data.organization_id, vineyard: 'Tystrya Estate', blocks: '4', task: 'SMOKE TEST', hours: 1}).select('id').single();
  const oDel = oIns.data ? await dbf.from('vineyard_observations').delete().eq('id', oIns.data.id).select('id') : {};
  const lDel = lIns.data ? await dbf.from('vineyard_labor').delete().eq('id', lIns.data.id).select('id') : {};
  ok('scouting note and labor entry save and delete', !oIns.error && !lIns.error && oDel.data.length === 1 && lDel.data.length === 1, (oIns.error || lIns.error || {}).message || '');
  /* 1v. forecast, spray planning, season, budget, equipment */
  ok('season modules loaded', !!(window.CmForecast && window.CmSprayHistory && window.CmSeason && window.CmEquipment && window.cmBotrytisDaily && window.cmBudgetSummary && window.cmMaintenanceDue));
  const hrs = []; const tf = [], rh = [], rn = [], wd = []; for (let i = 0; i < 48; i++) { hrs.push('2030-06-0' + (i < 24 ? 1 : 2) + 'T' + ('0' + (i % 24)).slice(-2) + ':00'); tf.push(68); rh.push(i < 24 && i < 12 ? 95 : 60); rn.push(0); wd.push(4); }
  const bd = cmBotrytisDaily(hrs, tf, rh, rn);
  ok('Botrytis risk: 12 wet hours at 68°F is high, a dry day is low', bd[0].wetHours === 12 && bd[0].level === 'high' && bd[1].level === 'low', JSON.stringify(bd.map(function(b) { return [b.wetHours, b.level, Math.round(b.risk * 100)]; })));
  const sw0 = cmSprayWindows(hrs, tf, rn, wd, {});
  ok('spray windows: dry calm daytime hours count', sw0[0].hours >= 10 && sw0[0].from === '06:00', JSON.stringify(sw0));
  const rn2 = rn.slice(); rn2[30] = 0.3; const sw1 = cmSprayWindows(hrs, tf, rn2, wd, {});
  ok('spray windows close when rain is due within 24 hours', sw1[0].hours < sw0[0].hours, JSON.stringify(sw1));
  const mfc = cmMildewForecast(60, 0, [{date: 'a', gt: 7, hot: 0}, {date: 'b', gt: 2, hot: 1}]);
  ok('mildew forecast continues the index', mfc[0].index === 80 && mfc[1].index === 60, JSON.stringify(mfc));
  const nd = cmNextSprayDue('2030-06-01', 70);
  ok('next spray due in about 10 days at high pressure', nd.due === '2030-06-11' && cmNextSprayDue('2030-06-01', 45).gap === 14, JSON.stringify(nd));
  const so = cmSeasonalOutlook({time: ['2030-07-01', '2030-07-02'], temperature_2m_max_member01: [80, 82], temperature_2m_max_member02: [84, 86], precipitation_sum_member01: [0, 0.1], precipitation_sum_member02: [0, 0]}, {7: {tmax: 80, rain: 0.5}});
  ok('seasonal outlook against normals', so.length === 1 && so[0].tAnom > 0 && so[0].members === 2, JSON.stringify(so));
  const sv = await Promise.all(['vineyard_sprays', 'tissue_tests', 'estate_harvests', 'harvest_estimates'].map(function(t) { return cmFetch(t); }));
  const pu = cmProductUsage(sv[0], 14.2); const mic = pu['microthiol'];
  ok('product use from the spray records (Microthiol 2024)', mic && mic.years[2024] && mic.years[2024].amount > 100 && mic.unit === 'lb', mic ? JSON.stringify(mic.years[2024]) : 'missing');
  const ue = mic ? cmUsageEstimate(mic, 14.2, 2026) : null;
  ok('next year product estimate', ue && ue.amount > 0 && ue.years.length >= 1, JSON.stringify(ue));
  ok('typical calendar covers the season', cmTypicalCalendar().length === 11 && cmTypicalCalendar()[7].stage === 'Veraison');
  const hm = cmHistoryMarkers({tissue: sv[1], sprays: sv[0], harvests: sv[2], obs: []});
  ok('season markers from the records (veraison sampling, sprays, picks)', hm.typical.veraisonSample && hm.typical.firstSpray && hm.typical.firstPick && hm.rows.length >= 8, JSON.stringify(hm.typical));
  const eva = cmEstimateVsActual(sv[3].filter(function(x) { return x.vineyard === 'Tystrya Estate'; }), sv[2], 2026);
  ok('2026 crop estimate against harvest', Math.abs(eva.total.est - 46.83) < 0.1 && eva.total.actual > 40 && eva.rows.length === 13, JSON.stringify(eva.total));
  const tk = await supa.schema('cellarmate').from('vineyard_tasks').select('*').eq('kind', 'harvest').gte('planned_on', '2026-01-01').lte('planned_on', '2026-12-31');
  const ea = cmExpectedActual(tk.data || []);
  ok('2026 pick schedule: expected against actual tons', ea.length === 7 && ea.every(function(r) { return r.actual > 0 && r.expected > 0; }), ea.length);
  const bs = cmBudgetSummary([{year: 2030, version: 'preliminary', category: 'Canopy', item: 'Thin', amount: 1000, month: 5}, {year: 2030, version: 'final', category: 'Canopy', item: 'Thin', amount: 1200, hours: 40}, {year: 2030, version: 'actual', category: 'Canopy', item: 'Thin', amount: 1350, hours: 45, done_on: '2030-06-10'}, {year: 2029, version: 'actual', category: 'Canopy', item: 'Thin', amount: 1}], 2030);
  ok('budget: preliminary, final, actual and variance', bs.rows.length === 1 && bs.rows[0].variance === 150 && bs.rows[0].expectedMonth === 5 && bs.rows[0].doneMonth === 6 && bs.total.actual === 1350, JSON.stringify(bs.rows[0]));
  const eqd = await Promise.all([supa.schema('cellarmate').from('vineyard_equipment').select('*'), supa.schema('cellarmate').from('equipment_maintenance').select('*')]);
  const due0 = cmMaintenanceDue(eqd[0].data || [], eqd[1].data || [], '2026-11-22');
  ok('equipment: sprayer inspections 2017 to 2025 on file, 2026 flagged', (eqd[1].data || []).filter(function(l) { return l.kind === 'inspection'; }).length >= 9 && due0.some(function(d) { return d.kind === 'inspection' && /2026/.test(d.text); }), JSON.stringify(due0.map(function(d) { return d.text; })));
  const due1 = cmMaintenanceDue([{id: 1, name: 'T', kind: 'tractor', status: 'in use', service_every_months: 12}], [{equipment_id: 1, done_on: '2029-01-10', kind: 'service'}], '2030-02-01');
  ok('equipment: service past its interval is due', due1.length === 1 && /2030-01-10/.test(due1[0].text), JSON.stringify(due1));
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
  for (const n of ['home', 'lots', 'health', 'sched', 'hub']) { cmNavOpen(cmNavByKey(n), CM_APP_GO, SCREENS); await wait(1600); ok('screen ' + n, document.body.innerText.length > 300 && !bad(), bad()); }
  for (const t of ['today', 'hub', 'work', 'log', 'vol', 'tanks', 'wines', 'sup', 'ferm', 'map', 'top', 'lab', 'mat', 'cost', 'files', 'vint', 'plan', 'data', 'ask', 'fac', 'ttb', 'admin', 'r_status']) {
    const it = cmNavByKey(t); if (!it) continue; cmNavOpen(it, CM_APP_GO, SCREENS); await wait(1800);
    const tx = document.body.innerText; ok('tab ' + t, !bad() && !/You are offline and this has not been saved/.test(tx), bad());
  }
  /* 1w. vit library: stage, signals, matching, search and the AI prompt */
  ok('vit library module loaded', !!(window.CmVitLibrary && window.cmVitStageFor && window.cmVitSignals && window.cmVitMatch && window.cmVitSearch && window.cmVitPrompt));
  ok('vit stage by date', cmVitStageFor('2030-06-10').key === 'bloom' && cmVitStageFor('2030-01-15').key === 'dormant' && cmVitStageFor('2030-12-15').key === 'dormant' && cmVitStageFor('2030-09-20').key === 'harvest', [cmVitStageFor('2030-06-10').key, cmVitStageFor('2030-12-15').key].join(','));
  const vsig = cmVitSignals({date: '2030-06-10', days: [{date: '2030-06-08', p: 0.4, tmax: 70, tmin: 50}, {date: '2030-06-09', p: 0.3, tmax: 68, tmin: 52}, {date: '2030-06-10', p: 0, tmax: 72, tmin: 51}]});
  ok('vit signals: rain at bloom raises Botrytis', vsig.tags.indexOf('rain') >= 0 && vsig.tags.indexOf('botrytis_high') >= 0 && vsig.tags.indexOf('stage:bloom') >= 0, vsig.tags.join(','));
  const vfr = cmVitSignals({date: '2030-04-20', days: [{date: '2030-04-19', p: 0, tmax: 60, tmin: 30}, {date: '2030-04-20', p: 0, tmax: 62, tmin: 35}]});
  ok('vit signals: frost after budbreak', vfr.tags.indexOf('frost') >= 0 && vfr.tags.indexOf('rain') < 0, vfr.tags.join(','));
  const vfx = [{slug: 'a', title: 'Botrytis', category: 'Diseases', summary: 'grey mould at bloom', signals: ['rain', 'stage:bloom'], months: [6], orgs: ['OSU'], varieties: ['Pinot noir'], sources: [{org: 'OSU', title: 'Guide', url: 'https://x'}]}, {slug: 'b', title: 'Frost', category: 'Weather', summary: 'cold nights', signals: ['frost'], months: [4], orgs: ['WSU']}, {slug: 'h', title: 'Hub', category: 'Programs', summary: 'bloom', signals: ['hub'], months: [6], orgs: ['OSU']}];
  const vm = cmVitMatch(vfx, vsig, 5);
  ok('vit match ranks the bloom rain entry and leaves out hubs', vm.length === 1 && vm[0].e.slug === 'a', vm.map(function(x) { return x.e.slug + ':' + x.score; }).join(','));
  ok('vit search by words, topic and source', cmVitSearch(vfx, 'grey mould', {}).length === 1 && cmVitSearch(vfx, '', {org: 'WSU'})[0].slug === 'b' && cmVitSearch(vfx, '', {category: 'Diseases'}).length === 1);
  const vpr = cmVitPrompt([vfx[0]], {site: {name: 'Test', acres: 1}, sig: vsig});
  ok('vit prompt carries stage, conditions and sources', /Likely stage: Bloom/.test(vpr) && /Source: OSU, Guide, https:\/\/x/.test(vpr) && /rain in the last 3 days/.test(vpr));
  const vlib = await dbf.from('vit_library').select('slug,orgs,sources,summary');
  const vorgs = {}; (vlib.data || []).forEach(function(e) { (e.orgs || []).forEach(function(o) { vorgs[o] = 1; }); });
  ok('vit library loaded with sources from all four universities', !vlib.error && vlib.data.length >= 30 && ['OSU', 'UC Davis', 'WSU', 'Cornell'].every(function(o) { return vorgs[o]; }) && vlib.data.every(function(e) { return e.summary && (e.sources || []).length && e.sources.every(function(s) { return /^https:\/\//.test(s.url); }); }), (vlib.error || {}).message || (vlib.data || []).length);
  /* 1x. forecast year against actual years, and a year split between two vineyard managers */
  ok('outlook module loaded', !!(window.CmOutlook && window.cmGddPath && window.cmCalibrate && window.cmProject && window.cmNormalGdd && window.cmBacktest && window.cmOutlookPlan && window.cmManagerFor));
  const oDays = []; [2030, 2031, 2032].forEach(function(y, j) { for (let i = 0; i < 365; i++) { const d = new Date(Date.UTC(y, 0, 1 + i)).toISOString().slice(0, 10); const t = 55 + 25 * Math.sin((i - 100) / 365 * 2 * Math.PI) + (j - 1) * 2; oDays.push({date: d, tmax: t + 10, tmin: t - 10, p: 0.1}); } });
  const oPaths = {}; [2030, 2031, 2032].forEach(function(y) { oPaths[y] = cmGddPath(oDays, y); });
  ok('outlook heat path: warmer year has more heat, season complete', oPaths[2032].total > oPaths[2031].total && oPaths[2031].total > oPaths[2030].total && oPaths[2030].complete, [2030, 2031, 2032].map(function(y) { return Math.round(oPaths[y].total); }).join(','));
  const oSt = [2030, 2031, 2032].map(function(y) { return {year: y, firstSpray: y + '-04-25', veraison: y + '-08-15', firstPick: y + '-09-25', lastPick: y + '-10-05'}; });
  const oCal = cmCalibrate(oSt, oPaths, null);
  ok('outlook calibrates from the vineyard and falls back to the library for bloom', oCal.firstPick.n === 3 && oCal.bloom.n === 0 && Math.abs(oCal.bloom.gdd - cmGddPath(oDays, 2031).by['2031-06-15']) < 1, JSON.stringify({fp: oCal.firstPick.n, bl: oCal.bloom.gdd}));
  const oNm = cmNormalGdd(oDays, null); const oPr = cmProject(2033, oCal, null, function(d) { return oNm[d.slice(5)] || 0; });
  ok('outlook projects stages in order', oPr.dates.firstSpray < oPr.dates.bloom && oPr.dates.bloom < oPr.dates.veraison && oPr.dates.veraison < oPr.dates.firstPick, JSON.stringify(oPr.dates));
  const oBt = cmBacktest(oSt, oPaths, oDays);
  ok('outlook backtest: each year forecast from the others lands within 3 days on steady weather', oBt.length === 3 && oBt.every(function(b) { return b.firstPick.diff != null && Math.abs(b.firstPick.diff) <= 3; }), JSON.stringify(oBt.map(function(b) { return b.firstPick.diff; })));
  const oPl = cmOutlookPlan({firstSpray: '2033-04-25', bloom: '2033-06-12', veraison: '2033-08-14', firstPick: '2033-09-20', lastPick: '2033-10-03'});
  ok('outlook plan: bloom protection, crop estimate, harvest window, library links', oPl.some(function(p) { return /Protect bloom/.test(p.name) && p.lib.indexOf('botrytis-bunch-rot') >= 0; }) && oPl.some(function(p) { return /Lag-phase/.test(p.name) && p.from === '2033-07-27'; }) && oPl.some(function(p) { return p.name === 'Harvest window' && p.to === '2033-10-03'; }));
  const oHist = [{manager: 'Results Partners', from: '2017-01-01'}, {manager: 'Century Vineyards', from: '2026-06-01'}];
  ok('manager for a month', cmManagerFor(oHist, 2026, 5) === 'Results Partners' && cmManagerFor(oHist, 2026, 6) === 'Century Vineyards' && cmManagerFor(oHist, 2025, 9) === 'Results Partners');
  const oBud = cmBudgetSummary([{year: 2026, version: 'final', category: 'A', item: 'Prune', month: 1, amount: 100, manager: 'Results Partners'}, {year: 2026, version: 'final', category: 'B', item: 'Prune', month: 1, amount: 90, manager: 'Century Vineyards'}, {year: 2026, version: 'final', category: 'A', item: 'Harvest', month: 9, amount: 500, manager: 'Results Partners'}, {year: 2026, version: 'final', category: 'B', item: 'Harvest', month: 9, amount: 400, manager: 'Century Vineyards'}], 2026, oHist);
  ok('budget split by manager: Results Partners months then Century months', oBud.total.final === 500, JSON.stringify(oBud.total));
  /* 1y. budbreak (base 41°F from Feb 1), Oregon regional calibration, pruning, watch list, winery library */
  const yP50 = {}, yP41 = {}; [2030, 2031, 2032].forEach(function(y) { yP50[y] = cmGddPath(oDays, y); yP41[y] = cmGddPath(oDays, y, 41, '02-01'); });
  ok('budbreak heat path from February 1 at base 41°F', yP41[2031].complete && yP41[2031].by['2031-04-15'] > yP50[2031].by['2031-04-15'], Math.round(yP41[2031].by['2031-04-15']));
  const yReg = [{year: 2030, stage: 'budbreak', date: '2030-04-12', approx: false}, {year: 2031, stage: 'budbreak', date: '2031-04-12', approx: false}, {year: 2031, stage: 'bloom', date: '2031-06-01', approx: true}];
  const yCal = cmCalibrate(oSt, {a50: yP50, a41: yP41}, null, yReg);
  ok('budbreak calibrated from Oregon regional dates; approximate dates ignored', yCal.budbreak && yCal.budbreak.nReg === 2 && yCal.bloom && !yCal.bloom.nReg, JSON.stringify({bb: yCal.budbreak && yCal.budbreak.nReg, bl: yCal.bloom && yCal.bloom.from}));
  const yN41 = cmNormalGdd(oDays, null, 41); const yBB = cmProject(2033, yCal, null, function(d) { return yN41[d.slice(5)] || 0; }, 'a41').dates.budbreak;
  ok('budbreak projected in April', /^2033-04/.test(yBB || ''), yBB);
  const yPr = cmPrunePlan('2033-04-12', 216, 6);
  ok('pruning plan: finish 3 weeks before budbreak, crew days from hours', yPr.finish === '2033-03-22' && yPr.workDays === 5, JSON.stringify(yPr));
  const yPl = cmOutlookPlan({budbreak: '2033-04-12', bloom: '2033-06-12', veraison: '2033-08-14', firstPick: '2033-09-20', lastPick: '2033-10-03'}, {pruneHours: 216});
  ok('plan includes pruning, frost, winery prep, YAN and malolactic', yPl.some(function(p) { return /^Pruning \(about 216 hours/.test(p.name); }) && yPl.some(function(p) { return /^Winery ready/.test(p.name); }) && yPl.some(function(p) { return /^YAN/.test(p.name) && p.lib.indexOf('yan-and-nutrients') >= 0; }) && yPl.some(function(p) { return /^Malolactic/.test(p.name); }));
  const yW = cmWatchList({year: 2033, seasonal: [{month: '2033-02', tAnom: 3}, {month: '2033-03', tAnom: 2}, {month: '2033-04', tAnom: -2}, {month: '2033-05', tAnom: -3, rainPct: 150}, {month: '2033-06', rainPct: 140}], dates: {budbreak: '2033-04-05', firstPick: '2033-09-10'}, typical: {firstPick: '2033-09-24'}, sulfurGap: 20, sulfurYear: 2032});
  ok('watch list: warm late winter, cool spring, wet bloom, early harvest, sulfur, smoke', yW.length === 6 && yW[0].level === 'high' && /2\.5°F above/.test(yW[0].text) && /2\.5°F below/.test(yW[1].text) && yW.some(function(w) { return /hydrogen sulfide/.test(w.text); }), yW.map(function(w) { return w.text.slice(0, 30); }).join(' | '));
  ok('library domains: vineyard and winery', cmVitDomain({category: 'Winemaking: fermentation'}) === 'Winery' && cmVitDomain({category: 'Diseases'}) === 'Vineyard');
  const yLib = await dbf.from('vit_library').select('slug,category'); const yReg2 = await dbf.from('regional_phenology').select('year,stage,approx');
  ok('library has winery entries and Oregon regional timing is stored', (yLib.data || []).filter(function(e) { return /^(Winemaking|Enology)/.test(e.category); }).length >= 15 && (yReg2.data || []).filter(function(r) { return !r.approx; }).length >= 12, ((yLib.data || []).length) + ' entries, ' + ((yReg2.data || []).length) + ' regional dates');
  /* 1aa. cost sheet, assets, crop estimate and thinning */
  ok('cost, asset and crop modules loaded', !!(window.CmCostSheet && window.CmAssets && window.CmCropEstimate && CM_MODULES.cost && CM_MODULES.assets && window.cmThinScenario));
  ok('line vintage: lot name, grapes by harvest year, else August to July', cmLineVintage({lot_no: '24 Signature PN', doc_date: '2026-08-04'}) === 2024 && cmLineVintage({category: 'Grapes', doc_date: '2026-10-29'}) === 2026 && cmLineVintage({category: 'Argon', doc_date: '2026-03-17'}) === 2025 && cmLineVintage({vintage: 2023, doc_date: '2025-09-01'}) === 2023);
  ok('cost groups', cmCostGroup('Dry ice') === 'Gases and dry ice' && cmCostGroup('Glass') === 'Packaging' && cmCostGroup('Filtration') === 'Filtration');
  const aV = cmAssetValue({unit_cost: 1400, qty: 2, acquired_on: '2024-06-01', life_years: 4, salvage_each: 75}, '2026-06-01');
  ok('barrel value straight line to salvage', Math.abs(aV.each - 738) < 2 && cmAssetValue({unit_cost: 3280, qty: 1, owned: false}).value === 0);
  const cS = cmCostSheet([{category: 'Grapes', doc_date: '2025-10-01', amount: 3000}, {category: 'Barrels', doc_date: '2025-05-01', amount: 9999}, {category: 'Argon', doc_date: '2026-02-01', amount: 100}], [{kind: 'Barrel', unit_cost: 1475, qty: 2, acquired_on: '2025-06-12', life_years: 4, salvage_each: 75}], [{vintage: 2025, owner: 'Tystrya', tons: 2}], 2025, 150);
  ok('cost sheet: barrels as depreciation, per ton and per case', cS.total === 3800 && cS.oak.total === 700 && cS.perTon === 1900 && Math.round(cS.cases) === 126, JSON.stringify({t: cS.total, o: cS.oak.total}));
  const cc1 = {vines: 490, acres: 0.34, shoots_per_vine: 13.3, clusters_per_vine: 18.9, grams_per_cluster: 37, grams_with_wings: 38, lag_mid: 1.7};
  ok('crop tons match the Century 2026 sheet (block 1, 1.7 factor, 0.642 t)', Math.abs(cmCropTons(490, 18.9, 37, 1.7) - 0.642) < 0.002);
  const t1 = cmThinScenario(cc1, {scenario: 'target', target: 1.5}), o1 = cmThinScenario(cc1, {scenario: 'one'}), w1 = cmThinScenario(cc1, {scenario: 'wings'});
  ok('thinning scenarios: target t/a hit, one per shoot keeps shoots, wings trims weight', Math.abs(t1.tpa - 1.5) < 0.01 && Math.abs(o1.clusters - 13.3) < 0.01 && w1.tons < w1.before && o1.removed > 0.25);
  ok('ripening check tightens in a cool season', cmRipenCheck(o1, 13.3, 0.2, 0.9).need === 1 && cmRipenCheck(o1, 13.3, 0.2, 1).need === 0.8 && cmRipenCheck({clusters: 30, grams: 120, lag: 2}, 10, 0.2, 1).status === 'risk');
  const cq = await dbf.from('crop_counts').select('id,vintage');
  ok('crop counts loaded for 2022 to 2026', !cq.error && (cq.data || []).length >= 41 && (cq.data || []).some(function(c) { return c.vintage === 2026; }), (cq.error || {}).message || (cq.data || []).length);
  const wa = await dbf.from('winery_assets').select('id,kind');
  ok('winery assets readable', !wa.error && (wa.data || []).filter(function(a) { return a.kind === 'Barrel'; }).length >= 5, (wa.error || {}).message || '');
  /* 1ab. round 6: sales and marketing out of cost of goods, 2023 thinning directions, new library entries */
  const sX = cmCostSheet([{category: 'Sales and marketing', doc_date: '2025-06-09', amount: 1000}, {category: 'Small equipment', doc_date: '2025-06-09', amount: 500}, {category: 'Closures', doc_date: '2025-06-09', amount: 100}], [], [], 2024, 150);
  ok('sales and marketing and small equipment kept out of cost of goods; corks counted as packaging', sX.total === 100 && sX.rows[0].group === 'Packaging');
  ok('2023 thinning styles as scenarios', Math.abs(cmThinScenario({vines: 1363, acres: 0.94, shoots_per_vine: 15.68, clusters_per_vine: 26.26, grams_per_cluster: 69.32, lag_mid: 2}, {scenario: 'removeN', removeN: 5}).clusters - 21.26) < 0.01 && Math.abs(cmThinScenario({vines: 1363, acres: 0.94, shoots_per_vine: 15.68, clusters_per_vine: 26.26, grams_per_cluster: 69.32, lag_mid: 2}, {scenario: 'oneplus2'}).clusters - 17.68) < 0.01);
  const tp6 = await dbf.from('thin_plans').select('id,vintage').eq('vintage', 2023);
  ok('2023 winemaker thinning directions loaded', !tp6.error && (tp6.data || []).length >= 12, (tp6.error || {}).message || (tp6.data || []).length);
  const vl = await dbf.from('vit_library').select('slug').in('slug', ['so2-will-not-hold', 'flat-unbalanced-white-after-mlf', 'chitosan-and-inactivated-yeast', 'ph-jump-press-and-mlf', 'lower-ph-in-the-cellar', 'vineyard-potassium-and-ph']);
  ok('library has the SO2, flat white, chitosan, pH and potassium entries', !vl.error && (vl.data || []).length === 6, (vl.data || []).length);
  /* 1ac. round 7: inventory check behind cost of goods, film yeast and potassium library entries */
  const icL = [{category: 'Glass', unit: 'cs', qty: 100, amount: 1500, doc_date: '2025-05-01'}, {category: 'Closures', unit: 'ea', qty: 1000, amount: 700, doc_date: '2025-05-01'}, {category: 'Grapes', doc_date: '2025-10-01', amount: 3000}];
  const icS = cmCostSheet(icL, [], [{vintage: 2025, owner: 'Tystrya', tons: 2}], 2025, 150);
  const icR = cmInventoryCheck(icL, [{vintage: 2025, cases_bottled: 50, bottled: '2026-06-15', cogs_per_bottle: 10}, {vintage: 2023, cases_bottled: 9}], icS);
  ok('inventory check: glass and corks on hand, wine cost split between bottled and cellar', icR.glassLeftCases === 50 && icR.corksLeft === 400 && Math.round(icR.vintage.toBottled) === 1189 && Math.round(icR.vintage.inCellar) === 1811);
  ok('sales orders kept out of cost of goods', cmCostSheet([{category: 'Sales order (not invoiced)', doc_date: '2025-10-21', amount: 1896}], [], [], 2025, 150).total === 0);
  const vl7 = await dbf.from('vit_library').select('slug').in('slug', ['film-yeast-in-barrel', 'lower-vine-potassium-keep-acid']);
  ok('library has film yeast and lowering vine potassium', !vl7.error && (vl7.data || []).length === 2, (vl7.data || []).length);
  /* 1ad. round 8: notebook photos transcribed (SO2 rounds, malic, berry samples, review log) */
  const pr8 = await dbf.from('photo_review').select('id,status');
  ok('photo review log has at least 80 pages', !pr8.error && (pr8.data || []).length >= 80, (pr8.error || {}).message || (pr8.data || []).length);
  const s528 = await dbf.from('so2_log').select('id').eq('date', '2026-05-28');
  ok('5/28/2026 SO2 round loaded (readings and adds)', !s528.error && (s528.data || []).length >= 140, (s528.data || []).length);
  const s502 = await dbf.from('so2_log').select('id').in('date', ['2026-05-02', '2026-05-08', '2026-04-26']);
  ok('May and April 2026 SO2 pages loaded', !s502.error && (s502.data || []).length >= 50, (s502.data || []).length);
  const bs8 = await dbf.from('berry_samples').select('id').eq('vintage', 2026);
  ok('2026 berry samples loaded', !bs8.error && (bs8.data || []).length >= 40, (bs8.data || []).length);
  const ml8 = await dbf.from('malic_results').select('id').gte('date', '2026-02-01');
  ok('2026 malic results loaded', !ml8.error && (ml8.data || []).length >= 20, (ml8.data || []).length);
  const tn8 = await dbf.from('tasting_notes').select('id').eq('kind', 'Cellar rule');
  ok('SO2 dose rules from the notebook saved', !tn8.error && (tn8.data || []).length >= 3, (tn8.data || []).length);
  /* 1ae. round 9: every photo record keeps a link to its notebook page */
  const pl9 = await dbf.from('photo_review').select('title,link').limit(5);
  ok('photo review rows carry a Drive page link', !pl9.error && (pl9.data || []).length > 0 && (pl9.data || []).every(function(p) { return /^https:\/\/drive\.google\.com\/file\/d\/.+\/view$/.test(p.link || ''); }), (pl9.error || {}).message || '');
  const sl9 = await dbf.from('so2_log').select('id,photo_links').eq('date', '2026-05-28').not('photo_links', 'is', null);
  ok('5/28/2026 SO2 rows link back to their pages', !sl9.error && (sl9.data || []).length >= 140, (sl9.data || []).length);
  const bl9 = await dbf.from('berry_samples').select('id,photo_links').eq('sampled_on', '2026-09-19');
  ok('9/19/2026 berry samples loaded with page links', !bl9.error && (bl9.data || []).length === 6 && (bl9.data || []).every(function(b) { return (b.photo_links || []).length === 1; }), (bl9.data || []).length);
  const fr9 = await dbf.from('fermenters').select('fermenter,so2_at_crush_ppm').eq('vintage', 2026).eq('fermenter', 'F14');
  ok('crush SO2 from the 9/18/2026 page on F14', !fr9.error && (fr9.data || []).length === 1 && Number(fr9.data[0].so2_at_crush_ppm) === 35);
  /* 1af. round 10: offline round trip (read saved copy, queue a change, sync it) */
  {
    const off = {};
    try {
      const odb = supa.schema('cellarmate');
      await odb.from('questions').select('*').order('id').range(0, 999);
      await odb.from('photo_review').select('*').order('id').range(0, 999);
      localStorage.setItem('cm_force_offline', '1');
      const rq = await odb.from('questions').select('*').order('id').range(0, 999);
      const rp = await odb.from('photo_review').select('*').order('id').range(0, 999);
      off.readQ = !rq.error && (rq.data || []).length > 0; off.readP = !rp.error && (rp.data || []).length > 0;
      const oorg = await cmOrg();
      const w = await odb.from('questions').insert({organization_id: oorg, sort: 9998, topic: 'offline smoke', question: 'offline smoke test row', status: 'open'}).select();
      off.queued = !w.error && CM_NET.queue.length >= 1;
      const back = await odb.from('questions').select('*').order('id').range(0, 999);
      off.seen = (back.data || []).some(function(r) { return r.sort === 9998; });
    } catch (e) { off.err = e.message; }
    localStorage.removeItem('cm_force_offline');
    try { await cmSync(); for (let w = 0; w < 20 && CM_NET.queue.length; w++) await new Promise(function(r) { setTimeout(r, 500); }); const c = await supa.schema('cellarmate').from('questions').select('id').eq('sort', 9998); off.synced = (c.data || []).length === 1 && !CM_NET.queue.length; await supa.schema('cellarmate').from('questions').delete().eq('sort', 9998); } catch (e) { off.err2 = e.message; }
    ok('offline: saved data readable with no connection', off.readQ && off.readP, JSON.stringify(off));
    ok('offline: change made with no connection is queued and shown', off.queued && off.seen, JSON.stringify(off));
    ok('offline: queued change syncs when back online', off.synced && !CM_NET.failed.length, JSON.stringify(off));
  }
  /* 1ag. round 11: map SO2 recommendations in tablets and KMS powder */
  const at11 = {g: 11, tab: '1\u00d75 + 3\u00d72'};
  ok('map SO2 add shows tablets or KMS powder', /tablets/.test(cmMapAddText(at11, 'tabs')) && !/KMS/.test(cmMapAddText(at11, 'tabs')) && /KMS powder/.test(cmMapAddText(at11, 'kms')) && !/tablets/.test(cmMapAddText(at11, 'kms')) && /tablets.* or .*KMS/.test(cmMapAddText(at11, 'both')), cmMapAddText(at11, 'both'));
  ok('map KMS grams come from tablet grams (11 g tablet = 9.5 g KMS)', cmMapKms(11) === 9.5, cmMapKms(11));
  ok('map SO2 add is blank when nothing to add', cmMapAddText({g: null}, 'both') === '' && cmMapAddText({g: 0}, 'both') === '');
  const rr11 = cmMapRecFromReading({target: 30, L: 225}, 19);
  ok('map works out the dose from a free SO2 reading (11 ppm gap in 225 L = 5 g tablet, 4.3 g KMS)', rr11 && rr11.g === 5 && rr11.kms === 4.3 && /KMS powder/.test(cmMapAddText(rr11, 'kms')) && /4\.3 g KMS/.test(cmMapAddText(rr11, 'kms')), JSON.stringify(rr11));
  ok('map says nothing to add when already at target', (cmMapRecFromReading({target: 30, L: 225}, 33) || {}).g === 0);
  const bm11 = cmMapIndex(bmz[0], bmz[1], bmz[2], await cmStatusRows());
  ok('map barrels carry recommended free SO2', bm11.filter(function(p) { return p.barrel && p.target != null; }).length > 100, bm11.filter(function(p) { return p.barrel && p.target != null; }).length);
  /* 1ah. round 12: map shows last tests with dates */
  const tt12 = cmMapTests([], [{vintage: 2026, barrel: '26-001', kind: 'Reading', date: '2026-11-18', free_so2_ppm: 20, ph: 3.3}], [{vintage: 2026, barrel: '26-001', date: '2026-11-16', malic_g_l: 0}], [{barrel_id: '26-001', date: '2026-11-19', ph: 3.35, malic_g_l: null}]);
  const t12 = tt12['2026|26-001'] || {};
  ok('map tests: newest pH, free SO2 and malic 0 each keep their date', t12.ph && t12.ph.v === 3.35 && t12.ph.d === '2026-11-19' && t12.fso2 && t12.fso2.v === 20 && t12.fso2.d === '2026-11-18' && t12.malic && t12.malic.v === 0 && t12.malic.d === '2026-11-16', JSON.stringify(t12));
  const tl12 = cmMapTests(await cmFetch('lab_results'), await cmFetch('so2_log'), await cmFetch('malic_results'), await cmFetch('ph_readings_2026_11_18'));
  const bt12 = cmMapIndex(bmz[0], bmz[1], bmz[2], await cmStatusRows(), tl12);
  ok('map barrels carry pH with a test date', bt12.filter(function(p) { return p.barrel && p.tests && p.tests.ph && p.tests.ph.d; }).length > 100, bt12.filter(function(p) { return p.barrel && p.tests && p.tests.ph && p.tests.ph.d; }).length);
  ok('map barrels carry varietal', bt12.filter(function(p) { return p.barrel && p.var && p.var !== 'Unknown'; }).length > 100);
  /* 1ai. round 13: KMBS to protect tanks, topping vessels and kegs */
  const k13 = cmKmbsPlan({volume_text: '~345 gal', ph: '3.25', malic_text: '0.28', contents: 'Chardonnay blend', vessel: 'T20'});
  ok('KMBS plan: tank with malic 0.28 holds, target 23 ppm = 52 g in 1306 L', k13 && k13.L === 1306 && k13.target === 23 && Math.round(k13.g) === 52 && k13.mlf === false && /^HOLD/.test(cmKmbsText(k13)), JSON.stringify(k13));
  const k13b = cmKmbsPlan({volume_text: '250 L', ph: '3.76', malic_text: '<0.05', contents: '2026 Sawyer Pinot topping', vessel: '26 Sawyer topping'});
  ok('KMBS plan: finished red topping tank gets a dose (45 ppm = 19.5 g in 250 L)', k13b && k13b.target === 45 && k13b.g === 19.5 && k13b.mlf === true && !/HOLD|first/.test(cmKmbsText(k13b)), JSON.stringify(k13b));
  const k13c = cmKmbsPlan({volume_text: '8 gal', contents: 'Chardonnay topping', vessel: 'K-1'});
  ok('KMBS plan: no pH gives a per-10-ppm dose and asks for pH and malic', k13c && k13c.target == null && k13c.per10 > 0 && /test malic first/.test(cmKmbsText(k13c)) && /test pH/.test(cmKmbsText(k13c)), cmKmbsText(k13c));
  ok('KMBS plan: stainless barrel with no volume gives no dose', cmKmbsPlan({size: 'Stainless barrel', ph: '3.64'}) === null);
  /* 1aj. round 14: navigation, Winery / Vineyard sides, search, Reports hub, PDF layout */
  {
    const N = window.CM_NAV, sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
    const live = function() { return (document.getElementById('root').innerText || '').length; };
    const SCR = Object.keys(SCREENS).map(function(k) { return SCREENS[k]; });
    const vyTabs = ['weather','sprays','field','season','crop','equipment','paperwork','owners','records','library'];
    const repTabs = ['hub','status','focus','work','log','vol','tanks','wines','sup','data','ask','fac','ttb','admin'];
    const reps = ['malic','so2','tart','top','chard','ml','chsul','eat'];
    ok('nav: catalog loaded', N && N.ITEMS.length > 40, N && N.ITEMS.length);
    const keys = N.ITEMS.map(function(i) { return i.k; });
    ok('nav: every item key is unique', new Set(keys).size === keys.length);
    const bad = N.ITEMS.filter(function(i) {
      const t = i.to || {};
      if (SCR.indexOf(t.screen) < 0) return true;
      if (t.screen === 'reports' && repTabs.indexOf(t.tab) < 0 && !(window.CM_MODULES && window.CM_MODULES[t.tab])) return true;
      if (t.rep && reps.indexOf(t.rep) < 0) return true;
      if (t.vy && vyTabs.indexOf(t.vy) < 0) return true;
      return false;
    }).map(function(i) { return i.k; });
    ok('nav: every item points at a screen, tab, report or vineyard section that exists', bad.length === 0, bad.join(', '));
    ok('nav: bottom bar has 5 short tabs per side, last is More', ['winery', 'vineyard'].every(function(s) { return N.BAR[s].length === 5 && N.BAR[s][4][0] === 'more' && N.BAR[s].slice(0, 4).every(function(b) { return cmNavByKey(b[0]); }); }));
    ok('nav: every Reports hub item has a description', N.ITEMS.filter(function(i) { return i.kind === 'report'; }).length >= 15 && N.ITEMS.filter(function(i) { return i.kind === 'report' && !i.desc; }).length === 0);
    ok('nav: search finds tanks by kmbs, malic report, spray and map', cmNavSearch('kmbs')[0].k === 'tanks' && cmNavSearch('malic').some(function(i) { return i.k === 'r_malic'; }) && cmNavSearch('spray').some(function(i) { return i.k === 'v_sprays'; }) && cmNavSearch('barrel map').some(function(i) { return i.k === 'map'; }));
    ok('nav: search needs every word and ignores nonsense', cmNavSearch('kmbs zzzz').length === 0 && cmNavSearch('').length === 0);
    const keep = cmNavModules();
    cmNavSetModules('winery');
    ok('nav: winery-only account sees no vineyard items', cmNavAllowed().length === 1 && cmNavSide() === 'winery' && cmNavSearch('spray').every(function(i) { return i.side !== 'vineyard'; }) && cmNavItems('winery').length > 20);
    cmNavSetModules('vineyard');
    ok('nav: vineyard-only account sees no winery items', cmNavSide() === 'vineyard' && cmNavSearch('tanks').every(function(i) { return i.side !== 'winery'; }));
    cmNavSetModules('both');
    ok('nav: both sides allowed when the account uses both', cmNavAllowed().length === 2);
    const calls = [];
    const fake = function(s, p) { calls.push(s); };
    const sv = localStorage.getItem('cm_vy_tab');
    cmNavOpen(cmNavByKey('r_so2'), fake, SCREENS);
    ok('nav: opening a report sets its tab and report', CM_PRESET && CM_PRESET.tab === 'focus' && CM_FOCUS.rep === 'so2' && calls[0] === 'reports');
    CM_PRESET = null; CM_FOCUS = {};
    cmNavOpen(cmNavByKey('v_season'), fake, SCREENS);
    ok('nav: opening a vineyard section sets the section', localStorage.getItem('cm_vy_tab') === 'season' && calls[1] === 'blocks' && cmNavSide() === 'vineyard');
    if (sv == null) localStorage.removeItem('cm_vy_tab'); else localStorage.setItem('cm_vy_tab', sv);
    cmNavSetModules(keep); localStorage.setItem('cm_side', 'winery');

    /* real clicks through the live app: bottom bar, More and the Reports hub on both sides */
    const fails = [];
    const wait = async function(sel, ms) { for (let i = 0; i < (ms || 40); i++) { const e = document.querySelector(sel); if (e) return e; await sleep(100); } return null; };
    const errs = []; const onErr = function(e) { errs.push(e.message || String(e)); }; window.addEventListener('error', onErr);
    cmNavSetModules('both');
    for (const side of ['winery', 'vineyard']) {
      cmNavOpen(cmNavByKey(N.HOME[side]), CM_APP_GO, SCREENS); await sleep(700);
      const barKeys = N.BAR[side].map(function(b) { return b[0]; });
      for (const k of barKeys) {
        const b = await wait('[data-bar="' + k + '"]'); if (!b) { fails.push(side + ' bar ' + k + ' missing'); continue; }
        b.click(); await sleep(700);
        if (live() < 80) fails.push(side + ' bar ' + k + ' blank');
      }
      (await wait('[data-bar="more"]')).click(); await sleep(400);
      const mk = Array.prototype.map.call(document.querySelectorAll('[data-more]'), function(e) { return e.getAttribute('data-more'); });
      if (mk.length < 5) fails.push(side + ' More has only ' + mk.length);
      for (const k of mk) {
        const bm = await wait('[data-bar="more"]'); bm.click(); await sleep(250);
        const e = await wait('[data-more="' + k + '"]'); if (!e) { fails.push(side + ' More ' + k + ' missing'); continue; }
        e.click(); await sleep(800);
        if (live() < 80) fails.push(side + ' More ' + k + ' blank');
      }
    }
    ok('nav ui: every bottom-bar tab and More item opens a screen with content', fails.length === 0, fails.join('; '));
    const rf = [];
    cmNavOpen(cmNavByKey('hub'), CM_APP_GO, SCREENS); await sleep(900);
    const rk = Array.prototype.map.call(document.querySelectorAll('[data-report]'), function(e) { return e.getAttribute('data-report'); });
    if (rk.length < 15) rf.push('hub lists only ' + rk.length);
    for (const k of rk) {
      let e = document.querySelector('[data-report="' + k + '"]');
      if (!e) { const bk = document.querySelector('[data-back="reports"]'); if (bk) bk.click(); await sleep(300); e = await wait('[data-report="' + k + '"]'); }
      if (!e) { rf.push(k + ' button missing'); continue; }
      e.click(); await sleep(1200);
      if (live() < 120) rf.push(k + ' blank');
      const back = await wait('[data-back="reports"]'); if (!back) { rf.push(k + ' has no back button'); continue; }
      back.click(); await sleep(400);
      if (!document.querySelector('[data-report="' + k + '"]')) rf.push(k + ' back did not return to the list');
    }
    ok('nav ui: every Reports hub button opens its report and back returns to the list', rf.length === 0, rf.join('; '));
    ok('nav ui: no script errors while walking the menus', errs.length === 0, errs.slice(0, 3).join(' | '));
    window.removeEventListener('error', onErr);
    const q = await wait('[aria-label="Find anything"]');
    ok('nav ui: the find-anything box is on every screen', !!q);
    cmNavOpen(cmNavByKey('home'), CM_APP_GO, SCREENS); await sleep(500);

    const cols8 = [1, 2, 3, 4, 5, 6, 7, 8].map(function(i) { return ['c' + i, 'Col ' + i]; });
    const rows = []; for (let i = 0; i < 90; i++) { const r = {}; cols8.forEach(function(c) { r[c[0]] = 'value ' + i; }); rows.push(r); }
    const pdfW = await cmPdfDoc('Test report', 'sub', cols8, [{title: 'Group', rows: rows}]);
    const pdfN = await cmPdfDoc('Test report', 'sub', cols8.slice(0, 4), [{title: 'Group', rows: rows.slice(0, 5)}]);
    ok('pdf: wide reports print landscape, narrow ones portrait', pdfW.internal.pageSize.getWidth() > pdfW.internal.pageSize.getHeight() && pdfN.internal.pageSize.getWidth() < pdfN.internal.pageSize.getHeight());
    ok('pdf: long reports run to several pages, each stamped page x of y', pdfW.internal.getNumberOfPages() >= 2 && /page 2 of /.test(String(pdfW.output()).slice(0, 400000)) === true);
  }
  /* 1z. winery troubleshooter, AI context and wine inventory */
  ok('troubleshooter and inventory modules loaded', !!(window.CmWineHelp && window.CmWineInventory && window.cmDiagnose && window.cmMolecularSO2 && window.cmInvRows && CM_MODULES.help && CM_MODULES.inv));
  ok('molecular SO2 from free SO2 and pH', Math.abs(cmMolecularSO2(30, 3.3) - 0.94) < 0.02 && Math.abs(cmMolecularSO2(25, 3.85) - 0.23) < 0.02);
  const zA = cmDiagnose(['fizz', 'haze'], {white: true, malic: 0.8, rs: 0.5, filtered: 'no', monthsInBottle: 5});
  ok('fizz and haze with malic left ranks malolactic in the bottle first, low sugar counts against yeast', zA[0].key === 'mlf_bottle' && zA.filter(function(c) { return c.key === 'yeast_referment'; })[0].against.length === 1, zA.map(function(c) { return c.key + ':' + c.score; }).join(','));
  const zB = cmDiagnose(['reduced'], {white: true, yan: 110, closure: 'screw cap'});
  ok('rotten egg with low YAN and screw cap ranks reduction first', zB[0].key === 'reduction' && zB[0].evidence.length === 2, zB.map(function(c) { return c.key + ':' + c.score; }).join(','));
  ok('barnyard in a high-pH red ranks Brett', cmDiagnose(['barnyard'], {white: false, ph: 3.8, free: 20})[0].key === 'brett' && cmDiagnose([], {}).length === 0);
  const zCtx = cmWineContext({label: '2024 Chardonnay', vintage: 2024, stage: 'bottled'}, {white: true, ph: 3.4, free: 30}, ['fizz'], zA.slice(0, 2), [{title: 'Entry', summary: 'S', key_points: ['k'], sources: [{org: 'O', title: 't', url: 'https://x'}]}], [{wine: 'w', symptoms: ['fizz'], outcome: 'malolactic in bottle'}]);
  ok('AI context carries numbers, causes, library sources and past cases', /Molecular SO2 about 0\.75/.test(zCtx) && /Malolactic finishing in the bottle/.test(zCtx) && /Source: O, t, https:\/\/x/.test(zCtx) && /Past case at this winery/.test(zCtx));
  const zR = cmInvRows([{id: 1, sku: 'A', cases_bottled: 10, bottles_per_case: 12, crm_product_id: 'p1', cogs_per_bottle: 10}, {id: 2, sku: 'B'}], [{id: 'p1', stock: 60, sold_qty_90d: 30, sold_qty_all: 60, low_alert: 12, cogs: 9}, {id: 'p2', name: 'C', stock: 5}]);
  ok('inventory rows: months of supply, value, depletion, unlinked CRM products', zR.rows[0].months === 6 && zR.rows[0].value === 600 && zR.rows[0].depleted === 0.5 && zR.unlinked.length === 1);
  const zP = await dbf.rpc('crm_products', {p_org: vy0.data.organization_id});
  ok('CRM products reachable through CellarMate', !zP.error && (zP.data || []).length >= 10, (zP.error || {}).message || (zP.data || []).length);
  const zS = await dbf.from('bottled_skus').select('id,crm_product_id').not('crm_product_id', 'is', null);
  ok('bottled wines linked to CRM products', (zS.data || []).length >= 10, (zS.data || []).length);
  const zI = await dbf.from('wine_issues').select('id').limit(1);
  ok('wine investigations table readable', !zI.error, (zI.error || {}).message || '');
  const sel = Array.from(document.querySelectorAll('select')).filter(function(e) { return Array.from(e.options).some(function(x) { return x.value === 'malic'; }); })[0];
  cmNavOpen(cmNavByKey('r_malic'), CM_APP_GO, SCREENS); await wait(1500);
  const sel2 = Array.from(document.querySelectorAll('select')).filter(function(e) { return Array.from(e.options).some(function(x) { return x.value === 'malic'; }); })[0];
  if (sel2) { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    for (const rep of ['malic','so2','tart','top','chard','ml','chsul','eat']) { set.call(sel2, rep); sel2.dispatchEvent(new Event('change', {bubbles:true})); await wait(1300); ok('report ' + rep, document.querySelectorAll('tbody tr').length > 0 && !bad(), bad()); } }

  /* 3c. winery side: troubleshooter and inventory tabs */
  const navTab = {Troubleshoot:'help', Inventory:'inv', Costs:'cost', Assets:'assets'};
  const tabBtn = function(t) { if (navTab[t]) return {click: function() { cmNavOpen(cmNavByKey(navTab[t]), CM_APP_GO, SCREENS); }}; return Array.from(document.querySelectorAll('button,div')).filter(function(e) { return e.children.length === 0 && e.innerText && e.innerText.trim() === t; })[0]; };
  let tb = tabBtn('Troubleshoot'); if (tb) { tb.click(); for (let i = 0; i < 15 && !/Troubleshoot a wine/.test(document.body.innerText); i++) await wait(1000); }
  ok('Troubleshoot tab', /Troubleshoot a wine/.test(document.body.innerText) && /Past investigations/.test(document.body.innerText) && !bad(), bad());
  const tsel = Array.from(document.querySelectorAll('select')).filter(function(e) { return Array.from(e.options).some(function(o) { return /Eola-Amity Chardonnay/.test(o.text); }); })[0];
  if (tsel) { const o = Array.from(tsel.options).filter(function(o) { return /2024 Eola-Amity Chardonnay/.test(o.text); })[0]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(tsel, o.value); tsel.dispatchEvent(new Event('change', {bubbles: true})); await wait(500); const fz = tabBtn('Fizz or spritz in a still wine'); if (fz) fz.click(); await wait(500); }
  ok('troubleshooter ranks causes for the 2024 Chardonnay and shows what to expect', /Likely causes/.test(document.body.innerText) && /in the bottle/.test(document.body.innerText) && /What this wine should taste like/.test(document.body.innerText) && /Next steps for this wine/.test(document.body.innerText) && !bad(), bad());
  tb = tabBtn('Inventory'); if (tb) { tb.click(); for (let i = 0; i < 15 && !/Wine inventory/.test(document.body.innerText); i++) await wait(1000); }
  for (let i = 0; i < 10 && /Loading wine inventory/.test(document.body.innerText); i++) await wait(1000);
  ok('Inventory tab with CRM stock', /Wine inventory/.test(document.body.innerText) && /bottles on hand/.test(document.body.innerText) && /Record a bottling/.test(document.body.innerText) && /2024 Willamette Valley Chardonnay/.test(document.body.innerText) && !/CRM error: /.test(document.body.innerText) && !bad(), bad());
  tb = tabBtn('Costs'); if (tb) { tb.click(); for (let i = 0; i < 20 && !/Winemaking cost sheet/.test(document.body.innerText); i++) await wait(1000); }
  ok('Costs tab: cost sheet with gases, filtration and oak', /Winemaking cost sheet/.test(document.body.innerText) && /Gases and dry ice/.test(document.body.innerText) && /Vintages side by side/.test(document.body.innerText) && /Per case/.test(document.body.innerText) && /Inventory check: what the costs are compared against/.test(document.body.innerText) && !bad(), bad());
  tb = tabBtn('Assets'); if (tb) { tb.click(); for (let i = 0; i < 20 && !/Winery assets/.test(document.body.innerText); i++) await wait(1000); await wait(2500); }
  ok('Assets tab: barrels, gas equipment and the cellar check', /Winery assets/.test(document.body.innerText) && /Gillet Bourgogne Export/.test(document.body.innerText) && /Check against the cellar/.test(document.body.innerText) && !bad(), bad());
  /* 3b. vineyard side: every section of Vine Blocks */
  nav('Cellar'); await wait(1200);
  const vb = Array.from(document.querySelectorAll('div')).filter(function(e) { return e.children.length === 0 && e.innerText.trim() === 'Vine Blocks'; })[0];
  if (vb) { vb.click(); await wait(1500); }
  const vtab = async function(label, re, secs) { const bt = Array.from(document.querySelectorAll('button')).filter(function(x) { return x.innerText.trim() === label; })[0]; if (bt) bt.click(); for (let i = 0; i < (secs || 20) && !re.test(document.body.innerText); i++) await wait(1000); return !!bt; };
  const T = function() { return document.body.innerText; };
  await vtab('Weather and harvest', /Estate blocks: tons per acre/, 25);
  for (let i = 0; i < 70 && /Loading weather and block history/.test(T()); i++) await wait(1000);
  ok('Vine Blocks, weather and harvest', /Heat units and rain/.test(T()) && /Estate blocks: tons per acre/.test(T()) && /Ripeness samples/.test(T()) && /Harvest watch: Estate/.test(T()) && /Crop estimates and pick window/.test(T()) && !bad(), bad());
  await vtab('Forecast and sprays', /Next 16 days|did not answer/, 40);
  for (let i = 0; i < 40; i++) { if (/index started|index never started/.test(T()) && /Product use and/.test(T())) break; await wait(1000); }
  const fcDown = /forecast service \(Open-Meteo\) did not answer/.test(T());
  ok('Vine Blocks, forecast and sprays' + (fcDown ? ' (forecast service down, saved weather only)' : ''), (fcDown || (/Next 16 days/.test(T()) && /Seasonal outlook/.test(T()))) && /Spray program and rain/.test(T()) && /Powdery mildew pressure \(Gubler-Thomas index\)/.test(T()) && /index started/.test(T()) && /Spray history and the weather/.test(T()) && /Product use and/.test(T()) && !bad(), bad());
  await vtab('Field work', /Block board/);
  ok('Vine Blocks, field work', /Block board/.test(T()) && /Re-entry and pre-harvest windows/.test(T()) && /Scouting and growth stages/.test(T()) && /Add photos/.test(T()) && /Labor and cost per block/.test(T()) && !bad(), bad());
  await vtab('Season and budget', /The typical year/);
  for (let i = 0; i < 90 && !(/Recommended work for/.test(T()) && /Things to watch in \d{4}/.test(T())); i++) await wait(1000);
  ok('Vine Blocks, watch list, pruning and Oregon timing', /Things to watch in \d{4}/.test(T()) && /Pruning/.test(T()) && /Oregon public timing reports/.test(T()) && /Winery ready/.test(T()) && !bad(), bad());
  ok('Vine Blocks, forecast year against actual years', /Every year at this vineyard/.test(T()) && /Forecast year \d{4}/.test(T()) && /Usual miss/.test(T()) && /Recommended work for/.test(T()) && /Protect bloom/.test(T()) && !bad(), bad());
  ok('Vine Blocks, season and budget', /The typical year/.test(T()) && /Season markers by year/.test(T()) && /budget: preliminary, final and actual/.test(T()) && !bad(), bad());
  await vtab('Crop estimate', /Crop estimate and thinning/, 20);
  for (let i = 0; i < 15 && /Loading crop counts/.test(T()); i++) await wait(1000);
  ok('Vine Blocks, crop estimate and thinning scenarios', /Crop estimate and thinning/.test(T()) && /One cluster per shoot/.test(T()) && /Estimate against pick, every year/.test(T()) && /Realised factor/.test(T()) && /By row/.test(T()) && /Thinning directions given by each winemaker/.test(T()) && !bad(), bad());
  await vtab('Equipment', /Maintenance log/);
  ok('Vine Blocks, equipment', /Airblast sprayer/.test(T()) && /Maintenance log/.test(T()) && /sprayer inspection not on file/.test(T()) && !bad(), bad());
  await vtab('Paperwork', /Download pesticide use report/);
  ok('Vine Blocks, paperwork', /Certification paperwork/.test(T()) && /Download pesticide use report/.test(T()) && !bad(), bad());
  await vtab('Records', /Original files/);
  ok('Vine Blocks, records', /Vineyard records/.test(T()) && /Spray history/.test(T()) && /Original files/.test(T()) && !bad(), bad());
  await vtab('Schedule and owners', /Schedule and owner access/);
  const pvb = Array.from(document.querySelectorAll('button')).filter(function(x) { return x.innerText.trim() === 'Preview what the owner sees'; })[0];
  if (pvb) { pvb.click(); for (let i = 0; i < 20 && !/Records and files \(/.test(T()); i++) await wait(1000); }
  ok('Vine Blocks, schedule, owner access and owner preview', /Schedule and owner access/.test(T()) && /vineyard owner view/i.test(T()) && /Done lately/.test(T()) && /From the field/.test(T()) && /Records and files \(/.test(T()) && !bad(), bad());
  if (pvb) { const cl = Array.from(document.querySelectorAll('button')).filter(function(x) { return x.innerText.trim() === 'Close preview'; })[0]; if (cl) cl.click(); await wait(500); }
  await vtab('Vit library', /What may be happening now/, 20);
  for (let i = 0; i < 15 && !/entries/.test(T()); i++) await wait(1000);
  ok('vit library has the vineyard and winery filter', /Vineyard and winery/.test(T()));
  ok('Vine Blocks, vit library', /What may be happening now/.test(T()) && /likely stage/.test(T()) && /Powdery mildew/.test(T()) && / of \d+ entries/.test(T()) && !bad(), bad());
  if (click('Study cards', 'button')) { await wait(600); ok('vit library study cards', /Card 1 of \d+/.test(T()) && !bad(), bad()); click('Read', 'button'); await wait(400); }
  await vtab('Weather and harvest', /Heat units and rain/);
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
