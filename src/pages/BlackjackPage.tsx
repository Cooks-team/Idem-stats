import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';

// Blackjack solo contre un bot croupier. Règles standard :
//  - Cartes 2-10 = face value, J/Q/K = 10, As = 1 ou 11
//  - Joueur reçoit 2 cartes, dealer 1 face + 1 cachée
//  - Joueur : Hit (carte) ou Stand (passe)
//  - >21 = bust, mise perdue
//  - 21 sur 2 cartes = blackjack, paie 3:2
//  - Dealer tire tant que < 17, sinon passe
//  - Compare → win/lose/push

const DEALER_NAMES = ['Bebeto', 'Jumper', 'Dim'] as const;
const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

type Suit = typeof SUITS[number];
type Rank = typeof RANKS[number];
interface Card { rank: Rank; suit: Suit; hidden?: boolean }

type Phase = 'betting' | 'dealing' | 'player' | 'dealer' | 'reveal' | 'result';
type RoundResult = 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | null;

function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(hand: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.hidden) continue;
    if (c.rank === 'A') { aces += 1; total += 11; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J') total += 10;
    else total += parseInt(c.rank, 10);
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}

function isBlackjack(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  const visible = hand.filter((c) => !c.hidden);
  if (visible.length !== 2) return false;
  return handValue(visible) === 21;
}

