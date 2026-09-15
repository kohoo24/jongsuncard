/*
 * sw.js - 서비스 워커 (오프라인 지원)
 *
 * 정적 파일만으로 돌아가는 앱이므로 앱 셸을 통째로 캐시한다.
 * 버전을 올리면 이전 캐시는 activate 에서 정리된다.
 */
const CACHE = 'holdem-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/font.css',
  './css/style.css',
  './js/cards.js',
  './js/cardart.js',
  './js/i18n.js',
  './js/rng.js',
  './js/evaluator.js',
  './js/ranges.js',
  './js/equity.js',
  './js/stats.js',
  './js/tournament.js',
  './js/engine.js',
  './js/ai.js',
  './js/review.js',
  './js/history.js',
  './js/storage.js',
  './js/panels.js',
  './js/ui.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        // 같은 출처의 성공 응답만 캐시에 넣는다
        if (res && res.ok && new URL(e.request.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
