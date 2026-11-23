/* CellarMate module: Vit library (a viticulture encyclopedia for study and decisions)
   - Entries live in cellarmate.vit_library: study notes in our own words drawn from Oregon State,
     UC Davis, Washington State and Cornell extension work, each with links to the originals,
     key points, numbers with their source, what to look for, what to do, worked examples
     (scenario, what may be happening, what to check) and study cards.
   - "What may be happening now" reads the vineyard's recent weather and the date, works out the
     likely growth stage and the active signals (rain, frost, heat, mildew pressure), and ranks the
     entries that matter most right now.
   - Study mode turns the cards and examples into flash cards.
   - "Copy for an AI assistant" builds a prompt with the site context, the matched entries and their
     sources, so any assistant answers from the library rather than from guesses. No AI is called
     from the app (AI belongs to the paid plans).
   Renders on Vineyard, Vit library tab (CmVitLibrary). Pure helpers on window for the smoke tests:
   cmVitStageFor, cmVitSignals, cmVitMatch, cmVitSearch, cmVitPrompt. */
(function () {
  'use strict';
  function num(x) { var n = Number(x); return x === null || x === undefined || x === '' || isNaN(n) ? null : n; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function low(s) { return String(s || '').toLowerCase(); }

  /* usual Willamette Valley stage for a date (a guide; logged stages beat it) */
  var STAGES = [
    { key: 'dormant', name: 'Dormant', el: 1, from: '12-01', to: '03-31' },
    { key: 'budbreak', name: 'Budbreak', el: 4, from: '04-01', to: '04-30' },
    { key: 'shoots', name: 'Shoot growth', el: 12, from: '05-01', to: '05-31' },
    { key: 'bloom', name: 'Bloom', el: 23, from: '06-01', to: '06-25' },
    { key: 'fruitset', name: 'Fruit set to bunch closure', el: 29, from: '06-26', to: '07-31' },
    { key: 'veraison', name: 'Veraison', el: 35, from: '08-01', to: '08-20' },
    { key: 'ripening', name: 'Ripening', el: 37, from: '08-21', to: '09-10' },
    { key: 'harvest', name: 'Harvest', el: 38, from: '09-11', to: '10-20' },
    { key: 'postharvest', name: 'Post-harvest', el: 43, from: '10-21', to: '11-30' }
  ];
  function cmVitStageFor(date) {
    var md = String(date).slice(5, 10);
    for (var i = 0; i < STAGES.length; i++) {
      var s = STAGES[i];
      if (s.from <= s.to ? (md >= s.from && md <= s.to) : (md >= s.from || md <= s.to)) return s;
    }
    return STAGES[0];
  }

  /* signals from recent daily weather: days [{date,tmax,tmin,p,gt}] up to the as-of date */
  function cmVitSignals(ctx) {
    var date = ctx.date || new Date().toISOString().slice(0, 10), m = +date.slice(5, 7);
    var st = ctx.stage || cmVitStageFor(date);
    var days = arr(ctx.days).filter(function (d) { return d.date <= date; });
    var last = function (n) { return days.slice(-n); };
    var tags = ['stage:' + st.key], facts = [];
    if (!days.length) return { date: date, month: m, stage: st, tags: tags, facts: ['No recent weather loaded for this vineyard.'] };
    var r3 = last(3).reduce(function (a, d) { return a + (num(d.p) || 0); }, 0);
    var lo3 = Math.min.apply(null, last(3).map(function (d) { return num(d.tmin); }).filter(function (x) { return x != null; }).concat([99]));
    var hi3 = Math.max.apply(null, last(3).map(function (d) { return num(d.tmax); }).filter(function (x) { return x != null; }).concat([-99]));
    var dry21 = last(21).length >= 21 && last(21).every(function (d) { return (num(d.p) || 0) < 0.05; });
    if (r3 >= 0.5) { tags.push('rain'); facts.push(r3.toFixed(2) + ' in of rain in the last 3 days.'); }
    if (m >= 4 && m <= 5 && lo3 <= 32) { tags.push('frost'); facts.push('Low of ' + Math.round(lo3) + '°F in the last 3 days after budbreak.'); }
    if ((m >= 11 || m <= 2) && lo3 <= 15) { tags.push('freeze'); facts.push('Low of ' + Math.round(lo3) + '°F: check bud hardiness.'); }
    if (hi3 >= 95) { tags.push('heat'); facts.push('High of ' + Math.round(hi3) + '°F in the last 3 days.'); }
    if (m >= 6 && m <= 9 && dry21) { tags.push('dry'); facts.push('No rain for three weeks.'); }
    if (m >= 4 && m <= 9 && window.cmMildewIndex) {
      var season = days.filter(function (d) { return d.date.slice(0, 4) === date.slice(0, 4) && d.date.slice(5) >= '04-01' && d.gt != null; });
      if (season.length >= 7) {
        var ser = window.cmMildewIndex(season), i = ser.length ? ser[ser.length - 1].index : null;
        if (i != null) { facts.push('Powdery mildew index ' + i + '.'); if (i >= 60) tags.push('mildew_high'); else if (i >= 40) tags.push('mildew_moderate'); }
      }
    }
    if (m >= 6 && m <= 10 && tags.indexOf('rain') >= 0) tags.push('botrytis_high');
    if (st.key === 'harvest' || st.key === 'ripening') tags.push('harvest');
    if (st.key === 'postharvest' || st.key === 'dormant') tags.push('paperwork');
    return { date: date, month: m, stage: st, tags: tags, facts: facts };
  }

  /* rank entries for the current signals: tag overlap, month and stage fit */
  function cmVitMatch(entries, sig, n) {
    var out = arr(entries).map(function (e) {
      var why = [], score = 0, sg = arr(e.signals), ms = arr(e.months);
      sig.tags.forEach(function (t) { if (sg.indexOf(t) >= 0) { score += 3; why.push(t.replace('stage:', '') .replace('_', ' ')); } });
      if (ms.length && ms.length < 12 && ms.indexOf(sig.month) >= 0) { score += 2; why.push('this month'); }
      if (e.el_from != null && e.el_to != null && sig.stage.el >= +e.el_from && sig.stage.el <= +e.el_to && !(+e.el_from <= 1 && +e.el_to >= 47)) { score += 1; why.push('this stage'); }
      if (sg.indexOf('hub') >= 0) score = 0;
      return { e: e, score: score, why: why };
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score || String(a.e.title).localeCompare(b.e.title); });
    return out.slice(0, n || 6);
  }

  function hay(e) {
    return low([e.title, e.category, e.summary, e.look_for, e.what_to_do, arr(e.key_points).join(' '), arr(e.varieties).join(' '), arr(e.orgs).join(' '),
      arr(e.examples).map(function (x) { return x.scenario + ' ' + x.may_be_happening + ' ' + x.check; }).join(' ')].join(' '));
  }
  /* vineyard (viticulture) or winery (oenology) entry */
  function cmVitDomain(e) { return /^(Winemaking|Enology)/.test(e.category || '') ? 'Winery' : 'Vineyard'; }
  function cmVitSearch(entries, q, f) {
    f = f || {}; var words = low(q).split(/\s+/).filter(Boolean);
    return arr(entries).filter(function (e) {
      if (f.domain && cmVitDomain(e) !== f.domain) return false;
      if (f.category && e.category !== f.category) return false;
      if (f.org && arr(e.orgs).indexOf(f.org) < 0) return false;
      if (f.variety && arr(e.varieties).length && arr(e.varieties).indexOf(f.variety) < 0) return false;
      if (!words.length) return true;
      var h = hay(e); return words.every(function (w) { return h.indexOf(w) >= 0; });
    }).map(function (e) { var t = low(e.title); return { e: e, s: words.reduce(function (a, w) { return a + (t.indexOf(w) >= 0 ? 2 : 0); }, 0) }; })
      .sort(function (a, b) { return b.s - a.s || String(a.e.category).localeCompare(b.e.category) || String(a.e.title).localeCompare(b.e.title); })
      .map(function (x) { return x.e; });
  }

  /* prompt for any AI assistant: site context, signals, matched entries and sources */
  function cmVitPrompt(entries, ctx, question) {
    var sig = ctx.sig || cmVitSignals(ctx), L = [];
    L.push('You are helping a vineyard team. Answer from the library notes below, cite the sources by title, and say when the notes do not cover something.');
    L.push(''); L.push('Vineyard: ' + (ctx.site ? ctx.site.name + (ctx.site.acres ? ', ' + ctx.site.acres + ' acres' : '') : 'not set') + '. Varieties: ' + (ctx.varieties || 'Pinot noir and Chardonnay') + '. Region: Willamette Valley, Oregon.');
    L.push('Date: ' + sig.date + '. Likely stage: ' + sig.stage.name + ' (E-L ' + sig.stage.el + ').');
    if (sig.facts.length) L.push('Recent conditions: ' + sig.facts.join(' '));
    L.push(''); L.push('Question: ' + (question || 'What may be happening in the vineyard right now, and what should we check this week?'));
    arr(entries).forEach(function (e, i) {
      L.push(''); L.push('[' + (i + 1) + '] ' + e.title + ' (' + e.category + ')'); L.push(e.summary);
      arr(e.key_points).forEach(function (k) { L.push('- ' + k); });
      arr(e.numbers).forEach(function (x) { L.push('- ' + x.label + ': ' + x.value + (x.source ? ' (' + x.source + ')' : '')); });
      arr(e.examples).forEach(function (x) { L.push('- Example: ' + x.scenario + ' May be happening: ' + x.may_be_happening + ' Check: ' + x.check); });
      arr(e.sources).forEach(function (s) { L.push('  Source: ' + s.org + ', ' + s.title + ', ' + s.url); });
    });
    return L.join('\n');
  }

  var ORG_COLOR = { OSU: '#d73f09', 'UC Davis': '#1b5e9e', WSU: '#981e32', Cornell: '#b31b1b', LIVE: '#4a7c3a', Industry: '#777' };

  function CmVitLibrary(P) {
    var s1 = React.useState(null), lib = s1[0], setLib = s1[1];
    var s2 = React.useState(''), q = s2[0], setQ = s2[1];
    var s3 = React.useState({}), f = s3[0], setF = s3[1];
    var s4 = React.useState(null), open = s4[0], setOpen = s4[1];
    var s5 = React.useState('read'), mode = s5[0], setMode = s5[1];
    var s6 = React.useState(0), card = s6[0], setCard = s6[1];
    var s7 = React.useState(false), flip = s7[0], setFlip = s7[1];
    var s8 = React.useState(''), note = s8[0], setNote = s8[1];
    var s9 = React.useState(''), err = s9[0], setErr = s9[1];
    var s10 = React.useState(null), aiAns = s10[0], setAiAns = s10[1];
    var s11 = React.useState(false), aiBusy = s11[0], setAiBusy = s11[1];
    React.useEffect(function () {
      supa.schema('cellarmate').from('vit_library').select('*').order('category').order('title')
        .then(function (r) { if (r.error) { setErr(r.error.message); setLib([]); } else setLib(r.data || []); });
    }, []);
    var C0 = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var chip = function (t, col) { return cmE('span', { key: t, style: { fontSize: 10, fontWeight: 700, color: '#fff', background: col || C.accent, borderRadius: 999, padding: '1px 7px', marginRight: 4 } }, t); };
    var sel = function (k, label, opts) {
      return cmE('select', { value: f[k] || '', onChange: function (ev) { var n = Object.assign({}, f); n[k] = ev.target.value || null; setF(n); }, style: { background: C.input || C.card, color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 6, padding: '4px 6px', fontSize: 12 } },
        [cmE('option', { key: '', value: '' }, label)].concat(opts.map(function (o) { return cmE('option', { key: o, value: o }, o); })));
    };
    if (!lib) return cmE('div', { style: C0 }, 'Loading the vit library...');
    if (err) return cmE('div', { style: C0 }, 'The vit library could not load: ' + err);
    var uniq = function (fn) { var m = {}; lib.forEach(function (e) { arr(fn(e)).forEach(function (x) { if (x) m[x] = 1; }); }); return Object.keys(m).sort(); };
    var sig = cmVitSignals({ days: P.days || [], date: P.date });
    var now = cmVitMatch(lib, sig, 6);
    var list = cmVitSearch(lib, q, f);
    var copy = function (entries, question) {
      var t = cmVitPrompt(entries, { site: P.site, sig: sig }, question);
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject(new Error('no clipboard')))
        .then(function () { setNote('Copied ' + entries.length + ' entries and the vineyard context. Paste it into your AI assistant.'); })
        .catch(function () { setNote('Could not copy automatically. Select the text in the box below.'); window.__cmVitPrompt = t; });
    };

    function entryCard(e) {
      var isOpen = open === e.slug;
      return cmE('div', { key: e.slug, style: Object.assign({}, C0, { borderLeft: '3px solid ' + (ORG_COLOR[arr(e.orgs)[0]] || C.accent) }) },
        cmE('div', { onClick: function () { setOpen(isOpen ? null : e.slug); }, style: { cursor: 'pointer' } },
          cmE('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
            cmE('div', { style: { fontWeight: 700 } }, e.title),
            cmE('div', null, arr(e.orgs).map(function (o) { return chip(o, ORG_COLOR[o]); }))),
          cmE('div', { style: small }, e.category + (arr(e.varieties).length ? ' · ' + e.varieties.join(', ') : '') + (e.el_from != null ? ' · E-L ' + (+e.el_from) + (e.el_to != null && +e.el_to !== +e.el_from ? ' to ' + (+e.el_to) : '') : '')),
          cmE('div', { style: { fontSize: 13, marginTop: 4 } }, e.summary)),
        isOpen ? cmE('div', { style: { marginTop: 6, fontSize: 13 } },
          arr(e.key_points).length ? cmE('ul', { style: { margin: '4px 0 6px 18px', padding: 0 } }, e.key_points.map(function (k, i) { return cmE('li', { key: i, style: { marginBottom: 3 } }, k); })) : null,
          arr(e.numbers).length ? cmE('table', { style: { borderCollapse: 'collapse', margin: '4px 0 8px', fontSize: 12 } }, cmE('tbody', null, e.numbers.map(function (x, i) {
            return cmE('tr', { key: i }, cmE('td', { style: { padding: '2px 8px 2px 0', color: C.textDim } }, x.label), cmE('td', { style: { padding: '2px 8px 2px 0', fontWeight: 700 } }, x.value), cmE('td', { style: small }, x.source || ''));
          }))) : null,
          e.look_for ? cmE('div', { style: { marginBottom: 4 } }, cmE('b', null, 'Look for: '), e.look_for) : null,
          e.what_to_do ? cmE('div', { style: { marginBottom: 4 } }, cmE('b', null, 'What to do: '), e.what_to_do) : null,
          arr(e.examples).map(function (x, i) {
            return cmE('div', { key: 'x' + i, style: { background: C.bg || 'transparent', border: '1px dashed ' + C.cardBorder, borderRadius: 8, padding: '6px 8px', margin: '6px 0' } },
              cmE('div', null, cmE('b', null, 'Example: '), x.scenario), cmE('div', null, cmE('b', null, 'May be happening: '), x.may_be_happening), cmE('div', null, cmE('b', null, 'Check: '), x.check));
          }),
          cmE('div', { style: Object.assign({}, small, { marginTop: 6 }) }, 'Sources: ', arr(e.sources).map(function (s, i) {
            return cmE('span', { key: i }, i ? ' · ' : '', cmE('a', { href: s.url, target: '_blank', rel: 'noopener', style: { color: C.accentLight } }, s.org + ': ' + s.title));
          })),
          cmE('div', { style: { marginTop: 6 } }, cmBtn('Copy this entry for an AI assistant', function () { copy([e], 'Explain ' + e.title + ' for our vineyard right now.'); }, false, false))) : null);
    }

    var cards = []; list.forEach(function (e) {
      arr(e.study).forEach(function (x) { cards.push({ q: x.q, a: x.a, t: e.title }); });
      arr(e.examples).forEach(function (x) { cards.push({ q: 'What may be happening? ' + x.scenario, a: x.may_be_happening + ' Check: ' + x.check, t: e.title }); });
    });
    var cur = cards.length ? cards[card % cards.length] : null;

    return cmE('div', null,
      cmE('div', { style: C0 },
        cmE('div', { style: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 } },
          cmE('div', { style: { fontWeight: 700 } }, 'What may be happening now'),
          cmE('div', { style: small }, sig.date + ' · likely stage: ' + sig.stage.name + ' (E-L ' + sig.stage.el + ')')),
        sig.facts.length ? cmE('div', { style: Object.assign({}, small, { margin: '4px 0' }) }, sig.facts.join(' ')) : null,
        now.length ? now.map(function (x) {
          return cmE('div', { key: x.e.slug, onClick: function () { setMode('read'); setQ(''); setF({}); setOpen(x.e.slug); }, style: { cursor: 'pointer', padding: '4px 0', borderTop: '1px solid ' + C.cardBorder, fontSize: 13 } },
            cmE('b', null, x.e.title), cmE('span', { style: small }, '  ' + x.why.join(', ')));
        }) : cmE('div', { style: small }, 'Nothing stands out for this date and weather.'),
        cmE('div', { style: { marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' } }, cmBtn('Copy for an AI assistant', function () { copy(now.map(function (x) { return x.e; })); }, false, false),
          window.cmAskLibrary ? cmBtn(aiBusy ? 'Asking...' : (q ? 'Ask AI: ' + q.slice(0, 40) : 'Ask AI what to watch now'), function () {
            var ents = (q ? list.slice(0, 8) : now.map(function (x) { return x.e; })); setAiBusy(true); setAiAns(null);
            window.cmAskLibrary((typeof CM_ME !== 'undefined' && CM_ME.org_id) || '762fc809-0341-4ee2-834f-16e707181ea7', q || 'What may be happening in the vineyard and winery right now, and what should we check this week?', cmVitPrompt(ents, { site: P.site, sig: sig }, q))
              .then(function (r) { setAiBusy(false); setAiAns(r.answer || r.message || 'No answer.'); });
          }, true, aiBusy) : null),
        aiAns ? cmE('div', { style: { marginTop: 6, fontSize: 13, whiteSpace: 'pre-wrap', borderTop: '1px solid ' + C.cardBorder, paddingTop: 6 } }, aiAns) : null,
        note ? cmE('div', { style: Object.assign({}, small, { marginTop: 4, color: C.green || C.text }) }, note) : null,
        window.__cmVitPrompt && note.indexOf('Could not') === 0 ? cmE('textarea', { readOnly: true, value: window.__cmVitPrompt, style: { width: '100%', height: 120, fontSize: 11 } }) : null),
      cmE('div', { style: Object.assign({}, C0, { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }) },
        cmE('input', { placeholder: 'Search the library (for example: botrytis bloom, frost, YAN)', value: q, onChange: function (ev) { setQ(ev.target.value); setCard(0); }, style: { flex: '1 1 220px', background: C.input || C.card, color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 6, padding: '5px 8px', fontSize: 13 } }),
        sel('domain', 'Vineyard and winery', ['Vineyard', 'Winery']),
        sel('category', 'All topics', uniq(function (e) { return [e.category]; })),
        sel('org', 'All sources', uniq(function (e) { return e.orgs; })),
        sel('variety', 'All varieties', uniq(function (e) { return e.varieties; })),
        cmBtn(mode === 'read' ? 'Study cards' : 'Read', function () { setMode(mode === 'read' ? 'study' : 'read'); setFlip(false); }, false, false),
        cmE('span', { style: small }, list.length + ' of ' + lib.length + ' entries')),
      mode === 'study' ? (cur ? cmE('div', { style: Object.assign({}, C0, { textAlign: 'center' }) },
        cmE('div', { style: small }, 'Card ' + ((card % cards.length) + 1) + ' of ' + cards.length + ' · ' + cur.t),
        cmE('div', { style: { fontSize: 15, fontWeight: 700, margin: '8px 0' } }, cur.q),
        flip ? cmE('div', { style: { fontSize: 14, margin: '8px 0' } }, cur.a) : null,
        cmE('div', { style: { display: 'flex', gap: 6, justifyContent: 'center' } },
          cmBtn(flip ? 'Hide answer' : 'Show answer', function () { setFlip(!flip); }, false, false),
          cmBtn('Next card', function () { setCard(card + 1); setFlip(false); }, false, false))) : cmE('div', { style: C0 }, 'No study cards for this search.')) : null,
      mode === 'read' ? list.map(entryCard) : null,
      cmE('div', { style: Object.assign({}, small, { margin: '4px 2px 10px' }) }, 'Study notes in our own words. Always read the original guide and the product label before acting; rates and registrations change every year.'));
  }

  window.cmVitStageFor = cmVitStageFor;
  window.cmVitSignals = cmVitSignals;
  window.cmVitMatch = cmVitMatch;
  window.cmVitSearch = cmVitSearch;
  window.cmVitDomain = cmVitDomain;
  window.cmVitPrompt = cmVitPrompt;
  window.CmVitLibrary = CmVitLibrary;
})();
