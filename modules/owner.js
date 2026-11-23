/* CellarMate module: Vineyard owners, schedule and the owner portal
   The vineyard manager (the account that farms the vineyard) plans the work and invites the
   vineyard's owner, or a winery buying the fruit, by email. Those people get their own view of
   that one vineyard only: the schedule, what was done, the season so far, the harvest and the
   files. The database enforces it (cellarmate.is_vineyard_member in every vineyard policy).
   - CmVineyardTeam: on Vine Blocks, the schedule (vineyard_tasks), people with access
     (vineyard_members) and "Preview what the owner sees".
   - CmOwnerPortal: the whole screen for a login that has no winery but owns or buys from a
     vineyard (safety windows and field notes come from fieldwork.js); falls back to the usual "No access" screen when there is none.
   Pure helpers on window for the smoke tests: cmScheduleSplit, cmOwnerFeed. */
(function () {
  'use strict';
  var KINDS = [['spray', 'Spray'], ['mow', 'Mowing'], ['irrigation', 'Irrigation'], ['sample', 'Sampling'], ['canopy', 'Canopy work'], ['prune', 'Pruning'], ['harvest', 'Harvest'], ['soil', 'Soil work'], ['other', 'Other']];
  function kindName(k) { return (KINDS.filter(function (x) { return x[0] === k; })[0] || [0, k])[1]; }
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function md(s) { return s ? String(s).slice(5, 10) : ''; }
  function db() { return supa.schema('cellarmate'); }
  function me() { return (typeof CM_ME !== 'undefined' && CM_ME && CM_ME.full_name) || null; }

  /* tasks -> overdue, coming up (next 14 days), later, done in the last 30 days */
  function cmScheduleSplit(tasks, asOf) {
    var t = asOf || today(), soon = addDays(t, 14), back = addDays(t, -30);
    var open = (tasks || []).filter(function (x) { return !x.done_on; }).sort(function (a, b) { return String(a.planned_on || '9').localeCompare(String(b.planned_on || '9')); });
    return {
      overdue: open.filter(function (x) { return x.planned_on && x.planned_on < t; }),
      soon: open.filter(function (x) { return !x.planned_on || (x.planned_on >= t && x.planned_on <= soon); }),
      later: open.filter(function (x) { return x.planned_on && x.planned_on > soon; }),
      done: (tasks || []).filter(function (x) { return x.done_on && x.done_on >= back; }).sort(function (a, b) { return b.done_on.localeCompare(a.done_on); })
    };
  }

  /* what the owner sees as "done lately": finished tasks, sprays and irrigation, newest first */
  function cmOwnerFeed(X, asOf, days) {
    var from = addDays(asOf || today(), -(days || 60)), out = [];
    (X.tasks || []).forEach(function (t) { if (t.done_on && t.done_on >= from) out.push({ date: t.done_on, kind: kindName(t.kind), text: t.title + (t.blocks ? ' (blocks ' + t.blocks + ')' : '') }); });
    (X.sprays || []).forEach(function (s) { if (s.date && !s.skipped && s.date >= from) out.push({ date: s.date, kind: 'Spray', text: (s.reason || 'Spray') + (s.products_rate_per_acre ? ': ' + s.products_rate_per_acre : '') }); });
    (X.acts || []).forEach(function (a) { if (a.date && a.date >= from) out.push({ date: a.date, kind: a.kind === 'irrigation' ? 'Irrigation' : a.kind === 'amendment' ? 'Soil amendment' : 'Herbicide', text: (a.product || (a.amount != null ? a.amount + ' ' + (a.unit || '') : '')) + (a.blocks ? ' (blocks ' + a.blocks + ')' : '') }); });
    return out.sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  var card = function () { return { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }; };
  var small = function () { return { fontSize: 11, color: C.textDim }; };
  var inp = function () { return { background: C.bg || '#111', color: C.text, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' }; };
  var btn = function (primary) { return { background: primary ? C.accent : C.card, color: primary ? '#fff' : C.accentLight, border: primary ? 'none' : '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }; };
  var row = function (key, left, mid, right, color) { return cmE('div', { key: key, style: { display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid ' + C.cardBorder } }, cmE('span', { style: { width: 44, color: color || C.textDim, flexShrink: 0 } }, left), cmE('span', { style: { width: 90, color: C.textDim, flexShrink: 0 } }, mid), cmE('span', { style: { flex: 1 } }, right)); };

  /* ── manager side: schedule and people with access ── */
  function CmVineyardTeam(P) {
    var site = P.site;
    var s = React.useState(null), D = s[0], setD = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    var f = React.useState({ kind: 'spray', title: '', blocks: '', planned_on: today(), assigned_to: '', note: '', owner_visible: true }), F = f[0], setF = f[1];
    var m = React.useState({ email: '', full_name: '', role: 'owner' }), M = m[0], setM = m[1];
    var pv = React.useState(false), preview = pv[0], setPreview = pv[1];
    var load = function () {
      if (!site) return;
      Promise.all([db().from('vineyard_tasks').select('*').eq('organization_id', site.organization_id).eq('vineyard', site.name).order('planned_on'), db().from('vineyard_members').select('*').eq('vineyard_id', site.id).order('created_at')])
        .then(function (a) { if (a[0].error || a[1].error) setErr((a[0].error || a[1].error).message); setD({ tasks: a[0].data || [], members: a[1].data || [] }); });
    };
    React.useEffect(load, [site && site.id]);
    if (!site) return null;
    if (!D) return cmE('div', { style: card() }, 'Loading schedule...');
    var S = cmScheduleSplit(D.tasks);
    var addTask = function () {
      if (!F.title.trim()) { setErr('Give the task a short title.'); return; }
      db().from('vineyard_tasks').insert({ organization_id: site.organization_id, vineyard: site.name, kind: F.kind, title: F.title.trim(), blocks: F.blocks || null, planned_on: F.planned_on || null, assigned_to: F.assigned_to || null, note: F.note || null, owner_visible: !!F.owner_visible, created_by: me() })
        .then(function (r) { if (r.error) setErr(r.error.message); else { setErr(''); setF(Object.assign({}, F, { title: '', blocks: '', note: '' })); load(); } });
    };
    var done = function (t) { db().from('vineyard_tasks').update({ done_on: t.done_on ? null : today() }).eq('id', t.id).then(function (r) { if (r.error) setErr(r.error.message); else load(); }); };
    var del = function (t) { if (!confirm('Delete "' + t.title + '"?')) return; db().from('vineyard_tasks').delete().eq('id', t.id).then(function (r) { if (r.error) setErr(r.error.message); else load(); }); };
    var addMember = function () {
      var em = M.email.trim().toLowerCase(); if (em.indexOf('@') < 1) { setErr('Enter the email address they sign in with.'); return; }
      db().from('vineyard_members').insert({ organization_id: site.organization_id, vineyard_id: site.id, email: em, full_name: M.full_name || null, role: M.role, added_by: me() })
        .then(function (r) { if (r.error) setErr(/duplicate/.test(r.error.message) ? 'That email already has access.' : r.error.message); else { setErr(''); setM({ email: '', full_name: '', role: 'owner' }); load(); } });
    };
    var removeMember = function (x) { if (!confirm('Remove ' + x.email + ' from ' + site.name + '?')) return; db().from('vineyard_members').delete().eq('id', x.id).then(function (r) { if (r.error) setErr(r.error.message); else load(); }); };
    var taskRow = function (t, color) {
      return cmE('div', { key: t.id, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px solid ' + C.cardBorder } },
        cmE('input', { type: 'checkbox', checked: !!t.done_on, onChange: function () { done(t); }, title: t.done_on ? 'Mark not done' : 'Mark done' }),
        cmE('span', { style: { width: 44, color: color || C.textDim } }, md(t.done_on || t.planned_on)),
        cmE('span', { style: { width: 80, color: C.textDim } }, kindName(t.kind)),
        cmE('span', { style: { flex: 1 } }, t.title + (t.blocks ? ' · blocks ' + t.blocks : '') + (t.assigned_to ? ' · ' + t.assigned_to : '') + (t.owner_visible ? '' : ' · not shown to owner')),
        cmE('span', { onClick: function () { del(t); }, style: { color: C.textDim, cursor: 'pointer' } }, '×'));
    };
    var field = function (k, label, type, flex) { return cmE('label', { key: k, style: { flex: flex || '1 1 110px', fontSize: 11, color: C.textDim } }, label, cmE('input', { type: type || 'text', value: F[k], onChange: function (ev) { var o = Object.assign({}, F); o[k] = ev.target.value; setF(o); }, style: inp() })); };
    return cmE('div', null,
      cmE('div', { style: { fontSize: 15, fontWeight: 700, margin: '12px 0 8px' } }, 'Schedule and owner access'),
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, site.name + ' schedule'),
        cmE('div', { style: Object.assign(small(), { marginBottom: 6 }) }, 'Plan the work; tick it when it is done. The owner sees the schedule and what was done, unless you untick "Show to owner".'),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 } },
          cmE('label', { style: { flex: '1 1 110px', fontSize: 11, color: C.textDim } }, 'Kind', cmE('select', { value: F.kind, onChange: function (ev) { setF(Object.assign({}, F, { kind: ev.target.value })); }, style: inp() }, KINDS.map(function (k) { return cmE('option', { key: k[0], value: k[0] }, k[1]); }))),
          field('title', 'What', 'text', '2 1 180px'), field('blocks', 'Blocks'), field('planned_on', 'Planned for', 'date'), field('assigned_to', 'Who'),
          cmE('label', { style: { fontSize: 11, color: C.textDim, display: 'flex', alignItems: 'center', gap: 4 } }, cmE('input', { type: 'checkbox', checked: F.owner_visible, onChange: function (ev) { setF(Object.assign({}, F, { owner_visible: ev.target.checked })); } }), 'Show to owner'),
          cmE('button', { onClick: addTask, style: btn(true) }, 'Add to schedule')),
        S.overdue.length ? cmE('div', null, cmE('div', { style: { fontSize: 11, fontWeight: 700, color: C.orange, marginTop: 4 } }, 'Past due (' + S.overdue.length + ')'), S.overdue.map(function (t) { return taskRow(t, C.orange); })) : null,
        cmE('div', { style: { fontSize: 11, fontWeight: 700, marginTop: 4 } }, 'Next two weeks (' + S.soon.length + ')'), S.soon.length ? S.soon.map(function (t) { return taskRow(t); }) : cmE('div', { style: small() }, 'Nothing planned.'),
        S.later.length ? cmE('div', null, cmE('div', { style: { fontSize: 11, fontWeight: 700, marginTop: 4 } }, 'Later (' + S.later.length + ')'), S.later.map(function (t) { return taskRow(t); })) : null,
        S.done.length ? cmE('div', null, cmE('div', { style: { fontSize: 11, fontWeight: 700, marginTop: 4, color: C.green } }, 'Done in the last 30 days (' + S.done.length + ')'), S.done.map(function (t) { return taskRow(t, C.green); })) : null),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'People with access to ' + site.name),
        cmE('div', { style: Object.assign(small(), { marginBottom: 6 }) }, 'Add the vineyard owner, or a winery buying the fruit, by the email they sign in with. They see this vineyard only: schedule, work done, weather, harvest and files. They cannot change anything, and they never see your other vineyards or any cellar records.'),
        D.members.length ? D.members.map(function (x) {
          return cmE('div', { key: x.id, style: { display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid ' + C.cardBorder } },
            cmE('span', { style: { flex: 1 } }, (x.full_name ? x.full_name + ' · ' : '') + x.email), cmE('span', { style: small() }, x.role === 'buyer' ? 'Winery buying fruit' : 'Owner'),
            cmE('span', { style: small() }, x.user_id ? 'signed in' : 'not signed in yet'),
            cmE('span', { onClick: function () { removeMember(x); }, style: { color: C.textDim, cursor: 'pointer' } }, '×'));
        }) : cmE('div', { style: small() }, 'Nobody outside your team yet.'),
        cmE('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 } },
          cmE('label', { style: { flex: '2 1 180px', fontSize: 11, color: C.textDim } }, 'Email', cmE('input', { type: 'email', value: M.email, onChange: function (ev) { setM(Object.assign({}, M, { email: ev.target.value })); }, style: inp() })),
          cmE('label', { style: { flex: '1 1 140px', fontSize: 11, color: C.textDim } }, 'Name', cmE('input', { value: M.full_name, onChange: function (ev) { setM(Object.assign({}, M, { full_name: ev.target.value })); }, style: inp() })),
          cmE('label', { style: { flex: '1 1 140px', fontSize: 11, color: C.textDim } }, 'Role', cmE('select', { value: M.role, onChange: function (ev) { setM(Object.assign({}, M, { role: ev.target.value })); }, style: inp() }, [cmE('option', { key: 'o', value: 'owner' }, 'Vineyard owner'), cmE('option', { key: 'b', value: 'buyer' }, 'Winery buying fruit')])),
          cmE('button', { onClick: addMember, style: btn(true) }, 'Give access'),
          cmE('button', { onClick: function () { setPreview(!preview); }, style: btn(false) }, preview ? 'Close preview' : 'Preview what the owner sees')),
        cmE('div', { style: Object.assign(small(), { marginTop: 4 }) }, 'They sign in at this same web address with that email. No winery account is created for them.')),
      preview ? cmE('div', { style: { border: '2px dashed ' + C.accent, borderRadius: 12, padding: 8, marginBottom: 8 } }, cmE('div', { style: Object.assign(small(), { marginBottom: 6 }) }, 'Preview: this is the owner\'s screen. Tasks marked "not shown to owner" are hidden.'), cmE(CmOwnerPortal, { preview: site })) : null);
  }

  /* ── owner side ── */
  function OwnerVineyard(P) {
    var V = P.v;
    var s = React.useState(null), D = s[0], setD = s[1];
    var e = React.useState(''), err = e[0], setErr = e[1];
    React.useEffect(function () {
      var live = true; setD(null);
      var by = function (t) { return db().from(t).select('*').eq('organization_id', V.organization_id).eq('vineyard', V.name); };
      Promise.all([by('vineyard_tasks').eq('owner_visible', true), by('vineyard_sprays'), by('vineyard_activities'), by('harvest_estimates'), by('estate_harvests'), by('vineyard_blocks'),
        db().from('weather_daily').select('date,tmax_f,tmin_f,precip_in,gt_hours,hot_hours').eq('vineyard_id', V.id).gte('date', (new Date().getFullYear() - 1) + '-01-01').order('date').limit(1000),
        window.cmFiles ? window.cmFiles.forRef('vineyard', null, V.name) : Promise.resolve([]),
        by('vineyard_observations').eq('owner_visible', true).order('observed_on', { ascending: false }).limit(40),
        db().from('spray_products').select('name,rei_hours,phi_days').eq('organization_id', V.organization_id)])
        .then(function (a) {
          if (!live) return; var bad = a.slice(0, 7).filter(function (r) { return r.error; })[0]; if (bad) setErr(bad.error.message);
          setD({ tasks: a[0].data || [], sprays: a[1].data || [], acts: a[2].data || [], est: a[3].data || [], harv: a[4].data || [], blocks: a[5].data || [],
            days: (a[6].data || []).map(function (d) { return { date: d.date, tmax: Number(d.tmax_f), tmin: Number(d.tmin_f), p: Number(d.precip_in) || 0, gt: d.gt_hours, hot: d.hot_hours }; }), files: a[7] || [],
            obs: (a[8] && a[8].data) || [], prods: (a[9] && a[9].data) || [] });
        }).catch(function (x) { if (live) setErr(x.message); });
      return function () { live = false; };
    }, [V.id]);
    if (!D) return cmE('div', { style: card() }, err || 'Loading ' + V.name + '...');
    var t = today(), yr = +t.slice(0, 4), S = cmScheduleSplit(D.tasks, t), feed = cmOwnerFeed(D, t, 60);
    var seasons = window.cmGddSeason ? window.cmGddSeason(D.days) : {}, sea = seasons[yr];
    var rain7 = D.days.filter(function (d) { return d.date > addDays(t, -7); }).reduce(function (a, d) { return a + d.p; }, 0);
    var mi = window.cmMildewIndex ? window.cmMildewIndex(D.days.filter(function (d) { return d.date.slice(0, 4) === String(yr) && d.date.slice(5) >= '04-01' && d.date.slice(5) <= '09-30'; })) : [];
    var lastMi = mi.filter(function (d) { return d.index != null; }).pop();
    var tonsBy = {}; D.harv.forEach(function (h) { if (h.year && h.tons != null) tonsBy[h.year] = (tonsBy[h.year] || 0) + Number(h.tons); });
    var acres = D.blocks.reduce(function (a, b) { return a + (Number(b.acres) || 0); }, 0) || Number(V.acres) || null;
    var years = Object.keys(tonsBy).map(Number).sort().slice(-5);
    var est = D.est.filter(function (x) { return x.vintage >= yr; }).sort(function (a, b) { return (a.block || 0) - (b.block || 0); });
    var byYear = {}; D.files.forEach(function (f) { var mm = /^(\d{4}) · /.exec(f.title || ''); var y = mm ? mm[1] : 'Reference'; (byYear[y] = byYear[y] || []).push(f); });
    var fy = Object.keys(byYear).sort(function (a, b) { return a === 'Reference' ? -1 : b === 'Reference' ? 1 : b - a; });
    var openFile = function (f) { supa.storage.from('cellar-files').createSignedUrl(f.path, 600).then(function (r) { if (r.data) window.open(r.data.signedUrl, '_blank'); else setErr('Could not open ' + f.filename); }); };
    var stat = function (label, value) { return cmE('div', { key: label, style: { minWidth: 90 } }, cmE('div', { style: { fontSize: 18, fontWeight: 700 } }, value), cmE('div', { style: small() }, label)); };
    var safe = window.cmSafetyWindows ? window.cmSafetyWindows(D.sprays, D.prods, D.blocks) : { active: [] };
    var stage = D.obs.filter(function (o) { return o.kind === 'growth stage' && o.el_stage != null; })[0];
    var notes = D.obs.filter(function (o) { return o.kind !== 'growth stage'; }).slice(0, 8);
    return cmE('div', null,
      err ? cmE('div', { style: { color: C.red, fontSize: 12, marginBottom: 6 } }, err) : null,
      safe.active.length ? cmE('div', { style: Object.assign(card(), { border: '1px solid ' + C.red }) },
        cmE('div', { style: { fontWeight: 700, color: C.red, marginBottom: 4 } }, 'Before you walk the vineyard'),
        safe.active.map(function (o) { return cmE('div', { key: o.block, style: { fontSize: 12 } }, 'Block ' + o.block + ': ' + [o.reiUntil ? 'keep out until ' + (o.reiUntil.getMonth() + 1) + '/' + o.reiUntil.getDate() + ' ' + o.reiUntil.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null, o.phiUntil ? 'no harvest before ' + md(o.phiUntil) : null].filter(Boolean).join(' · ')); })) : null,
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'From the field'),
        stage ? cmE('div', { style: { fontSize: 13, marginBottom: 4 } }, 'Growth stage: ', cmE('b', null, window.cmStageName ? window.cmStageName(stage.el_stage) : 'E-L ' + stage.el_stage), ' (' + md(stage.observed_on) + (stage.block ? ', block ' + stage.block : '') + ')') : null,
        notes.length ? notes.map(function (o) { return row('o' + o.id, md(o.observed_on), o.block ? 'Block ' + o.block : 'Vineyard', (o.subject || o.kind) + (o.severity ? ' (' + o.severity + ')' : '') + (o.note ? ' · ' + o.note : '')); }) : (stage ? null : cmE('div', { style: small() }, 'No field notes yet.'))),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Coming up'),
        S.overdue.concat(S.soon).length ? S.overdue.concat(S.soon).map(function (x) { return row('s' + x.id, md(x.planned_on), kindName(x.kind), x.title + (x.blocks ? ' · blocks ' + x.blocks : ''), x.planned_on && x.planned_on < t ? C.orange : null); }) : cmE('div', { style: small() }, 'Nothing planned for the next two weeks.'),
        S.later.length ? cmE('div', { style: Object.assign(small(), { marginTop: 4 }) }, 'Later: ' + S.later.map(function (x) { return md(x.planned_on) + ' ' + x.title; }).join(' · ')) : null),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Done lately'),
        feed.length ? feed.slice(0, 15).map(function (x, i) { return row('f' + i, md(x.date), x.kind, x.text); }) : cmE('div', { style: small() }, 'No work recorded in the last 60 days.')),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 6 } }, yr + ' season so far'),
        cmE('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
          stat('Heat units (base 50°F)', sea ? Math.round(sea.gdd) : 'none yet'), stat('Rain since Apr 1', sea ? sea.rain.toFixed(1) + '"' : ''), stat('Rain last 7 days', rain7.toFixed(2) + '"'),
          stat('Mildew risk', (+t.slice(5, 7) < 4 || +t.slice(5, 7) > 9) ? 'Out of season' : lastMi ? (lastMi.index >= 60 ? 'High' : lastMi.index >= 40 ? 'Moderate' : 'Low') + ' (' + lastMi.index + ')' : 'not started'))),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Harvest'),
        years.length ? cmE('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6 } }, years.map(function (y) { return stat(String(y), tonsBy[y].toFixed(1) + ' t' + (acres ? ' · ' + (tonsBy[y] / acres).toFixed(2) + ' t/ac' : '')); })) : cmE('div', { style: small() }, 'No harvest weights on file yet.'),
        est.length ? cmE('div', null, cmE('div', { style: { fontSize: 11, fontWeight: 700 } }, 'Crop estimates'), est.map(function (x) { return row('e' + x.id, String(x.vintage), x.block ? 'Block ' + x.block : 'Whole vineyard', Number(x.est_tons).toFixed(2) + ' t' + (x.method ? ' (' + x.method + ')' : '')); })) : null),
      cmE('div', { style: card() },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Records and files (' + D.files.length + ')'),
        fy.length ? fy.map(function (y) { return cmE('div', { key: y, style: { marginBottom: 6 } }, cmE('div', { style: { fontSize: 12, fontWeight: 700 } }, y), cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, byYear[y].map(function (f) { return cmE('span', { key: f.id, onClick: function () { openFile(f); }, style: { fontSize: 11, background: C.cardBorder, borderRadius: 5, padding: '4px 6px', cursor: 'pointer' } }, String(f.title || f.filename).replace(/^\d{4} · /, '')); }))); }) : cmE('div', { style: small() }, 'No files shared yet.')));
  }

  function CmOwnerPortal(P) {
    P = P || {};
    var s = React.useState(P.preview ? [P.preview] : null), list = s[0], setList = s[1];
    var c = React.useState(0), pick = c[0], setPick = c[1];
    React.useEffect(function () { if (P.preview) { setList([P.preview]); return; } db().rpc('my_vineyards').then(function (r) { setList(r.error ? [] : (r.data || [])); }); }, [P.preview && P.preview.id]);
    if (!list) return cmE('div', { style: { position: P.preview ? 'static' : 'fixed', inset: 0, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim } }, 'Loading...');
    if (!list.length && P.Fallback) return cmE(P.Fallback, { email: P.email, onLogout: P.onLogout });
    var V = list[Math.min(pick, list.length - 1)];
    var body = cmE('div', { style: { maxWidth: 760, margin: '0 auto', padding: P.preview ? 0 : '16px 14px 40px' } },
      cmE('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
        cmE('div', { style: { flex: 1 } },
          cmE('div', { style: { fontSize: 11, letterSpacing: 1, color: C.textDim, textTransform: 'uppercase' } }, 'CellarMate · ' + (V.role === 'buyer' ? 'fruit buyer view' : 'vineyard owner view')),
          list.length > 1 ? cmE('select', { value: pick, onChange: function (ev) { setPick(+ev.target.value); }, style: Object.assign({}, cmSel, { fontSize: 18, fontWeight: 700 }) }, list.map(function (x, i) { return cmE('option', { key: x.id, value: i }, x.name); })) : cmE('div', { style: { fontSize: 20, fontWeight: 800 } }, V.name),
          cmE('div', { style: small() }, [V.manager || (P.preview && typeof CM_ME !== 'undefined' ? CM_ME.org_name : ''), V.address, V.ava ? V.ava + ' AVA' : ''].filter(Boolean).join(' · '))),
        P.onLogout ? cmE('button', { onClick: P.onLogout, style: btn(false) }, 'Sign out') : null),
      cmE(OwnerVineyard, { key: V.id, v: V }),
      cmE('div', { style: Object.assign(small(), { textAlign: 'center', marginTop: 10 }) }, 'Questions about your vineyard? Call or email ' + (V.manager || 'your vineyard manager') + '. This view is read only.'));
    return P.preview ? body : cmE('div', { style: { position: 'fixed', inset: 0, background: C.bg, overflowY: 'auto', color: C.text } }, body);
  }

  window.cmScheduleSplit = cmScheduleSplit;
  window.cmOwnerFeed = cmOwnerFeed;
  window.CmVineyardTeam = CmVineyardTeam;
  window.CmOwnerPortal = CmOwnerPortal;
})();
