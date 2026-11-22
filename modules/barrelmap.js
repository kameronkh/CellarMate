/* CellarMate module: Barrel map (EBS racks, floor rows, pallets)
   Reads barrel_positions plus the 2025 and 2026 status tables. Registers in CM_MODULES. */
(function () {
  'use strict';
  var ROSE = { '26-004': 1, '26-005': 1, '26-039': 1 };
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
  function short(st) {
    var s = (st && (st.lot_name || st.vineyard)) || '';
    return s.replace(/Estate Blk/g, 'Est').replace(/ \(.*$/, '').replace('Terry Vineyard Chardonnay', 'Terry Ch').slice(0, 18);
  }
  function cmMapIndex(pos, s25, s26) {
    var i25 = {}, i26 = {};
    s25.forEach(function (r) { i25[r.barrel] = r; });
    s26.forEach(function (r) { i26[r.barrel] = r; });
    return pos.filter(function (p) { return p.active !== false; }).map(function (p) {
      var st = p.vintage === 2025 ? i25[p.barrel] : p.vintage === 2026 ? i26[p.barrel] : null;
      return Object.assign({}, p, { st: st, kind: kindOf(p, st) });
    });
  }
  function colors() {
    return { red: '#5a2230', white: '#5a5022', rose: '#5a2248', client: '#22385a', unk: '#3a3a3a' };
  }

  function CmBarrelMap() {
    var sD = React.useState(null), D = sD[0], setD = sD[1];
    var sA = React.useState('EBS'), area = sA[0], setArea = sA[1];
    var sS = React.useState(null), sel = sS[0], setSel = sS[1];
    var sQ = React.useState(''), q = sQ[0], setQ = sQ[1];
    var sE = React.useState(''), err = sE[0], setErr = sE[1];
    React.useEffect(function () {
      var live = true;
      Promise.all([cmFetch('barrel_positions'), cmFetch('barrel_status_2025'), cmFetch('barrel_status_2026')])
        .then(function (a) { if (live) setD(cmMapIndex(a[0], a[1], a[2])); })
        .catch(function (e) { if (live) { setErr(e.message); setD([]); } });
      return function () { live = false; };
    }, []);
    if (!D) return cmE('div', { style: { textAlign: 'center', color: C.textDim, padding: 30 } }, 'Loading...');
    var col = colors();
    var small = { fontSize: 11, color: C.textDim };
    var card = { background: C.card, border: '1px solid ' + C.cardBorder, borderRadius: 10, padding: '10px 12px', marginBottom: 8 };
    var hit = function (p) { return q && p.barrel && p.barrel.replace('26-', '').replace(/^0+/, '') === q.replace(/^26-/, '').replace(/^0+/, ''); };
    var box = function (p, key) {
      if (!p) return cmE('div', { key: key, style: { minHeight: 34, border: '1px dashed ' + C.cardBorder, borderRadius: 6 } });
      var isSel = sel && sel.id === p.id;
      return cmE('div', { key: key, onClick: function () { setSel(isSel ? null : p); }, title: p.barrel || p.label,
        style: { minHeight: 34, background: col[p.kind], borderRadius: 6, padding: '3px 4px', cursor: 'pointer', textAlign: 'center', lineHeight: 1.15,
          border: '2px solid ' + (hit(p) ? C.accentLight : isSel ? '#fff' : p.flag ? C.orange : 'transparent') } },
        cmE('div', { style: { fontWeight: 800, fontSize: 12 } }, p.barrel ? (p.vintage === 2026 ? p.barrel.slice(3) : p.barrel) : p.label),
        p.barrel ? cmE('div', { style: { fontSize: 9, color: '#ddd' } }, p.vintage === 2025 && area === 'Rows' ? '2025' : short(p.st)) : null);
    };
    var mine = D.filter(function (p) { return p.area === area; });
    var grid;
    if (area === 'EBS') {
      var levels = []; for (var l = 12; l >= 1; l--) levels.push(l);
      grid = cmE('div', { style: { overflowX: 'auto' } }, cmE('div', { style: { minWidth: 640 } },
        cmE('div', { style: { display: 'grid', gridTemplateColumns: '34px repeat(4, 1fr) 10px repeat(4, 1fr)', gap: 4, marginBottom: 4, fontSize: 10, color: C.textDim, textAlign: 'center' } },
          [cmE('div', { key: 'h' }, 'Lvl')].concat('ABCD'.split('').map(function (c) { return cmE('div', { key: 'f' + c }, 'Front ' + c); }), [cmE('div', { key: 'sp' })], 'ABCD'.split('').map(function (c) { return cmE('div', { key: 'b' + c }, 'Back ' + c); }))),
        levels.map(function (lv) {
          var cells = [cmE('div', { key: 'l', style: { fontWeight: 700, alignSelf: 'center', textAlign: 'center' } }, lv)];
          ['Front', 'Back'].forEach(function (side, si) {
            if (si) cells.push(cmE('div', { key: 'sp' }));
            'ABCD'.split('').forEach(function (c) { cells.push(box(mine.filter(function (p) { return p.rack === lv && p.side === side && p.col === c; })[0], side + c)); });
          });
          return cmE('div', { key: lv, style: { display: 'grid', gridTemplateColumns: '34px repeat(4, 1fr) 10px repeat(4, 1fr)', gap: 4, marginBottom: 4 } }, cells);
        })));
    } else if (area === 'Rows') {
      var rows = cmUniq(mine.map(function (p) { return p.rack; })).sort(function (a, b) { return a - b; });
      grid = cmE('div', { style: { overflowX: 'auto' } }, cmE('div', { style: { minWidth: 700 } }, rows.map(function (rn) {
        var inRow = mine.filter(function (p) { return p.rack === rn; });
        return cmE('div', { key: rn, style: Object.assign({}, card, { padding: 8 }) },
          cmE('div', { style: { fontWeight: 700, marginBottom: 6 } }, 'Row ' + rn),
          cmE('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 } }, ['1', '2', '3', '4'].map(function (c) {
            var inCol = inRow.filter(function (p) { return p.col === c; });
            var block = inCol.filter(function (p) { return !p.barrel; })[0];
            return cmE('div', { key: c },
              cmE('div', { style: Object.assign({}, small, { textAlign: 'center', marginBottom: 3 }) }, 'Column ' + c + ' · front | back'),
              block ? cmE('div', { style: { minHeight: 60, background: col.client, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 } }, block.label)
                : cmE('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 } }, ['D', 'C', 'B', 'A'].map(function (lv) {
                  return ['Front', 'Back'].map(function (side) { return box(inCol.filter(function (p) { return p.level === lv && p.side === side; })[0], lv + side); });
                })));
          })));
      })));
    } else {
      grid = cmE('div', null, mine.sort(function (a, b) { return a.rack - b.rack; }).map(function (p) {
        return cmE('div', { key: p.id, style: card }, cmE('div', { style: { fontWeight: 700 } }, p.label), p.note ? cmE('div', { style: small }, p.note) : null);
      }));
    }
    var detail = sel ? cmE('div', { style: Object.assign({}, card, { borderColor: C.accentLight }) },
      cmE('div', { style: { fontWeight: 800 } }, (sel.barrel ? (sel.vintage + ' barrel ' + sel.barrel) : sel.label)),
      cmE('div', { style: small }, sel.area === 'EBS' ? 'EBS level ' + sel.rack + ', ' + sel.side.toLowerCase() + ' ' + sel.col : sel.area === 'Rows' ? 'Row ' + sel.rack + ', column ' + sel.col + ', ' + sel.side.toLowerCase() + ', level ' + sel.level : ''),
      sel.st ? cmE('div', { style: { fontSize: 12, marginTop: 4 } }, [sel.st.lot_name || sel.st.vineyard, sel.st.owner, sel.st.wine_type, sel.st.ph_latest ? 'pH ' + sel.st.ph_latest : null].filter(Boolean).join(' · ')) : null,
      sel.st && sel.st.action ? cmE('div', { style: { fontSize: 12, color: C.accentLight, marginTop: 2 } }, sel.st.action) : null,
      sel.note ? cmE('div', { style: small }, 'Map note: ' + sel.note) : null,
      sel.flag ? cmE('div', { style: { fontSize: 12, color: C.orange } }, sel.flag) : null) : null;
    var placed = D.filter(function (p) { return p.barrel; }).length;
    var flagged = D.filter(function (p) { return p.flag; }).length;
    return cmE('div', null,
      err ? cmE('div', { style: { color: C.red, fontSize: 12 } }, err) : null,
      cmE('div', { style: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
        cmE('div', { style: { flex: '2 1 260px' } }, cmSeg([['EBS', 'EBS racks'], ['Rows', 'Floor rows'], ['Pallets', 'Pallets']], area, function (a) { setArea(a); setSel(null); })),
        cmE('input', { value: q, onChange: function (e) { setQ(e.target.value.trim()); }, placeholder: 'Find barrel', style: Object.assign({}, cmSel, { flex: '1 1 120px' }) })),
      cmE('div', { style: Object.assign({}, small, { marginBottom: 8 }) }, placed + ' barrels placed · ' + flagged + ' to check (orange) · as of ' + ((D[0] && D[0].as_of) || '') + '. Colors: red wine, white, rose, client or other winemaker, lot unknown.'),
      detail, grid);
  }

  window.cmMapIndex = cmMapIndex;
  window.CM_MODULES = window.CM_MODULES || {};
  window.CM_MODULES.map = { label: 'Map', Component: CmBarrelMap, order: 47 };
})();
