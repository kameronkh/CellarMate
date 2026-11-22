/* CellarMate module: upload lab reports (ETS PDF, other PDF, Word, CSV/text, photos)
   The file is kept in Supabase Storage (bucket lab-docs, folder per winery) and listed in
   lab_documents. Text is read in the browser (pdf.js for PDF, mammoth for Word), ETS reports
   are parsed sample by sample, each sample is matched to a barrel, and the results are saved
   to lab_results with a link back to the document. Photos are saved for reference only.
   Exposes window.CmLabUpload (used by the Lab tab) and pure helpers for the tests. */
(function () {
  'use strict';
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
  var MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  var ETS_NAMES = [
    [/^ph$/i, 'ph', ''], [/^brix$/i, 'brix', '°Bx'],
    [/^free sulfur dioxide/i, 'fso2', 'mg/L'], [/^molecular sulfur dioxide/i, 'mso2', 'mg/L'], [/^total sulfur dioxide/i, 'tso2', 'mg/L'],
    [/^titratable acidity/i, 'ta', 'g/L'], [/^volatile acidity/i, 'va', 'g/L'], [/^ethanol at 20/i, 'alc', '% vol'], [/^ethanol at 60/i, null, ''],
    [/^(l-)?malic acid/i, 'malic', 'g/L'], [/^glucose ?\+ ?fructose/i, 'rs', 'g/L'], [/^(yeast assimilable nitrogen|yan)/i, 'yan', 'mg N/L'],
    [/^ammonia/i, 'nh3', 'mg N/L'], [/^alpha.?amino/i, 'nopa', 'mg N/L'], [/^turbidity/i, 'turb', 'NTU'], [/^lactic acid/i, 'lactic', 'g/L'],
    [/^potassium/i, 'k', 'mg/L'], [/^tartaric acid/i, 'tartaric', 'g/L'], [/^acetaldehyde/i, 'acetald', 'mg/L'],
    [/^(4-)?ethylphenol/i, 'ep4', 'µg/L'], [/^(4-)?ethylguaiacol/i, 'eg4', 'µg/L'], [/^brettanomyces/i, 'brett', 'cells/mL']
  ];
  var ANALYTE_LABEL = { ph: 'pH', brix: 'Brix', fso2: 'Free SO2', mso2: 'Molecular SO2', tso2: 'Total SO2', ta: 'TA', va: 'VA', alc: 'Alcohol', malic: 'Malic', rs: 'Glucose + fructose', yan: 'YAN', nh3: 'Ammonia', nopa: 'Amino nitrogen', turb: 'Turbidity', lactic: 'Lactic', k: 'Potassium', tartaric: 'Tartaric', acetald: 'Acetaldehyde', ep4: '4-EP', eg4: '4-EG', brett: 'Brett' };

  /* ---------- pure helpers ---------- */
  function linesFromItems(items) {
    /* items: [{str, x, y}] from one page (pdf.js). Group by y, order by x, keep wide gaps as two spaces. */
    var rows = [];
    items.filter(function (i) { return String(i.str).trim(); }).forEach(function (i) {
      var r = rows.filter(function (r) { return Math.abs(r.y - i.y) <= 2.5; })[0];
      if (!r) { r = { y: i.y, items: [] }; rows.push(r); }
      r.items.push(i);
    });
    return rows.sort(function (a, b) { return b.y - a.y; }).map(function (r) {
      var its = r.items.sort(function (a, b) { return a.x - b.x; }); var s = ''; var end = null;
      its.forEach(function (i) { if (end != null) s += (i.x - end > 6 ? '   ' : (i.x - end > 1.2 ? ' ' : '')); s += i.str; end = i.x + (i.w || i.str.length * 4.5); });
      return s;
    });
  }
  function dateFromText(s) {
    var m = String(s).match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
    if (m) return m[3] + '-' + ('0' + MONTHS[m[2].toLowerCase()]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; if (y === '2000') return null; return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2); }
    return null;
  }
  function sampleToBarrel(desc) {
    var t = String(desc || '').trim();
    var m = t.match(/^(?:barrel\s*)?(2[0-9])\s*-\s*0*(\d{1,3})\s*$/i);
    if (m) { var y = 2000 + Number(m[1]); return { vintage: y, barrel: y === 2026 ? '26-' + ('00' + m[2]).slice(-3) : String(Number(m[2])) }; }
    return { vintage: null, barrel: null };
  }
  function cmParseEts(lines) {
    var out = { lab: null, report_no: null, received_on: null, samples: [], unread: [] };
    var all = lines.join('\n');
    if (/ETS Laboratories/i.test(all)) out.lab = 'ETS Laboratories';
    var m = all.match(/#\s*(\d{6,8}[A-Z]?)/) || all.match(/REPORT\s+(\d{6,8}[A-Z]?)/); if (m) out.report_no = m[1];
    var ri = lines.findIndex(function (l) { return /Samples Received/i.test(l); });
    if (ri > -1) for (var k = ri; k < Math.min(lines.length, ri + 4) && !out.received_on; k++) out.received_on = dateFromText(lines[k]);
    if (!out.received_on) { var d0 = all.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i); if (d0) out.received_on = dateFromText(d0[1]); }
    var cur = null;
    lines.forEach(function (raw) {
      var l = raw.replace(/\s+$/, ''); var t = l.trim(); if (!t) return;
      var sm = t.match(/^(\d{9})\s+(.*)$/);
      if (sm) { var same = out.samples.filter(function (x) { return x.lab_id === sm[1]; })[0]; if (same) { cur = same; return; } var b = sampleToBarrel(sm[2]); cur = { lab_id: sm[1], desc: sm[2].trim(), vintage: b.vintage, barrel: b.barrel, results: [] }; out.samples.push(cur); return; }
      if (!cur) return;
      var parts = t.split(/\s{2,}/);
      var name = parts[0]; var map = ETS_NAMES.filter(function (e) { return e[0].test(name); })[0];
      if (!map) { if (/\d/.test(t) && !/[\u2580-\u259F]|^#|code:|SOP|Accredited|report|Laborator|Tel|Page|Street|Highway|Hubbard/i.test(t)) out.unread.push(t); return; }
      if (!map[1]) return;
      var rest = t.slice(name.length).trim();
      var vm = rest.match(/^([<>]?\s*-?[\d.]+)\s*([^\d\s][^\s]*(?:\s[^\d\s/][^\s]*)?)?\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/) || rest.match(/^([<>]?\s*-?[\d.]+)\s*(\S+)?/);
      if (!vm) { out.unread.push(t); return; }
      var vt = vm[1].replace(/\s+/g, ''); var num = Number(vt.replace(/[<>]/g, ''));
      cur.results.push({ analyte: map[1], value: vt[0] === '<' ? num / 2 : num, value_text: vt + (vm[2] && !/^\d/.test(vm[2]) ? ' ' + vm[2] : ''), unit: map[2], date: vm[3] ? dateFromText(vm[3]) : null });
    });
    return out;
  }

  /* ---------- file reading ---------- */
  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load a reader (' + src.split('/').pop() + '). Check the connection.')); }; document.head.appendChild(s); });
  }
  async function pdfLines(buf) {
    await loadScript(PDFJS, function () { return !!window.pdfjsLib; });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    var doc = await window.pdfjsLib.getDocument({ data: buf }).promise; var lines = [];
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p); var tc = await page.getTextContent();
      lines = lines.concat(linesFromItems(tc.items.map(function (i) { return { str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }; })));
    }
    return lines;
  }
  async function readFile(file) {
    var name = file.name.toLowerCase(); var buf = await file.arrayBuffer();
    if (/\.pdf$/.test(name) || file.type === 'application/pdf') return { kind: 'pdf', lines: await pdfLines(buf) };
    if (/\.docx$/.test(name)) { await loadScript(MAMMOTH, function () { return !!window.mammoth; }); var r = await window.mammoth.extractRawText({ arrayBuffer: buf }); return { kind: 'docx', lines: r.value.split(/\r?\n/) }; }
    if (/\.(csv|txt|tsv)$/.test(name) || /^text\//.test(file.type)) return { kind: 'text', text: new TextDecoder().decode(buf) };
    if (/^image\//.test(file.type) || /\.(jpe?g|png|heic|gif|webp)$/.test(name)) return { kind: 'image' };
    return { kind: 'other' };
  }
  function safeName(n) { return String(n).replace(/[^\w.\-]+/g, '_').slice(-80); }

  /* ---------- upload card ---------- */
  function CmLabUpload(props) {
    var sF = React.useState(null), file = sF[0], setFile = sF[1];
    var sR = React.useState(null), res = sR[0], setRes = sR[1];
    var sMap = React.useState({}), map = sMap[0], setMap = sMap[1];
    var sB = React.useState(''), busy = sB[0], setBusy = sB[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    var sM = React.useState(''), msg = sM[0], setMsg = sM[1];
    var sDocs = React.useState(null), docs = sDocs[0], setDocs = sDocs[1];
    var sK = React.useState(0), tick = sK[0], setTick = sK[1];
    var sX = React.useState(null), openDoc = sX[0], setOpenDoc = sX[1];
    var sXr = React.useState([]), docRows = sXr[0], setDocRows = sXr[1];
    var org = props.org || '762fc809-0341-4ee2-834f-16e707181ea7';
    React.useEffect(function () { var live = true; supa.schema('cellarmate').from('lab_documents').select('*').order('id', { ascending: false }).limit(20).then(function (r) { if (live) setDocs(r.data || []); }); return function () { live = false; }; }, [tick]);
    var small = { fontSize: 11, color: C.textDim };
    var inp = Object.assign({}, cmSel, { minWidth: 0 });
    var pick = function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      setFile(f); setRes(null); setErr(''); setMsg(''); setBusy('Reading ' + f.name + '...');
      readFile(f).then(function (r) {
        if (r.kind === 'pdf' || r.kind === 'docx') {
          var ets = cmParseEts(r.lines);
          if (!ets.samples.length && window.cmParseLab) { var g = cmParseLab(r.lines.join('\n'), null); r.generic = g; }
          r.ets = ets;
        } else if (r.kind === 'text' && window.cmParseLab) r.generic = cmParseLab(r.text, null);
        var m = {}; ((r.ets && r.ets.samples) || []).forEach(function (s, i) { m[i] = !s.barrel ? '' : s.vintage === 2026 ? s.barrel : String(s.vintage).slice(2) + '-' + s.barrel; });
        setMap(m); setRes(r); setBusy('');
      }).catch(function (e2) { setBusy(''); setErr(e2.message); });
    };
    var rowsToSave = function () {
      if (!res) return [];
      var out = [];
      if (res.ets && res.ets.samples.length) {
        res.ets.samples.forEach(function (s, i) {
          var code = String(map[i] || '').trim(); var b = code && window.cmBarrelLabels ? cmBarrelLabels.parseCode(code) : null; if (!b && code) { var o = sampleToBarrel(code); if (o.barrel) b = o; }
          s.results.forEach(function (r) {
            out.push({ sample: s.desc, lab_sample_id: s.lab_id, vintage: b ? b.vintage : s.vintage, barrel: b ? b.barrel : s.barrel, sampled_on: r.date || res.ets.received_on, analyte: r.analyte, value: isNaN(r.value) ? null : r.value, value_text: r.value_text, unit: r.unit });
          });
        });
      } else if (res.generic) out = res.generic.rows.map(function (r) { return Object.assign({}, r); });
      return out;
    };
    var save = async function () {
      setErr(''); setMsg(''); setBusy('Saving the document...');
      try {
        var ets = res && res.ets;
        var rows = rowsToSave(); var fallbackDate = (ets && ets.received_on) || new Date().toISOString().slice(0, 10);
        rows.forEach(function (r) { if (!r.sampled_on) r.sampled_on = fallbackDate; });
        if (ets && ets.report_no) {
          var dup = await supa.schema('cellarmate').from('lab_documents').select('id').eq('report_no', ets.report_no).limit(1);
          if (dup.data && dup.data.length && !window.confirm('Report ' + ets.report_no + ' was already loaded. Load it again?')) { setBusy(''); return; }
        }
        var path = org + '/' + new Date().toISOString().slice(0, 7) + '/' + Date.now() + '_' + safeName(file.name);
        var up = await supa.storage.from('lab-docs').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (up.error) throw new Error('Upload failed: ' + up.error.message);
        var doc = await supa.schema('cellarmate').from('lab_documents').insert({ organization_id: org, path: path, filename: file.name, mime: file.type, size_bytes: file.size, lab: (ets && ets.lab) || null, report_no: (ets && ets.report_no) || null, received_on: (ets && ets.received_on) || null, results_count: rows.length, status: rows.length ? 'entered' : (res.kind === 'image' ? 'saved: enter results by hand' : 'saved: nothing read'), uploaded_by: (typeof CM_ME !== 'undefined' && CM_ME.full_name) || null }).select('id').single();
        if (doc.error) throw new Error(doc.error.message);
        if (rows.length) {
          setBusy('Saving ' + rows.length + ' results...');
          var ins = await supa.schema('cellarmate').from('lab_results').insert(rows.map(function (r) { return Object.assign({}, r, { organization_id: org, lab: (ets && ets.lab) || null, report_no: (ets && ets.report_no) || null, document_id: doc.data.id, source: 'Read from ' + file.name, entered_by: (typeof CM_ME !== 'undefined' && CM_ME.full_name) || null }); }));
          if (ins.error) throw new Error('Results not saved: ' + ins.error.message);
        }
        if (typeof CM_CACHE !== 'undefined') delete CM_CACHE.lab_results;
        setMsg('Saved ' + file.name + (rows.length ? ' and ' + rows.length + ' results.' : '. No results were read, so enter them by hand below.'));
        setFile(null); setRes(null); setBusy(''); setTick(tick + 1); if (props.onSaved) props.onSaved();
      } catch (e3) { setBusy(''); setErr(e3.message); }
    };
    var showRows = function (d) {
      if (openDoc === d.id) { setOpenDoc(null); return; }
      setOpenDoc(d.id); setDocRows([]);
      supa.schema('cellarmate').from('lab_results').select('sample,vintage,barrel,analyte,value_text,sampled_on').eq('document_id', d.id).order('id').then(function (r) { setDocRows(r.data || []); });
    };
    var open = function (d) { supa.storage.from('lab-docs').createSignedUrl(d.path, 600).then(function (r) { if (r.error) setErr(r.error.message); else window.open(r.data.signedUrl, '_blank'); }); };
    var ets = res && res.ets;
    var n = rowsToSave().length;
    return cmE('div', { style: { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 } },
      cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Load a lab report'),
      cmE('div', { style: small }, 'Choose an ETS report (PDF), another PDF or Word file, a spreadsheet saved as CSV, or a photo. The file is saved with the records; results it can read are matched to barrels for you to check before saving.'),
      cmE('input', { type: 'file', accept: '.pdf,.docx,.csv,.txt,.tsv,image/*', onChange: pick, style: { marginTop: 8, fontSize: 12, color: C.text } }),
      busy ? cmE('div', { style: { fontSize: 12, color: C.accentLight, marginTop: 6 } }, busy) : null,
      err ? cmE('div', { style: { fontSize: 12, color: C.red, marginTop: 6 } }, err) : null,
      msg ? cmE('div', { style: { fontSize: 12, color: C.green || '#22c55e', marginTop: 6, fontWeight: 700 } }, msg) : null,
      res ? cmE('div', { style: { marginTop: 8 } },
        ets && ets.samples.length ? cmE('div', null,
          cmE('div', { style: { fontSize: 12, marginBottom: 6 } }, (ets.lab || 'Lab') + (ets.report_no ? ' report ' + ets.report_no : '') + (ets.received_on ? ', received ' + ets.received_on : '') + ': ' + ets.samples.length + ' sample' + (ets.samples.length === 1 ? '' : 's') + '.'),
          ets.samples.map(function (s, i) {
            return cmE('div', { key: i, style: { borderTop: '1px solid ' + C.cardBorder, padding: '6px 0' } },
              cmE('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                cmE('span', { style: { fontWeight: 700, fontSize: 12 } }, 'Sample "' + s.desc + '"'), cmE('span', { style: small }, 'lab id ' + s.lab_id),
                cmE('input', { value: map[i] || '', placeholder: 'Barrel, e.g. 26-022 or 25-183 (blank: keep as a sample)', onChange: function (e) { var m2 = Object.assign({}, map); m2[i] = e.target.value; setMap(m2); }, style: Object.assign({}, inp, { flex: '1 1 220px', fontSize: 12 }) })),
              cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 } }, s.results.map(function (r, j) { return cmE('span', { key: j, style: { fontSize: 11, background: C.cardBorder, borderRadius: 5, padding: '2px 6px' } }, (ANALYTE_LABEL[r.analyte] || r.analyte) + ' ' + r.value_text); })));
          }),
          ets.unread.length ? cmE('div', { style: Object.assign({}, small, { marginTop: 4 }) }, 'Lines not read (enter by hand if needed): ' + ets.unread.slice(0, 6).join(' | ')) : null)
          : res.generic && res.generic.rows.length ? cmE('div', { style: { fontSize: 12 } }, res.generic.rows.length + ' results read from the file.')
          : cmE('div', { style: { fontSize: 12, color: C.orange } }, res.kind === 'image' ? 'Photos are saved with the records but not read. After saving, type the results in the box below.' : 'No results could be read from this file. It can still be saved; type the results in the box below.'),
        cmE('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
          cmE('button', { onClick: save, disabled: !!busy, style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' } }, n ? 'Save file and ' + n + ' results' : 'Save file'),
          cmE('button', { onClick: function () { setFile(null); setRes(null); }, style: { background: C.card, color: C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 14px', fontWeight: 700, cursor: 'pointer' } }, 'Cancel'))) : null,
      docs && docs.length ? cmE('div', { style: { marginTop: 10 } }, cmE('div', { style: Object.assign({}, small, { fontWeight: 700 }) }, 'Saved lab documents'),
        docs.map(function (d) { return cmE('div', { key: d.id, style: { display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', flexWrap: 'wrap', alignItems: 'center' } },
          cmE('span', { style: { color: C.textDim, minWidth: 80 } }, d.received_on || String(d.created_at).slice(0, 10)),
          cmE('span', { style: { flex: '1 1 200px' } }, (d.report_no ? d.lab + ' ' + d.report_no + ' · ' : '') + d.filename + ' · ' + d.results_count + ' results' + (d.status && d.status !== 'entered' ? ' · ' + d.status : '')),
          cmE('span', { onClick: function () { showRows(d); }, style: { color: C.accentLight, cursor: 'pointer', fontWeight: 700 } }, openDoc === d.id ? 'Hide results' : 'Results'),
          cmE('span', { onClick: function () { open(d); }, style: { color: C.accentLight, cursor: 'pointer', fontWeight: 700 } }, 'Open file'),
          openDoc === d.id ? cmE('div', { style: { flexBasis: '100%', paddingLeft: 8 } }, (function () {
            var g = {}; docRows.forEach(function (r) { var k = r.sample + (r.barrel ? ' (barrel ' + (r.vintage === 2026 ? r.barrel : String(r.vintage).slice(2) + '-' + r.barrel) + ')' : ''); (g[k] = g[k] || []).push((ANALYTE_LABEL[r.analyte] || r.analyte) + ' ' + r.value_text); });
            var ks = Object.keys(g); return ks.length ? ks.map(function (k) { return cmE('div', { key: k, style: { fontSize: 11, marginBottom: 3 } }, cmE('b', null, k + ': '), g[k].join(', ')); }) : cmE('div', { style: small }, 'Loading...');
          })()) : null); })) : null);
  }

  window.cmParseEts = cmParseEts; window.cmLinesFromItems = linesFromItems; window.cmEtsSampleToBarrel = sampleToBarrel;
  window.CmLabUpload = CmLabUpload;
})();
