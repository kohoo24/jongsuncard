/*
 * sw.js - 서비스 워커 (오프라인 지원)
 *
 * 정적 파일만으로 돌아가는 앱이므로 앱 셸을 통째로 캐시한다.
 *
 * 캐시 이름에 빌드 스탬프를 박는 게 핵심이다. 예전에는 이름이 'holdem-v1' 로
 * 고정돼 있어서, 한 번 접속한 사람에게는 그 버전이 영영 박혔다. 고쳐서 올려도
 * 남의 화면은 그대로였다. 이제 배포마다 캐시가 통째로 새로 깔리고, 옛 캐시는
 * activate 에서 지워진다. 셸이 한 벌씩 통째로 바뀌니 새 index.html 과 낡은
 * js 가 섞일 일도 없다.
 *
 * 아래 BUILD 한 줄은 배포 워크플로가 커밋 SHA 로 바꿔 넣는다 (바꾸지 못하면
 * 배포가 실패하게 해 뒀다). 로컬에서 열면 'dev' 로 남는다.
 */
const BUILD = 'dev';
const CACHE = 'holdem-' + BUILD;
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
  './js/format.js',
  './js/rng.js',
  './js/evaluator.js',
  './js/ranges.js',
  './js/preflop-table.js',
  './js/preflop.js',
  './js/equity.js',
  './js/stats.js',
  './js/tournament.js',
  './js/engine.js',
  './js/ai.js',
  './js/review.js',
  './js/profile.js',
  './js/drill.js',
  './js/history.js',
  './js/storage.js',
  './js/panels.js',
  './js/ui.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      /* 한 장이라도 실패하면 셸이 반쪽이 된다 — 통째로 다시 받게 둔다 */
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
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        /* 오프라인인데 캐시에도 없다 — 페이지 이동이면 앱 셸로 받아 준다 */
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
