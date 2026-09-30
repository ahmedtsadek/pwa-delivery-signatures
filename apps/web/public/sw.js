const CACHE='delivery-shell-v5';
const SHELL=['/','/driver','/enroll','/manifest.webmanifest','/icon.svg','/pwa-icon/192','/pwa-icon/512','/pwa-icon/180'];

async function safeCachePut(cache, request, response) {
  try {
    const url = new URL(request.url);
    if (!['http:','https:'].includes(url.protocol)) return;
    if (url.origin !== self.location.origin) return;
    if (!response || !response.ok) return;
    await cache.put(request, response);
  } catch (_) {
    // Never let a cache write break navigation or app fetches.
  }
}

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  let url;
  try { url=new URL(req.url); } catch (_) { return; }

  // Browser extensions and other non-web schemes can trigger fetch events.
  // CacheStorage only supports http/https requests.
  if(!['http:','https:'].includes(url.protocol)) return;
  if(url.origin!==self.location.origin) return;
  if(url.pathname.startsWith('/api/')) return;

  if(req.mode==='navigate') {
    event.respondWith(
      fetch(req).then(async r=>{
        const c=await caches.open(CACHE);
        await safeCachePut(c,req,r.clone());
        return r;
      }).catch(async()=>await caches.match(req)||await caches.match('/driver')||await caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>cached||fetch(req).then(async r=>{
      const c=await caches.open(CACHE);
      await safeCachePut(c,req,r.clone());
      return r;
    }))
  );
});
