import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import type { GameProps } from '../GameModule';
import type { GameModule } from '../GameModule';
import type { KartInput, KartState, RaceState } from './types';
import { buildTrack, gridStartPosition } from './track';
import { stepKart, resolveKartCollisions, PhysicsConfig } from './physics';
import { spawnItemBoxes, pickupItemBoxes, stepActiveItems, useItem as triggerItem, rankOfKart } from './items';
import { botSkillFor, getBotInput } from './ai';
import { buildScene, followKart, syncMeshes, syncEmotes, KART_COLORS } from './scene';
import { useRemoteGameSync } from '../../realtime/useRemoteGameSync';
import { EMOTES } from '../../lib/emotes';

// 3D kart racer. 4 karts toujours en course. Modes :
//  - local-1p (solo)   : P1 humain (flèches ou ZQSD) + 3 bots
//  - local-2p          : P1 flèches + P2 ZQSD + 2 bots, split-screen vertical
//  - host              : P1 humain, simulation locale broadcastée au guest
//  - guest             : P2 humain, reçoit l'état du host
//
// Le score envoyé à l'API mappe position d'arrivée → score (1er = 4, 2e = 3,
// 3e = 2, 4e = 1) pour que computeWinner du back (score > score = winner)
// renvoie le bon vainqueur sans hack.

type Phase = 'setup' | 'countdown' | 'racing' | 'finished';
type SetupChoice = 'solo' | 'local-2p';

const TOTAL_LAPS = 3;
const COUNTDOWN_MS = 3500;
const BOT_NAMES = ['Bot Mario', 'Bot Yoshi', 'Bot Bowser'];

