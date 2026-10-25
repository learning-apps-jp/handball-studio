const CACHE='handball-studio-v1-20261025-pages3';
const FILES=['./','./index.html','./styles.css','./icon.svg','./icon-180.png','./icon-192.png','./icon-512.png','./manifest.webmanifest','./js/app.mjs','./js/core.mjs','./js/storage.mjs','./js/tactics.mjs','./js/video.mjs','./js/export.mjs','./js/sync.mjs','./js/advanced-analysis.mjs'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(file=>file+'?release='+CACHE)))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('handball-studio-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin||new URL(e.request.url).pathname.includes('/api/'))return;e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(cached=>cached??fetch(e.request)));});
