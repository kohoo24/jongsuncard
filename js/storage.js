/*
 * storage.js - 설정과 진행 중인 게임 보관
 *
 * localStorage 는 사생활 보호 모드나 사이트 데이터 차단 시 접근 자체가 예외를
 * 던질 수 있다. 모든 접근을 try/catch 로 감싸고, 실패해도 게임은 정상 동작한다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  const PREFIX = 'holdem.';

  function store() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }

  function get(key, fallback) {
    const s = store();
    if (!s) return fallback;
    try {
      const raw = s.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function set(key, value) {
    const s = store();
    if (!s) return false;
    try { s.setItem(PREFIX + key, JSON.stringify(value)); return true; }
    catch (e) { return false; }   // 용량 초과 등
  }

  function remove(key) {
    const s = store();
    if (!s) return;
    try { s.removeItem(PREFIX + key); } catch (e) { /* 무시 */ }
  }

  const DEFAULT_SETTINGS = {
    lang: 'ko',
    bots: 3,
    chips: 1000,
    blind: 10,
    difficulty: 'normal',
    structure: 0,          // 0=고정, 그 외=레벨업 주기(핸드)
    anteMode: 'off',
    allowRebuy: false,
    speed: 750,
    actionClock: 0,
    mode: 'play',          // 'play' 실전 (힌트 없음) | 'coach' 코치 (승률·오즈·AI 근거·자동 리뷰·생각 정리)
    motion: true,          // 카드·칩 애니메이션
    rotateHintSeen: false, // 세로 폰의 가로 권장 안내를 닫았는지
    reviewTab: true,       // 핸드가 끝나면 옆 패널을 리뷰 탭으로
    showEquity: true,      // 아래 셋은 mode 에서 파생된다 (옛 저장값 이전용으로 남김)
    showThinking: false,
    autoReview: true,
    fourColor: false,
    unit: 'chips',         // 'chips' | 'bb'
    sound: true,
    seed: ''
  };

  function loadSettings() {
    const saved = get('settings', {}) || {};
    const out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      out[k] = saved[k] != null ? saved[k] : DEFAULT_SETTINGS[k];
    });
    return out;
  }

  function saveSettings(obj) { return set('settings', obj); }

  function saveSession(payload) { return set('session', payload); }
  function loadSession() { return get('session', null); }
  function clearSession() { remove('session'); }

  H.storage = {
    available: function () { return !!store(); },
    get: get, set: set, remove: remove,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    saveSession: saveSession,
    loadSession: loadSession,
    clearSession: clearSession
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