export function BlackjackPage() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [dealerName] = useState(() => DEALER_NAMES[Math.floor(Math.random() * DEALER_NAMES.length)]);
  const [bet, setBet] = useState(20);
  const [phase, setPhase] = useState<Phase>('betting');
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [dealerHand, setDealerHand] = useState<Card[]>([]);
  const [result, setResult] = useState<RoundResult>(null);
  const [payout, setPayout] = useState(0);
  const deckRef = useRef<Card[]>([]);

  const coins = user?.coins ?? 0;
  const canBet = phase === 'betting' && bet >= 5 && bet <= coins;

  // Mutation pour synchroniser le solde après chaque manche
  const roundMut = useMutation({
    mutationFn: ({ bet, payout }: { bet: number; payout: number }) => api.blackjackRound(bet, payout),
    onSuccess: (data) => {
      // Sync le solde sur le AuthContext sans re-fetch
      if (user) setUser({ ...user, coins: data.coins });
      qc.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });

  function startRound() {
    if (!canBet) return;
    const deck = makeDeck();
    deckRef.current = deck;
    const p1 = deck.pop()!;
    const d1 = deck.pop()!;
    const p2 = deck.pop()!;
    const d2: Card = { ...deck.pop()!, hidden: true };
    setPlayerHand([]);
    setDealerHand([]);
    setResult(null);
    setPayout(0);
    setPhase('dealing');

    // Animation : on distribue les cartes une par une avec 400ms d'écart
    setTimeout(() => setPlayerHand([p1]), 0);
    setTimeout(() => setDealerHand([d1]), 350);
    setTimeout(() => setPlayerHand([p1, p2]), 700);
    setTimeout(() => setDealerHand([d1, d2]), 1050);
    setTimeout(() => {
      // Check blackjack player → instant win (sauf si dealer aussi BJ → push)
      const ph = [p1, p2];
      const dh = [d1, d2];
      const playerBJ = handValue(ph) === 21;
      const dealerVisibleBJ = (d1.rank === 'A' || d1.rank === 'K' || d1.rank === 'Q' || d1.rank === 'J' || d1.rank === '10')
                              && (d2.rank === 'A' || d2.rank === 'K' || d2.rank === 'Q' || d2.rank === 'J' || d2.rank === '10')
                              && (d1.rank === 'A' || d2.rank === 'A');
      if (playerBJ) {
        // Reveal dealer card now
        setDealerHand([d1, { ...d2, hidden: false }]);
        if (dealerVisibleBJ) {
          finishRound(ph, [d1, { ...d2, hidden: false }], 'push');
        } else {
          finishRound(ph, [d1, { ...d2, hidden: false }], 'blackjack');
        }
      } else {
        setPhase('player');
      }
    }, 1400);
  }

  function hit() {
    if (phase !== 'player') return;
    const next = deckRef.current.pop()!;
    const newHand = [...playerHand, next];
    setPlayerHand(newHand);
    const val = handValue(newHand);
    if (val > 21) {
      setTimeout(() => finishRound(newHand, dealerHand, 'bust'), 500);
    } else if (val === 21) {
      // Auto-stand au max
      setTimeout(() => stand(newHand), 400);
    }
  }

  function stand(handOverride?: Card[]) {
    if (phase !== 'player') return;
    const ph = handOverride ?? playerHand;
    setPhase('dealer');
    // Reveal dealer hidden card
    const revealed = dealerHand.map((c) => ({ ...c, hidden: false }));
    setDealerHand(revealed);
    // Dealer hits jusqu'à >=17
    let dh = revealed.slice();
    setTimeout(() => playDealer(ph, dh), 700);
  }

  function playDealer(ph: Card[], dh: Card[]) {
    if (handValue(dh) >= 17) {
      // Compare
      const pv = handValue(ph);
      const dv = handValue(dh);
      let r: RoundResult;
      if (dv > 21 || pv > dv) r = 'win';
      else if (pv < dv) r = 'lose';
      else r = 'push';
      finishRound(ph, dh, r);
      return;
    }
    // Tire une carte avec délai
    const next = deckRef.current.pop()!;
    const newDh = [...dh, next];
    setDealerHand(newDh);
    setTimeout(() => playDealer(ph, newDh), 650);
  }

  function finishRound(ph: Card[], dh: Card[], r: RoundResult) {
    let p = 0;
    if (r === 'win') p = bet * 2;
    else if (r === 'push') p = bet;
    else if (r === 'blackjack') p = Math.floor(bet * 2.5);
    else p = 0; // lose, bust
    setResult(r);
    setPayout(p);
    setPhase('result');
    roundMut.mutate({ bet, payout: p });
  }

  function newRound() {
    setPhase('betting');
    setPlayerHand([]);
    setDealerHand([]);
    setResult(null);
    setPayout(0);
  }

  const playerTotal = handValue(playerHand);
  const dealerVisible = useMemo(() => dealerHand.filter((c) => !c.hidden), [dealerHand]);
  const dealerTotal = handValue(dealerVisible);

  return (
    <Shell title="🎰 Blackjack" onBack={() => nav(-1)} action={<CoinsBadge coins={coins} />}>
      {/* Croupier */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1 }}>CROUPIER</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
          🤵 {dealerName}
          {phase !== 'betting' && (
            <span style={{ marginLeft: 8, fontSize: 14, color: 'var(--muted)' }}>
              · {dealerTotal}
            </span>
          )}
        </div>
        <HandRow cards={dealerHand} />
      </div>

      {/* Pot central + result */}
      <div style={{ textAlign: 'center', minHeight: 80, padding: '8px 0' }}>
        {phase === 'result' && result && (
          <ResultBanner result={result} payout={payout} bet={bet} />
        )}
        {phase !== 'betting' && phase !== 'result' && (
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', padding: '6px 16px', borderRadius: 999, background: 'rgba(214, 255, 61, 0.18)', border: '1px solid var(--accent)' }}>
            <span style={{ fontWeight: 700 }}>{bet}</span>
            <span style={{ fontSize: 18 }}>🪙</span>
          </div>
        )}
      </div>

      {/* Joueur */}
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <HandRow cards={playerHand} />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, marginTop: 8 }}>
          {user?.pseudo}
          {phase !== 'betting' && (
            <span style={{ marginLeft: 8, fontSize: 14, color: playerTotal > 21 ? 'var(--loss)' : playerTotal === 21 ? 'var(--accent)' : 'var(--muted)' }}>
              · {playerTotal}
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
        {phase === 'betting' && (
          <BettingBar bet={bet} setBet={setBet} coins={coins} onDeal={startRound} canDeal={canBet} />
        )}
        {phase === 'player' && (
          <>
            <button className="btn btn-accent btn-lg" onClick={hit}>🃏 Tirer</button>
            <button className="btn btn-line btn-lg" onClick={() => stand()}>✋ Rester</button>
          </>
        )}
        {phase === 'result' && (
          <button className="btn btn-accent btn-lg" onClick={newRound} disabled={roundMut.isPending}>
            {roundMut.isPending ? '…' : 'Nouvelle manche'}
          </button>
        )}
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', marginTop: 20, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
        Gagne tes jetons en faisant des 1v1 (+50 par victoire, +10 par défaite, +25 sur un nul).
        Blackjack paie 3:2. Le multijoueur lobby (5-6) arrive bientôt.
      </p>
    </Shell>
  );
}

// ─ UI helpers ─────────────────────────────────────────────────────────────
function CoinsBadge({ coins }: { coins: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 12px', borderRadius: 999,
      background: 'color-mix(in oklab, #FFD700 22%, var(--surface))',
      border: '1px solid #FFD700',
      fontFamily: 'var(--font-display)', fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 16 }}>🪙</span>
      <span>{coins}</span>
    </span>
  );
}

