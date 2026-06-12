import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';
import { blackjackEmitter } from '../realtime/blackjackEvents';
import type { BJCard, BJSeat, BlackjackRoom } from '../api/types';

// Blackjack multi-joueurs : table de 6 sièges partagée. Quand on entre, on
// est auto-assigné à une room dispo (ou une nouvelle si toutes pleines).
// Le serveur fait foi pour les cartes / phases / payouts — pas de logique
// de gameplay locale ici.

const SEAT_COUNT = 6;

export function BlackjackPage() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [room, setRoom] = useState<BlackjackRoom | null>(null);
  const [seatIndex, setSeatIndex] = useState<number>(-1);
  const [bet, setBet] = useState(20);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  // Garde si on a déjà rejoint pour éviter le double join sur StrictMode (dev).
  const joinedRef = useRef(false);

  // Join au mount + leave au unmount + heartbeat.
  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    let alive = true;
    api.blackjackJoin()
      .then((r) => {
        if (!alive) return;
        setRoom(r.room);
        setSeatIndex(r.seatIndex);
      })
      .catch((e) => setJoinError(humanize(e)));
    return () => {
      alive = false;
      api.blackjackLeave().catch(() => {});
    };
  }, []);

  // Heartbeat 20s pour ne pas être idle-kick (le serveur kick à 60s).
  useEffect(() => {
    const t = window.setInterval(() => { api.blackjackHeartbeat().catch(() => {}); }, 20_000);
    return () => clearInterval(t);
  }, []);

  // Écoute les snapshots SSE.
  useEffect(() => {
    const off = blackjackEmitter.on((r) => {
      // Filtre : on ne réagit qu'aux events de NOTRE room.
      if (room && r.id !== room.id) return;
      setRoom(r);
      // Met à jour le solde de coins après un résultat (le serveur a
      // appliqué le payout, on reflète localement sans round-trip /me).
      const mySeat = r.seats.find((s) => s.isMe);
      if (r.phase === 'result' && mySeat && user) {
        // Le delta net = payout − total handBets. Le bet a déjà été débité
        // au moment du bet, donc on n'ajoute QUE le payout brut au solde
        // local pour rester cohérent.
        const payout = mySeat.payout ?? 0;
        if (payout > 0) {
          setUser({ ...user, coins: (user.coins ?? 0) + payout });
        }
      }
    });
    return () => { off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, user?.id]);

  const mySeat = room?.seats.find((s) => s.isMe) ?? null;
  const myActiveHand = mySeat?.activeHandIdx ?? 0;
  const myStatus = mySeat?.handStatus?.[myActiveHand];
  const canBet = room?.phase === 'betting' && mySeat && (mySeat.bet ?? 0) === 0;
  const canHit = room?.phase === 'playing' && myStatus === 'playing';
  const canStand = canHit;
  const canDouble = canHit && (mySeat?.hands?.[myActiveHand]?.length === 2);
  const canSplit  = canHit
    && mySeat?.hands?.length === 1
    && mySeat.hands[0].length === 2
    && mySeat.hands[0][0].rank === mySeat.hands[0][1].rank;

  const coins = user?.coins ?? 0;
  const presets = [5, 10, 25, 50, 100, 250].filter((p) => p <= coins);

  async function doBet() {
    if (!canBet || acting) return;
    if (bet > coins) return;
    setActing(true);
    try { await api.blackjackBet(bet); if (user) setUser({ ...user, coins: coins - bet }); }
    catch (e) { setJoinError(humanize(e)); }
    finally { setActing(false); }
  }
  const wrap = (fn: () => Promise<unknown>) => async () => {
    if (acting) return;
    setActing(true);
    try { await fn(); } catch (e) { setJoinError(humanize(e)); }
    finally { setActing(false); }
  };

  return (
    <Shell title="🎰 Blackjack Casino" onBack={() => nav(-1)} action={<span />}>
      {joinError && (
        <div className="panel" style={{ background: 'rgba(255,107,87,0.12)', borderColor: 'var(--loss)', color: 'var(--loss)' }}>
          {joinError}
        </div>
      )}

      {!room && !joinError && (
        <div className="panel" style={{ textAlign: 'center', padding: 50 }}>
          <div style={{ fontSize: 60 }}>🎰</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, marginTop: 8 }}>
            Recherche d'une table…
          </div>
        </div>
      )}

      {room && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Table <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>#{room.id}</span>
              {' · '}
              <span style={{ color: 'var(--text)' }}>{room.seats.filter((s) => !s.empty).length}/{room.maxSeats} joueurs</span>
            </div>
            <PhaseBadge phase={room.phase} bettingDeadline={room.bettingDeadline} resultDeadline={room.resultDeadline} />
          </div>

          <BlackjackRoomTable room={room} seatIndex={seatIndex} />

          {/* Contrôles selon la phase */}
          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
            {room.phase === 'betting' && mySeat && (mySeat.bet ?? 0) === 0 && (
              <BettingBar bet={bet} setBet={setBet} coins={coins} presets={presets} onDeal={doBet} canDeal={!!canBet && bet > 0 && bet <= coins && !acting} />
            )}
            {room.phase === 'betting' && mySeat && (mySeat.bet ?? 0) > 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                ✅ Mise de {mySeat.bet} 🪙 placée. En attente des autres…
              </div>
            )}
            {room.phase === 'playing' && (
              <>
                <button className="btn btn-accent btn-lg" onClick={wrap(() => api.blackjackHit())} disabled={!canHit || acting}>🃏 Tirer</button>
                <button className="btn btn-line btn-lg" onClick={wrap(() => api.blackjackStand())} disabled={!canStand || acting}>✋ Rester</button>
                <button className="btn btn-line btn-lg" onClick={wrap(() => api.blackjackDouble())} disabled={!canDouble || acting}>⏫ Doubler</button>
                <button className="btn btn-line btn-lg" onClick={wrap(() => api.blackjackSplit())} disabled={!canSplit || acting}>✂️ Split</button>
              </>
            )}
            {room.phase === 'dealer' && (
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>🤵 Le croupier joue…</div>
            )}
            {room.phase === 'result' && (
              <ResultStrip mySeat={mySeat} />
            )}
            {room.phase === 'waiting' && (
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>En attente du prochain round…</div>
            )}
          </div>

          <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', marginTop: 18, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
            Une nouvelle table s'ouvre quand celle-ci est pleine. Quitte avec le bouton retour — ta place sera libérée.
          </p>
        </>
      )}
    </Shell>
  );
}

