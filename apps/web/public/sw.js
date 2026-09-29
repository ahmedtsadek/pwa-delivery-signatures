const CACHE='delivery-shell-v4';
const SHELL=['/','/driver','/enroll','/manifest.webmanifest','/icon.svg','/icons/icon-192.png','/icons/apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/')) return;
  if(req.mode==='navigate') {
    event.respondWith(fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));return r;}).catch(async()=>await caches.match(req)||await caches.match('/driver')||await caches.match('/')));
    return;
  }
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));return r;})));
});