function KartGameImpl({ onFinish, player1, player2, mode = 'local', matchId }: GameProps) {
  const isRemote = mode === 'host' || mode === 'guest';
  const [phase, setPhase] = useState<Phase>(isRemote ? 'countdown' : 'setup');
  const [choice, setChoice] = useState<SetupChoice>('solo');
  const [now, setNow] = useState(() => performance.now());
  const [fpsMode, setFpsMode] = useState(false);
  const [hudTick, setHudTick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [debugInfo, setDebugInfo] = useState<{ camX: number; camY: number; camZ: number; kartX: number; kartZ: number; heading: number; cssW: number; cssH: number; bufW: number; bufH: number } | null>(null);
  const inputRef = useRef<{ p1: KartInput; p2: KartInput }>({
    p1: emptyInput(), p2: emptyInput(),
  });
  const keysRef = useRef<Set<string>>(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);

  const track = useMemo(() => buildTrack(), []);

  // Le mode local effectif (après le setup) ou imposé par le remote.
  const effectiveMode: 'local-1p' | 'local-2p' | 'host' | 'guest' = isRemote
    ? (mode as 'host' | 'guest')
    : choice === 'solo' ? 'local-1p' : 'local-2p';
  const splitScreen = effectiveMode === 'local-2p';

  // État de course
  const stateRef = useRef<RaceState>({
    karts: [],
    itemBoxes: [],
    activeItems: [],
    startedAt: 0,
    totalLaps: TOTAL_LAPS,
    finishedOrder: [],
  });

  // Sync remote (host envoie state, guest reçoit state)
  const myKartIdRef = useRef<string | null>(null);

  const { sendInput, sendState } = useRemoteGameSync<KartInput, RaceState>({
    matchId: isRemote ? matchId ?? null : null,
    role: isRemote ? (mode as 'host' | 'guest') : 'local',
    onInput: (inp) => {
      // host reçoit l'input du guest = mon player2
      const k = stateRef.current.karts.find((x) => x.id === 'p2');
      if (k) inputRef.current.p2 = inp;
    },
    onState: (snap) => {
      // guest reçoit l'état total, on remplace
      stateRef.current = snap;
    },
  });

  // -- Initialisation : crée la flotte de karts en grille ---------------------
  useEffect(() => {
    if (phase !== 'countdown') return;
    const total = 4;
    const karts: KartState[] = [];
    const colors = KART_COLORS;
    const p1Name = player1?.pseudo || 'Joueur 1';
    const p2Name = player2?.pseudo || 'Joueur 2';

    function makeKart(id: string, pseudo: string, color: number, isBot: boolean, idx: number): KartState {
      const pos = gridStartPosition(track, idx, total);
      return {
        id, pseudo, color,
        x: pos.x, z: pos.z, y: 0,
        heading: pos.heading,
        speed: 0,
        itemStock: null,
        boostUntil: 0,
        stunUntil: 0,
        lapProgress: 0,
        lap: 0,
        totalProgress: 0,
        finished: false,
        isBot,
      };
    }

    if (effectiveMode === 'local-1p') {
      karts.push(makeKart('p1', p1Name, colors[0], false, 0));
      for (let i = 0; i < 3; i++) {
        karts.push(makeKart(`bot${i}`, BOT_NAMES[i], colors[i + 1], true, i + 1));
      }
      myKartIdRef.current = 'p1';
    } else if (effectiveMode === 'local-2p') {
      karts.push(makeKart('p1', p1Name, colors[0], false, 0));
      karts.push(makeKart('p2', p2Name, colors[1], false, 1));
      for (let i = 0; i < 2; i++) {
        karts.push(makeKart(`bot${i}`, BOT_NAMES[i], colors[i + 2], true, i + 2));
      }
      myKartIdRef.current = 'p1';
    } else {
      // host / guest : 2 humains + 2 bots, p1=host, p2=guest
      karts.push(makeKart('p1', p1Name, colors[0], false, 0));
      karts.push(makeKart('p2', p2Name, colors[1], false, 1));
      for (let i = 0; i < 2; i++) {
        karts.push(makeKart(`bot${i}`, BOT_NAMES[i], colors[i + 2], true, i + 2));
      }
      myKartIdRef.current = mode === 'host' ? 'p1' : 'p2';
    }

    stateRef.current = {
      karts,
      itemBoxes: spawnItemBoxes(track),
      activeItems: [],
      startedAt: performance.now() + COUNTDOWN_MS,
      totalLaps: TOTAL_LAPS,
      finishedOrder: [],
    };

    // Démarrage de la course après le compte à rebours
    const t = window.setTimeout(() => setPhase('racing'), COUNTDOWN_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, effectiveMode]);

  // -- Inputs clavier --------------------------------------------------------
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keysRef.current.add(k);
      if (k === 'c') setFpsMode((v) => !v);
      if (k === 'f') toggleFullscreen(containerRef.current);
      // Emotes : touches 1..8 → on déclenche immédiatement sur le kart joueur
      if (/^[1-9]$/.test(k)) {
        const idx = Number(k) - 1;
        const emote = EMOTES[idx];
        if (emote) triggerEmote(stateRef.current, myKartIdRef.current, emote.key, performance.now());
      }
      // Empêche le scroll de page avec les flèches / espace
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // Sync de l'état fullscreen (l'utilisateur peut sortir avec Escape)
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Auto-fullscreen au démarrage de la course (countdown). Si l'API n'est pas
  // dispo ou l'user refuse, on continue en mode encart classique sans bloquer.
  useEffect(() => {
    if (phase !== 'countdown' || !containerRef.current) return;
    requestFullscreen(containerRef.current).catch(() => {});
  }, [phase]);

  // -- Scene three.js --------------------------------------------------------
  useEffect(() => {
    if (phase === 'setup' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const handles = buildScene(track, canvas, splitScreen);

    const onResize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w > 0 && h > 0) handles.resize(w, h);
    };
    onResize();
    window.addEventListener('resize', onResize);
    // ResizeObserver : couvre le cas où le parent n'a pas encore sa taille
    // finale au mount (fullscreen, animation, layout retardé)
    const ro = new ResizeObserver(onResize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    let raf = 0;
    let lastTs = performance.now();
    let firstCamFrame = true;
    const lastSendStateRef = { current: 0 };
    const lastSendInputRef = { current: 0 };
    const lastHudRef = { current: 0 };

    const tick = (ts: number) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const tNow = ts;

      const state = stateRef.current;
      const racing = phase === 'racing';

      // Mode local et host : on simule. Guest : non, on attend les states.
      if (racing && (effectiveMode !== 'guest')) {
        // Inputs locaux
        readKeyInputs(keysRef.current, inputRef.current, effectiveMode);

        for (const kart of state.karts) {
          let input: KartInput;
          if (kart.id === 'p1') input = inputRef.current.p1;
          else if (kart.id === 'p2') input = inputRef.current.p2;
          else input = getBotInput(kart, state, track, tNow, botSkillFor(kart, state, 0.9));

          // Déclenchement item
          if (input.useItem && kart.itemStock) {
            triggerItem(state, kart, tNow);
          }

          stepKart(kart, input, { track, now: tNow, dt });

          // Check finish
          if (!kart.finished && kart.lap >= TOTAL_LAPS) {
            kart.finished = true;
            kart.finishedAt = tNow;
            state.finishedOrder.push(kart.id);
          }
        }
        resolveKartCollisions(state.karts);
        pickupItemBoxes(state, tNow);
        stepActiveItems(state, tNow, dt);

        // Fin de course : tous les humains ont fini OU tout le monde a fini
        const allFinished = state.karts.every((k) => k.finished);
        const allHumansFinished = state.karts.filter((k) => !k.isBot).every((k) => k.finished);
        if (allFinished || allHumansFinished) {
          // Bots qui n'avaient pas fini → on les classe dans l'ordre de leur totalProgress
          const stillRacing = state.karts.filter((k) => !k.finished)
            .sort((a, b) => b.totalProgress - a.totalProgress);
          for (const k of stillRacing) {
            k.finished = true;
            k.finishedAt = tNow;
            state.finishedOrder.push(k.id);
          }
          setPhase('finished');
        }

        // Host : broadcast l'état (3 fois/s pour limiter le bruit réseau)
        if (effectiveMode === 'host' && tNow - lastSendStateRef.current > 200) {
          lastSendStateRef.current = tNow;
          sendState(snapshotForGuest(state));
        }
      }

      // Guest : envoie ses inputs (à 10Hz)
      if (effectiveMode === 'guest' && racing) {
        readKeyInputs(keysRef.current, inputRef.current, effectiveMode);
        const p2 = state.karts.find((k) => k.id === 'p2');
        if (p2 && tNow - lastSendInputRef.current > 100) {
          lastSendInputRef.current = tNow;
          sendInput(inputRef.current.p1); // côté guest, mes touches commandent p2
        }
      }

      // Sync visuels
      syncMeshes(state, handles, tNow);
      syncEmotes(state.karts, handles, tNow);

      // Caméras — snap au premier frame (sinon le lerp depuis (0,6,10) laisse
      // entrevoir des frames hors du circuit, et l'utilisateur a 1 seconde où
      // il voit "que de l'herbe").
      const myKart = state.karts.find((k) => k.id === myKartIdRef.current);
      if (handles.cameras[0] && myKart) followKart(handles.cameras[0], myKart, fpsMode, dt, firstCamFrame);
      if (splitScreen) {
        const p2 = state.karts.find((k) => k.id === 'p2');
        if (handles.cameras[1] && p2) followKart(handles.cameras[1], p2, fpsMode, dt, firstCamFrame);
      }
      firstCamFrame = false;

      // Rendu (1 ou 2 viewports)
      const W = handles.renderer.domElement.width;
      const H = handles.renderer.domElement.height;
      if (splitScreen) {
        handles.renderer.setScissorTest(true);
        handles.renderer.setViewport(0, H / 2, W, H / 2);
        handles.renderer.setScissor(0, H / 2, W, H / 2);
        handles.renderer.render(handles.scene, handles.cameras[0]);
        handles.renderer.setViewport(0, 0, W, H / 2);
        handles.renderer.setScissor(0, 0, W, H / 2);
        handles.renderer.render(handles.scene, handles.cameras[1]);
        handles.renderer.setScissorTest(false);
      } else {
        handles.renderer.setViewport(0, 0, W, H);
        handles.renderer.render(handles.scene, handles.cameras[0]);
      }

      // HUD refresh ~10Hz (utilisé aussi pour piloter le décompte du countdown)
      if (tNow - lastHudRef.current > 100) {
        lastHudRef.current = tNow;
        setNow(tNow);
        setHudTick((v) => v + 1);
        // Debug : on capture les coords caméra + kart + dims canvas pour
        // afficher dans l'overlay (cf. DebugOverlay plus bas)
        if (myKart && handles.cameras[0]) {
          setDebugInfo({
            camX: +handles.cameras[0].position.x.toFixed(1),
            camY: +handles.cameras[0].position.y.toFixed(1),
            camZ: +handles.cameras[0].position.z.toFixed(1),
            kartX: +myKart.x.toFixed(1),
            kartZ: +myKart.z.toFixed(1),
            heading: +myKart.heading.toFixed(2),
            cssW: canvas.parentElement?.clientWidth ?? 0,
            cssH: canvas.parentElement?.clientHeight ?? 0,
            bufW: handles.renderer.domElement.width,
            bufH: handles.renderer.domElement.height,
          });
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      handles.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, effectiveMode, fpsMode, splitScreen]);

  // -- Fin de course : calcule les scores et appelle onFinish ---------------
  const finishedReportedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'finished' || finishedReportedRef.current) return;
    finishedReportedRef.current = true;
    // Place de p1 et p2 dans state.finishedOrder
    const state = stateRef.current;
    const order = state.finishedOrder;
    const posOf = (id: string) => order.indexOf(id);
    const p1Pos = posOf('p1');
    const p2Pos = posOf('p2');
    // Score = 4 - position (1er=4, 2e=3, 3e=2, 4e=1). Si pas trouvé : 0.
    const scoreOf = (pos: number) => pos < 0 ? 0 : Math.max(1, 4 - pos);
    const sp1 = scoreOf(p1Pos);
    // En solo, p2 n'existe pas : on envoie score = meilleur bot
    let sp2: number;
    if (effectiveMode === 'local-1p') {
      // En solo, P2 = "le meilleur bot" pour que l'ELO reflète vrai/faux
      const botOrder = order.filter((id) => id.startsWith('bot'));
      const best = botOrder[0] ? posOf(botOrder[0]) : -1;
      sp2 = scoreOf(best);
    } else {
      sp2 = scoreOf(p2Pos);
    }
    // Délai pour que l'écran de victoire s'affiche un instant
    const t = window.setTimeout(() => onFinish(sp1, sp2), 2500);
    return () => clearTimeout(t);
  }, [phase, effectiveMode, onFinish]);

  // -- Render ---------------------------------------------------------------
  if (phase === 'setup' && !isRemote) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', padding: 20 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>🏎️ Kart Race</h2>
        <p style={{ color: 'var(--muted)', textAlign: 'center', maxWidth: 520 }}>
          Course de karts 3D, 3 tours. Ramasse les <strong>?-boxes</strong> pour décrocher
          un boost, une banane ou une carapace. Touche <kbd>C</kbd> pour changer de caméra (3e personne / cockpit).
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className={`btn ${choice === 'solo' ? 'btn-accent' : 'btn-ghost'}`}
            onClick={() => setChoice('solo')}>
            Solo vs 3 bots
          </button>
          <button className={`btn ${choice === 'local-2p' ? 'btn-accent' : 'btn-ghost'}`}
            onClick={() => setChoice('local-2p')}>
            Local 1v1 + 2 bots
          </button>
        </div>
        <ControlsHelp twoPlayers={choice === 'local-2p'} />
        <button className="btn btn-accent btn-lg" onClick={() => setPhase('countdown')}>
          🏁 Démarrer la course
        </button>
      </div>
    );
  }

  // En plein écran, on prend tout le viewport. Sinon, encart 16:9 paysage.
  const containerStyle: CSSProperties = isFullscreen
    ? { position: 'relative', width: '100vw', height: '100vh', background: '#6ab7ff', overflow: 'hidden' }
    : { position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#6ab7ff', borderRadius: 12, overflow: 'hidden' };

  return (
    <div ref={containerRef} style={containerStyle}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      <Hud
        state={stateRef.current}
        phase={phase}
        countdownStart={stateRef.current.startedAt}
        now={now}
        myKartId={myKartIdRef.current}
        secondaryKartId={splitScreen ? 'p2' : null}
        totalLaps={TOTAL_LAPS}
        fpsMode={fpsMode}
        hudTick={hudTick}
      />
      <FullscreenToggle
        active={isFullscreen}
        onToggle={() => toggleFullscreen(containerRef.current)}
      />
      <EmoteBar onPick={(key) => triggerEmote(stateRef.current, myKartIdRef.current, key, performance.now())} />
      <DebugOverlay info={debugInfo} />
    </div>
  );
}

