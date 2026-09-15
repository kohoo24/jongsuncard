/*
 * cardart.js - 카드와 칩 그래픽
 *
 * 카드 무늬(♠♥♦♣)는 폰트마다 모양이 제각각이고 Pretendard 에는 ♠♦♣ 가 아예 없다.
 * 그래서 무늬는 SVG 패스로 직접 그린다. 앞면은 코너 인덱스 + 표준 핍 배치를 코드로
 * 생성하므로 외부 에셋이 필요 없고, 어느 해상도에서나 선명하며 테마에 연동된다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});
  const NS = 'http://www.w3.org/2000/svg';

  /* 100x100 기준 무늬 패스 */
  const SUIT_PATH = {
    s: 'M50 7c11 20 43 32 43 52 0 14-10 24-22 24-8 0-15-4-19-10 0 0-1 11 9 19H39c10-8 9-19 9-19-4 6-11 10-19 10-12 0-22-10-22-24 0-20 32-32 43-52z',
    h: 'M50 90C22 68 7 50 7 34 7 19 18 9 31 9c9 0 16 5 19 12 3-7 10-12 19-12 13 0 24 10 24 25 0 16-15 34-43 56z',
    d: 'M50 5l36 45-36 45-36-45z',
    c: 'M50 6c10 0 18 8 18 18 0 3-1 6-2 9 3-2 6-3 10-3 10 0 18 8 18 18s-8 18-18 18c-7 0-13-4-16-10 0 0-1 12 9 20H39c10-8 9-20 9-20-3 6-9 10-16 10-10 0-18-8-18-18s8-18 18-18c4 0 7 1 10 3-1-3-2-6-2-9 0-10 8-18 18-18z'
  };
  const RED_SUITS = { h: 1, d: 1 };
  const RANK_LABEL = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  /*
   * 표준 핍 배치. [x, y, 뒤집힘] — 카드 좌표계 100x140
   * 열은 x=31 / 69, 행은 위 35 · 가운데 70 · 아래 105 를 기본으로 하고,
   * 8~10 은 행을 넷으로 쪼개 코너 인덱스와 겹치지 않게 한다.
   */
  const PIPS = {
    2: [[50, 35], [50, 105, 1]],
    3: [[50, 35], [50, 70], [50, 105, 1]],
    4: [[31, 35], [69, 35], [31, 105, 1], [69, 105, 1]],
    5: [[31, 35], [69, 35], [50, 70], [31, 105, 1], [69, 105, 1]],
    6: [[31, 35], [69, 35], [31, 70], [69, 70], [31, 105, 1], [69, 105, 1]],
    7: [[31, 35], [69, 35], [50, 52.5], [31, 70], [69, 70], [31, 105, 1], [69, 105, 1]],
    8: [[31, 35], [69, 35], [50, 52.5], [31, 70], [69, 70], [50, 87.5, 1], [31, 105, 1], [69, 105, 1]],
    9: [[31, 35], [69, 35], [31, 55], [69, 55], [50, 70], [31, 85, 1], [69, 85, 1], [31, 105, 1], [69, 105, 1]],
    10: [[31, 35], [69, 35], [50, 45], [31, 55], [69, 55], [50, 95, 1], [31, 85, 1], [69, 85, 1], [31, 105, 1], [69, 105, 1]]
  };

  let uid = 0;
  function nextId(prefix) { return prefix + (++uid).toString(36); }

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  /** 무늬 한 개를 (cx, cy) 에 size 크기로 */
  function pip(parent, suit, cx, cy, size, fill, flipped) {
    const s = size / 100;
    const g = el('g', {
      transform: 'translate(' + (cx - size / 2) + ' ' + (cy - size / 2) + ') scale(' + s + ')'
        + (flipped ? ' rotate(180 50 50)' : '')
    }, parent);
    el('path', { d: SUIT_PATH[suit], fill: fill }, g);
    return g;
  }

  /** 무늬만 필요한 곳(범례, 로그 등)을 위한 독립 SVG */
  function suitIcon(suit, size, fill) {
    const svg = el('svg', {
      viewBox: '0 0 100 100', width: size, height: size,
      'aria-hidden': 'true', focusable: 'false'
    });
    el('path', { d: SUIT_PATH[suit], fill: fill || 'currentColor' }, svg);
    return svg;
  }

  /* 무늬별 잉크 색. 4색 덱이면 ♦ 파랑 ♣ 초록 */
  function inkOf(suit, fourColor) {
    if (fourColor) {
      return { s: '#12161c', h: '#c8102e', d: '#1565c9', c: '#0e8c56' }[suit];
    }
    return RED_SUITS[suit] ? '#c8102e' : '#12161c';
  }

  /**
   * 카드 앞면
   * @param {{rank:number,suit:string}} card
   * @param {object} opts {compact:boolean, fourColor:boolean}
   */
  function face(card, opts) {
    opts = opts || {};
    const ink = inkOf(card.suit, opts.fourColor);
    const label = RANK_LABEL[card.rank];
    const svg = el('svg', { viewBox: '0 0 100 140', class: 'card-svg' });

    const gid = nextId('cf');
    const hid = nextId('ch');
    const defs = el('defs', null, svg);
    const grad = el('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0.35', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffffff' }, grad);
    el('stop', { offset: '0.55', 'stop-color': '#fbfbfc' }, grad);
    el('stop', { offset: '1', 'stop-color': '#e9ebef' }, grad);
    /* 위쪽 하이라이트는 부드럽게 사라져야 한다 (사각형으로 넣으면 가로줄이 생긴다) */
    const hi = el('linearGradient', { id: hid, x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffffff', 'stop-opacity': '.85' }, hi);
    el('stop', { offset: '1', 'stop-color': '#ffffff', 'stop-opacity': '0' }, hi);

    el('rect', { x: 0, y: 0, width: 100, height: 140, rx: 8, fill: 'url(#' + gid + ')' }, svg);
    el('rect', { x: 2, y: 2, width: 96, height: 70, rx: 7, fill: 'url(#' + hid + ')' }, svg);
    el('rect', { x: 0.7, y: 0.7, width: 98.6, height: 138.6, rx: 7.4, fill: 'none',
      stroke: 'rgba(0,0,0,.16)', 'stroke-width': 1.4 }, svg);

    if (opts.compact) {
      /* 작은 카드: 코너 인덱스를 크게 하나만, 가운데에 큰 무늬 */
      const t = el('text', {
        x: 13, y: 30, 'font-size': 30, 'font-weight': 700, fill: ink,
        'text-anchor': 'middle', class: 'card-index'
      }, svg);
      t.textContent = label;
      pip(svg, card.suit, 50, 92, 46, ink, false);
    } else {
      cornerIndex(svg, label, card.suit, ink, false);
      cornerIndex(svg, label, card.suit, ink, true);
      if (card.rank === 14) {
        pip(svg, card.suit, 50, 70, 46, ink, false);
      } else if (card.rank >= 11) {
        court(svg, label, card.suit, ink);
      } else {
        const pipSize = card.rank >= 9 ? 18 : 21;
        (PIPS[card.rank] || []).forEach(function (p) {
          pip(svg, card.suit, p[0], p[1], pipSize, ink, !!p[2]);
        });
      }
    }
    return svg;
  }

  function cornerIndex(svg, label, suit, ink, flipped) {
    const g = el('g', flipped ? { transform: 'rotate(180 50 70)' } : null, svg);
    const t = el('text', {
      x: 11, y: 20, 'font-size': 18, 'font-weight': 700, fill: ink,
      'text-anchor': 'middle', class: 'card-index'
    }, g);
    t.textContent = label;
    pip(g, suit, 11, 29.5, 10.5, ink, false);
  }

  /* J / Q / K — 인물화 대신 모노그램 프레임 (다크 UI 와 톤을 맞춘다) */
  function court(svg, label, suit, ink) {
    const g = el('g', null, svg);
    el('rect', { x: 21, y: 29, width: 58, height: 82, rx: 5, fill: ink, opacity: '.05' }, g);
    el('rect', { x: 21, y: 29, width: 58, height: 82, rx: 5, fill: 'none',
      stroke: ink, 'stroke-width': 1.1, opacity: '.5' }, g);
    el('rect', { x: 24.5, y: 32.5, width: 51, height: 75, rx: 3, fill: 'none',
      stroke: ink, 'stroke-width': 0.6, opacity: '.35' }, g);
    const t = el('text', {
      x: 50, y: 64, 'font-size': 38, 'font-weight': 600, fill: ink,
      'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'card-court'
    }, g);
    t.textContent = label;
    pip(g, suit, 50, 92, 20, ink, false);
    /* 네 모서리 장식 */
    [[27, 35], [73, 35], [27, 105], [73, 105]].forEach(function (c) {
      pip(g, suit, c[0], c[1], 7, ink, false).setAttribute('opacity', '.35');
    });
  }

  /** 카드 뒷면 */
  function back(opts) {
    opts = opts || {};
    const svg = el('svg', { viewBox: '0 0 100 140', class: 'card-svg' });
    const gid = nextId('cb');
    const pid = nextId('cbp');
    const defs = el('defs', null, svg);
    const grad = el('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0.4', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#21497a' }, grad);
    el('stop', { offset: '1', 'stop-color': '#112742' }, grad);
    const pat = el('pattern', { id: pid, width: 10, height: 10, patternUnits: 'userSpaceOnUse',
      patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 10, height: 10, fill: 'none' }, pat);
    el('path', { d: 'M0 5h10M5 0v10', stroke: 'rgba(255,255,255,.11)', 'stroke-width': 1.6 }, pat);

    el('rect', { x: 0, y: 0, width: 100, height: 140, rx: 8, fill: '#e6e9ee' }, svg);
    el('rect', { x: 3, y: 3, width: 94, height: 134, rx: 6, fill: 'url(#' + gid + ')' }, svg);
    el('rect', { x: 3, y: 3, width: 94, height: 134, rx: 6, fill: 'url(#' + pid + ')' }, svg);
    el('rect', { x: 8, y: 8, width: 84, height: 124, rx: 4, fill: 'none',
      stroke: 'rgba(255,255,255,.22)', 'stroke-width': 1 }, svg);
    /* 가운데 마크 */
    const mark = el('g', { opacity: '.28' }, svg);
    pip(mark, 's', 50, 70, 28, '#ffffff', false);
    return svg;
  }

  /* ---------- 칩 ---------- */
  const DENOMS = [
    { v: 1000, face: '#d0a03a', edge: '#8e6c22' },
    { v: 500, face: '#8b47c4', edge: '#5b2f86' },
    { v: 100, face: '#2b6fd4', edge: '#1c4a91' },
    { v: 25, face: '#2f9e5f', edge: '#1f6b41' },
    { v: 5, face: '#c9ccd2', edge: '#83878f' },
    { v: 1, face: '#d94f4f', edge: '#8f2f2f' }
  ];

  function denomFor(amount) {
    for (let i = 0; i < DENOMS.length; i++) {
      if (amount >= DENOMS[i].v) return DENOMS[i];
    }
    return DENOMS[DENOMS.length - 1];
  }

  /** 칩 한 개 (SVG 요소) */
  function chip(denom, size) {
    const svg = el('svg', { viewBox: '0 0 64 64', width: size, height: size,
      'aria-hidden': 'true', focusable: 'false', class: 'chip-svg' });
    el('circle', { cx: 32, cy: 32, r: 30, fill: denom.edge }, svg);
    const spots = el('g', null, svg);
    [0, 45, 90, 135, 180, 225, 270, 315].forEach(function (a) {
      el('rect', { x: 28.6, y: 1.6, width: 6.8, height: 11, rx: 1.6,
        fill: '#f6f8fa', opacity: '.9', transform: 'rotate(' + a + ' 32 32)' }, spots);
    });
    el('circle', { cx: 32, cy: 32, r: 22.5, fill: denom.face }, svg);
    el('circle', { cx: 32, cy: 32, r: 22.5, fill: 'none', stroke: 'rgba(0,0,0,.25)', 'stroke-width': 1.4 }, svg);
    el('circle', { cx: 32, cy: 32, r: 16, fill: 'none', stroke: 'rgba(255,255,255,.55)',
      'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
    el('ellipse', { cx: 32, cy: 21, rx: 21, ry: 10, fill: '#ffffff', opacity: '.12' }, svg);
    return svg;
  }

  /**
   * 금액에 맞는 칩 스택. 실제 칩 개수를 세지 않고, 금액대에 맞는 색 + 높이만 보여준다.
   * (정확한 숫자는 옆에 텍스트로 붙는다)
   */
  function chipStack(amount, opts) {
    opts = opts || {};
    const size = opts.size || 22;
    const denom = denomFor(amount);
    const count = Math.max(1, Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, amount / denom.v)) * 2.2) + (amount >= denom.v * 3 ? 1 : 0)));
    const wrap = document.createElement('span');
    wrap.className = 'chip-stack';
    wrap.style.width = size + 'px';
    wrap.style.height = (size * 0.42 + (count - 1) * 3) + 'px';
    for (let i = 0; i < count; i++) {
      const c = document.createElement('span');
      c.className = 'chip-layer';
      c.style.bottom = (i * 3) + 'px';
      c.appendChild(chip(denom, size));
      wrap.appendChild(c);
    }
    return wrap;
  }

  H.cardart = {
    SUIT_PATH: SUIT_PATH,
    RANK_LABEL: RANK_LABEL,
    DENOMS: DENOMS,
    face: face,
    back: back,
    suitIcon: suitIcon,
    inkOf: inkOf,
    chip: chip,
    chipStack: chipStack,
    denomFor: denomFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
