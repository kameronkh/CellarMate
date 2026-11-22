/* CellarMate module: barrel moves (tap or drag on the map)
   Database work goes through RPCs that check the 'moves' permission and keep a history:
   move_barrel (with optional swap), place_barrel, remove_barrel, undo_barrel_move.
   Exposes window.cmBarrelMoves; the Map module (barrelmap.js) uses it when present. */
(function () {
  'use strict';
  var ORG_DEFAULT = '762fc809-0341-4ee2-834f-16e707181ea7';
  function db() { return supa.schema('cellarmate'); }
  function clearCache() { var c = (typeof CM_CACHE !== 'undefined') ? CM_CACHE : window.CM_CACHE; if (!c) return; ['barrel_positions', 'barrel_moves', 'barrels', 'barrel_status_2025', 'barrel_status_2026'].forEach(function (t) { delete c[t]; }); }
  function clean(e) { var m = (e && e.message) || String(e); return m.replace(/^.*?ERROR:\s*/, ''); }

  /* pure helpers */
  function slotKey(s) { return [s.area, s.rack, s.col, s.side, s.level || ''].join('|'); }
  function sameSlot(p, s) { return p && s && slotKey(p) === slotKey(s); }
  function slotText(s) {
    if (!s) return '';
    if (s.area === 'EBS') return 'EBS ' + s.rack + ' ' + String(s.side).toLowerCase() + ' ' + s.col;
    if (s.area === 'Rows') return 'Row ' + s.rack + ' col ' + s.col + ' ' + String(s.side).toLowerCase() + ' ' + (s.level || '');
    return s.area || '';
  }
  function occupantAt(items, s, exceptId) {
    return items.filter(function (p) { return p.barrel && p.id !== exceptId && sameSlot(p, s); })[0] || null;
  }
  function blockedAt(items, s) {
    return s.area === 'Rows' && items.some(function (p) { return !p.barrel && p.area === 'Rows' && p.rack === s.rack && p.col === s.col; });
  }
  /* What would happen if `pick` went to slot `s`? Returns {ok, kind, other, reason} */
  function plan(items, pick, s) {
    if (!pick || !s) return { ok: false, reason: 'Pick a barrel, then a spot.' };
    if (blockedAt(items, s)) return { ok: false, reason: 'That column holds another winery\'s stack.' };
    if (pick.id && sameSlot(pick, s)) return { ok: false, reason: 'That is where it already is.' };
    var other = occupantAt(items, s, pick.id);
    if (!pick.id) return other ? { ok: false, reason: 'Spot taken by ' + other.barrel + '. Pick an empty spot to place a new barrel.' } : { ok: true, kind: 'place' };
    return other ? { ok: true, kind: 'swap', other: other } : { ok: true, kind: 'move' };
  }
  function unplaced(items, s25, s26) {
    var on = {}; items.forEach(function (p) { if (p.barrel) on[p.vintage + '|' + p.barrel] = 1; });
    var out = [];
    (s26 || []).forEach(function (r) { if (!on['2026|' + r.barrel]) out.push({ vintage: 2026, barrel: r.barrel, organization_id: r.organization_id, label: r.lot_name || '' }); });
    (s25 || []).forEach(function (r) { if (!on['2025|' + r.barrel]) out.push({ vintage: 2025, barrel: r.barrel, organization_id: r.organization_id, label: r.vineyard || '' }); });
    return out.sort(function (a, b) { return (b.vintage - a.vintage) || (String(a.barrel).localeCompare(String(b.barrel), undefined, { numeric: true })); });
  }

  /* database calls */
  async function rpc(name, args) {
    var r = await db().rpc(name, args);
    if (r.error) throw new Error(clean(r.error));
    clearCache();
    return r.data;
  }
  function move(pick, s, note, swap) {
    return rpc('move_barrel', { p_pos_id: pick.id, p_area: s.area, p_rack: s.rack, p_col: s.col, p_side: s.side, p_level: s.level || null, p_note: note || null, p_swap: !!swap });
  }
  function place(pick, s, note) {
    return rpc('place_barrel', { p_org: pick.organization_id || ORG_DEFAULT, p_vintage: pick.vintage, p_barrel: pick.barrel, p_area: s.area, p_rack: s.rack, p_col: s.col, p_side: s.side, p_level: s.level || null, p_note: note || null });
  }
  function remove(pick, note) { return rpc('remove_barrel', { p_pos_id: pick.id, p_note: note || 'Taken off the map' }); }
  function undo(moveId) { return rpc('undo_barrel_move', { p_move_id: moveId }); }
  async function recent(n) {
    var r = await db().from('barrel_moves').select('*').order('id', { ascending: false }).limit(n || 15);
    if (r.error) throw new Error(clean(r.error));
    return r.data || [];
  }
  function describe(m) {
    var from = m.from_area ? slotText({ area: m.from_area, rack: m.from_rack, col: m.from_col, side: m.from_side, level: m.from_level }) : '';
    var to = m.to_area ? slotText({ area: m.to_area, rack: m.to_rack, col: m.to_col, side: m.to_side, level: m.to_level }) : '';
    var b = (m.vintage === 2025 ? '25-' : '') + m.barrel;
    if (m.kind === 'place') return b + ' placed at ' + to;
    if (m.kind === 'remove') return b + ' taken off the map (' + (m.note || '') + ') from ' + from;
    return b + (m.kind === 'swap' ? ' swapped: ' : ' moved: ') + from + ' to ' + to;
  }

  window.cmBarrelMoves = { slotKey: slotKey, slotText: slotText, plan: plan, unplaced: unplaced, occupantAt: occupantAt, move: move, place: place, remove: remove, undo: undo, recent: recent, describe: describe, clearCache: clearCache };
})();
