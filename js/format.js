/*
 * format.js - 금액 표시 단위 (칩 / bb)
 *
 * 화면의 모든 칩 금액은 이 포맷터를 거친다. bb 모드에서는 현재 빅블라인드로 나눠
 * "62.5bb" 처럼 보여준다. 블라인드 레벨이 오르면 setBigBlind 로 갱신한다.
 * 블라인드 자체("10/20")와 텍스트 내보내기는 항상 칩이다 — 레벨의 이름이고 외부 도구가 읽으니까.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});

  let unit = 'chips';
  let bigBlind = 20;

  function chips(v) { return Math.round(v).toLocaleString(); }

  /* bb 수치: 100 이상은 정수, 10 이상은 소수 1자리, 그 아래는 2자리. 뒤의 0 은 지운다 */
  function bbNumber(x) {
    const a = Math.abs(x);
    const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
    let s = x.toFixed(digits);
    if (digits > 0) s = s.replace(/\.?0+$/, '');
    if (s === '-0') s = '0';
    return s;
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '';
    if (unit === 'bb' && bigBlind > 0) return bbNumber(v / bigBlind) + 'bb';
    return chips(v);
  }

  /* 입력칸용: 표시 단위의 숫자만 (접미사 없음) */
  function toInput(v) {
    if (unit === 'bb' && bigBlind > 0) return bbNumber(v / bigBlind);
    return String(Math.round(v));
  }
  function fromInput(str) {
    const x = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
    if (!isFinite(x)) return NaN;
    return unit === 'bb' ? Math.round(x * bigBlind) : Math.round(x);
  }

  H.format = {
    amount: amount,
    chips: chips,
    bbNumber: bbNumber,
    toInput: toInput,
    fromInput: fromInput,
    setUnit: function (u) { unit = u === 'bb' ? 'bb' : 'chips'; },
    unit: function () { return unit; },
    setBigBlind: function (bb) { if (bb > 0) bigBlind = bb; },
    bigBlind: function () { return bigBlind; },
    suffix: function () { return unit === 'bb' ? 'bb' : ''; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
