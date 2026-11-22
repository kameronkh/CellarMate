/* CellarMate module: Files (photos and documents)
   Photos and documents are kept in Supabase Storage (bucket cellar-files, folder per winery)
   with a small thumbnail for photos, listed in `attachments`, and linked through
   `attachment_links` to barrels, lots, vessels, fermenters, the facility or work orders.
   How a file is read decides where it goes:
     - a photo of a CellarMate barrel label (QR code) links to that barrel;
     - barrel, tank, keg and fermenter codes in the file name, note or document text link there;
     - document text tells the kind: lab report, invoice, compliance (TTB/OLCC), contract.
   Everything suggested can be changed before saving. Registers the Files tab and exposes
   window.cmFiles (helpers) and window.CmFilesFor (photo strip used by the Map barrel panel). */
(function () {
  'use strict';
  var BUCKET = 'cellar-files';
  var JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
  var ORG_DEFAULT = '762fc809-0341-4ee2-834f-16e707181ea7';
  var CATS = [['issue', 'Issue or problem'], ['barrel', 'Barrel or tank photo'], ['lab', 'Lab report'], ['invoice', 'Invoice or receipt'], ['compliance', 'Compliance (TTB, OLCC)'], ['contract', 'Contract or agreement'], ['vineyard', 'Vineyard'], ['bottling', 'Bottling or label'], ['general', 'Other']];
  var LINK_TYPES = [['barrel', 'Barrel'], ['lot', 'Lot'], ['vessel', 'Tank, keg or vessel'], ['fermenter', 'Fermenter'], ['facility', 'Facility'], ['work_order', 'Work order'], ['vineyard', 'Vineyard']];

  /* ---------- pure helpers ---------- */
  function linkKey(l) { return [l.link_type, l.vintage || '', l.ref || ''].join('|'); }
  function uniqLinks(a) { var s = {}; return a.filter(function (l) { var k = linkKey(l); if (s[k]) return false; s[k] = 1; return true; }); }
  /* find barrel / vessel / fermenter codes in free text */
  function cmFindRefs(text, known) {
    var t = ' ' + String(text || '') + ' '; var out = [];
    var re = /(?:^|[^\w-])(2[3-6])-0*(\d{1,3})(?!\w|\.\d|-\d)/g, m;
    while ((m = re.exec(t))) { var y = 2000 + Number(m[1]); var b = y === 2026 ? '26-' + ('00' + m[2]).slice(-3) : String(Number(m[2])); out.push({ link_type: 'barrel', vintage: y, ref: b }); }
    var vre = /\b(SST\s?\d{1,2}|SSB|T\s?2[0-9]|K-?\s?\d{1,2})\b/gi;
    while ((m = vre.exec(t))) { var v = m[1].toUpperCase().replace(/\s/g, ''); if (/^K\d/.test(v)) v = 'K-' + v.slice(1); out.push({ link_type: 'vessel', vintage: null, ref: v }); }
    var fre = /\b(?:F|fermenter\s*|fermentor\s*)(\d{1,2})\b/gi;
    while ((m = fre.exec(t))) out.push({ link_type: 'fermenter', vintage: known && known.fermVintage || null, ref: 'F' + Number(m[1]) });
    if (known && known.lots) known.lots.forEach(function (L) { if (L.length > 6 && t.toLowerCase().indexOf(L.toLowerCase()) > -1) out.push({ link_type: 'lot', vintage: null, ref: L }); });
    if (/press and barrel|crush pad|cellar floor|forklift|floor drain|glycol|chiller|compressor|roof|door/i.test(t) && !/ets laborator/i.test(t)) out.push({ link_type: 'facility', vintage: null, ref: 'Press and Barrel Wine Collective' });
    return uniqLinks(out);
  }
  function cmGuessCategory(name, text, isImage) {
    var s = (String(name || '') + ' ' + String(text || '')).toLowerCase();
    if (/ets laborator|laboratory report|free sulfur dioxide|volatile acidity|malic acid/.test(s)) return 'lab';
    if (/invoice|receipt|crush2cellar|crush 2 cellar|amount due|subtotal/.test(s)) return 'invoice';
    if (/ttb|5120|olcc|bond|permit|registration/.test(s)) return 'compliance';
    if (/agreement|contract|custom crush/.test(s)) return 'contract';
    if (/leak|broken|spill|mold|mould|crack|damage|issue|problem|bung|pop|seep|stuck|reduct|ethyl|brett|va\b/.test(s)) return 'issue';
    if (/vineyard|block|vine|harvest|pick/.test(s)) return 'vineyard';
    if (/bottl|label|capsule|cork/.test(s)) return 'bottling';
    return isImage ? 'barrel' : 'general';
  }
  function qrToLink(text) {
    var m = String(text || '').match(/[?&]barrel=([^&#\s]+)/i); if (!m) return null;
    var c = decodeURIComponent(m[1]); var p = window.cmBarrelLabels ? cmBarrelLabels.parseCode(c) : null;
    return p ? { link_type: 'barrel', vintage: p.vintage, ref: p.barrel, from: 'QR code on the barrel label' } : null;
  }
  function linkText(l) {
    if (l.link_type === 'barrel') return 'Barrel ' + (l.vintage === 2026 || /^26-/.test(l.ref) ? l.ref : String(l.vintage || '').slice(2) + '-' + l.ref);
    if (l.link_type === 'facility') return 'Facility';
    var t = (LINK_TYPES.filter(function (x) { return x[0] === l.link_type; })[0] || [0, l.link_type])[1];
    return t + ' ' + (l.ref || '') + (l.link_type === 'fermenter' && l.vintage ? ' (' + l.vintage + ')' : '');
  }

  /* ---------- image reading ---------- */
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = JSQR; s.onload = function () { res(window.jsQR); }; s.onerror = function () { rej(new Error('QR reader did not load')); }; document.head.appendChild(s); });
  }
  function fileToImage(file) {
    return new Promise(function (res, rej) { var u = URL.createObjectURL(file); var im = new Image(); im.onload = function () { res({ img: im, url: u }); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('Could not open the photo (HEIC photos store fine but cannot be previewed here).')); }; im.src = u; });
  }
  function draw(img, max) {
    var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
  }
  async function readImage(file) {
    var out = { thumb: null, qr: null, w: 0, h: 0 };
    var o = await fileToImage(file);
    try {
      out.w = o.img.naturalWidth; out.h = o.img.naturalHeight;
      var tc = draw(o.img, 480); out.thumb = await new Promise(function (r) { tc.toBlob(r, 'image/jpeg', 0.8); });
      try {
        var jsQR = await loadJsQR();
        for (var i = 0, sizes = [1200, 800, 1800]; i < sizes.length && !out.qr; i++) {
          var c = draw(o.img, sizes[i]); var d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
          var hit = jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' }); if (hit && hit.data) out.qr = hit.data;
        }
      } catch (e) { /* QR reading is a bonus; keep going */ }
    } finally { URL.revokeObjectURL(o.url); }
    return out;
  }
  async function readAny(file, known) {
    var isImage = /^image\//.test(file.type) || /\.(jpe?g|png|gif|webp|heic)$/i.test(file.name);
    var r = { file: file, isImage: isImage, kind: isImage ? 'photo' : 'document', links: [], text: '', thumb: null, notes: [] };
    if (isImage) {
      try {
        var im = await readImage(file); r.thumb = im.thumb;
        var ql = qrToLink(im.qr); if (ql) { r.links.push(ql); r.notes.push('Read the barrel label QR code: ' + linkText(ql) + '.'); }
        else if (im.qr) r.notes.push('Found a QR code that is not a CellarMate barrel label.');
      } catch (e) { r.notes.push(e.message); }
    } else if (window.cmReadDocFile) {
      try { var d = await cmReadDocFile(file); r.text = d.lines ? d.lines.join('\n') : (d.text || ''); } catch (e) { r.notes.push('Could not read the text: ' + e.message); }
    }
    var fromText = cmFindRefs(file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ') + ' ' + r.text.slice(0, 20000), known);
    r.links = uniqLinks(r.links.concat(fromText));
    r.category = cmGuessCategory(file.name, r.text.slice(0, 4000), isImage);
    if (r.category === 'lab' && !isImage) r.notes.push('This looks like a lab report. Load it in the Lab tab to enter its results.');
    return r;
  }

  /* ---------- storage ---------- */
  function db() { return supa.schema('cellarmate'); }
  function safe(n) { return String(n).replace(/[^\w.\-]+/g, '_').slice(-80); }
  async function saveOne(r, meta, org) {
    var o = org || ORG_DEFAULT; var stamp = Date.now() + '_' + Math.round(Math.random() * 1e4);
    if (window.cmPlan && !(await window.cmPlan.canStore(o))) throw new Error('Storing files and photos is part of the paid plans. Basic keeps your records and weather free.');
    var base = o + '/' + new Date().toISOString().slice(0, 7) + '/' + stamp + '_' + safe(r.file.name);
    var up = await supa.storage.from(BUCKET).upload(base, r.file, { contentType: r.file.type || 'application/octet-stream', upsert: false });
    if (up.error) throw new Error('Upload failed: ' + up.error.message);
    var thumbPath = null;
    if (r.thumb) { var tp = o + '/thumbs/' + stamp + '.jpg'; var tu = await supa.storage.from(BUCKET).upload(tp, r.thumb, { contentType: 'image/jpeg' }); if (!tu.error) thumbPath = tp; }
    var ins = await db().from('attachments').insert({ organization_id: o, path: base, thumb_path: thumbPath, filename: r.file.name, mime: r.file.type || null, size_bytes: r.file.size,
      kind: r.kind, category: meta.category || r.category || 'general', title: meta.title || null, note: meta.note || null, taken_on: meta.taken_on || null, is_issue: !!meta.is_issue || meta.category === 'issue',
      read_from: (r.notes || []).join(' ') || null, uploaded_by: (typeof CM_ME !== 'undefined' && CM_ME.full_name) || null }).select('id').single();
    if (ins.error) throw new Error(ins.error.message);
    var links = uniqLinks(meta.links || r.links || []);
    if (links.length) { var li = await db().from('attachment_links').insert(links.map(function (l) { return { attachment_id: ins.data.id, organization_id: o, link_type: l.link_type, vintage: l.vintage || null, ref: l.ref || null }; })); if (li.error) throw new Error('Saved the file, but not its links: ' + li.error.message); }
    if (typeof CM_CACHE !== 'undefined') { delete CM_CACHE.attachments; delete CM_CACHE.attachment_links; }
    return ins.data.id;
  }
  async function signed(paths) {
    var p = paths.filter(Boolean); if (!p.length) return {};
    var r = await supa.storage.from(BUCKET).createSignedUrls(p, 3600); var out = {};
    (r.data || []).forEach(function (x) { if (x.signedUrl) out[x.path] = x.signedUrl; }); return out;
  }
  async function forRef(type, vintage, ref) {
    var q = db().from('attachment_links').select('attachment_id').eq('link_type', type).eq('ref', ref);
    if (vintage) q = q.eq('vintage', vintage);
    var l = await q; var ids = (l.data || []).map(function (x) { return x.attachment_id; }); if (!ids.length) return [];
    var a = await db().from('attachments').select('*').in('id', ids).order('created_at', { ascending: false }); return a.data || [];
  }
  async function removeOne(a) {
    await supa.storage.from(BUCKET).remove([a.path].concat(a.thumb_path ? [a.thumb_path] : []));
    var d = await db().from('attachments').delete().eq('id', a.id); if (d.error) throw new Error(d.error.message);
  }
  function openFile(a) { return supa.storage.from(BUCKET).createSignedUrl(a.path, 600).then(function (r) { if (r.data) window.open(r.data.signedUrl, '_blank'); return r; }); }

  /* ---------- link editor ---------- */
  function LinkEditor(props) {
    var sT = React.useState('barrel'), type = sT[0], setType = sT[1];
    var sR = React.useState(''), ref = sR[0], setRef = sR[1];
    var add = function () {
      var t = ref.trim(); if (!t && type !== 'facility') return; var l;
      if (type === 'barrel') { var p = window.cmBarrelLabels ? cmBarrelLabels.parseCode(/-/.test(t) ? t : '26-' + t) : null; if (!p) return; l = { link_type: 'barrel', vintage: p.vintage, ref: p.barrel }; }
      else if (type === 'facility') l = { link_type: 'facility', vintage: null, ref: 'Press and Barrel Wine Collective' };
      else if (type === 'fermenter') { var m = t.match(/(\d{1,2})/); l = { link_type: 'fermenter', vintage: props.fermVintage || null, ref: m ? 'F' + Number(m[1]) : t }; }
      else l = { link_type: type, vintage: null, ref: t };
      props.onChange(uniqLinks(props.links.concat([l]))); setRef('');
    };
    var inp = Object.assign({}, cmSel, { minWidth: 0, fontSize: 12 });
    return cmE('div', null,
      cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 } }, props.links.length ? props.links.map(function (l) {
        return cmE('span', { key: linkKey(l), style: { fontSize: 11, background: C.accentDim || C.cardBorder, borderRadius: 5, padding: '2px 6px', display: 'inline-flex', gap: 6 } }, linkText(l),
          cmE('span', { onClick: function () { props.onChange(props.links.filter(function (x) { return linkKey(x) !== linkKey(l); })); }, style: { cursor: 'pointer', color: C.textDim } }, 'x'));
      }) : cmE('span', { style: { fontSize: 11, color: C.orange } }, 'Not linked yet: add a barrel, lot, tank or the facility.')),
      cmE('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        cmE('select', { value: type, onChange: function (e) { setType(e.target.value); }, style: Object.assign({}, inp, { flex: '0 1 150px' }) }, LINK_TYPES.map(function (o) { return cmE('option', { key: o[0], value: o[0] }, o[1]); })),
        type !== 'facility' ? cmE('input', { value: ref, list: 'cm-files-' + type, onChange: function (e) { setRef(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') add(); }, placeholder: type === 'barrel' ? '26-022 or 25-183' : type === 'fermenter' ? 'F7' : 'name', style: Object.assign({}, inp, { flex: '1 1 140px' }) }) : null,
        cmE('button', { onClick: add, style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '4px 10px', fontWeight: 700, cursor: 'pointer', fontSize: 12 } }, 'Add link')));
  }

  /* ---------- Files tab ---------- */
  function CmFiles(props) {
    var sK = React.useState(null), known = sK[0], setKnown = sK[1];
    var sP = React.useState([]), pend = sP[0], setPend = sP[1];
    var sL = React.useState(null), list = sL[0], setList = sL[1];
    var sU = React.useState({}), urls = sU[0], setUrls = sU[1];
    var sF = React.useState('all'), filt = sF[0], setFilt = sF[1];
    var sQ = React.useState(''), q = sQ[0], setQ = sQ[1];
    var sB = React.useState(''), busy = sB[0], setBusy = sB[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    var sM = React.useState(''), msg = sM[0], setMsg = sM[1];
    var sT = React.useState(0), tick = sT[0], setTick = sT[1];
    React.useEffect(function () {
      var live = true;
      Promise.all([cmFetch('barrel_status_2026'), cmFetch('barrel_status_2025'), cmFetch('vessels')]).then(function (a) {
        if (!live) return;
        var lots = cmUniq(a[0].map(function (r) { return String(r.lot_name || '').replace(/;.*$/, '').trim(); }).filter(function (x) { return x && !/not in barrel list|not linked/i.test(x); }));
        setKnown({ fermVintage: 2026, lots: lots, barrels: a[0].map(function (r) { return r.barrel; }).concat(a[1].map(function (r) { return '25-' + r.barrel; })), vessels: a[2].map(function (v) { return v.tank_code || v.vessel; }).filter(Boolean), org: (a[0][0] && a[0][0].organization_id) || ORG_DEFAULT });
      }).catch(function () { if (live) setKnown({ lots: [], barrels: [], vessels: [], org: ORG_DEFAULT }); });
      return function () { live = false; };
    }, []);
    React.useEffect(function () {
      var live = true;
      Promise.all([db().from('attachments').select('*').order('created_at', { ascending: false }).limit(300), db().from('attachment_links').select('*')]).then(function (a) {
        if (!live) return; var links = {}; (a[1].data || []).forEach(function (l) { (links[l.attachment_id] = links[l.attachment_id] || []).push(l); });
        var rows = (a[0].data || []).map(function (x) { return Object.assign({}, x, { links: links[x.id] || [] }); }); setList(rows);
        signed(rows.map(function (x) { return x.thumb_path; })).then(function (u) { if (live) setUrls(u); });
      });
      return function () { live = false; };
    }, [tick]);
    if (!known) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var small = { fontSize: 11, color: C.textDim };
    var inp = Object.assign({}, cmSel, { minWidth: 0, fontSize: 12 });
    var pick = function (e) {
      var files = Array.prototype.slice.call(e.target.files || []); if (!files.length) return; e.target.value = '';
      setErr(''); setMsg(''); setBusy('Reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '...');
      Promise.all(files.map(function (f) { return readAny(f, known); })).then(function (rs) {
        setPend(pend.concat(rs.map(function (r) { return Object.assign(r, { meta: { category: r.category, note: '', title: '', taken_on: new Date().toISOString().slice(0, 10), is_issue: r.category === 'issue', links: r.links }, preview: r.thumb ? URL.createObjectURL(r.thumb) : null }); }))); setBusy('');
      }).catch(function (x) { setBusy(''); setErr(x.message); });
    };
    var setMeta = function (i, k, v) { var p = pend.slice(); p[i] = Object.assign({}, p[i], { meta: Object.assign({}, p[i].meta) }); p[i].meta[k] = v; setPend(p); };
    var saveAll = async function () {
      setErr(''); setMsg(''); var ok = 0;
      for (var i = 0; i < pend.length; i++) { setBusy('Saving ' + (i + 1) + ' of ' + pend.length + '...'); try { await saveOne(pend[i], pend[i].meta, known.org); ok++; } catch (x) { setErr(pend[i].file.name + ': ' + x.message); break; } }
      setBusy(''); if (ok) { setMsg('Saved ' + ok + ' file' + (ok === 1 ? '' : 's') + '.'); setPend(pend.slice(ok)); setTick(tick + 1); }
    };
    var shown = (list || []).filter(function (a) {
      if (filt === 'photo' && a.kind !== 'photo') return false; if (filt === 'document' && a.kind !== 'document') return false; if (filt === 'issue' && !a.is_issue) return false;
      if (filt === 'unlinked' && a.links.length) return false;
      if (!q) return true; var s = q.toLowerCase();
      return (a.filename + ' ' + (a.title || '') + ' ' + (a.note || '') + ' ' + a.links.map(linkText).join(' ')).toLowerCase().indexOf(s) > -1;
    });
    var dl = function (id, vals) { return cmE('datalist', { id: id }, vals.slice(0, 400).map(function (v) { return cmE('option', { key: v, value: v }); })); };
    return cmE('div', null,
      dl('cm-files-barrel', known.barrels), dl('cm-files-vessel', known.vessels), dl('cm-files-lot', known.lots),
      cmE('div', { style: card },
        cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Add photos or documents'),
        cmE('div', { style: small }, 'Take a photo or choose files. A photo of a barrel label opens that barrel; barrel, tank and fermenter numbers in the file name or document link it there; the kind of document is read from its text. Check the links, add a note, then save.'),
        cmE('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 } },
          cmE('label', { style: { background: C.accent, color: '#fff', borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 } }, 'Take a photo', cmE('input', { type: 'file', accept: 'image/*', capture: 'environment', onChange: pick, style: { display: 'none' } })),
          cmE('label', { style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 } }, 'Choose files', cmE('input', { type: 'file', multiple: true, accept: 'image/*,.pdf,.docx,.csv,.txt,.xlsx', onChange: pick, style: { display: 'none' }, 'data-cm': 'files-input' }))),
        busy ? cmE('div', { style: { fontSize: 12, color: C.accentLight, marginTop: 6 } }, busy) : null,
        err ? cmE('div', { style: { fontSize: 12, color: C.red, marginTop: 6 } }, err) : null,
        msg ? cmE('div', { style: { fontSize: 12, color: C.green || '#22c55e', marginTop: 6, fontWeight: 700 } }, msg) : null,
        pend.map(function (r, i) {
          return cmE('div', { key: i, style: { borderTop: '1px solid ' + C.cardBorder, marginTop: 8, paddingTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' } },
            r.preview ? cmE('img', { src: r.preview, style: { width: 96, height: 96, objectFit: 'cover', borderRadius: 6 } }) : cmE('div', { style: { width: 96, height: 96, borderRadius: 6, background: C.cardBorder, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.textDim } }, r.isImage ? 'photo' : (r.file.name.split('.').pop() || '').toUpperCase()),
            cmE('div', { style: { flex: '1 1 260px', minWidth: 0 } },
              cmE('div', { style: { fontSize: 12, fontWeight: 700, marginBottom: 4 } }, r.file.name),
              r.notes.map(function (n, j) { return cmE('div', { key: j, style: { fontSize: 11, color: C.accentLight } }, n); }),
              cmE('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6, margin: '6px 0' } },
                cmE('select', { value: r.meta.category, onChange: function (e) { setMeta(i, 'category', e.target.value); if (e.target.value === 'issue') setMeta(i, 'is_issue', true); }, style: inp }, CATS.map(function (c) { return cmE('option', { key: c[0], value: c[0] }, c[1]); })),
                cmE('input', { type: 'date', value: r.meta.taken_on, onChange: function (e) { setMeta(i, 'taken_on', e.target.value); }, style: inp }),
                cmE('input', { value: r.meta.note, placeholder: 'Note: what happened, what it shows', onChange: function (e) { setMeta(i, 'note', e.target.value); }, style: Object.assign({}, inp, { gridColumn: '1 / -1' }) })),
              cmE('label', { style: { fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 } }, cmE('input', { type: 'checkbox', checked: !!r.meta.is_issue, onChange: function (e) { setMeta(i, 'is_issue', e.target.checked); } }), 'This shows an issue to follow up'),
              cmE(LinkEditor, { links: r.meta.links, fermVintage: 2026, onChange: function (ls) { setMeta(i, 'links', ls); } }),
              cmE('span', { onClick: function () { setPend(pend.filter(function (_, j) { return j !== i; })); }, style: { fontSize: 11, color: C.textDim, cursor: 'pointer', display: 'inline-block', marginTop: 4 } }, 'Remove from this list')));
        }),
        pend.length ? cmE('button', { onClick: saveAll, disabled: !!busy, style: { marginTop: 8, background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' } }, 'Save ' + pend.length + ' file' + (pend.length === 1 ? '' : 's')) : null),
      cmE('div', { style: { display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
        cmE('div', { style: { flex: '3 1 320px' } }, cmSeg([['all', 'All'], ['photo', 'Photos'], ['document', 'Documents'], ['issue', 'Issues'], ['unlinked', 'Not linked']], filt, setFilt)),
        cmE('input', { value: q, onChange: function (e) { setQ(e.target.value); }, placeholder: 'Find: barrel, tank, word', style: Object.assign({}, inp, { flex: '1 1 140px' }) })),
      list === null ? cmE('div', { style: small }, 'Loading files...') : !shown.length ? cmE('div', { style: Object.assign({}, card, small) }, 'No files here yet.') :
        cmE('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 } }, shown.map(function (a) {
          return cmE('div', { key: a.id, style: Object.assign({}, card, { marginBottom: 0, borderColor: a.is_issue ? C.orange : C.cardBorder }) },
            a.thumb_path && urls[a.thumb_path] ? cmE('img', { src: urls[a.thumb_path], onClick: function () { openFile(a); }, style: { width: '100%', height: 130, objectFit: 'cover', borderRadius: 6, cursor: 'pointer' } })
              : cmE('div', { onClick: function () { openFile(a); }, style: { height: 60, borderRadius: 6, background: C.cardBorder, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, cursor: 'pointer' } }, (a.filename.split('.').pop() || '').toUpperCase() + ' · open'),
            cmE('div', { style: { fontSize: 12, fontWeight: 700, marginTop: 6, wordBreak: 'break-word' } }, a.title || a.filename),
            cmE('div', { style: small }, (CATS.filter(function (c) { return c[0] === a.category; })[0] || [0, a.category])[1] + ' · ' + (a.taken_on || String(a.created_at).slice(0, 10)) + (a.is_issue ? ' · issue' : '')),
            a.note ? cmE('div', { style: { fontSize: 11, marginTop: 2 } }, a.note) : null,
            cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 } }, a.links.map(function (l) { return cmE('span', { key: l.id, style: { fontSize: 10, background: C.cardBorder, borderRadius: 4, padding: '1px 5px' } }, linkText(l)); })),
            cmE('div', { style: { display: 'flex', gap: 10, marginTop: 6, fontSize: 11 } },
              cmE('span', { onClick: function () { openFile(a); }, style: { color: C.accentLight, cursor: 'pointer', fontWeight: 700 } }, 'Open'),
              cmE('span', { onClick: function () { if (window.confirm('Delete ' + a.filename + '? This removes the file.')) removeOne(a).then(function () { setTick(tick + 1); }).catch(function (x) { setErr(x.message); }); }, style: { color: C.textDim, cursor: 'pointer' } }, 'Delete')));
        })));
  }

  /* ---------- photo strip for one barrel / lot / vessel (used by the Map panel) ---------- */
  function CmFilesFor(props) {
    var sA = React.useState(null), items = sA[0], setItems = sA[1];
    var sU = React.useState({}), urls = sU[0], setUrls = sU[1];
    var sB = React.useState(''), busy = sB[0], setBusy = sB[1];
    var sT = React.useState(0), tick = sT[0], setTick = sT[1];
    React.useEffect(function () {
      var live = true; setItems(null);
      forRef(props.type, props.vintage, props.refCode).then(function (a) { if (!live) return; setItems(a); signed(a.map(function (x) { return x.thumb_path; })).then(function (u) { if (live) setUrls(u); }); }).catch(function () { if (live) setItems([]); });
      return function () { live = false; };
    }, [props.type, props.vintage, props.refCode, tick]);
    var add = function (e) {
      var files = Array.prototype.slice.call(e.target.files || []); if (!files.length) return; e.target.value = ''; setBusy('Saving...');
      (async function () {
        for (var i = 0; i < files.length; i++) {
          var r = await readAny(files[i], null);
          var links = uniqLinks([{ link_type: props.type, vintage: props.vintage || null, ref: props.refCode }].concat(r.links));
          await saveOne(r, { category: r.isImage ? (r.category === 'issue' ? 'issue' : 'barrel') : r.category, links: links, taken_on: new Date().toISOString().slice(0, 10), is_issue: r.category === 'issue' }, props.org);
        }
      })().then(function () { setBusy(''); setTick(tick + 1); }).catch(function (x) { setBusy(x.message); });
    };
    return cmE('div', { style: { marginTop: 6 } },
      cmE('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, cmE('span', { style: { fontSize: 11, color: C.textDim, fontWeight: 700 } }, 'Photos and files' + (items ? ' (' + items.length + ')' : '')),
        cmE('label', { style: { fontSize: 11, color: C.accentLight, cursor: 'pointer', fontWeight: 700 } }, '+ Add', cmE('input', { type: 'file', multiple: true, accept: 'image/*,.pdf,.docx', onChange: add, style: { display: 'none' } })),
        busy ? cmE('span', { style: { fontSize: 11, color: C.accentLight } }, busy) : null),
      items && items.length ? cmE('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } }, items.map(function (a) {
        return a.thumb_path && urls[a.thumb_path] ? cmE('img', { key: a.id, src: urls[a.thumb_path], title: (a.note || a.filename), onClick: function () { openFile(a); }, style: { width: 64, height: 64, objectFit: 'cover', borderRadius: 5, cursor: 'pointer', border: a.is_issue ? '2px solid ' + C.orange : 'none' } })
          : cmE('span', { key: a.id, onClick: function () { openFile(a); }, style: { fontSize: 11, background: C.cardBorder, borderRadius: 5, padding: '4px 6px', cursor: 'pointer' } }, a.filename);
      })) : null);
  }

  window.cmFiles = { findRefs: cmFindRefs, guessCategory: cmGuessCategory, qrToLink: qrToLink, linkText: linkText, readAny: readAny, saveOne: saveOne, forRef: forRef, signed: signed, removeOne: removeOne };
  window.CmFilesFor = CmFilesFor;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.files = { label: 'Files', Component: CmFiles, order: 77 };
})();
