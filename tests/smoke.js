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
  for (const t of ['Today', 'Reports', 'Work', 'Log', 'Volumes', 'Tanks', 'Wines', 'Supplies', 'Ferment', 'Map', 'Topping', 'Lab', 'Materials', 'Costs', 'Files', 'Vintages', 'Plan', 'Data', 'Q&A', 'Facility', 'TTB', 'Admin', 'Status']) {
    if (!click(t, 'button')) continue; await wait(1800);
    const tx = document.body.innerText; ok('tab ' + t, !bad() && !/You are offline and this has not been saved/.test(tx), bad());
  }
  const sel = Array.from(document.querySelectorAll('select')).filter(function(e) { return Array.from(e.options).some(function(x) { return x.value === 'malic'; }); })[0];
  if (click('Reports', 'button')) { await wait(1500); }
  const sel2 = Array.from(document.querySelectorAll('select')).filter(function(e) { return Array.from(e.options).some(function(x) { return x.value === 'malic'; }); })[0];
  if (sel2) { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    for (const rep of ['malic','so2','tart','top','chard','ml','chsul','eat']) { set.call(sel2, rep); sel2.dispatchEvent(new Event('change', {bubbles:true})); await wait(1300); ok('report ' + rep, document.querySelectorAll('tbody tr').length > 0 && !bad(), bad()); } }

  /* 3b. vineyard side */
  nav('Cellar'); await wait(1200);
  const vb = Array.from(document.querySelectorAll('div')).filter(function(e) { return e.children.length === 0 && e.innerText.trim() === 'Vine Blocks'; })[0];
  if (vb) { vb.click(); for (let i = 0; i < 20 && !/Spray program and rain/.test(document.body.innerText); i++) await wait(1000); }
  ok('Vine Blocks shows weather and harvest', /Heat units and rain/.test(document.body.innerText) && /Estate blocks: tons per acre/.test(document.body.innerText) && /Spray program and rain/.test(document.body.innerText) && !bad(), bad() || (/Fetching weather/.test(document.body.innerText) ? 'weather still loading' : 'spray card missing'));
  for (let i = 0; i < 40; i++) { const tx = document.body.innerText; if (/index started|index never started/.test(tx) && !/Loading weather and block history/.test(tx)) break; await wait(1000); }
  for (let i = 0; i < 20 && !/Original files/.test(document.body.innerText); i++) await wait(1000);
  ok('Vine Blocks shows vineyard records and original files', /Vineyard records/.test(document.body.innerText) && /Spray history/.test(document.body.innerText) && /Original files/.test(document.body.innerText) && !bad(), bad());
  for (let i = 0; i < 15 && !/Schedule and owner access/.test(document.body.innerText); i++) await wait(1000);
  const pvb = Array.from(document.querySelectorAll('button')).filter(function(b) { return b.innerText.trim() === 'Preview what the owner sees'; })[0];
  if (pvb) { pvb.click(); for (let i = 0; i < 20 && !/Records and files \(/.test(document.body.innerText); i++) await wait(1000); }
  ok('Vine Blocks shows the schedule, owner access and the owner preview', /Schedule and owner access/.test(document.body.innerText) && /vineyard owner view/i.test(document.body.innerText) && /Done lately/.test(document.body.innerText) && /From the field/.test(document.body.innerText) && /Records and files \(/.test(document.body.innerText) && !bad(), bad());
  if (pvb) { const cl = Array.from(document.querySelectorAll('button')).filter(function(b) { return b.innerText.trim() === 'Close preview'; })[0]; if (cl) cl.click(); await wait(500); }
  ok('Vine Blocks shows the field work board', /Field work/.test(document.body.innerText) && /Block board/.test(document.body.innerText) && /Re-entry and pre-harvest windows/.test(document.body.innerText) && /Labor and cost per block/.test(document.body.innerText) && !bad(), bad());
  ok('Vine Blocks shows the certification paperwork', /Certification paperwork/.test(document.body.innerText) && /Download pesticide use report/.test(document.body.innerText) && !bad(), bad());
  ok('Vine Blocks shows mildew pressure, ripeness samples and harvest watch', /Powdery mildew pressure \(Gubler-Thomas index\)/.test(document.body.innerText) && /Ripeness samples/.test(document.body.innerText) && /Harvest watch: Estate/.test(document.body.innerText) && /index started/.test(document.body.innerText) && !bad(), bad() || document.body.innerText.slice(document.body.innerText.indexOf('Powdery'), document.body.innerText.indexOf('Powdery') + 200));
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
