/*
 * cards.js - 카드/덱 기본 유틸리티
 * 브라우저(클래식 스크립트)와 Node 양쪽에서 동작한다.
 */
(function (global) {
  const H = global.Holdem || (global.Holdem = {});

  const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const SUITS = ['s', 'h', 'd', 'c'];

  const RANK_LABEL = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
    10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A'
  };
  const SUIT_LABEL = { s: '♠', h: '♥', d: '♦', c: '♣' };

  function makeDeck() {
    const deck = [];
    for (const s of SUITS) {
      for (const r of RANKS) deck.push({ rank: r, suit: s });
    }
    return deck;
  }

  // Fisher-Yates
  function shuffle(deck, rng) {
    const rand = rng || Math.random;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    return deck;
  }

  function cardToString(c) {
    return RANK_LABEL[c.rank] + c.suit;
  }

  function parseCard(str) {
    const s = String(str).trim();
    const suit = s.slice(-1).toLowerCase();
    const rankPart = s.slice(0, -1).toUpperCase();
    const map = { T: 10, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
    const rank = map[rankPart] || parseInt(rankPart, 10);
    if (!rank || SUITS.indexOf(suit) === -1) throw new Error('잘못된 카드: ' + str);
    return { rank: rank, suit: suit };
  }

  function isRed(c) {
    return c.suit === 'h' || c.suit === 'd';
  }

  H.cards = {
    RANKS: RANKS,
    SUITS: SUITS,
    RANK_LABEL: RANK_LABEL,
    SUIT_LABEL: SUIT_LABEL,
    makeDeck: makeDeck,
    shuffle: shuffle,
    cardToString: cardToString,
    parseCard: parseCard,
    isRed: isRed
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Holdem;
