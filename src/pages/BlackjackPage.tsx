import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';

// Blackjack solo contre un bot croupier (table 6 places).
// Le multijoueur lobby arrivera plus tard ; pour l'instant le user
// s'assied à la place du milieu, les autres sont des places libres.

const DEALER_NAMES = ['Bebeto', 'Jumper', 'Dim'] as const;
const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const SEAT_COUNT = 6;

type Suit = typeof SUITS[number];
type Rank = typeof RANKS[number];
interface Card { rank: Rank; suit: Suit; hidden?: boolean }

type Phase = 'betting' | 'dealing' | 'player' | 'dealer' | 'reveal' | 'result';
type RoundResult = 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | null;

function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
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
  // Place du joueur courant : place du milieu (index 2 sur 6 places 0..5)
  const mySeatIndex = 2;

  const roundMut = useMutation({
    mutationFn: ({ bet, payout }: { bet: number; payout: number }) => api.blackjackRound(bet, payout),
    onSuccess: (data) => {
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

    // Distribution séquentielle
    setTimeout(() => setPlayerHand([p1]),        0);
    setTimeout(() => setDealerHand([d1]),       350);
    setTimeout(() => setPlayerHand([p1, p2]),   700);
    setTimeout(() => setDealerHand([d1, d2]), 1050);
    setTimeout(() => {
      const ph = [p1, p2];
      const playerBJ = handValue(ph) === 21;
      const tenLike = (c: Card) => c.rank === '10' || c.rank === 'J' || c.rank === 'Q' || c.rank === 'K' || c.rank === 'A';
      const dealerBJ = tenLike(d1) && tenLike(d2) && (d1.rank === 'A' || d2.rank === 'A');
      if (playerBJ) {
        setDealerHand([d1, { ...d2, hidden: false }]);
        finishRound(ph, [d1, { ...d2, hidden: false }], dealerBJ ? 'push' : 'blackjack');
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
    if (val > 21) setTimeout(() => finishRound(newHand, dealerHand, 'bust'), 500);
    else if (val === 21) setTimeout(() => stand(newHand), 400);
  }

  function stand(handOverride?: Card[]) {
    if (phase !== 'player') return;
    const ph = handOverride ?? playerHand;
    setPhase('dealer');
    const revealed = dealerHand.map((c) => ({ ...c, hidden: false }));
    setDealerHand(revealed);
    setTimeout(() => playDealer(ph, revealed.slice()), 700);
  }

  function playDealer(ph: Card[], dh: Card[]) {
    if (handValue(dh) >= 17) {
      const pv = handValue(ph);
      const dv = handValue(dh);
      let r: RoundResult;
      if (dv > 21 || pv > dv) r = 'win';
      else if (pv < dv) r = 'lose';
      else r = 'push';
      finishRound(ph, dh, r);
      return;
    }
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

  // Construction des 6 places — le user occupe mySeatIndex, les autres sont vides
  const seats = useMemo(() => Array.from({ length: SEAT_COUNT }, (_, i) => ({
    index: i,
    isMe: i === mySeatIndex,
    player: i === mySeatIndex && user ? user : null,
  })), [user]);

  return (
    <Shell title="🎰 Blackjack" onBack={() => nav(-1)} action={<CoinsBadge coins={coins} />}>
      <BlackjackTable
        seats={seats}
        playerHand={playerHand}
        dealerHand={dealerHand}
        dealerName={dealerName}
        dealerTotal={dealerTotal}
        playerTotal={playerTotal}
        phase={phase}
        result={result}
        payout={payout}
        bet={bet}
        mySeatIndex={mySeatIndex}
      />

      {/* Contrôles sous la table */}
      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
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

      <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', marginTop: 18, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
        Gagne tes jetons en faisant des 1v1 (+50 victoire · +10 défaite · +25 nul).
        Blackjack paie 3:2. Le multijoueur lobby (5-6) arrive bientôt.
      </p>
    </Shell>
  );
}

// ─ Table SVG façon casino Vegas ─────────────────────────────────────────────
function BlackjackTable({
  seats, playerHand, dealerHand, dealerName, dealerTotal, playerTotal,
  phase, result, payout, bet, mySeatIndex,
}: {
  seats: Array<{ index: number; isMe: boolean; player: { pseudo: string; avatarUrl?: string | null } | null }>;
  playerHand: Card[]; dealerHand: Card[]; dealerName: string; dealerTotal: number; playerTotal: number;
  phase: Phase; result: RoundResult; payout: number; bet: number; mySeatIndex: number;
}) {
  // Coordonnées en unités viewBox (1000×600)
  const VB_W = 1000;
  const VB_H = 600;
  // Centre des places : arc convexe (smile) en bas
  const seatArcCenter = { x: VB_W / 2, y: 110 }; // au-dessus de la zone
  const seatArcRadius = 440;
  const seatStartAngle = Math.PI * 0.30; // ~54°
  const seatEndAngle   = Math.PI * 0.70; // ~126°
  const seatPositions = seats.map((_, i) => {
    const t = seats.length === 1 ? 0.5 : i / (seats.length - 1);
    const angle = seatStartAngle + t * (seatEndAngle - seatStartAngle);
    return {
      x: seatArcCenter.x + seatArcRadius * Math.cos(angle),
      y: seatArcCenter.y + seatArcRadius * Math.sin(angle),
    };
  });

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 1000, margin: '0 auto', aspectRatio: `${VB_W} / ${VB_H}` }}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          {/* Feutre vert avec vignette */}
          <radialGradient id="felt" cx="50%" cy="50%" r="65%">
            <stop offset="0%"  stopColor="#1B7A3F" />
            <stop offset="65%" stopColor="#0F5A2C" />
            <stop offset="100%" stopColor="#053015" />
          </radialGradient>
          {/* Arc supérieur jaune pour "Dealer Must Draw on 16…" */}
          <path id="arcRules" d="M 180 290 A 360 260 0 0 1 820 290" fill="none" />
          {/* Arc interne pour "INSURANCE PAYS 2 TO 1" */}
          <path id="arcInsurance" d="M 220 320 A 320 230 0 0 1 780 320" fill="none" />
        </defs>

        {/* Fond table */}
        <rect width={VB_W} height={VB_H} rx="24" fill="url(#felt)" />
        {/* Bordure cuir */}
        <rect x="2" y="2" width={VB_W - 4} height={VB_H - 4} rx="22" fill="none" stroke="#3A1F0C" strokeWidth="6" />
        <rect x="12" y="12" width={VB_W - 24} height={VB_H - 24} rx="16" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="2" />

        {/* BLACK JACK header + PAYS 3 TO 2 */}
        <text x={VB_W / 2} y="100" textAnchor="middle"
          fontFamily="Georgia, serif" fontSize="40" fontWeight="700"
          fill="#0a0a0a" letterSpacing="6">
          BLACK JACK
        </text>
        <text x={VB_W / 2} y="135" textAnchor="middle"
          fontFamily="Georgia, serif" fontSize="14" fontWeight="700"
          fill="#D4A028" letterSpacing="4">
          PAYS 3 TO 2
        </text>

        {/* Arc jaune "Dealer Must Draw on 16 and Stand on 17" */}
        <path d="M 180 290 A 360 260 0 0 1 820 290" stroke="#E5C158" strokeWidth="4" fill="none" />
        <text fontFamily="Georgia, serif" fontSize="20" fontWeight="700" fill="#0a0a0a" letterSpacing="2">
          <textPath href="#arcRules" startOffset="50%" textAnchor="middle">
            Dealer Must Draw on 16 and Stand on 17
          </textPath>
        </text>

        {/* INSURANCE PAYS 2 TO 1 — rouge */}
        <text fontFamily="Georgia, serif" fontSize="32" fontWeight="800" fill="#B11D1D" letterSpacing="6">
          <textPath href="#arcInsurance" startOffset="50%" textAnchor="middle">
            INSURANCE PAYS
          </textPath>
        </text>
        {/* Labels "2 TO 1" sur les côtés */}
        <text x="195" y="335" fontFamily="Georgia, serif" fontSize="22" fontWeight="700" fill="#0a0a0a" textAnchor="middle" transform="rotate(-32 195 335)">2 TO 1</text>
        <text x="805" y="335" fontFamily="Georgia, serif" fontSize="22" fontWeight="700" fill="#0a0a0a" textAnchor="middle" transform="rotate(32 805 335)">2 TO 1</text>

        {/* Sièges (cases jaunes) */}
        {seatPositions.map((pos, i) => (
          <g key={i}>
            {/* Carré or */}
            <rect
              x={pos.x - 55} y={pos.y - 35} width="110" height="70" rx="14"
              fill={seats[i].isMe ? 'rgba(214, 255, 61, 0.10)' : 'rgba(0,0,0,0.18)'}
              stroke="#E5C158" strokeWidth="3"
            />
            {!seats[i].player && (
              <text x={pos.x} y={pos.y + 5} textAnchor="middle"
                fontFamily="Georgia, serif" fontSize="12" fill="rgba(229, 193, 88, 0.75)">
                place libre
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* ── Couches HTML par-dessus pour avatars + cartes ──────────────────── */}
      {/* Avatar dealer + cartes */}
      <DealerBox dealerName={dealerName} dealerTotal={dealerTotal} dealerHand={dealerHand} phase={phase}
        boxStyle={{ position: 'absolute', top: '3%', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}
      />

      {/* Pot central + bandeau résultat */}
      <CenterPot
        phase={phase} result={result} payout={payout} bet={bet}
        style={{ position: 'absolute', left: '50%', top: '40%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}
      />

      {/* Avatars sur chaque siège (overlay HTML car SVG n'aime pas les <img>) */}
      {seats.map((seat, i) => {
        const pos = seatPositions[i];
        const left = (pos.x / VB_W) * 100;
        const top  = (pos.y / VB_H) * 100;
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: `${left}%`, top: `${top}%`,
              transform: 'translate(-50%, -50%)',
              width: '11%', textAlign: 'center', pointerEvents: 'none',
            }}
          >
            {seat.player ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Avatar
                  seed={seat.player.pseudo}
                  size={56}
                  ring ringColor={seat.isMe ? '#D6FF3D' : '#E5C158'}
                  imageUrl={absoluteAvatar(seat.player.avatarUrl ?? null)}
                />
                <div style={{
                  marginTop: 4, fontSize: 11, fontWeight: 700,
                  color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                  maxWidth: '110%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {seat.player.pseudo}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Cartes du joueur courant — au-dessus de son siège */}
      {playerHand.length > 0 && (() => {
        const pos = seatPositions[mySeatIndex];
        const leftPct = (pos.x / VB_W) * 100;
        const topPct  = ((pos.y - 110) / VB_H) * 100;
        return (
          <div style={{
            position: 'absolute', left: `${leftPct}%`, top: `${topPct}%`,
            transform: 'translate(-50%, -100%)',
            display: 'flex', gap: 4, justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            {playerHand.map((c, i) => <MiniCard key={i} card={c} index={i} />)}
          </div>
        );
      })()}

      {/* Total du joueur sous ses cartes */}
      {playerHand.length > 0 && (() => {
        const pos = seatPositions[mySeatIndex];
        const leftPct = (pos.x / VB_W) * 100;
        const topPct  = ((pos.y + 50) / VB_H) * 100;
        return (
          <div style={{
            position: 'absolute', left: `${leftPct}%`, top: `${topPct}%`,
            transform: 'translate(-50%, 0)',
            fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14,
            color: playerTotal > 21 ? '#ff6b57' : playerTotal === 21 ? '#D6FF3D' : '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)', whiteSpace: 'nowrap',
          }}>
            {playerTotal}
          </div>
        );
      })()}
    </div>
  );
}

function DealerBox({ dealerName, dealerTotal, dealerHand, phase, boxStyle }: {
  dealerName: string; dealerTotal: number; dealerHand: Card[]; phase: Phase; boxStyle: React.CSSProperties;
}) {
  return (
    <div style={boxStyle}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '4px 12px', borderRadius: 999,
        background: 'rgba(0,0,0,0.5)',
        color: '#fff', fontFamily: 'Georgia, serif', fontWeight: 700,
      }}>
        <span style={{ fontSize: 18 }}>🤵</span>
        <span>{dealerName}</span>
        {phase !== 'betting' && (
          <span style={{ marginLeft: 4, fontSize: 12, color: '#D6FF3D' }}>· {dealerTotal}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 6, minHeight: 92 }}>
        {dealerHand.map((c, i) => <MiniCard key={i} card={c} index={i} />)}
      </div>
    </div>
  );
}

function CenterPot({ phase, result, payout, bet, style }: {
  phase: Phase; result: RoundResult; payout: number; bet: number; style: React.CSSProperties;
}) {
  return (
    <div style={style}>
      {phase === 'result' && result && <ResultBanner result={result} payout={payout} bet={bet} />}
      {phase !== 'betting' && phase !== 'result' && (
        <div style={{
          display: 'inline-flex', gap: 8, alignItems: 'center',
          padding: '6px 16px', borderRadius: 999,
          background: 'rgba(214, 255, 61, 0.20)',
          border: '1px solid #D6FF3D',
          color: '#fff', fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        }}>
          <span>{bet}</span>
          <span style={{ fontSize: 18 }}>🪙</span>
        </div>
      )}
    </div>
  );
}

// ─ UI helpers (cartes, banner, etc.) ──────────────────────────────────────
function CoinsBadge({ coins }: { coins: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 12px', borderRadius: 999,
      background: 'color-mix(in oklab, #FFD700 22%, var(--surface))',
      border: '1px solid #FFD700',
      fontFamily: 'var(--font-display)', fontWeight: 700, whiteSpace: 'nowrap',
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

function MiniCard({ card, index }: { card: Card; index: number }) {
  const isRed = card.suit === '♥' || card.suit === '♦';
  return (
    <div
      style={{
        width: 56, height: 84,
        borderRadius: 8,
        background: card.hidden ? 'linear-gradient(135deg, #5B3A1F, #2D1A0F)' : '#fff',
        border: '2px solid #fff',
        boxShadow: '0 3px 8px rgba(0,0,0,0.55)',
        position: 'relative',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: 4,
        color: card.hidden ? '#fff' : (isRed ? '#D32030' : '#0E0E12'),
        fontFamily: 'serif', fontWeight: 700,
        animation: `idemCardDeal 0.45s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.08}s both`,
        userSelect: 'none',
      }}
    >
      {!card.hidden && (
        <>
          <div style={{ fontSize: 13, lineHeight: 1 }}>{card.rank}</div>
          <div style={{ fontSize: 22, textAlign: 'center' }}>{card.suit}</div>
          <div style={{ fontSize: 13, lineHeight: 1, alignSelf: 'flex-end', transform: 'rotate(180deg)' }}>{card.rank}</div>
        </>
      )}
      {card.hidden && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
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
    win:       { text: 'Gagné !',          color: '#3DD68C',    emoji: '💰' },
    blackjack: { text: 'BLACKJACK !',      color: '#FFD700',    emoji: '🎰' },
    push:      { text: 'Égalité',          color: '#cdcdcd',    emoji: '🤝' },
    lose:      { text: 'Perdu',            color: '#FF6B57',    emoji: '💸' },
    bust:      { text: 'BUST ! (> 21)',    color: '#FF6B57',    emoji: '💥' },
  };
  if (!result) return null;
  const cfg = map[result];
  return (
    <div style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      padding: '12px 28px', borderRadius: 14,
      background: 'rgba(0,0,0,0.65)',
      border: `2px solid ${cfg.color}`,
      animation: 'idemPopIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
    }}>
      <div style={{ fontSize: 32 }}>{cfg.emoji}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: cfg.color, letterSpacing: 1 }}>{cfg.text}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: delta > 0 ? '#3DD68C' : delta < 0 ? '#FF6B57' : '#cdcdcd' }}>
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
