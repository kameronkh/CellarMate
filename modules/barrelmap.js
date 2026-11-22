/* CellarMate module: Barrel map
   Views: Layout (racks and rows as they stand), List (every barrel with its spot),
   By lot (where each wine is), Work list (what to do, in walking order).
   Color by wine or by next step. Every view prints (or saves as PDF from the print dialog).
   Reads barrel_positions plus the 2025 and 2026 status tables. Registers in CM_MODULES. */
(function () {
  'use strict';
  var ROSE = { '26-004': 1, '26-005': 1, '26-039': 1 };

  /* ---------- data helpers (pure, tested in tests/smoke.js) ---------- */
  function kindOf(p, st) {
    if (!p.barrel) return 'client';
    if (!st) return 'unk';
    if (ROSE[p.barrel] || /ros/i.test(st.wine_type || '')) return 'rose';
    if (/white/i.test(st.wine_type || '')) return 'white';
    var lot = st.lot_name || st.vineyard || '';
    if (!lot || /not in barrel list|not linked/i.test(lot)) return 'unk';
    if (st.owner && !/tystrya/i.test(st.owner) && p.vintage === 2026) return 'client';
    return 'red';
  }
  function stepOf(p) {
    if (!p.barrel) return 'client';
    var t = ((p.st && (p.st.action_group || '')) + ' ' + (p.st && (p.st.action || ''))).toLowerCase();
    if (!p.st) return 'unk';
    if (/owner|decision|client|confirm contents/.test(t)) return 'decide';
    if (/hold/.test(t)) return 'hold';
    if (/(^|\W)add so2|top up so2/.test(t) && !/done|added \d|so2 added/.test(t)) return 'add';
    if (/test|malic|brix|measure|check|relabel/.test(t)) return 'test';
    return 'ok';
  }
  var STEP_LABEL = { add: 'Add SO2', test: 'Test or check', hold: 'Hold', decide: 'Owner or winemaker decides', ok: 'Done or at target', unk: 'Not on file', client: 'Client or other winemaker' };
  var STEP_ORDER = ['add', 'test', 'decide', 'hold', 'ok', 'unk'];
  function short(st) {
    var s = (st && (st.lot_name || st.vineyard)) || '';
    return s.replace(/Estate Blk/g, 'Est').replace(/ \(.*$/, '').replace('Terry Vineyard Chardonnay', 'Terry Ch').slice(0, 18);
  }
  function lotName(p) {
    if (!p.st) return 'Not on file';
    var s = (p.st.lot_name || p.st.vineyard || 'Lot not written').replace(/;.*$/, '');
    if (/not in barrel list|not linked/i.test(s)) s = 'Lot not written';
    return p.vintage + ' ' + s + (p.st.owner && !/tystrya/i.test(p.st.owner) ? ' (' + p.st.owner + ')' : '');
  }
  function where(p) {
    if (p.area === 'EBS') return 'EBS ' + p.rack + ' ' + p.side.toLowerCase() + ' ' + p.col;
    if (p.area === 'Rows') return 'Row ' + p.rack + ' col ' + p.col + ' ' + p.side.toLowerCase() + ' ' + (p.level || '');
    return p.label || '';
  }
  function walkKey(p) {
    var a = p.area === 'EBS' ? 0 : p.area === 'Rows' ? 1 : 2;
    return [a, ('00' + p.rack).slice(-2), p.col, p.side === 'Front' ? 0 : 1, p.level || '', p.barrel || ''].join('|');
  }
  function cmMapIndex(pos, s25, s26, srows) {
    var i25 = {}, i26 = {}, iS = {};
    (srows || []).forEach(function (r) { var b = String(r.b || ''); iS[r.v + '|' + (r.v === 2025 ? b.replace(/^25-0*/, '') : b)] = r; });
    s25.forEach(function (r) { i25[r.barrel] = r; });
    s26.forEach(function (r) { i26[r.barrel] = r; });
    return pos.filter(function (p) { return p.active !== false; }).map(function (p) {
      var st = p.vintage === 2025 ? i25[p.barrel] : p.vintage === 2026 ? i26[p.barrel] : null;
      var o = Object.assign({}, p, { st: st, kind: kindOf(p, st) });
      var sr = p.barrel ? iS[p.vintage + '|' + p.barrel] : null;
      o.step = sr ? (sr.cat === 'other' ? 'ok' : sr.cat) : stepOf(o);
      o.act = sr ? sr.action : (st ? st.action : '');
      o.g = sr ? sr.g : (st ? st.so2_grams : null);
      if (o.g === '' || o.g === undefined) o.g = null;
      return o;
    });
  }
  function cmMapLots(items) {
    var g = {};
    items.filter(function (p) { return p.barrel; }).forEach(function (p) { var k = lotName(p); (g[k] = g[k] || []).push(p); });
    return Object.keys(g).sort().map(function (k) { return { lot: k, barrels: g[k].sort(function (a, b) { return walkKey(a) < walkKey(b) ? -1 : 1; }) }; });
  }
  function cmMapWork(items) {
    var g = {};
    items.filter(function (p) { return p.barrel; }).forEach(function (p) { (g[p.step] = g[p.step] || []).push(p); });
    return STEP_ORDER.filter(function (k) { return g[k]; }).map(function (k) { return { step: k, label: STEP_LABEL[k], barrels: g[k].sort(function (a, b) { return walkKey(a) < walkKey(b) ? -1 : 1; }) }; });
  }

  /* ---------- colors ---------- */
  var DARK = { red: '#5a2230', white: '#5a5022', rose: '#6a2250', client: '#22385a', unk: '#3a3a3a', add: '#7a2a1a', test: '#5a4a12', hold: '#283f66', decide: '#4a2a66', ok: '#1f4a33' };
  var LIGHT = { red: '#F4D3D9', white: '#FBF1C7', rose: '#F4B6D2', client: '#DCE8F5', unk: '#E3E3E3', add: '#F8C9B8', test: '#F6E7A8', hold: '#CFE0F7', decide: '#E3D3F3', ok: '#CDEBD9' };
  function fillOf(p, by, pal) { return pal[by === 'step' && p.barrel ? p.step : p.kind] || pal.unk; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ---------- printable HTML (same layouts, white paper) ---------- */
  function cellHtml(p, by) {
    if (!p) return '<td class="e"></td>';
    var bg = fillOf(p, by, LIGHT);
    var num = p.barrel ? (p.vintage === 2026 ? p.barrel.slice(3) : p.barrel) : esc(p.label);
    var sub = p.barrel ? (by === 'step' ? STEP_LABEL[p.step] : (p.vintage === 2025 && p.area === 'Rows' ? '2025' : short(p.st))) : '';
    return '<td style="background:' + bg + (p.flag ? ';outline:2px solid #E07000;outline-offset:-2px' : '') + '"><b>' + num + '</b><br><span>' + esc(sub) + '</span></td>';
  }
  function legendHtml(by) {
    var keys = by === 'step' ? STEP_ORDER.concat(['client']) : ['red', 'white', 'rose', 'client', 'unk'];
    var names = { red: 'Red', white: 'White', rose: 'Rose', client: 'Client or other winemaker', unk: 'Lot unknown' };
    return '<div class="lg">' + keys.map(function (k) { return '<span style="background:' + LIGHT[k] + '">' + esc(by === 'step' ? STEP_LABEL[k] : names[k]) + '</span>'; }).join('') + '<span style="outline:2px solid #E07000">Orange = check</span></div>';
  }
  function layoutHtml(items, by) {
    var h = '<h2>EBS racks (2025 wine)</h2><table class="g"><tr><th>Lvl</th><th>Front A</th><th>Front B</th><th>Front C</th><th>Front D</th><th class="sp"></th><th>Back A</th><th>Back B</th><th>Back C</th><th>Back D</th></tr>';
    for (var l = 12; l >= 1; l--) {
      h += '<tr><th>' + l + '</th>';
      ['Front', 'Back'].forEach(function (side, si) {
        if (si) h += '<td class="sp"></td>';
        'ABCD'.split('').forEach(function (c) { h += cellHtml(items.filter(function (p) { return p.area === 'EBS' && p.rack === l && p.side === side && p.col === c; })[0], by); });
      });
      h += '</tr>';
    }
    h += '</table><div class="pb"></div><h2>Floor rows (2026 wine)</h2><table class="g"><tr><th>Row</th><th>Lvl</th>';
    for (var c = 1; c <= 4; c++) h += '<th>Col ' + c + ' front</th><th>Col ' + c + ' back</th>';
    h += '</tr>';
    var rows = cmUniq(items.filter(function (p) { return p.area === 'Rows'; }).map(function (p) { return p.rack; })).sort(function (a, b) { return a - b; });
    rows.forEach(function (rn) {
      ['D', 'C', 'B', 'A'].forEach(function (lv, li) {
        h += '<tr' + (li === 3 ? ' class="rb"' : '') + '>' + (li === 0 ? '<th rowspan="4">' + rn + '</th>' : '') + '<th>' + lv + '</th>';
        for (var c = 1; c <= 4; c++) {
          var inCol = items.filter(function (p) { return p.area === 'Rows' && p.rack === rn && p.col === String(c); });
          var block = inCol.filter(function (p) { return !p.barrel; })[0];
          if (block) { if (li === 0) h += '<td colspan="2" rowspan="4" style="background:' + LIGHT.client + '"><b>' + esc(block.label) + '</b></td>'; continue; }
          ['Front', 'Back'].forEach(function (side) { h += cellHtml(inCol.filter(function (p) { return p.level === lv && p.side === side; })[0], by); });
        }
        h += '</tr>';
      });
    });
    h += '</table>';
    var pal = items.filter(function (p) { return p.area === 'Pallets'; });
    if (pal.length) h += '<h2>Pallets and small vessels</h2><table class="t">' + pal.map(function (p) { return '<tr><td>Pallet ' + p.rack + '</td><td>' + esc(p.label) + (p.note ? ' (' + esc(p.note) + ')' : '') + '</td></tr>'; }).join('') + '</table>';
    return h;
  }
  function listHtml(items) {
    var rows = items.filter(function (p) { return p.barrel; }).sort(function (a, b) { return (a.vintage + a.barrel) < (b.vintage + b.barrel) ? -1 : 1; });
    return '<h2>Every barrel and its spot (' + rows.length + ')</h2><table class="t"><tr><th>Vintage</th><th>Barrel</th><th>Where</th><th>Wine</th><th>Next step</th><th>pH</th></tr>' + rows.map(function (p) {
      return '<tr><td>' + p.vintage + '</td><td><b>' + esc(p.barrel) + '</b></td><td>' + esc(where(p)) + '</td><td>' + esc(lotName(p).replace(/^\d{4} /, '')) + '</td><td>' + esc(p.act || '') + '</td><td>' + esc(p.st && p.st.ph_latest || '') + '</td></tr>';
    }).join('') + '</table>';
  }
  function lotsHtml(items) {
    return '<h2>Where each wine is</h2>' + cmMapLots(items).map(function (g) {
      return '<div class="grp"><b>' + esc(g.lot) + '</b> <span class="n">' + g.barrels.length + ' barrel' + (g.barrels.length === 1 ? '' : 's') + '</span><br>' + g.barrels.map(function (p) { return esc(p.barrel) + ' <span class="n">(' + esc(where(p)) + ')</span>'; }).join(', ') + '</div>';
    }).join('');
  }
  function workHtml(items) {
    return '<h2>Work list, in walking order</h2>' + cmMapWork(items).filter(function (g) { return g.step !== 'ok'; }).map(function (g) {
      return '<h3 style="background:' + LIGHT[g.step] + '">' + esc(g.label) + ' (' + g.barrels.length + ')</h3><table class="t"><tr><th class="ck">Done</th><th>Where</th><th>Barrel</th><th>Wine</th><th>What to do</th><th>Grams</th></tr>' + g.barrels.map(function (p) {
        return '<tr><td class="ck">&#9744;</td><td>' + esc(where(p)) + '</td><td><b>' + esc(p.barrel) + '</b></td><td>' + esc(lotName(p).replace(/^\d{4} /, '')) + '</td><td>' + esc(p.act || '') + '</td><td>' + esc(p.g != null ? p.g + ' g' : '') + '</td></tr>';
      }).join('') + '</table>';
    }).join('');
  }
  var CSS = 'body{font-family:Helvetica,Arial,sans-serif;color:#222;margin:18px}h1{color:#7B1E3A;font-size:20px;margin:0 0 2px}h2{color:#7B1E3A;font-size:15px;margin:14px 0 6px}h3{font-size:12px;padding:3px 6px;margin:10px 0 4px}.sub{color:#666;font-size:11px;margin-bottom:6px}' +
    'table{border-collapse:collapse;width:100%}table.g td,table.g th{border:1px solid #999;font-size:9px;text-align:center;padding:2px;height:26px}table.g td span{font-size:8px;color:#333}table.g th{background:#EFE7EA}td.sp,th.sp{border:none!important;background:#fff!important;width:8px}td.e{background:#fff}tr.rb td,tr.rb th{border-bottom:2px solid #000}' +
    'table.t td,table.t th{border:1px solid #bbb;font-size:10px;padding:3px 5px;text-align:left}table.t th{background:#EFE7EA}.ck{width:34px;text-align:center!important;font-size:13px!important}.grp{font-size:10.5px;margin:0 0 7px;line-height:1.35}.n{color:#666}' +
    '.lg span{display:inline-block;font-size:9px;padding:2px 6px;margin:0 4px 4px 0;border:1px solid #bbb}.pb{page-break-after:always}@page{size:landscape;margin:10mm}@media print{.noprint{display:none}}button{font-size:14px;padding:6px 14px;margin-bottom:10px}';
  function cmMapPrintHtml(view, items, by) {
    var title = { layout: 'Barrel map', list: 'Barrel list', lots: 'Barrels by wine', work: 'Cellar work list' }[view] || 'Barrel map';
    var asOf = (items[0] && items[0].as_of) || '';
    var body = view === 'list' ? listHtml(items) : view === 'lots' ? lotsHtml(items) : view === 'work' ? workHtml(items) : (legendHtml(by) + layoutHtml(items, by));
    return '<!doctype html><html><head><meta charset="utf-8"><title>CellarMate ' + title + '</title><style>' + CSS + '</style></head><body>' +
      '<div class="noprint"><button onclick="window.print()">Print or save as PDF</button></div><h1>CellarMate: ' + title + '</h1><div class="sub">Positions as of ' + esc(asOf) + '. Printed ' + new Date().toLocaleDateString() + '.</div>' + body + '</body></html>';
  }
  function printView(view, items, by) {
    var html = cmMapPrintHtml(view, items, by);
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400); return 'window'; }
    var f = document.createElement('iframe'); f.style.position = 'fixed'; f.style.right = '0'; f.style.bottom = '0'; f.style.width = '0'; f.style.height = '0'; f.style.border = '0';
    document.body.appendChild(f); f.srcdoc = html;
    f.onload = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { f.remove(); }, 60000); };
    return 'frame';
  }

  /* ---------- screen ---------- */
  function CmBarrelMap() {
    var sD = React.useState(null), D = sD[0], setD = sD[1];
    var sV = React.useState('layout'), view = sV[0], setView = sV[1];
    var sA = React.useState('EBS'), area = sA[0], setArea = sA[1];
    var sB = React.useState('wine'), by = sB[0], setBy = sB[1];
    var sS = React.useState(null), sel = sS[0], setSel = sS[1];
    var sQ = React.useState(''), q = sQ[0], setQ = sQ[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    var sR = React.useState({ s25: [], s26: [] }), raw = sR[0], setRaw = sR[1];
    var sT = React.useState(0), tick = sT[0], setTick = sT[1];
    var sM = React.useState(false), moveMode = sM[0], setMoveMode = sM[1];
    var sP = React.useState(null), pick = sP[0], setPick = sP[1];
    var sG = React.useState(null), target = sG[0], setTarget = sG[1];
    var sN = React.useState(''), note = sN[0], setNote = sN[1];
    var sMsg = React.useState(''), msg = sMsg[0], setMsg = sMsg[1];
    var sH = React.useState(null), hist = sH[0], setHist = sH[1];
    var sU = React.useState(false), showUn = sU[0], setShowUn = sU[1];
    var sBusy = React.useState(false), busy = sBusy[0], setBusy = sBusy[1];
    var MV = window.cmBarrelMoves;
    var LB = window.cmBarrelLabels;
    var sL = React.useState(false), showLabels = sL[0], setShowLabels = sL[1];
    var sLs = React.useState('placed'), labelSet = sLs[0], setLabelSet = sLs[1];
    var sLz = React.useState('small'), labelSize = sLz[0], setLabelSize = sLz[1];
    var sHi = React.useState(null), selHist = sHi[0], setSelHist = sHi[1];
    React.useEffect(function () {
      var f = window.CM_MAP_FOCUS; if (!D || !f) return;
      window.CM_MAP_FOCUS = null;
      var p = D.filter(function (x) { return x.barrel && x.vintage === f.vintage && x.barrel === f.barrel; })[0];
      setView('layout'); setMoveMode(false);
      if (p) { setArea(p.area === 'Pallets' ? 'Pallets' : p.area); setSel(p); setQ(p.barrel); setMsg('Opened from a barrel label.'); }
      else setErr('Barrel ' + (f.vintage === 2025 ? '25-' : '') + f.barrel + ' is not on the map yet.');
    }, [D]);
    React.useEffect(function () {
      var live = true; setSelHist(null);
      if (sel && sel.barrel && LB) LB.history(sel).then(function (h) { if (live) setSelHist(h); }).catch(function () { if (live) setSelHist([]); });
      return function () { live = false; };
    }, [sel && sel.id]);
    var canMove = !!MV && (typeof cmCan !== 'function' || cmCan('moves'));
    React.useEffect(function () {
      var live = true;
      Promise.all([cmFetch('barrel_positions'), cmFetch('barrel_status_2025'), cmFetch('barrel_status_2026'), (typeof cmStatusRows === 'function' ? cmStatusRows() : Promise.resolve([])).catch(function () { return []; })])
        .then(function (a) { if (live) { setRaw({ s25: a[1], s26: a[2] }); setD(cmMapIndex(a[0], a[1], a[2], a[3])); } })
        .catch(function (e) { if (live) { setErr(e.message); setD([]); } });
      if (MV && moveMode) MV.recent(12).then(function (h) { if (live) setHist(h); }).catch(function () {});
      return function () { live = false; };
    }, [tick, moveMode]);
    var runMove = function (fn, ok) {
      setBusy(true); setErr(''); setMsg('');
      Promise.resolve().then(fn).then(function () { setMsg(ok); setPick(null); setTarget(null); setNote(''); setSel(null); setTick(tick + 1); })
        .catch(function (e) { var m = e.message || String(e); setErr(/^occupied:/.test(m) ? 'Spot is taken by ' + m.split(':')[1] + '.' : m); })
        .then(function () { setBusy(false); });
    };
    var chooseSlot = function (slot) {
      if (!moveMode || !pick) return;
      setTarget(slot); setErr(''); setMsg('');
    };
    if (!D) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var small = { fontSize: 11, color: C.textDim };
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var norm = function (s) { return String(s || '').replace(/^26-/, '').replace(/^0+/, ''); };
    var hit = function (p) { return q && p.barrel && norm(p.barrel) === norm(q); };
    var dropProps = function (slot) {
      return { onDragOver: function (e) { if (moveMode) e.preventDefault(); }, onDrop: function (e) { if (!moveMode) return; e.preventDefault(); chooseSlot(slot); } };
    };
    var isTarget = function (slot) { return target && slot && MV && MV.slotKey(target) === MV.slotKey(slot); };
    var box = function (p, key, slot) {
      if (!p) return cmE('div', Object.assign({ key: key, onClick: function () { chooseSlot(slot); },
        style: { minHeight: 34, border: (isTarget(slot) ? '2px solid ' + C.accentLight : '1px dashed ' + C.cardBorder), borderRadius: 6, cursor: moveMode && pick ? 'pointer' : 'default', background: moveMode && pick ? 'rgba(139,92,246,0.08)' : 'transparent' } }, slot ? dropProps(slot) : {}));
      var isSel = sel && sel.id === p.id;
      var isPick = pick && pick.id === p.id;
      var click = function () {
        if (moveMode) { if (pick && !isPick) chooseSlot(slot || p); else { setPick(isPick ? null : p); setTarget(null); setErr(''); setMsg(''); } return; }
        setSel(isSel ? null : p);
      };
      return cmE('div', Object.assign({ key: key, onClick: click, title: p.barrel || p.label, draggable: !!(moveMode && p.barrel),
        onDragStart: function (e) { if (!moveMode) return; try { e.dataTransfer.setData('text/plain', String(p.id)); } catch (x) {} setPick(p); setTarget(null); },
        style: { minHeight: 34, background: fillOf(p, by, DARK), borderRadius: 6, padding: '3px 4px', cursor: moveMode ? 'grab' : 'pointer', textAlign: 'center', lineHeight: 1.15, opacity: isPick ? 0.55 : 1,
          border: '2px solid ' + (isPick || isTarget(slot) ? C.accentLight : hit(p) ? C.accentLight : isSel ? '#fff' : p.flag ? C.orange : 'transparent') } }, slot ? dropProps(slot) : {}),
        cmE('div', { style: { fontWeight: 800, fontSize: 12 } }, p.barrel ? (p.vintage === 2026 ? p.barrel.slice(3) : p.barrel) : p.label),
        p.barrel ? cmE('div', { style: { fontSize: 9, color: '#ddd' } }, by === 'step' ? STEP_LABEL[p.step] : (p.vintage === 2025 && p.area === 'Rows' ? '2025' : short(p.st))) : null);
    };
    var spotBtn = function (p) { return cmE('span', { key: p.id, onClick: function () { setSel(p); setView('layout'); setArea(p.area === 'Pallets' ? 'Pallets' : p.area); setQ(p.barrel); }, style: { cursor: 'pointer', color: C.accentLight, whiteSpace: 'nowrap' } }, p.barrel + ' · ' + where(p)); };

    var body;
    if (view === 'list') {
      var rows = D.filter(function (p) { return p.barrel && (!q || norm(p.barrel).indexOf(norm(q)) === 0 || lotName(p).toLowerCase().indexOf(q.toLowerCase()) > -1); })
        .sort(function (a, b) { return (a.vintage + a.barrel) < (b.vintage + b.barrel) ? -1 : 1; });
      body = cmE('div', { style: card }, rows.map(function (p) {
        return cmE('div', { key: p.id, onClick: function () { setSel(p); setView('layout'); setArea(p.area); setQ(p.barrel); }, style: { display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid ' + C.cardBorder, cursor: 'pointer', flexWrap: 'wrap' } },
          cmE('span', { style: { minWidth: 70, fontWeight: 700 } }, p.vintage === 2026 ? p.barrel : '25-' + p.barrel),
          cmE('span', { style: { minWidth: 150, color: C.accentLight } }, where(p)),
          cmE('span', { style: { flex: '1 1 160px' } }, lotName(p).replace(/^\d{4} /, '')),
          cmE('span', { style: { flex: '1 1 160px', color: C.textDim } }, p.act || ''));
      }));
    } else if (view === 'lots') {
      body = cmE('div', null, cmMapLots(D).filter(function (g) { return !q || g.lot.toLowerCase().indexOf(q.toLowerCase()) > -1; }).map(function (g) {
        return cmE('div', { key: g.lot, style: card }, cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, g.lot + '  ', cmE('span', { style: small }, g.barrels.length + ' barrel' + (g.barrels.length === 1 ? '' : 's'))),
          cmE('div', { style: { fontSize: 12, lineHeight: 1.7, display: 'flex', flexWrap: 'wrap', columnGap: 10 } }, g.barrels.map(spotBtn)));
      }));
    } else if (view === 'work') {
      body = cmE('div', null, cmMapWork(D).filter(function (g) { return g.step !== 'ok'; }).map(function (g) {
        return cmE('div', { key: g.step, style: card }, cmE('div', { style: { fontWeight: 700, marginBottom: 6 } }, cmE('span', { style: { display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: DARK[g.step], marginRight: 6 } }), g.label + ' (' + g.barrels.length + ')'),
          g.barrels.map(function (p) {
            return cmE('div', { key: p.id, style: { display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px solid ' + C.cardBorder, flexWrap: 'wrap' } },
              cmE('span', { style: { minWidth: 150, color: C.accentLight } }, where(p)), cmE('span', { style: { minWidth: 60, fontWeight: 700 } }, p.barrel),
              cmE('span', { style: { flex: '1 1 200px' } }, p.act || ''), p.g != null ? cmE('span', { style: { fontWeight: 700 } }, p.g + ' g') : null);
          }));
      }));
    } else {
      var mine = D.filter(function (p) { return p.area === area; });
      if (area === 'EBS') {
        var levels = []; for (var l = 12; l >= 1; l--) levels.push(l);
        var tpl = '34px repeat(4, 1fr) 10px repeat(4, 1fr)';
        body = cmE('div', { style: { overflowX: 'auto' } }, cmE('div', { style: { minWidth: 640 } },
          cmE('div', { style: { display: 'grid', gridTemplateColumns: tpl, gap: 4, marginBottom: 4, fontSize: 10, color: C.textDim, textAlign: 'center' } },
            [cmE('div', { key: 'h' }, 'Lvl')].concat('ABCD'.split('').map(function (c) { return cmE('div', { key: 'f' + c }, 'Front ' + c); }), [cmE('div', { key: 'sp' })], 'ABCD'.split('').map(function (c) { return cmE('div', { key: 'b' + c }, 'Back ' + c); }))),
          levels.map(function (lv) {
            var cells = [cmE('div', { key: 'l', style: { fontWeight: 700, alignSelf: 'center', textAlign: 'center' } }, lv)];
            ['Front', 'Back'].forEach(function (side, si) {
              if (si) cells.push(cmE('div', { key: 'sp' }));
              'ABCD'.split('').forEach(function (c) { cells.push(box(mine.filter(function (p) { return p.rack === lv && p.side === side && p.col === c; })[0], side + c, { area: 'EBS', rack: lv, col: c, side: side, level: null })); });
            });
            return cmE('div', { key: lv, style: { display: 'grid', gridTemplateColumns: tpl, gap: 4, marginBottom: 4 } }, cells);
          })));
      } else if (area === 'Rows') {
        var rowsN = cmUniq(mine.map(function (p) { return p.rack; })).sort(function (a, b) { return a - b; });
        body = cmE('div', { style: { overflowX: 'auto' } }, cmE('div', { style: { minWidth: 700 } }, rowsN.map(function (rn) {
          var inRow = mine.filter(function (p) { return p.rack === rn; });
          return cmE('div', { key: rn, style: Object.assign({}, card, { padding: 8 }) },
            cmE('div', { style: { fontWeight: 700, marginBottom: 6 } }, 'Row ' + rn),
            cmE('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 } }, ['1', '2', '3', '4'].map(function (c) {
              var inCol = inRow.filter(function (p) { return p.col === c; });
              var block = inCol.filter(function (p) { return !p.barrel; })[0];
              return cmE('div', { key: c },
                cmE('div', { style: Object.assign({}, small, { textAlign: 'center', marginBottom: 3 }) }, 'Column ' + c + ' · front | back'),
                block ? cmE('div', { style: { minHeight: 60, background: DARK.client, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 } }, block.label)
                  : cmE('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 } }, ['D', 'C', 'B', 'A'].map(function (lv) {
                    return ['Front', 'Back'].map(function (side) { return box(inCol.filter(function (p) { return p.level === lv && p.side === side; })[0], lv + side, { area: 'Rows', rack: rn, col: c, side: side, level: lv }); });
                  })));
            })));
        })));
      } else {
        body = cmE('div', null, mine.sort(function (a, b) { return a.rack - b.rack; }).map(function (p) {
          return cmE('div', { key: p.id, style: card }, cmE('div', { style: { fontWeight: 700 } }, 'Pallet ' + p.rack + ': ' + p.label), p.note ? cmE('div', { style: small }, p.note) : null);
        }));
      }
    }
    var unpl = MV ? MV.unplaced(D, raw.s25, raw.s26) : [];
    var pl = MV && pick && target ? MV.plan(D, pick, target) : null;
    var btn = function (label, fn, primary, dis) { return cmE('button', { onClick: fn, disabled: !!dis, style: { background: primary ? C.accent : C.card, color: primary ? '#fff' : C.accentLight, border: '1px solid ' + (primary ? C.accent : C.cardBorder), borderRadius: 8, padding: '6px 12px', cursor: dis ? 'default' : 'pointer', fontWeight: 700, opacity: dis ? 0.5 : 1 } }, label); };
    var pickName = pick ? ((pick.vintage === 2025 ? '25-' : '') + pick.barrel) : '';
    var movePanel = moveMode && view === 'layout' ? cmE('div', { style: Object.assign({}, card, { borderColor: C.accent }) },
      cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Move barrels'),
      cmE('div', { style: small }, !pick ? 'Tap a barrel (or drag it on a computer), then tap the spot it went to. Tap a barrel that is already there to swap them.' :
        !target ? 'Picked ' + pickName + (pick.id ? ' at ' + MV.slotText(pick) : ' (not on the map yet)') + '. Now tap the spot it went to' + (pick.id ? ', or take it off the map.' : '.') : ''),
      pl ? cmE('div', { style: { marginTop: 6, fontSize: 13 } },
        pl.ok ? (pl.kind === 'swap' ? 'Swap ' + pickName + ' (' + MV.slotText(pick) + ') with ' + pl.other.barrel + ' (' + MV.slotText(target) + ')?' :
          pl.kind === 'place' ? 'Place ' + pickName + ' at ' + MV.slotText(target) + '?' : 'Move ' + pickName + ' from ' + MV.slotText(pick) + ' to ' + MV.slotText(target) + '?')
          : cmE('span', { style: { color: C.orange } }, pl.reason)) : null,
      pick ? cmE('input', { value: note, onChange: function (e) { setNote(e.target.value); }, placeholder: 'Note (optional): who, why', style: Object.assign({}, cmSel, { width: '100%', marginTop: 6, boxSizing: 'border-box' }) }) : null,
      cmE('div', { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
        pl && pl.ok ? btn(busy ? 'Saving...' : pl.kind === 'swap' ? 'Swap' : pl.kind === 'place' ? 'Place' : 'Move', function () {
          runMove(function () { return pl.kind === 'place' ? MV.place(pick, target, note) : MV.move(pick, target, note, pl.kind === 'swap'); }, (pl.kind === 'swap' ? 'Swapped ' : pl.kind === 'place' ? 'Placed ' : 'Moved ') + pickName + '.');
        }, true, busy) : null,
        pick && pick.id && !target ? btn('Take off map', function () {
          if (!note.trim()) { setErr('Add a note first: emptied, bottled, moved out, sold.'); return; }
          runMove(function () { return MV.remove(pick, note.trim()); }, pickName + ' taken off the map.');
        }, false, busy) : null,
        pick ? btn('Cancel', function () { setPick(null); setTarget(null); setErr(''); }) : null,
        btn((showUn ? 'Hide' : 'Show') + ' barrels not on the map (' + unpl.length + ')', function () { setShowUn(!showUn); })),
      showUn ? cmE('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } }, unpl.map(function (u) {
        var isP = pick && !pick.id && pick.barrel === u.barrel && pick.vintage === u.vintage;
        return cmE('span', { key: u.vintage + u.barrel, title: u.label, onClick: function () { setPick(isP ? null : u); setTarget(null); setErr(''); },
          style: { fontSize: 11, padding: '3px 7px', borderRadius: 6, cursor: 'pointer', background: isP ? C.accent : C.cardBorder, color: '#fff' } }, (u.vintage === 2025 ? '25-' : '') + u.barrel);
      })) : null,
      hist && hist.length ? cmE('div', { style: { marginTop: 10 } }, cmE('div', { style: Object.assign({}, small, { fontWeight: 700, marginBottom: 2 }) }, 'Recent moves'),
        hist.map(function (m) {
          return cmE('div', { key: m.id, style: { display: 'flex', gap: 8, fontSize: 11, padding: '2px 0', alignItems: 'center', opacity: m.undone_at ? 0.45 : 1 } },
            cmE('span', { style: { color: C.textDim, minWidth: 92 } }, (m.moved_at ? new Date(m.moved_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')),
            cmE('span', { style: { flex: 1 } }, MV.describe(m) + (m.moved_by ? ' · ' + m.moved_by : '') + (m.undone_at ? ' (undone)' : '')),
            !m.undone_at ? cmE('span', { onClick: function () { runMove(function () { return MV.undo(m.id); }, 'Undone.'); }, style: { color: C.accentLight, cursor: 'pointer' } }, 'Undo') : null);
        })) : null) : null;
    var detail = sel && view === 'layout' && !moveMode ? cmE('div', { style: Object.assign({}, card, { borderColor: C.accentLight }) },
      cmE('div', { style: { fontWeight: 800 } }, sel.barrel ? (sel.vintage + ' barrel ' + sel.barrel) : sel.label),
      cmE('div', { style: small }, where(sel)),
      sel.st ? cmE('div', { style: { fontSize: 12, marginTop: 4 } }, [sel.st.lot_name || sel.st.vineyard, sel.st.owner, sel.st.wine_type, sel.st.ph_latest ? 'pH ' + sel.st.ph_latest : null].filter(Boolean).join(' · ')) : null,
      sel.act ? cmE('div', { style: { fontSize: 12, color: C.accentLight, marginTop: 2 } }, sel.act + (sel.g != null ? ' (' + sel.g + ' g)' : '')) : null,
      sel.note ? cmE('div', { style: small }, 'Map note: ' + sel.note) : null,
      sel.flag ? cmE('div', { style: { fontSize: 12, color: C.orange } }, sel.flag) : null,
      sel.barrel ? cmE('div', { style: { marginTop: 6 } }, cmE('div', { style: Object.assign({}, small, { fontWeight: 700 }) }, 'History'),
        selHist === null ? cmE('div', { style: small }, 'Loading...') : !selHist.length ? cmE('div', { style: small }, 'Nothing logged yet.') :
          selHist.map(function (h, i) { return cmE('div', { key: i, style: { fontSize: 11, display: 'flex', gap: 8 } }, cmE('span', { style: { color: C.textDim, minWidth: 74 } }, h.d), cmE('span', null, h.t)); })) : null,
      sel.barrel && window.CmFilesFor ? cmE(window.CmFilesFor, { type: 'barrel', vintage: sel.vintage, refCode: sel.barrel, org: sel.organization_id }) : null) : null;
    var labelItems = function () {
      var placed = D.filter(function (p) { return p.barrel; });
      var pick = labelSet === '2025' ? placed.filter(function (p) { return p.vintage === 2025; }) : labelSet === '2026' ? placed.filter(function (p) { return p.vintage === 2026; })
        : labelSet === 'found' ? placed.filter(function (p) { return q && (norm(p.barrel).indexOf(norm(q)) === 0 || lotName(p).toLowerCase().indexOf(q.toLowerCase()) > -1); })
        : labelSet === 'relabel' ? placed.filter(function (p) { return p.vintage === 2026 && ['26-072', '26-057', '26-074', '26-120', '26-142'].indexOf(p.barrel) > -1; })
        : labelSet === 'check' ? placed.filter(function (p) { return p.flag; }) : placed;
      return pick.slice().sort(function (a, b) { return walkKey(a) < walkKey(b) ? -1 : 1; }).map(function (p) { return Object.assign({}, p, { where: where(p) }); });
    };
    var labelPanel = showLabels && LB ? cmE('div', { style: Object.assign({}, card, { borderColor: C.accentLight }) },
      cmE('div', { style: { fontWeight: 700, marginBottom: 4 } }, 'Barrel labels with QR codes'),
      cmE('div', { style: small }, 'Scanning a label with a phone camera opens that barrel here: where it is, what to do next, and its history.'),
      cmE('div', { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
        cmE('select', { value: labelSet, onChange: function (e) { setLabelSet(e.target.value); }, style: Object.assign({}, cmSel, { flex: '1 1 200px' }) },
          [['placed', 'Every barrel on the map'], ['2026', '2026 barrels'], ['2025', '2025 barrels'], ['found', 'Barrels matching the search box'], ['relabel', 'Relabel list (72, 57, 74, 120, 142)'], ['check', 'Barrels marked to check']].map(function (o) { return cmE('option', { key: o[0], value: o[0] }, o[1]); })),
        cmE('select', { value: labelSize, onChange: function (e) { setLabelSize(e.target.value); }, style: Object.assign({}, cmSel, { flex: '1 1 200px' }) },
          [['small', 'Small: 2.625 x 1 in, 30 per page'], ['large', 'Large: 4 x 2 in, 10 per page']].map(function (o) { return cmE('option', { key: o[0], value: o[0] }, o[1]); })),
        cmE('button', { onClick: function () { var it = labelItems(); if (!it.length) { setErr('No barrels in that set.'); return; } setErr(''); LB.printLabels(it, labelSize).catch(function (e) { setErr(e.message); }); },
          style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700 } }, 'Print ' + labelItems().length + ' labels'))) : null;
    var legendKeys = by === 'step' ? STEP_ORDER.concat(['client']) : ['red', 'white', 'rose', 'client', 'unk'];
    var legendNames = { red: 'Red', white: 'White', rose: 'Rose', client: 'Client', unk: 'Lot unknown' };
    var placed = D.filter(function (p) { return p.barrel; }).length;
    return cmE('div', null,
      err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
      cmE('div', { style: { display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
        cmE('div', { style: { flex: '3 1 340px' } }, cmSeg([['layout', 'Layout'], ['list', 'List'], ['lots', 'By wine'], ['work', 'Work list']], view, function (v) { setView(v); setSel(null); })),
        cmE('input', { value: q, onChange: function (e) { setQ(e.target.value.trim()); }, placeholder: view === 'lots' ? 'Find wine' : 'Find barrel', style: Object.assign({}, cmSel, { flex: '1 1 120px' }) }),
        canMove && view === 'layout' ? cmE('button', { onClick: function () { setMoveMode(!moveMode); setPick(null); setTarget(null); setErr(''); setMsg(''); setSel(null); }, style: { background: moveMode ? C.orange : C.card, color: moveMode ? '#fff' : C.accentLight, border: '1px solid ' + (moveMode ? C.orange : C.cardBorder), borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700 } }, moveMode ? 'Done moving' : 'Move barrels') : null,
        cmE('button', { onClick: function () { printView(view, D, by); }, style: { background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700 } }, 'Print'),
        LB ? cmE('button', { onClick: function () { setShowLabels(!showLabels); }, style: { background: showLabels ? C.accentLight : C.card, color: showLabels ? '#fff' : C.accentLight, border: '1px solid ' + C.cardBorder, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700 } }, 'Labels') : null),
      msg ? cmE('div', { style: { color: C.green || '#22c55e', fontSize: 12, marginBottom: 6, fontWeight: 700 } }, msg) : null,
      view === 'layout' ? cmE('div', { style: { display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
        cmE('div', { style: { flex: '2 1 260px' } }, cmSeg([['EBS', 'EBS racks'], ['Rows', 'Floor rows'], ['Pallets', 'Pallets']], area, function (a) { setArea(a); setSel(null); })),
        cmE('div', { style: { flex: '1 1 200px' } }, cmSeg([['wine', 'Color: wine'], ['step', 'Color: next step']], by, setBy))) : null,
      view === 'layout' ? cmE('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } }, legendKeys.map(function (k) {
        return cmE('span', { key: k, style: { fontSize: 10, background: DARK[k], borderRadius: 4, padding: '2px 6px' } }, by === 'step' ? STEP_LABEL[k] : legendNames[k]);
      }).concat([cmE('span', { key: 'fl', style: { fontSize: 10, border: '2px solid ' + C.orange, borderRadius: 4, padding: '1px 6px' } }, 'Check')])) : null,
      cmE('div', { style: Object.assign({}, small, { marginBottom: 8 }) }, placed + ' barrels placed · positions as of ' + ((D[0] && D[0].as_of) || '') +
        (view === 'work' ? ' · grouped by next step, in walking order (EBS bottom to top, then rows)' : view === 'lots' ? ' · tap a barrel to see it on the layout' : '')),
      labelPanel, movePanel, detail, body);
  }

  window.cmMapIndex = cmMapIndex; window.cmMapLots = cmMapLots; window.cmMapWork = cmMapWork; window.cmMapPrintHtml = cmMapPrintHtml;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.map = { label: 'Map', Component: CmBarrelMap, order: 47 };
})();