// Set le kart courant en mode emote. Si on est en remote, l'emote sera
// transmis naturellement avec le state suivant (host) ou via input (guest).
function triggerEmote(state: RaceState, kartId: string | null, key: string, now: number) {
  if (!kartId) return;
  const k = state.karts.find((x) => x.id === kartId);
  if (!k) return;
  k.emoteKey = key;
  k.emoteUntil = now + 2500;
}

// ─── Fullscreen helpers ─────────────────────────────────────────────────────
function requestFullscreen(el: HTMLElement | null): Promise<void> {
  if (!el) return Promise.resolve();
  if (document.fullscreenElement === el) return Promise.resolve();
  const fn = el.requestFullscreen?.bind(el);
  if (!fn) return Promise.resolve();
  return fn();
}
function toggleFullscreen(el: HTMLElement | null) {
  if (!el) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    requestFullscreen(el).catch(() => {});
  }
}

function DebugOverlay({ info }: { info: null | { camX: number; camY: number; camZ: number; kartX: number; kartZ: number; heading: number; cssW: number; cssH: number; bufW: number; bufH: number } }) {
  if (!info) return null;
  // Le rapport sigma_X = écart entre la position cible théorique
  // (kart.x - 15*cos(h), kart.z - 15*sin(h)) et la position réelle de la
  // caméra. S'il n'est pas ~0, c'est qu'un truc écrit cam.position ailleurs.
  const expectedCamX = +(info.kartX - 15 * Math.cos(info.heading)).toFixed(1);
  const expectedCamZ = +(info.kartZ - 15 * Math.sin(info.heading)).toFixed(1);
  return (
    <div style={{
      position: 'absolute', top: 12, left: 200, zIndex: 6,
      background: 'rgba(0,0,0,0.7)', color: '#3DD68C',
      fontFamily: 'monospace', fontSize: 11, padding: '6px 10px',
      borderRadius: 8, lineHeight: 1.4, pointerEvents: 'none',
    }}>
      KART   ({info.kartX}, {info.kartZ})  h={info.heading}<br />
      CAM    ({info.camX}, {info.camY}, {info.camZ})<br />
      EXPECT ({expectedCamX}, 9, {expectedCamZ})<br />
      VIEW   css={info.cssW}×{info.cssH}  buf={info.bufW}×{info.bufH}
    </div>
  );
}

function FullscreenToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={active ? 'Quitter plein écran (F ou Échap)' : 'Plein écran (F)'}
      style={{
        position: 'absolute', top: 12, right: 12, zIndex: 5,
        background: 'rgba(0,0,0,0.6)', color: 'white',
        border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
        padding: '6px 10px', cursor: 'pointer', fontSize: 13,
      }}
    >
      {active ? '✕ Quitter' : '⛶ Plein écran'}
    </button>
  );
}

function EmoteBar({ onPick }: { onPick: (key: string) => void }) {
  return (
    <div style={{
      position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: 6, zIndex: 5, padding: '6px 8px',
      background: 'rgba(0,0,0,0.55)', borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      {EMOTES.map((e, i) => (
        <button
          key={e.key}
          onClick={() => onPick(e.key)}
          title={`${e.label} — touche ${i + 1}`}
          style={{
            position: 'relative', width: 46, height: 46, borderRadius: 10, cursor: 'pointer',
            background: e.bg, color: e.fg, border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, transition: 'transform .08s ease',
          }}
          onMouseEnter={(ev) => { (ev.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'; }}
          onMouseLeave={(ev) => { (ev.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
        >
          <span>{e.emoji}</span>
          <span style={{
            position: 'absolute', top: -8, right: -6,
            background: '#0d0d10', color: '#FFD23B',
            width: 18, height: 18, borderRadius: 9,
            fontSize: 10, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #FFD23B',
          }}>{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

function readKeyInputs(keys: Set<string>, dest: { p1: KartInput; p2: KartInput }, mode: 'local-1p' | 'local-2p' | 'host' | 'guest') {
  const has = (k: string) => keys.has(k);

  // P1 : flèches + ZQSD aussi accepté en local-1p (la plupart des joueurs préfèrent ZQSD)
  const useArrowsAsP1 = mode !== 'local-2p';
  const useZqsdAsP1 = mode !== 'local-2p';

  // ARROWS — pour P1 en solo/host/guest, pour P1 en split-screen
  const arrowUp    = has('arrowup');
  const arrowDown  = has('arrowdown');
  const arrowLeft  = has('arrowleft');
  const arrowRight = has('arrowright');

  // ZQSD — pour P1 en solo (alternative), pour P2 en split-screen
  const z = has('z') || has('w'); // WASD aussi accepté
  const s = has('s');
  const q = has('q') || has('a');
  const d = has('d');

  if (mode === 'local-2p') {
    // P1 = arrows
    dest.p1 = {
      throttle: arrowUp ? 1 : 0,
      brake:    arrowDown ? 1 : 0,
      steer:    (arrowLeft ? -1 : 0) + (arrowRight ? 1 : 0),
      drift:    has('control') || has('rightcontrol') || has('shift'),
      useItem:  has('enter') || has(','),
    };
    // P2 = ZQSD
    dest.p2 = {
      throttle: z ? 1 : 0,
      brake:    s ? 1 : 0,
      steer:    (q ? -1 : 0) + (d ? 1 : 0),
      drift:    has(' ') || has('spacebar'),
      useItem:  has('e'),
    };
  } else {
    // Solo / host / guest : un seul joueur, on accepte flèches OU ZQSD
    const throttle = (useArrowsAsP1 && arrowUp ? 1 : 0) || (useZqsdAsP1 && z ? 1 : 0);
    const brake    = (useArrowsAsP1 && arrowDown ? 1 : 0) || (useZqsdAsP1 && s ? 1 : 0);
    const steerL   = (useArrowsAsP1 && arrowLeft ? 1 : 0) || (useZqsdAsP1 && q ? 1 : 0);
    const steerR   = (useArrowsAsP1 && arrowRight ? 1 : 0) || (useZqsdAsP1 && d ? 1 : 0);
    dest.p1 = {
      throttle,
      brake,
      steer: -steerL + steerR,
      drift: has(' ') || has('shift') || has('control'),
      useItem: has('e') || has('enter'),
    };
  }
}

function emptyInput(): KartInput {
  return { throttle: 0, brake: 0, steer: 0, drift: false, useItem: false };
}

// Snapshot transmissible (drop des bots refs si gros).
function snapshotForGuest(state: RaceState): RaceState {
  return {
    karts: state.karts.map((k) => ({ ...k })),
    itemBoxes: state.itemBoxes.map((b) => ({ ...b })),
    activeItems: state.activeItems.map((i) => ({ ...i })),
    startedAt: state.startedAt,
    totalLaps: state.totalLaps,
    finishedOrder: [...state.finishedOrder],
  };
}

// ─── HUD overlay ────────────────────────────────────────────────────────────
function Hud(props: {
  state: RaceState;
  phase: Phase;
  countdownStart: number;
  now: number;
  myKartId: string | null;
  secondaryKartId: string | null;
  totalLaps: number;
  fpsMode: boolean;
  hudTick: number;
}) {
  const { state, phase, countdownStart, now, myKartId, secondaryKartId, totalLaps, fpsMode } = props;
  const me = state.karts.find((k) => k.id === myKartId);
  const second = secondaryKartId ? state.karts.find((k) => k.id === secondaryKartId) : null;

  // Countdown 3..2..1.. GO ! — chaque token a sa propre couleur. Le "GO !"
  // reste affiché ~700ms après que la course a démarré (sinon il flashe une
  // frame puis disparaît, on a juste le temps de le voir).
  const countdownRemain = Math.max(0, countdownStart - now);
  let cdText: string | null = null;
  let cdColor = '#FFD23B';
  if (phase === 'countdown' && countdownRemain > 0) {
    if (countdownRemain > 3000)      { cdText = 'PRÊT';  cdColor = '#FFFFFF'; }
    else if (countdownRemain > 2000) { cdText = '3';     cdColor = '#FF6B57'; }
    else if (countdownRemain > 1000) { cdText = '2';     cdColor = '#FFD23B'; }
    else                              { cdText = '1';     cdColor = '#FFFFFF'; }
  } else if (phase === 'racing' && now - countdownStart < 700) {
    cdText = 'GO !'; cdColor = '#3DD68C';
  }

  // Podium final
  if (phase === 'finished') {
    const podium = state.finishedOrder.slice(0, 4)
      .map((id) => state.karts.find((k) => k.id === id))
      .filter((k): k is KartState => !!k);
    return (
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
      }}>
        <div style={{ background: 'var(--surface)', padding: '24px 30px', borderRadius: 18, minWidth: 320, textAlign: 'center' }}>
          <h2 style={{ marginTop: 0, fontFamily: 'var(--font-display)' }}>🏁 Arrivée</h2>
          <ol style={{ textAlign: 'left', paddingLeft: 26, fontSize: 18, lineHeight: 1.55 }}>
            {podium.map((k, i) => (
              <li key={k.id} style={{
                color: k.isBot ? 'var(--muted)' : 'var(--text)',
                fontWeight: k.id === myKartId ? 800 : 500,
              }}>
                {i === 0 ? '🏆 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '   '}
                {k.pseudo}
                {k.id === myKartId ? ' (toi)' : ''}
              </li>
            ))}
          </ol>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Compte des récompenses…</div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* HUD principal joueur 1 (toujours visible) */}
      {me && (
        <KartHud
          kart={me}
          state={state}
          totalLaps={totalLaps}
          side="top"
          showSplit={!!second}
          fpsMode={fpsMode}
        />
      )}
      {/* HUD joueur 2 si split-screen */}
      {second && (
        <KartHud
          kart={second}
          state={state}
          totalLaps={totalLaps}
          side="bottom"
          showSplit
          fpsMode={fpsMode}
        />
      )}
      {/* Countdown — animation pop-in à chaque changement de token via la key */}
      {cdText && (
        <div
          key={cdText}
          style={{
            position: 'absolute', top: '32%', left: 0, right: 0, textAlign: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 900,
            fontSize: cdText === 'GO !' ? 200 : cdText === 'PRÊT' ? 96 : 220,
            color: cdColor,
            textShadow: `0 8px 0 rgba(0,0,0,0.55), 0 0 36px ${cdColor}88`,
            pointerEvents: 'none', letterSpacing: 4,
            animation: 'idemCountdownPop 0.45s cubic-bezier(0.16, 1, 0.3, 1) both',
          }}
        >
          {cdText}
        </div>
      )}
      {/* Bandeau "Locked, attends le GO" pendant le countdown — l'utilisateur
          ne sait pas toujours qu'il est verrouillé, on lui dit. */}
      {phase === 'countdown' && (
        <div style={{
          position: 'absolute', bottom: 90, left: 0, right: 0, textAlign: 'center',
          color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 700,
          letterSpacing: 1.5, textTransform: 'uppercase', pointerEvents: 'none',
          textShadow: '0 2px 4px rgba(0,0,0,0.6)',
        }}>
          Garde tes mains sur le volant — décollage imminent
        </div>
      )}
      <style>{`
        @keyframes idemCountdownPop {
          0%   { transform: scale(0.2);  opacity: 0; }
          35%  { transform: scale(1.35); opacity: 1; }
          80%  { transform: scale(1.0);  opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.95; }
        }
      `}</style>
    </>
  );
}

function KartHud({ kart, state, totalLaps, side, showSplit, fpsMode }: {
  kart: KartState; state: RaceState; totalLaps: number;
  side: 'top' | 'bottom'; showSplit: boolean; fpsMode: boolean;
}) {
  const rank = rankOfKart(state, kart.id);
  const speedKph = Math.round(Math.abs(kart.speed) * 3.6);
  const lapLabel = `Tour ${Math.min(totalLaps, kart.lap + 1)} / ${totalLaps}`;
  const positionEmoji = ['🥇', '🥈', '🥉', '4️⃣'][rank] || '';
  const itemLabel = kart.itemStock === 'boost' ? '🚀' :
                    kart.itemStock === 'banana' ? '🍌' :
                    kart.itemStock === 'shell' ? '🐢' : '—';
  const yPosStyle = side === 'top'
    ? { top: 12 }
    : { bottom: 12 };

  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, ...yPosStyle,
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      pointerEvents: 'none', userSelect: 'none',
    }}>
      <div style={{
        background: 'rgba(0,0,0,0.6)', padding: '8px 12px', borderRadius: 12,
        color: 'white', fontFamily: 'var(--font-display)', fontWeight: 800,
        display: 'flex', flexDirection: 'column', gap: 2, minWidth: 140,
      }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>{kart.pseudo}{showSplit ? '' : ''}</div>
        <div style={{ fontSize: 17 }}>{positionEmoji} {ordinal(rank + 1)}</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>{lapLabel}</div>
      </div>
      <div style={{
        background: 'rgba(0,0,0,0.6)', padding: '8px 12px', borderRadius: 12,
        color: 'white', textAlign: 'right', minWidth: 110,
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, lineHeight: 1 }}>
          {speedKph}<span style={{ fontSize: 12, marginLeft: 4 }}>km/h</span>
        </div>
        <div style={{ fontSize: 22, marginTop: 2 }}>{itemLabel}</div>
      </div>
      {!showSplit && (
        <div style={{
          position: 'absolute', top: 0, right: 0, transform: 'translate(0, -100%)',
          background: 'rgba(0,0,0,0.45)', padding: '4px 8px', borderRadius: 8,
          color: 'white', fontSize: 11, marginTop: -28,
        }}>
          {fpsMode ? 'Cockpit (C)' : '3e personne (C)'}
        </div>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  if (n === 1) return '1er';
  return `${n}e`;
}

function ControlsHelp({ twoPlayers }: { twoPlayers: boolean }) {
  return (
    <div className="panel" style={{ padding: 14, width: '100%', maxWidth: 520, fontSize: 13 }}>
      <div className="eyebrow"><span className="label">Contrôles</span></div>
      {twoPlayers ? (
        <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 22, lineHeight: 1.6 }}>
          <li><strong>P1</strong> : flèches ↑↓←→, <kbd>Maj</kbd> drift, <kbd>Entrée</kbd> item</li>
          <li><strong>P2</strong> : <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd>, <kbd>Espace</kbd> drift, <kbd>E</kbd> item</li>
          <li><kbd>C</kbd> bascule cockpit / 3e personne (les 2 joueurs)</li>
        </ul>
      ) : (
        <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 22, lineHeight: 1.6 }}>
          <li>Avancer / tourner : flèches <strong>ou</strong> ZQSD/WASD</li>
          <li><kbd>Maj</kbd> (Shift) ou <kbd>Espace</kbd> : drift (braquage serré, sortie + rapide)</li>
          <li><kbd>E</kbd> ou <kbd>Entrée</kbd> : utiliser l'item en stock</li>
          <li><kbd>C</kbd> : cockpit / 3e personne &nbsp;·&nbsp; <kbd>F</kbd> : plein écran</li>
          <li><kbd>1</kbd> à <kbd>9</kbd> : emotes (rage, clown, goat, L… + 🦈 Sharknado en 9)</li>
        </ul>
      )}
    </div>
  );
}

export const KartGame: GameModule = {
  id: 'kart',
  apiId: 'kart',
  name: 'Kart Race',
  description: 'Course de karts 3D — boost, banane, carapace, 3 tours. Solo, local 1v1 ou en ligne.',
  Component: KartGameImpl,
};

// Petit usage de THREE pour éviter qu'un tree-shaker zélé le retire si rien
// d'autre ne l'importe directement ici (en pratique scene.ts le fait).
void THREE;
void PhysicsConfig;
