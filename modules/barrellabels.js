/* CellarMate module: barrel QR labels and scan links
   A label's QR code opens  <app>/?barrel=26-142  ; the app jumps to Reports > Map with that
   barrel selected (see the deep-link hook in index.html). Labels print from the Map tab.
   QR images come from qrcodejs (cdnjs), loaded only when labels are printed. */
(function () {
  'use strict';
  var QR_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

  function code(p) { return p.vintage === 2025 ? '25-' + p.barrel : p.barrel; }
  function parseCode(s) {
    var t = String(s || '').trim().toUpperCase().replace(/\s+/g, '');
    var m = t.match(/^(25|26)-?0*(\d+)$/); if (!m) return null;
    return m[1] === '26' ? { vintage: 2026, barrel: '26-' + ('00' + m[2]).slice(-3) } : { vintage: 2025, barrel: String(Number(m[2])) };
  }
  function linkFor(p, base) { return (base || (location.origin + location.pathname.replace(/index\.html$/, ''))) + '?barrel=' + encodeURIComponent(code(p)); }
  function deepBarrel() {
    try { var q = new URLSearchParams(location.search).get('barrel'); return q ? parseCode(q) : null; } catch (e) { return null; }
  }
  function clearDeep() {
    try { var u = new URL(location.href); u.searchParams.delete('barrel'); history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash); } catch (e) {}
  }
  function loadQr() {
    if (window.QRCode) return Promise.resolve(window.QRCode);
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = QR_SRC; s.onload = function () { res(window.QRCode); }; s.onerror = function () { rej(new Error('Could not load the QR code maker. Check the connection and try again.')); };
      document.head.appendChild(s);
    });
  }
  function qrDataUrl(text) {
    var div = document.createElement('div'); div.style.position = 'fixed'; div.style.left = '-9999px'; document.body.appendChild(div);
    try {
      new window.QRCode(div, { text: text, width: 192, height: 192, correctLevel: window.QRCode.CorrectLevel.M });
      var c = div.querySelector('canvas'); var img = div.querySelector('img');
      return c ? c.toDataURL('image/png') : (img ? img.src : '');
    } finally { div.remove(); }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  /* size: 'small' = 30 per letter page (2.625 x 1 in), 'large' = 10 per page (4 x 2 in) */
  function labelsHtml(items, size, qrFor, base) {
    var big = size === 'large';
    var css = '@page{size:letter;margin:' + (big ? '0.5in 0.16in' : '0.5in 0.19in') + '}body{margin:0;font-family:Helvetica,Arial,sans-serif}' +
      '.sheet{display:grid;grid-template-columns:repeat(' + (big ? 2 : 3) + ',' + (big ? '4in' : '2.625in') + ');grid-auto-rows:' + (big ? '2in' : '1in') + ';column-gap:' + (big ? '0.19in' : '0.125in') + '}' +
      '.l{display:flex;align-items:center;gap:' + (big ? '10px' : '5px') + ';padding:' + (big ? '8px' : '3px 5px') + ';box-sizing:border-box;overflow:hidden;break-inside:avoid}' +
      '.l img{width:' + (big ? '1.6in' : '0.85in') + ';height:' + (big ? '1.6in' : '0.85in') + '}.b{font-weight:800;font-size:' + (big ? '30px' : '17px') + ';line-height:1}.t{font-size:' + (big ? '13px' : '8px') + ';color:#333;margin-top:2px}.w{font-size:' + (big ? '12px' : '7.5px') + ';color:#666}' +
      '.noprint{padding:10px}@media print{.noprint{display:none}}button{font-size:14px;padding:6px 14px}';
    var cells = items.map(function (p) {
      var lot = p.st ? (p.st.lot_name || p.st.vineyard || '') : '';
      return '<div class="l"><img src="' + qrFor(linkFor(p, base)) + '"><div><div class="b">' + esc(code(p)) + '</div><div class="t">' + esc(String(lot).replace(/;.*$/, '').slice(0, big ? 60 : 34)) + '</div><div class="w">' + esc(p.where || '') + '</div></div></div>';
    }).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>CellarMate barrel labels</title><style>' + css + '</style></head><body><div class="noprint"><button onclick="window.print()">Print labels</button> ' + items.length + ' labels, ' + (big ? '4 x 2 in, 10 per page' : '2.625 x 1 in, 30 per page (Avery 5160 size)') + '. Scanning a label opens that barrel in CellarMate.</div><div class="sheet">' + cells + '</div></body></html>';
  }
  async function printLabels(items, size) {
    await loadQr();
    var html = labelsHtml(items, size, qrDataUrl);
    var w = null; try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); return 'window'; }
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f); f.srcdoc = html;
    f.onload = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { f.remove(); }, 60000); };
    return 'frame';
  }
  async function barrelHistory(p, n) {
    var S = supa.schema('cellarmate'); var lim = n || 6; var out = [];
    var bAlt = p.vintage === 2025 ? [p.barrel] : [p.barrel, p.barrel.slice(3), String(Number(p.barrel.slice(3)))];
    var a = await S.from('so2_log').select('date,kind,free_so2_ppm,ph,grams_added').eq('vintage', p.vintage).in('barrel', bAlt).order('date', { ascending: false }).limit(lim);
    (a.data || []).forEach(function (r) { out.push({ d: r.date, t: r.kind === 'Addition' || r.grams_added ? 'SO2 added ' + (r.grams_added != null ? r.grams_added + ' g' : '') : 'Free SO2 ' + (r.free_so2_ppm != null ? r.free_so2_ppm : '-') + (r.ph != null ? ', pH ' + r.ph : '') }); });
    var m = await S.from('malic_results').select('date,result_text').eq('vintage', p.vintage).in('barrel', bAlt).order('date', { ascending: false }).limit(3);
    (m.data || []).forEach(function (r) { out.push({ d: r.date, t: 'Malic ' + r.result_text }); });
    var c = await S.from('cellar_actions').select('done_on,action_type,grams,value,note').eq('vintage', p.vintage).in('barrel', bAlt).order('done_on', { ascending: false }).limit(lim);
    (c.data || []).forEach(function (r) { out.push({ d: r.done_on, t: String(r.action_type).replace(/_/g, ' ') + (r.grams != null ? ' ' + r.grams + ' g' : '') + (r.value != null ? ' ' + r.value : '') + (r.note ? ' · ' + r.note : '') }); });
    return out.filter(function (x) { return x.d; }).sort(function (x, y) { return String(y.d) < String(x.d) ? -1 : 1; }).slice(0, lim + 4);
  }

  window.cmBarrelLabels = { code: code, parseCode: parseCode, linkFor: linkFor, deepBarrel: deepBarrel, clearDeep: clearDeep, labelsHtml: labelsHtml, printLabels: printLabels, history: barrelHistory };
})();
