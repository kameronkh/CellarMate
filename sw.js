/* CellarMate service worker: keeps the app itself available with no connection.
   Cellar data is saved separately by the app (IndexedDB), not here. */
const CM_SW_CACHE = 'cellarmate-shell-v14';
const CM_SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png', '/modules/ferment.js', '/modules/materials.js', '/modules/barrelmap.js', '/modules/barrelmoves.js', '/modules/lotcost.js', '/modules/barrellabels.js', '/modules/topping.js', '/modules/lab.js', '/modules/labdocs.js', '/modules/today.js', '/modules/files.js', '/modules/vintages.js', '/modules/vineyard.js'];
const CM_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];
const CM_CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CM_SW_CACHE).then(function(c) {
    return Promise.all(CM_SHELL.concat(CM_LIBS).map(function(u) { return c.add(u).catch(function() {}); }));
  }).then(function() { return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(ks) { return Promise.all(ks.filter(function(k) { return k !== CM_SW_CACHE; }).map(function(k) { return caches.delete(k); })); }).then(function() { return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.indexOf('supabase.co') !== -1) return;
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    const key = req.mode === 'navigate' ? '/index.html' : req;
    e.respondWith(fetch(req).then(function(res) {
      if (res && res.ok) { const copy = res.clone(); caches.open(CM_SW_CACHE).then(function(c) { c.put(key, copy); }); }
      return res;
    }).catch(function() {
      return caches.match(key, {ignoreSearch:true}).then(function(r) { return r || caches.match('/index.html'); });
    }));
    return;
  }
  if (CM_CDN.indexOf(url.hostname) !== -1) {
    e.respondWith(caches.match(req).then(function(hit) {
      return hit || fetch(req).then(function(res) {
        if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CM_SW_CACHE).then(function(c) { c.put(req, copy); }); }
        return res;
      });
    }));
  }
});