// ─ Sous-composants ─────────────────────────────────────────────────────
function PhaseBadge({ phase, bettingDeadline, resultDeadline }: {
  phase: string; bettingDeadline: number; resultDeadline: number;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((n) => (n + 1) % 1000), 250);
    return () => clearInterval(t);
  }, []);
  const map: Record<string, { label: string; color: string }> = {
    waiting:  { label: 'EN ATTENTE',  color: 'var(--muted)' },
    betting:  { label: 'MISEZ',       color: '#FFD700' },
    playing:  { label: 'EN JEU',      color: 'var(--accent)' },
    dealer:   { label: 'CROUPIER',    color: '#5B8CFF' },
    result:   { label: 'RÉSULTATS',   color: '#3DD68C' },
  };
  const cfg = map[phase] ?? { label: phase.toUpperCase(), color: 'var(--muted)' };
  const countdown = phase === 'betting' && bettingDeadline > 0
    ? Math.max(0, Math.ceil((bettingDeadline - Date.now()) / 1000))
    : phase === 'result' && resultDeadline > 0
    ? Math.max(0, Math.ceil((resultDeadline - Date.now()) / 1000))
    : null;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '5px 12px', borderRadius: 999,
      background: `color-mix(in oklab, ${cfg.color} 20%, var(--surface))`,
      border: `1px solid ${cfg.color}`,
      color: cfg.color,
      fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: 1,
    }}>
      {cfg.label}{countdown !== null && <> · {countdown}s</>}
    </div>
  );
}