function BettingBar({ bet, setBet, coins, onDeal, canDeal }: {
  bet: number; setBet: (n: number) => void; coins: number; onDeal: () => void; canDeal: boolean;
}) {
  const presets = [5, 10, 25, 50, 100, 250];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)' }}>
        <span style={{ color: 'var(--muted)' }}>Mise :</span>
        <input
          type="number"
          value={bet}
          onChange={(e) => setBet(Math.max(5, Math.min(coins, parseInt(e.target.value, 10) || 5)))}
          style={{
            width: 100, padding: '6px 12px', borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--line)',
            color: 'var(--text)', fontSize: 18, fontWeight: 700, textAlign: 'center',
          }}
        />
        <span style={{ fontSize: 20 }}>🪙</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {presets.filter((p) => p <= coins).map((p) => (
          <button key={p} type="button" className={`chip ${bet === p ? 'active accent' : ''}`} onClick={() => setBet(p)}>
            {p}
          </button>
        ))}
        {coins > 0 && (
          <button type="button" className="chip" onClick={() => setBet(coins)}>ALL IN</button>
        )}
      </div>
      <button className="btn btn-accent btn-lg" onClick={onDeal} disabled={!canDeal}>
        🃏 Distribuer
      </button>
      {coins < 5 && (
        <div style={{ color: 'var(--loss)', fontSize: 12 }}>
          Plus assez de jetons. Va gagner des matchs en 1v1 !
        </div>
      )}
    </div>
  );
}

function HandRow({ cards }: { cards: Card[] }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12, minHeight: 110, flexWrap: 'wrap' }}>
      {cards.map((c, i) => <CardView key={i} card={c} index={i} />)}
    </div>
  );
}

function CardView({ card, index }: { card: Card; index: number }) {
  // Animation d'entrée : la carte slide depuis le haut + flip
  const isRed = card.suit === '♥' || card.suit === '♦';
  return (
    <div
      key={`${card.rank}-${card.suit}-${card.hidden ? 'h' : 'v'}`}
      style={{
        width: 72, height: 100,
        borderRadius: 10,
        background: card.hidden ? 'linear-gradient(135deg, #5B3A1F, #2D1A0F)' : '#fff',
        border: '2px solid #fff',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        position: 'relative',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: 6,
        color: card.hidden ? '#fff' : (isRed ? '#D32030' : '#0E0E12'),
        fontFamily: 'serif', fontWeight: 700,
        animation: `idemCardDeal 0.45s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.08}s both`,
        transformOrigin: 'center',
        userSelect: 'none',
      }}
    >
      {!card.hidden && (
        <>
          <div style={{ fontSize: 16, lineHeight: 1 }}>{card.rank}</div>
          <div style={{ fontSize: 28, textAlign: 'center' }}>{card.suit}</div>
          <div style={{ fontSize: 16, lineHeight: 1, alignSelf: 'flex-end', transform: 'rotate(180deg)' }}>{card.rank}</div>
        </>
      )}
      {card.hidden && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>
          🎴
        </div>
      )}
      <style>{`
        @keyframes idemCardDeal {
          0%   { transform: translate(0, -120px) rotate(-12deg) scale(0.7); opacity: 0; }
          70%  { transform: translate(0, 8px) rotate(2deg) scale(1.04); opacity: 1; }
          100% { transform: translate(0, 0) rotate(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function ResultBanner({ result, payout, bet }: { result: RoundResult; payout: number; bet: number }) {
  const delta = payout - bet;
  const map: Record<NonNullable<RoundResult>, { text: string; color: string; emoji: string }> = {
    win:       { text: 'Gagné !',          color: 'var(--win)',    emoji: '💰' },
    blackjack: { text: 'BLACKJACK !',      color: '#FFD700',       emoji: '🎰' },
    push:      { text: 'Égalité',          color: 'var(--muted)',  emoji: '🤝' },
    lose:      { text: 'Perdu',            color: 'var(--loss)',   emoji: '💸' },
    bust:      { text: 'BUST ! (> 21)',    color: 'var(--loss)',   emoji: '💥' },
  };
  if (!result) return null;
  const cfg = map[result];
  return (
    <div style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      padding: '10px 24px', borderRadius: 14,
      background: `color-mix(in oklab, ${cfg.color} 18%, var(--surface))`,
      border: `2px solid ${cfg.color}`,
      animation: 'idemPopIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
    }}>
      <div style={{ fontSize: 32 }}>{cfg.emoji}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: cfg.color, letterSpacing: 1 }}>{cfg.text}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: delta > 0 ? 'var(--win)' : delta < 0 ? 'var(--loss)' : 'var(--muted)' }}>
        {delta > 0 ? `+${delta}` : delta} 🪙
      </div>
      <style>{`
        @keyframes idemPopIn {
          0%   { transform: scale(0.4); opacity: 0; }
          80%  { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
