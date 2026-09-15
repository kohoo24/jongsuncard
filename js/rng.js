/*
 * rng.js - 시드 기반 난수 생성기
 * 같은 시드 = 같은 게임. 핸드 재현, 버그 리포트, 결정론적 테스트에 쓰인다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});

  // mulberry32: 빠르고 품질이 충분한 32비트 PRNG
  function create(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    if (global.crypto && global.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      global.crypto.getRandomValues(buf);
      return buf[0] >>> 0;
    }
    return (Math.random() * 4294967296) >>> 0;
  }

  // 사람이 주고받기 쉬운 짧은 문자열 형태
  function encode(seed) {
    return (seed >>> 0).toString(36).toUpperCase().padStart(7, '0');
  }

  function decode(str) {
    const n = parseInt(String(str).trim().toLowerCase(), 36);
    return isFinite(n) ? (n >>> 0) : randomSeed();
  }

  H.rng = {
    create: create,
    randomSeed: randomSeed,
    encode: encode,
    decode: decode
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