function BlackjackRoomTable({ room, seatIndex }: { room: BlackjackRoom; seatIndex: number }) {
  // Sièges sur un arc en bas du SVG, dealer au-dessus.
  const VB_W = 1000, VB_H = 560;
  const seatArcCenter = { x: VB_W / 2, y: 80 };
  const seatArcRadius = 440;
  const seatStartAngle = Math.PI * 0.30;
  const seatEndAngle   = Math.PI * 0.70;
  const seats = room.seats;
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
          <radialGradient id="felt" cx="50%" cy="50%" r="65%">
            <stop offset="0%"  stopColor="#1B7A3F" />
            <stop offset="65%" stopColor="#0F5A2C" />
            <stop offset="100%" stopColor="#053015" />
          </radialGradient>
        </defs>
        <rect width={VB_W} height={VB_H} rx="24" fill="url(#felt)" />
        <rect x="2" y="2" width={VB_W - 4} height={VB_H - 4} rx="22" fill="none" stroke="#3A1F0C" strokeWidth="6" />
        <text x={VB_W / 2} y="70" textAnchor="middle" fontFamily="Georgia, serif" fontSize="32" fontWeight="700" fill="#0a0a0a" letterSpacing="5">
          BLACK JACK
        </text>
        <text x={VB_W / 2} y="100" textAnchor="middle" fontFamily="Georgia, serif" fontSize="12" fontWeight="700" fill="#D4A028" letterSpacing="3">
          PAYS 3 TO 2 · TABLE #{room.id}
        </text>

        {/* Sièges */}
        {seatPositions.map((pos, i) => (
          <g key={i}>
            <rect
              x={pos.x - 55} y={pos.y - 35} width="110" height="70" rx="14"
              fill={i === seatIndex ? 'rgba(214, 255, 61, 0.10)' : 'rgba(0,0,0,0.18)'}
              stroke={i === seatIndex ? '#D6FF3D' : '#E5C158'} strokeWidth="3"
            />
            {seats[i].empty && (
              <text x={pos.x} y={pos.y + 5} textAnchor="middle" fontFamily="Georgia, serif" fontSize="11" fill="rgba(229, 193, 88, 0.75)">
                place libre
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* Dealer en haut */}
      <div style={{ position: 'absolute', top: '4%', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '4px 12px', borderRadius: 999,
          background: 'rgba(0,0,0,0.55)', color: '#fff',
          fontFamily: 'Georgia, serif', fontWeight: 700,
        }}>
          <span style={{ fontSize: 18 }}>🤵</span>
          <span>Croupier</span>
          {room.dealer.total > 0 && (
            <span style={{ marginLeft: 4, fontSize: 12, color: '#D6FF3D' }}>· {room.dealer.total}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 6, minHeight: 92 }}>
          {room.dealer.hand.map((c, i) => <MiniCard key={i} card={c} index={i} />)}
        </div>
      </div>

      {/* Avatars + mains des joueurs sur chaque siège */}
      {seats.map((seat, i) => {
        const pos = seatPositions[i];
        const leftPct = (pos.x / VB_W) * 100;
        const topPct  = (pos.y / VB_H) * 100;
        const handTopPct = ((pos.y - 110) / VB_H) * 100;
        return (
          <div key={i}>
            {/* Avatar + pseudo sur le siège */}
            <div style={{
              position: 'absolute', left: `${leftPct}%`, top: `${topPct}%`,
              transform: 'translate(-50%, -50%)',
              width: '11%', textAlign: 'center', pointerEvents: 'none',
            }}>
              {!seat.empty && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Avatar seed={seat.pseudo ?? '?'} size={52} ring ringColor={seat.isMe ? '#D6FF3D' : '#E5C158'} imageUrl={absoluteAvatar(seat.avatarUrl ?? null)} />
                  <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)', maxWidth: '110%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {seat.pseudo}
                  </div>
                  {seat.bet != null && seat.bet > 0 && (
                    <div style={{ fontSize: 11, color: '#FFD700', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                      🪙 {seat.bet}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Cartes au-dessus du siège */}
            {!seat.empty && seat.hands && seat.hands.length > 0 && (
              <div style={{
                position: 'absolute', left: `${leftPct}%`, top: `${handTopPct}%`,
                transform: 'translate(-50%, -100%)',
                display: 'flex', gap: 6, justifyContent: 'center',
                pointerEvents: 'none',
              }}>
                {seat.hands.map((h, hi) => (
                  <PlayerHandStack key={hi} hand={h} status={seat.handStatus?.[hi]} active={hi === (seat.activeHandIdx ?? 0)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlayerHandStack({ hand, status, active }: { hand: BJCard[]; status?: string; active: boolean }) {
  const total = computeTotal(hand);
  const tag = status === 'busted' ? 'BUST' : status === 'standing' ? 'STAND' : status === 'blackjack' ? 'BJ' : '';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      padding: 4, borderRadius: 8,
      border: active ? '2px solid #D6FF3D' : '2px solid transparent',
    }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {hand.map((c, i) => <MiniCard key={i} card={c} index={i} />)}
      </div>
      <div style={{
        fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 12,
        color: total > 21 ? '#FF6B57' : total === 21 ? '#D6FF3D' : '#fff',
        textShadow: '0 1px 2px rgba(0,0,0,0.8)',
      }}>
        {total} {tag && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>· {tag}</span>}
      </div>
    </div>
  );
}

function computeTotal(hand: BJCard[]): number {
  let total = 0, aces = 0;
  for (const c of hand) {
    if (c.hidden || !c.rank) continue;
    if (c.rank === 'A') { aces += 1; total += 11; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J') total += 10;
    else total += parseInt(c.rank, 10);
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}

function MiniCard({ card, index }: { card: BJCard; index: number }) {
  const isRed = card.suit === '♥' || card.suit === '♦';
  return (
    <div style={{
      width: 42, height: 62, borderRadius: 6,
      background: card.hidden ? 'linear-gradient(135deg, #5B3A1F, #2D1A0F)' : '#fff',
      border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      padding: 3, color: card.hidden ? '#fff' : (isRed ? '#D32030' : '#0E0E12'),
      fontFamily: 'serif', fontWeight: 700,
      animation: `idemCardDeal 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.06}s both`,
      userSelect: 'none',
    }}>
      {!card.hidden && (
        <>
          <div style={{ fontSize: 11, lineHeight: 1 }}>{card.rank}</div>
          <div style={{ fontSize: 16, textAlign: 'center' }}>{card.suit}</div>
          <div style={{ fontSize: 11, lineHeight: 1, alignSelf: 'flex-end', transform: 'rotate(180deg)' }}>{card.rank}</div>
        </>
      )}
      {card.hidden && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎴</div>
      )}
      <style>{`
        @keyframes idemCardDeal {
          0%   { transform: translate(0, -80px) rotate(-12deg) scale(0.7); opacity: 0; }
          70%  { transform: translate(0, 6px) rotate(2deg) scale(1.04); opacity: 1; }
          100% { transform: translate(0, 0) rotate(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function BettingBar({ bet, setBet, coins, presets, onDeal, canDeal }: {
  bet: number; setBet: (n: number) => void; coins: number; presets: number[];
  onDeal: () => void; canDeal: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)' }}>
        <span style={{ color: 'var(--muted)' }}>Mise :</span>
        <input
          type="number"
          value={bet}
          onChange={(e) => setBet(Math.max(1, Math.min(coins, parseInt(e.target.value, 10) || 1)))}
          style={{
            width: 100, padding: '6px 12px', borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--line)',
            color: 'var(--text)', fontSize: 18, fontWeight: 700, textAlign: 'center',
          }}
        />
        <span style={{ fontSize: 20 }}>🪙</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {presets.map((p) => (
          <button key={p} type="button" className={`chip ${bet === p ? 'active accent' : ''}`} onClick={() => setBet(p)}>{p}</button>
        ))}
        {coins > 0 && <button type="button" className="chip" onClick={() => setBet(coins)}>ALL IN</button>}
      </div>
      <button className="btn btn-accent btn-lg" onClick={onDeal} disabled={!canDeal}>🃏 Miser</button>
      {coins < 1 && (
        <div style={{ color: 'var(--loss)', fontSize: 12 }}>Plus de jetons. Gagne en 1v1 !</div>
      )}
    </div>
  );
}

function ResultStrip({ mySeat }: { mySeat: BJSeat | null }) {
  if (!mySeat || !mySeat.result) return <div style={{ color: 'var(--muted)' }}>Résultats…</div>;
  const r = mySeat.result;
  const payout = mySeat.payout ?? 0;
  const totalBet = useMemo(() => (mySeat.handBets ?? []).reduce((a, b) => a + b, 0), [mySeat.handBets]);
  const net = payout - totalBet;
  const map = {
    win:       { label: 'GAGNÉ',       color: '#3DD68C', emoji: '💰' },
    blackjack: { label: 'BLACKJACK !', color: '#FFD700', emoji: '🎰' },
    push:      { label: 'ÉGALITÉ',     color: '#cdcdcd', emoji: '🤝' },
    lose:      { label: 'PERDU',       color: '#FF6B57', emoji: '💸' },
    busted:    { label: 'BUST',        color: '#FF6B57', emoji: '💥' },
  } as const;
  const cfg = map[r as keyof typeof map] ?? map.lose;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 12,
      padding: '10px 20px', borderRadius: 14,
      background: 'rgba(0,0,0,0.6)', border: `2px solid ${cfg.color}`,
    }}>
      <span style={{ fontSize: 28 }}>{cfg.emoji}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: cfg.color, letterSpacing: 1 }}>{cfg.label}</span>
      <span style={{ fontWeight: 800, color: net > 0 ? '#3DD68C' : net < 0 ? '#FF6B57' : '#cdcdcd' }}>
        {net > 0 ? `+${net}` : net} 🪙
      </span>
    </div>
  );
}

function humanize(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: string }).message);
    if (m === 'insufficient_coins') return 'Pas assez de jetons.';
    if (m === 'already_bet')        return 'Tu as déjà misé pour ce round.';
    if (m === 'not_seated')         return 'Tu n\'es pas assis à une table.';
    return m;
  }
  return 'Erreur inconnue.';
}
