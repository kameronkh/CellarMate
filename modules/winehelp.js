/* CellarMate module: Troubleshoot a wine (the library on the winery side)
   - Pick a wine (a bottled SKU or a lot in the cellar), tick what is off (smell, look, taste, fizz),
     and check or enter the numbers (pH, SO2, VA, malic, sugar, YAN). The page ranks the likely
     causes, shows the evidence for and against each one from the wine's own data, the quick tests
     that tell them apart, what to do, and the library entries and university sources to read.
   - Shows what the wine should taste like (so a newer winemaker can tell style from fault) and the
     next steps for the wine's stage.
   - Ask the library: sends the wine data, the ranked causes, the matched library entries and this
     winery's past cases to the cellarmate-ask function (paid plans; usage logged at cost). Without
     AI it builds the same context to copy into any assistant.
   - Every investigation can be saved with its outcome, so later problems start from this winery's
     own history.
   Registers in CM_MODULES as 'Troubleshoot'. Pure helpers on window for the smoke tests:
   cmMolecularSO2, cmDiagnose, cmWineSymptoms, cmNextSteps, cmWineContext. */
(function () {
  'use strict';
  var ORG = '762fc809-0341-4ee2-834f-16e707181ea7';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function db() { return supa.schema('cellarmate'); }

  var SYMPTOMS = [
    ['Smell', 'reduced', 'Rotten egg, cabbage, rubber, onion'], ['Smell', 'flinty', 'Struck match, flint'], ['Smell', 'vinegar', 'Vinegar or nail polish'],
    ['Smell', 'barnyard', 'Barnyard, band-aid, sweaty saddle'], ['Smell', 'oxidized', 'Bruised apple, sherry, nutty'], ['Smell', 'musty', 'Musty, wet cardboard'],
    ['Smell', 'buttery', 'Butter, butterscotch'], ['Smell', 'smoky', 'Smoky, ashy, campfire'], ['Smell', 'geranium', 'Geranium, crushed leaves'],
    ['Smell', 'cooked', 'Cooked, jammy, caramel'], ['Smell', 'muted', 'Muted or closed'],
    ['Look', 'haze', 'Haze or cloudy'], ['Look', 'crystals', 'Crystals or flakes'], ['Look', 'fizz', 'Fizz or spritz in a still wine'],
    ['Look', 'browning', 'Darker or browning'], ['Look', 'pushed', 'Pushed or leaking corks'], ['Look', 'sediment', 'Sediment that swirls up'],
    ['Taste', 'mousy', 'Mousy or cracker aftertaste'], ['Taste', 'sour', 'Sharper or more sour than before'], ['Taste', 'sweet', 'Sweeter than expected'],
    ['Taste', 'bitter', 'Bitter'], ['Taste', 'flat', 'Flat, dull, fruit fading'],
    ['Pattern', 'some_bottles', 'Only some bottles'], ['Pattern', 'all_bottles', 'Every bottle'], ['Pattern', 'after_air', 'Gets better with air']
  ];
  function cmWineSymptoms() { return SYMPTOMS.map(function (s) { return { group: s[0], key: s[1], label: s[2] }; }); }

  /* molecular SO2 from free SO2 and pH */
  function cmMolecularSO2(free, ph) { if (free == null || ph == null) return null; return free / (1 + Math.pow(10, ph - 1.81)); }

  /* the causes: symptoms that point to each, data checks for and against, tests, actions, library */
  var CAUSES = [
    { key: 'reduction', title: 'Reduction (sulfur compounds)', sym: ['reduced', 'flinty', 'after_air', 'muted'], lib: ['reduction-sulfides', 'h2s-and-sulfur-residue', 'yan-and-nutrients'],
      why: 'Yeast made hydrogen sulfide or mercaptans (low nitrogen, sulfur residue on fruit, long lees contact) and the low-oxygen bottle keeps them.',
      tests: ['Swirl or decant: does it fade?', 'Copper bench test on a sample', 'Ask the lab for a sulfide panel'], actions: ['Aerate or splash rack wine still in tank or barrel', 'Copper only after a bench trial and within legal limits', 'For bottled wine, decide with the lab whether to sell, rework or hold'],
      data: function (d, add) { if (d.yan != null) add(d.yan < 150, 'YAN was ' + d.yan + ' mg/L (low nitrogen raises sulfide risk)', 'YAN was ' + d.yan + ' mg/L (adequate)'); if (d.closure === 'screw cap') add(true, 'Screw cap: very low oxygen after bottling favors reduction'); if (d.sulfurLate) add(true, 'Last elemental sulfur spray was close to harvest'); } },
    { key: 'oxidation', title: 'Oxidation', sym: ['oxidized', 'browning', 'flat', 'some_bottles'], lib: ['oxidation', 'so2-molecular'],
      why: 'Oxygen turned some ethanol into acetaldehyde and browned the wine, usually from low free SO2, oxygen picked up at bottling or a leaky closure.',
      tests: ['Free and total SO2 and color on a bad and a good bottle', 'Fill height and closure lot of bad bottles'], actions: ['Raise SO2 by pH in wine not yet bottled', 'Flush bottles with inert gas and check fill heights at the next bottling', 'Sell affected stock first or pull the worst bottles'],
      data: function (d, add) { var m = cmMolecularSO2(d.free, d.ph); if (m != null) add(m < (d.white ? 0.6 : 0.4), 'Molecular SO2 about ' + m.toFixed(2) + ' mg/L (' + (d.white ? 'target about 0.8 for whites' : 'target about 0.5 for reds') + ')', 'Molecular SO2 about ' + m.toFixed(2) + ' mg/L (protective)'); if (d.white) add(true, 'White wines show oxidation first'); } },
    { key: 'yeast_referment', title: 'Yeast fermenting leftover sugar in the bottle', sym: ['fizz', 'haze', 'sediment', 'pushed', 'sweet'], lib: ['refermentation-in-bottle', 'haze-and-deposits'],
      why: 'Live yeast in the bottle are fermenting residual sugar, making CO2 (spritz), haze and sometimes pushed corks.',
      tests: ['Residual sugar (glucose plus fructose) on a bottle against the pre-bottling number', 'Microscope or plating for yeast', 'Dissolved CO2'], actions: ['Hold shipments of affected lots', 'Store cold to slow activity', 'Future lots: absolute 0.45 micron sterile filtration and SO2 by pH before bottling'],
      data: function (d, add) { if (d.rs != null) add(d.rs >= 1.6, 'Residual sugar ' + d.rs + ' g/L: enough to make a noticeable spritz', 'Residual sugar ' + d.rs + ' g/L: low, less likely'); if (d.filtered === 'no') add(true, 'Not sterile filtered'); if (d.filtered === 'yes') add(false, null, 'Sterile filtered (lowers the chance)'); } },
    { key: 'mlf_bottle', title: 'Malolactic finishing in the bottle', sym: ['fizz', 'haze', 'buttery', 'sour', 'mousy', 'sediment'], lib: ['refermentation-in-bottle', 'malolactic', 'buttery-diacetyl'],
      why: 'Lactic bacteria are converting leftover malic acid in the bottle, making CO2, haze and buttery or sour notes.',
      tests: ['Malic acid on a bottle (paper chromatography or enzymatic)', 'Microscope or plating for bacteria'], actions: ['Hold shipments of affected lots', 'Future lots: confirm malic is gone (or block malolactic deliberately) and sterile filter before bottling', 'Do not use sorbate to fix bacteria'],
      data: function (d, add) { if (d.malic != null) add(d.malic >= 0.3, 'Malic acid ' + d.malic + ' g/L left: bacteria can still make CO2', 'Malic acid ' + d.malic + ' g/L: essentially done'); if (d.mlf === 'no') add(true, 'Malolactic not recorded as complete'); if (d.mlf === 'yes') add(false, null, 'Malolactic recorded as complete'); if (d.white) add(true, 'Chardonnay is sometimes bottled with partial malolactic'); } },
    { key: 'brett', title: 'Brettanomyces', sym: ['barnyard', 'smoky', 'mousy', 'all_bottles'], lib: ['brettanomyces', 'so2-molecular'],
      why: 'Brett yeast made 4-ethylphenol and 4-ethylguaiacol, usually in reds at high pH with low molecular SO2 and older barrels.',
      tests: ['Brett test (PCR or plating)', '4-ethylphenol and 4-ethylguaiacol at a lab'], actions: ['Raise SO2 by pH', 'Clean or retire affected barrels', 'Sterile filter at bottling'],
      data: function (d, add) { if (d.ph != null) add(d.ph >= 3.6, 'pH ' + d.ph + ': high pH favors Brett', 'pH ' + d.ph + ': lower pH protects'); var m = cmMolecularSO2(d.free, d.ph); if (m != null) add(m < 0.4, 'Molecular SO2 about ' + m.toFixed(2) + ' mg/L (low)', null); if (d.white) add(false, null, 'Brett is much less common in whites'); } },
    { key: 'va', title: 'Volatile acidity (acetic acid, ethyl acetate)', sym: ['vinegar', 'sour'], lib: ['volatile-acidity', 'sour-rot'],
      why: 'Acetic acid bacteria (or stressed yeast) made acetic acid and ethyl acetate, often from damaged fruit, air contact or slow ferments.',
      tests: ['VA at a lab'], actions: ['Keep vessels topped and SO2 up', 'Blend if under the legal limit; above it the wine cannot be sold as wine'],
      data: function (d, add) { if (d.va != null) { var lim = d.white ? 1.2 : 1.4; add(d.va >= 0.8, 'VA ' + d.va + ' g/L (legal limit about ' + lim + ' g/L as acetic)', 'VA ' + d.va + ' g/L (normal range)'); } } },
    { key: 'mousy', title: 'Mousy taint', sym: ['mousy'], lib: ['mousy-taint'], why: 'Lactic bacteria or Brett made mousy compounds, more likely at low SO2 and low acidity.',
      tests: ['Taste and wait 15 to 30 seconds; several tasters (many cannot detect it)'], actions: ['Protect with SO2 by pH; it usually fades slowly but cannot be removed easily'],
      data: function (d, add) { var m = cmMolecularSO2(d.free, d.ph); if (m != null) add(m < 0.4, 'Low molecular SO2 (' + m.toFixed(2) + ' mg/L)', null); if (d.ph != null) add(d.ph >= 3.6, 'High pH ' + d.ph, null); } },
    { key: 'tca', title: 'Cork taint (TCA)', sym: ['musty', 'muted', 'some_bottles'], lib: ['cork-taint'], why: 'Haloanisoles (TCA and related) from a cork or the winery give a musty, muting smell.',
      tests: ['Compare several bottles; one bad bottle points to the cork', 'TCA test at a lab'], actions: ['Replace affected bottles; if every bottle is musty, check barrels, hoses and cellar air'],
      data: function (d, add) { if (d.closure) add(d.closure === 'natural cork' || d.closure === 'technical cork', 'Closure: ' + d.closure, d.closure === 'screw cap' ? 'Screw cap: cork taint unlikely' : null); } },
    { key: 'protein', title: 'Protein haze', sym: ['haze'], lib: ['protein-and-cold-stability', 'haze-and-deposits'], why: 'Grape proteins in a white or rosé clump into haze after warm storage when bentonite fining was not enough.',
      tests: ['Heat test on a bottle sample'], actions: ['Bentonite trials and fining for wine not yet bottled', 'Keep bottled stock cool'],
      data: function (d, add) { add(!!d.white, d.white ? 'White wine (protein haze is a white and rosé problem)' : null, d.white ? null : 'Red wines rarely show protein haze'); if (d.warm) add(true, 'Stored warm'); } },
    { key: 'tartrate', title: 'Tartrate crystals', sym: ['crystals', 'sediment'], lib: ['protein-and-cold-stability', 'haze-and-deposits'], why: 'Potassium bitartrate dropped out when the wine got cold. Harmless and tasteless.',
      tests: ['Crystals dissolve slowly when warmed; cold stability test'], actions: ['Explain to buyers; cold stabilize future lots if it matters for the market'], data: function () {} },
    { key: 'diacetyl', title: 'Diacetyl from malolactic', sym: ['buttery'], lib: ['buttery-diacetyl', 'malolactic'], why: 'Bacteria made diacetyl during malolactic. A style choice in Chardonnay; too much tastes heavy.',
      tests: ['Taste against a reference; lab diacetyl if needed'], actions: ['For wine still on lees: stir lees after malolactic to lower diacetyl'],
      data: function (d, add) { if (d.mlf === 'no') add(true, 'Malolactic was not meant to be complete: bacteria may be active'); } },
    { key: 'geranium', title: 'Geranium taint (sorbate plus bacteria)', sym: ['geranium'], lib: ['refermentation-in-bottle'], why: 'Lactic bacteria broke down sorbic acid into a geranium-smelling compound.',
      tests: ['Check whether sorbate was added'], actions: ['Do not use sorbate in wines with bacteria or after malolactic'], data: function () {} },
    { key: 'heat', title: 'Heat damage', sym: ['cooked', 'pushed', 'browning', 'flat'], lib: ['oxidation'], why: 'Warm storage or shipping cooked the fruit and pushed corks.',
      tests: ['Storage and shipping temperatures; compare with bottles kept cool'], actions: ['Keep stock at a steady cool temperature; pull damaged cases'],
      data: function (d, add) { if (d.warm) add(true, 'Stored or shipped warm'); } },
    { key: 'smoke', title: 'Smoke exposure', sym: ['smoky', 'bitter'], lib: ['wildfire-smoke'], why: 'Smoke compounds taken up by the grapes before harvest release ashy, smoky flavors, sometimes growing after bottling.',
      tests: ['Guaiacol, 4-methylguaiacol and bound smoke compounds at a lab'], actions: ['Talk with the lab about blending or treatment options'], data: function () {} },
    { key: 'young', title: 'Bottle shock or a closed young wine', sym: ['muted', 'flat', 'after_air'], lib: ['how-to-investigate-a-wine'], why: 'Recently bottled wines can taste muted for weeks to months after the oxygen and handling of bottling.',
      tests: ['Taste again in a few weeks; compare with tank or barrel samples if any are left'], actions: ['Wait before releasing or judging'],
      data: function (d, add) { if (d.monthsInBottle != null) add(d.monthsInBottle < 3, 'Bottled ' + d.monthsInBottle + ' months ago', 'Bottled ' + d.monthsInBottle + ' months ago (past the usual bottle shock window)'); } }
  ];

  /* rank causes: matched symptoms 3 points each, data for +2, data against -3 */
  function cmDiagnose(symptoms, d) {
    d = d || {}; var S = symptoms || [];
    return CAUSES.map(function (c) {
      var hit = c.sym.filter(function (s) { return S.indexOf(s) >= 0; });
      var forE = [], against = [];
      c.data(d, function (cond, yes, no) { if (cond && yes) forE.push(yes); else if (!cond && no) against.push(no); });
      var score = hit.length * 3 + (hit.length ? forE.length * 2 - against.length * 3 : 0);
      return { key: c.key, title: c.title, why: c.why, tests: c.tests, actions: c.actions, lib: c.lib, matched: hit, evidence: forE, against: against, score: score };
    }).filter(function (x) { return x.matched.length && x.score > 0; }).sort(function (a, b) { return b.score - a.score; });
  }

  /* next steps by where the wine is, for a newer winemaker */
  function cmNextSteps(stage, white) {
    var S = {
      ferment: ['Daily Brix and temperature; YAN at the start and split nutrient additions', 'Smell every day for rotten egg (add nutrients early, aerate)', 'Keep whites cool (about 55 to 65°F), reds warmer for extraction'],
      mlf: ['Keep the wine warm enough (about 64 to 72°F) with low SO2', 'Check malic acid every 2 to 3 weeks', 'Top barrels; watch for vinegar or film on the surface'],
      aging: ['SO2 by pH as soon as malolactic is done, then monthly free SO2 checks', 'Top every 2 to 4 weeks', white ? 'Stir lees if reductive; taste each barrel monthly' : 'Taste barrels monthly; Brett test older barrels'],
      prebottle: ['Full panel: free and total SO2, pH, VA, residual sugar, malic acid, dissolved CO2', white ? 'Heat test and bentonite trials; cold stability if needed' : 'Brett test; filter decision', 'Sterile filtration (absolute 0.45 micron) if any sugar or malic remains; flush bottles with inert gas'],
      bottled: ['Store cool and steady; open a bottle every month or two and note changes', 'Watch for fizz, haze or pushed corks in the first months', 'Keep a few bottles from each bottling as references']
    };
    return S[stage] || S.aging;
  }

  /* the text sent to the AI (or copied): wine data, ranked causes with evidence, library notes, past cases */
  function cmWineContext(w, d, symptoms, causes, lib, past) {
    var L = ['Wine: ' + w.label + (w.vintage ? ' (' + w.vintage + ')' : '') + '. Type: ' + (d.white ? 'white' : 'red or rosé') + '. Stage: ' + (w.stage || 'unknown') + '.'];
    if (w.extra) L.push(w.extra);
    var nums = [['pH', d.ph], ['TA g/L', d.ta], ['VA g/L', d.va], ['free SO2 mg/L', d.free], ['total SO2 mg/L', d.total], ['malic g/L', d.malic], ['residual sugar g/L', d.rs], ['YAN mg/L', d.yan]].filter(function (x) { return x[1] != null; });
    if (nums.length) L.push('Numbers: ' + nums.map(function (x) { return x[0] + ' ' + x[1]; }).join(', ') + '.');
    var m = cmMolecularSO2(d.free, d.ph); if (m != null) L.push('Molecular SO2 about ' + m.toFixed(2) + ' mg/L.');
    L.push('Closure: ' + (d.closure || 'unknown') + '. Sterile filtered: ' + (d.filtered || 'unknown') + '. Malolactic complete: ' + (d.mlf || 'unknown') + '.' + (d.monthsInBottle != null ? ' Months in bottle: ' + d.monthsInBottle + '.' : ''));
    L.push('What is off: ' + (symptoms.length ? symptoms.map(function (k) { var s = SYMPTOMS.filter(function (x) { return x[1] === k; })[0]; return s ? s[2] : k; }).join('; ') : 'not specified') + '.');
    if (d.notes) L.push('Winemaker notes: ' + d.notes);
    if (causes.length) { L.push(''); L.push('Ranked likely causes from the CellarMate rules:'); causes.forEach(function (c, i) { L.push((i + 1) + '. ' + c.title + ' (score ' + c.score + '). For: ' + (c.evidence.join('; ') || 'symptoms only') + '. Against: ' + (c.against.join('; ') || 'none') + '.'); }); }
    (past || []).forEach(function (p) { L.push('Past case at this winery: ' + p.wine + ' (' + (p.symptoms || []).join(', ') + '): ' + (p.outcome || 'no outcome recorded') + '.'); });
    (lib || []).forEach(function (e) { L.push(''); L.push('Library: ' + e.title); L.push(e.summary || ''); (e.key_points || []).forEach(function (k) { L.push('- ' + k); }); (e.sources || []).forEach(function (s) { L.push('  Source: ' + s.org + ', ' + s.title + ', ' + s.url); }); });
    return L.join('\n');
  }

  /* ask the library through the cellarmate-ask function; returns {answer} or {message} */
  async function cmAskLibrary(org, question, context) {
    try {
      var r = await supa.functions.invoke('cellarmate-ask', { body: { org: org, question: question, context: context } });
      if (r.error) { var msg = r.error.message; try { var b = await r.error.context.json(); msg = b.error || b.message || msg; } catch (x) { } return { message: msg }; }
      return r.data || { message: 'No answer.' };
    } catch (e) { return { message: e.message }; }
  }

  function monthsSince(d) { if (!d) return null; return Math.max(0, Math.round((Date.now() - new Date(d + 'T12:00:00Z')) / (864e5 * 30.4))); }

  function CmWineHelp() {
    var org = (typeof CM_ME !== 'undefined' && CM_ME.org_id) || ORG;
    var s1 = React.useState(null), D = s1[0], setD = s1[1];
    var s2 = React.useState(''), pick = s2[0], setPick = s2[1];
    var s3 = React.useState([]), sym = s3[0], setSym = s3[1];
    var s4 = React.useState({}), F = s4[0], setF = s4[1];
    var s5 = React.useState(''), q = s5[0], setQ = s5[1];
    var s6 = React.useState(null), ans = s6[0], setAns = s6[1];
    var s7 = React.useState(''), msg = s7[0], setMsg = s7[1];
    var s8 = React.useState(false), busy = s8[0], setBusy = s8[1];
    var load = function () {
      Promise.all([db().from('bottled_skus').select('*').order('vintage', { ascending: false }), db().from('lots').select('id,name,vintage,varietal,type,status,mlf_complete,yeast_strain,vessel').is('removed_at', null).gte('vintage', 2025).order('vintage', { ascending: false }).limit(400),
        db().from('vit_library').select('slug,title,category,summary,key_points,sources,orgs'), db().from('wine_issues').select('*').order('created_at', { ascending: false }).limit(50)])
        .then(function (a) { setD({ skus: a[0].data || [], lots: a[1].data || [], lib: a[2].data || [], issues: a[3].data || [] }); });
    };
    React.useEffect(load, []);
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var inp = { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '5px 7px', fontSize: 12, width: '100%', boxSizing: 'border-box' };
    if (!D) return cmE('div', { style: card }, 'Loading the troubleshooter...');

    /* wine choices: bottled SKUs, then lots grouped by name */
    var lotNames = {}; D.lots.forEach(function (l) { var k = l.vintage + ' ' + (l.varietal || l.type || '') + (l.name ? ' · ' + l.name : ''); if (!lotNames[k]) lotNames[k] = l; });
    var opts = D.skus.map(function (s) { return { id: 'sku:' + s.id, label: s.sku + (s.bottled ? ' (bottled ' + s.bottled + ')' : s.status ? ' (' + s.status.toLowerCase() + ')' : ''), sku: s }; })
      .concat(Object.keys(lotNames).slice(0, 300).map(function (k) { return { id: 'lot:' + lotNames[k].id, label: k + (lotNames[k].vessel ? ' (' + lotNames[k].vessel + ')' : ''), lot: lotNames[k] }; }));
    var w = opts.filter(function (o) { return o.id === pick; })[0] || null;
    var wineType = w ? String((w.sku && w.sku.type) || (w.lot && (w.lot.varietal || w.lot.type)) || '') : '';
    var white = /chard|white|albari|gris|blanc|riesling/i.test(wineType);
    var stage = w ? (w.sku ? (w.sku.bottled || /bottled|released/i.test(w.sku.status || '') ? 'bottled' : 'aging') : (/ferment/i.test(w.lot.status || '') ? 'ferment' : w.lot.mlf_complete === false ? 'mlf' : 'aging')) : null;
    var d = { white: white, ph: num(F.ph), ta: num(F.ta), va: num(F.va), free: num(F.free), total: num(F.total), malic: num(F.malic), rs: num(F.rs), yan: num(F.yan),
      closure: F.closure || null, filtered: F.filtered || null, mlf: F.mlf || (w && w.lot ? (w.lot.mlf_complete === true ? 'yes' : w.lot.mlf_complete === false ? 'no' : null) : null), warm: F.warm === 'yes',
      monthsInBottle: w && w.sku && w.sku.bottled ? monthsSince(w.sku.bottled) : null, notes: F.notes || '' };
    var causes = cmDiagnose(sym, d);
    var libBy = {}; D.lib.forEach(function (e) { libBy[e.slug] = e; });
    var slugs = {}; causes.slice(0, 4).forEach(function (c) { c.lib.forEach(function (x) { slugs[x] = 1; }); }); slugs['how-to-investigate-a-wine'] = 1; slugs[white ? 'aromas-chardonnay' : 'aromas-pinot-noir'] = 1;
    var libSel = Object.keys(slugs).map(function (k) { return libBy[k]; }).filter(Boolean);
    var past = D.issues.filter(function (i) { return i.outcome && (!wineType || String(i.varietal || '').toLowerCase().slice(0, 5) === wineType.toLowerCase().slice(0, 5)); }).slice(0, 5);
    var extra = w && w.sku ? 'Fruit source: ' + (w.sku.fruit_source || 'unknown') + '. Cases bottled: ' + (w.sku.cases_bottled || 'unknown') + '. Notes: ' + (w.sku.notes || 'none') + '.' : w && w.lot ? 'Lot ' + (w.lot.name || '') + ', yeast ' + (w.lot.yeast_strain || 'unknown') + ', vessel ' + (w.lot.vessel || 'unknown') + '.' : '';
    var context = w ? cmWineContext({ label: w.label, vintage: (w.sku || w.lot).vintage, stage: stage, extra: extra }, d, sym, causes, libSel, past) : '';
    var expect = libBy[white ? 'aromas-chardonnay' : 'aromas-pinot-noir'];
    var toggle = function (k) { setSym(sym.indexOf(k) >= 0 ? sym.filter(function (x) { return x !== k; }) : sym.concat([k])); };
    var set = function (k) { return function (ev) { var n = Object.assign({}, F); n[k] = ev.target.value; setF(n); }; };
    var field = function (k, label) { return cmE('label', { key: k, style: { flex: '1 1 90px', fontSize: 11, color: C.textDim } }, label, cmE('input', { value: F[k] || '', onChange: set(k), inputMode: 'decimal', style: inp })); };
    var select = function (k, label, vals) { return cmE('label', { key: k, style: { flex: '1 1 120px', fontSize: 11, color: C.textDim } }, label, cmE('select', { value: F[k] || '', onChange: set(k), style: inp }, [cmE('option', { key: '', value: '' }, 'unknown')].concat(vals.map(function (v) { return cmE('option', { key: v, value: v }, v); })))); };
    var ask = async function () {
      if (!w) { setMsg('Pick a wine first.'); return; }
      setBusy(true); setAns(null); setMsg('');
      var r = await cmAskLibrary(org, q || 'What is most likely going on with this wine, how do I confirm it, and what should I do?', context);
      setBusy(false);
      if (r.answer) setAns(r.answer); else setMsg(r.message || 'No answer.');
    };
    var copy = function () { (navigator.clipboard ? navigator.clipboard.writeText(context + '\n\nQuestion: ' + (q || 'What is most likely going on with this wine?')) : Promise.reject()).then(function () { setMsg('Copied the wine data, likely causes and library notes. Paste into any AI assistant.'); }).catch(function () { setMsg('Could not copy automatically.'); }); };
    var save = function () {
      if (!w) return;
      db().from('wine_issues').insert({ organization_id: org, wine: w.label, sku_id: w.sku ? w.sku.id : null, lot_name: w.lot ? w.lot.name : null, vintage: (w.sku || w.lot).vintage, varietal: wineType, symptoms: sym, notes: F.notes || null,
        data_snapshot: d, likely_causes: causes.slice(0, 5).map(function (c) { return { key: c.key, title: c.title, score: c.score }; }), ai_answer: ans, created_by: (typeof CM_ME !== 'undefined' && CM_ME.full_name) || null })
        .then(function (r) { setMsg(r.error ? r.error.message : 'Saved. Add what it turned out to be under Past investigations when you know.'); load(); });
    };
    var setOutcome = function (i, outcome, resolved) { db().from('wine_issues').update({ outcome: outcome, resolved: resolved, updated_at: new Date().toISOString() }).eq('id', i.id).then(load); };
    var groups = ['Smell', 'Look', 'Taste', 'Pattern'];

    return cmE('div', null,
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Troubleshoot a wine'),
        cmE('div', { style: Object.assign({}, small, { marginBottom: 6 }) }, 'Pick the wine, tick what is off, and fill in any numbers you have. The likely causes update as you go, with the tests that tell them apart and where to read more.'),
        cmE('select', { value: pick, onChange: function (ev) { setPick(ev.target.value); setAns(null); setMsg(''); }, style: Object.assign({}, inp, { marginBottom: 8 }) },
          [cmE('option', { key: '', value: '' }, 'Choose a wine...')].concat(opts.map(function (o) { return cmE('option', { key: o.id, value: o.id }, o.label); }))),
        groups.map(function (g) {
          return cmE('div', { key: g, style: { marginBottom: 6 } }, cmE('span', { style: Object.assign({}, small, { marginRight: 6 }) }, g + ':'),
            SYMPTOMS.filter(function (s) { return s[0] === g; }).map(function (s) {
              var on = sym.indexOf(s[1]) >= 0;
              return cmE('button', { key: s[1], onClick: function () { toggle(s[1]); }, style: { margin: '2px 4px 2px 0', padding: '3px 9px', borderRadius: 999, fontSize: 12, cursor: 'pointer', border: '1px solid ' + (on ? C.accent : C.cardBorder), background: on ? C.accent : 'transparent', color: on ? '#fff' : C.text } }, s[2]);
            }));
        }),
        cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 } },
          field('ph', 'pH'), field('ta', 'TA g/L'), field('va', 'VA g/L'), field('free', 'Free SO2 mg/L'), field('total', 'Total SO2 mg/L'), field('malic', 'Malic g/L'), field('rs', 'Sugar g/L'), field('yan', 'YAN mg/L'),
          select('closure', 'Closure', ['screw cap', 'natural cork', 'technical cork', 'synthetic']), select('filtered', 'Sterile filtered', ['yes', 'no']), select('mlf', 'Malolactic complete', ['yes', 'no', 'partial']), select('warm', 'Stored or shipped warm', ['yes', 'no'])),
        cmE('textarea', { placeholder: 'Anything else you noticed (when it started, which bottles, what changed)...', value: F.notes || '', onChange: set('notes'), style: Object.assign({}, inp, { marginTop: 6, height: 50 }) }),
        w && d.ph != null && d.free != null ? cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Molecular SO2 about ' + cmMolecularSO2(d.free, d.ph).toFixed(2) + ' mg/L (' + (white ? 'whites usually target about 0.8' : 'reds usually target about 0.5') + ').') : null),

      w ? cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, sym.length ? 'Likely causes' : 'Tick what is off to see likely causes'),
        causes.map(function (c, i) {
          return cmE('div', { key: c.key, style: { borderTop: i ? '1px solid ' + C.cardBorder : 'none', padding: '6px 0', fontSize: 13 } },
            cmE('div', { style: { display: 'flex', justifyContent: 'space-between' } }, cmE('b', null, (i + 1) + '. ' + c.title), cmE('span', { style: small }, 'score ' + c.score)),
            cmE('div', null, c.why),
            c.evidence.length ? cmE('div', { style: { color: C.orange || C.text } }, 'Points to it: ' + c.evidence.join('; ') + '.') : null,
            c.against.length ? cmE('div', { style: { color: C.green || C.textDim } }, 'Points away: ' + c.against.join('; ') + '.') : null,
            cmE('div', null, cmE('b', null, 'Check: '), c.tests.join('; ') + '.'),
            cmE('div', null, cmE('b', null, 'Do: '), c.actions.join('; ') + '.'),
            cmE('div', { style: small }, 'Read: ', c.lib.map(function (sl) { var e = libBy[sl]; return e ? cmE('span', { key: sl, style: { color: C.accentLight } }, e.title + ' (' + (e.orgs || []).join(', ') + ')  ') : null; })));
        })) : null,

      w && expect ? cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 2 } }, 'What this wine should taste like'),
        cmE('div', { style: { fontSize: 13 } }, expect.summary),
        cmE('ul', { style: { margin: '4px 0 0 18px', padding: 0, fontSize: 12 } }, (expect.key_points || []).map(function (k, i) { return cmE('li', { key: i }, k); }))) : null,

      w ? cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 2 } }, 'Next steps for this wine (' + stage + ')'),
        cmE('ul', { style: { margin: '4px 0 0 18px', padding: 0, fontSize: 13 } }, cmNextSteps(stage, white).map(function (k, i) { return cmE('li', { key: i }, k); }))) : null,

      w ? cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Ask the library'),
        cmE('textarea', { placeholder: 'Ask anything about this wine (for example: why would only some bottles have fizz?)', value: q, onChange: function (ev) { setQ(ev.target.value); }, style: Object.assign({}, inp, { height: 50 }) }),
        cmE('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
          cmBtn(busy ? 'Asking...' : 'Ask AI (uses this wine\'s data and the library)', ask, true, busy), cmBtn('Copy for an AI assistant', copy, false, false), cmBtn('Save this investigation', save, false, false)),
        msg ? cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) }, msg) : null,
        ans ? cmE('div', { style: { marginTop: 8, fontSize: 13, whiteSpace: 'pre-wrap', borderTop: '1px solid ' + C.cardBorder, paddingTop: 6 } }, ans) : null,
        cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) }, 'AI answers use only this wine\'s data, the library notes and this winery\'s past cases, and say which entries they used. They are part of the paid plans and billed at cost.')) : null,

      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Past investigations (' + D.issues.length + ')'),
        D.issues.length ? D.issues.slice(0, 12).map(function (i) {
          return cmE('div', { key: i.id, style: { borderTop: '1px solid ' + C.cardBorder, padding: '5px 0', fontSize: 12 } },
            cmE('b', null, i.wine), ' · ', String(i.created_at).slice(0, 10), ' · ', (i.symptoms || []).join(', '),
            i.likely_causes && i.likely_causes.length ? cmE('div', { style: small }, 'Ranked: ' + i.likely_causes.map(function (c) { return c.title; }).join(', ')) : null,
            cmE('input', { defaultValue: i.outcome || '', placeholder: 'What it turned out to be and what fixed it', onBlur: function (ev) { if (ev.target.value !== (i.outcome || '')) setOutcome(i, ev.target.value, !!ev.target.value); }, style: Object.assign({}, inp, { marginTop: 3 }) }));
        }) : cmE('div', { style: small }, 'None yet. Saved investigations with their outcome teach the library what happens at this winery.')));
  }

  window.cmMolecularSO2 = cmMolecularSO2;
  window.cmDiagnose = cmDiagnose;
  window.cmWineSymptoms = cmWineSymptoms;
  window.cmNextSteps = cmNextSteps;
  window.cmWineContext = cmWineContext;
  window.cmAskLibrary = cmAskLibrary;
  window.CmWineHelp = CmWineHelp;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.help = { label: 'Troubleshoot', Component: CmWineHelp, order: 48 };
})();
