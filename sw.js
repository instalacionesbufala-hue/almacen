/* Service worker del almacén: notificaciones push (E-006) y apertura sin conexión de la última versión. */
const CACHE = 'almacen-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './manifest.webmanifest', './icono-192.png'])).catch(() => undefined));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Red primero; si no hay conexión, la última copia (la app guarda sus datos aparte y encola lo que registres)
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r).then(resp => {
    if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then(c => c.put(r, copia)); }
    return resp;
  }).catch(() => caches.match(r).then(m => m || caches.match('./index.html'))));
});

self.addEventListener('push', e => {
  let d = { title: 'Almacén', body: 'Hay un aviso nuevo', url: './#stock' };
  try { d = { ...d, ...e.data.json() }; } catch { /* texto plano */ }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: './icono-192.png', badge: './icono-192.png', data: { url: d.url }, tag: 'almacen-aviso', renotify: true }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => x.url.startsWith(self.registration.scope));
    return w ? w.focus().then(() => w.navigate(url)) : self.clients.openWindow(url);
  }));
});
