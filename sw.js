// 오프라인 캐시 서비스워커 — 한 번 열면 인터넷 없이도 학습 가능
const CACHE = 'ke-v3';
const FILES = [
  './', './index.html', './css/app.css', './js/app.js',
  './data/curriculum.json', './data/audio_map.json', './manifest.json', './icon.svg'
];
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await c.addAll(FILES);
      // 원어민 발음 mp3도 전부 캐시해서 오프라인 학습 가능하게
      try {
        const map = await (await fetch('./data/audio_map.json')).json();
        await c.addAll([...new Set(Object.values(map))].map(p => './' + p));
      } catch (e) { /* 발음 캐시는 실패해도 앱은 동작 */ }
    })
  );
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
