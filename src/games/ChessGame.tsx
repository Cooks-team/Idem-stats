import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';
import { useEmotePair } from '../realtime/useEmotePair';
import { EmoteBubble } from '../ui/EmoteBubble';
import { EmotePicker } from '../ui/EmotePicker';

// Échecs 1v1 local sur même écran/clavier, façon chess.com.
//   - P1 joue les blancs, P2 les noirs (assignment arbitraire)
//   - Click sur une pièce → coups légaux affichés en dots verts
//   - Click sur un coup → joue le coup
//   - Roque, prise en passant, promotion auto en Dame (skipper la sélection
//     pour rester simple — 99% des promotions sont des dames de toute façon)
//   - Détection échec / mat / pat / règle des 50 coups
//   - Score envoyé : winner=1, loser=0 ; nul = 0-0

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

type Color = 'w' | 'b';
type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
interface Piece { type: PieceType; color: Color }
type Square = Piece | null;
type Board = Square[][];

const PIECE_UNI: Record<Color, Record<PieceType, string>> = {
  w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
  b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' },
};

function initialBoard(): Board {
  const empty = (): Square[] => Array(8).fill(null);
  const b: Board = [];
  for (let r = 0; r < 8; r++) b.push(empty());
  const back: PieceType[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let f = 0; f < 8; f++) {
    b[0][f] = { type: back[f], color: 'b' };
    b[1][f] = { type: 'P', color: 'b' };
    b[6][f] = { type: 'P', color: 'w' };
    b[7][f] = { type: back[f], color: 'w' };
  }
  return b;
}

interface MoveRecord {
  from: [number, number]; to: [number, number];
  piece: PieceType; captured?: PieceType;
  promotion?: PieceType; castle?: 'K' | 'Q'; enPassant?: boolean;
  san: string;
}

interface GameState {
  board: Board;
  turn: Color;
  castle: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  enPassant: [number, number] | null;
  halfMove: number;
  fullMove: number;
  history: MoveRecord[];
  lastMove: { from: [number, number]; to: [number, number] } | null;
}

function initGameState(): GameState {
  return {
    board: initialBoard(),
    turn: 'w',
    castle: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfMove: 0,
    fullMove: 1,
    history: [],
    lastMove: null,
  };
}

// ─ Génération des coups ─────────────────────────────────────────────────
function pseudoLegal(state: GameState, rank: number, file: number): [number, number][] {
  const piece = state.board[rank][file];
  if (!piece) return [];
  const moves: [number, number][] = [];
  const enemy: Color = piece.color === 'w' ? 'b' : 'w';

  const ray = (dr: number, df: number) => {
    let r = rank + dr, f = file + df;
    while (r >= 0 && r < 8 && f >= 0 && f < 8) {
      const t = state.board[r][f];
      if (t == null) { moves.push([r, f]); }
      else { if (t.color === enemy) moves.push([r, f]); break; }
      r += dr; f += df;
    }
  };
  const single = (dr: number, df: number) => {
    const r = rank + dr, f = file + df;
    if (r < 0 || r >= 8 || f < 0 || f >= 8) return;
    const t = state.board[r][f];
    if (t == null || t.color === enemy) moves.push([r, f]);
  };

  switch (piece.type) {
    case 'P': {
      const dir = piece.color === 'w' ? -1 : 1;
      const startRank = piece.color === 'w' ? 6 : 1;
      const fr = rank + dir;
      if (fr >= 0 && fr < 8 && state.board[fr][file] == null) {
        moves.push([fr, file]);
        const fr2 = rank + dir * 2;
        if (rank === startRank && state.board[fr2][file] == null) moves.push([fr2, file]);
      }
      for (const df of [-1, 1]) {
        const cr = rank + dir, cf = file + df;
        if (cr < 0 || cr >= 8 || cf < 0 || cf >= 8) continue;
        const t = state.board[cr][cf];
        if (t && t.color === enemy) moves.push([cr, cf]);
        if (state.enPassant && state.enPassant[0] === cr && state.enPassant[1] === cf) {
          moves.push([cr, cf]);
        }
      }
      break;
    }
    case 'N': {
      for (const [dr, df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) single(dr, df);
      break;
    }
    case 'B': ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); break;
    case 'R': ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); break;
    case 'Q': ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); break;
    case 'K': {
      for (const dr of [-1,0,1]) for (const df of [-1,0,1]) {
        if (dr === 0 && df === 0) continue; single(dr, df);
      }
      break;
    }
  }
  return moves;
}

function isAttacked(state: GameState, r: number, f: number, byColor: Color): boolean {
  for (let rr = 0; rr < 8; rr++) for (let ff = 0; ff < 8; ff++) {
    const p = state.board[rr][ff];
    if (!p || p.color !== byColor) continue;
    if (p.type === 'P') {
      const dir = p.color === 'w' ? -1 : 1;
      if (rr + dir === r && Math.abs(ff - f) === 1) return true;
      continue;
    }
    const moves = pseudoLegal(state, rr, ff);
    for (const [mr, mf] of moves) if (mr === r && mf === f) return true;
  }
  return false;
}

function findKing(state: GameState, color: Color): [number, number] | null {
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = state.board[r][f];
    if (p && p.type === 'K' && p.color === color) return [r, f];
  }
  return null;
}
function isCheck(state: GameState, color: Color): boolean {
  const k = findKing(state, color);
  if (!k) return false;
  return isAttacked(state, k[0], k[1], color === 'w' ? 'b' : 'w');
}

function legalMoves(state: GameState, r: number, f: number): [number, number][] {
  const piece = state.board[r][f];
  if (!piece) return [];
  const pseudo = pseudoLegal(state, r, f);
  const legal: [number, number][] = [];
  for (const [tr, tf] of pseudo) {
    const next = applyMove(state, r, f, tr, tf);
    if (!isCheck(next, piece.color)) legal.push([tr, tf]);
  }
  if (piece.type === 'K' && !isCheck(state, piece.color)) {
    const canK = piece.color === 'w' ? state.castle.wK : state.castle.bK;
    const canQ = piece.color === 'w' ? state.castle.wQ : state.castle.bQ;
    const baseR = piece.color === 'w' ? 7 : 0;
    const enemy: Color = piece.color === 'w' ? 'b' : 'w';
    if (canK && state.board[baseR][5] == null && state.board[baseR][6] == null
        && !isAttacked(state, baseR, 5, enemy) && !isAttacked(state, baseR, 6, enemy)) {
      legal.push([baseR, 6]);
    }
    if (canQ && state.board[baseR][1] == null && state.board[baseR][2] == null && state.board[baseR][3] == null
        && !isAttacked(state, baseR, 2, enemy) && !isAttacked(state, baseR, 3, enemy)) {
      legal.push([baseR, 2]);
    }
  }
  return legal;
}

function applyMove(state: GameState, fromR: number, fromF: number, toR: number, toF: number, promotion: PieceType = 'Q'): GameState {
  const board: Board = state.board.map(row => row.slice());
  const piece = board[fromR][fromF];
  if (!piece) return state;

  let captured: PieceType | undefined;
  let enPassantCapture = false;
  let castleType: 'K' | 'Q' | undefined;

  if (piece.type === 'P' && state.enPassant
      && toR === state.enPassant[0] && toF === state.enPassant[1]
      && board[toR][toF] == null) {
    const capR = piece.color === 'w' ? toR + 1 : toR - 1;
    captured = 'P';
    board[capR][toF] = null;
    enPassantCapture = true;
  } else if (board[toR][toF]) {
    captured = board[toR][toF]!.type;
  }

  if (piece.type === 'K' && Math.abs(toF - fromF) === 2) {
    if (toF === 6) { board[fromR][5] = board[fromR][7]; board[fromR][7] = null; castleType = 'K'; }
    else if (toF === 2) { board[fromR][3] = board[fromR][0]; board[fromR][0] = null; castleType = 'Q'; }
  }

  const isPromotion = piece.type === 'P' && (toR === 0 || toR === 7);
  board[toR][toF] = isPromotion ? { type: promotion, color: piece.color } : piece;
  board[fromR][fromF] = null;

  const castle = { ...state.castle };
  if (piece.type === 'K') {
    if (piece.color === 'w') { castle.wK = false; castle.wQ = false; }
    else { castle.bK = false; castle.bQ = false; }
  }
  if (piece.type === 'R') {
    if (piece.color === 'w' && fromR === 7) {
      if (fromF === 7) castle.wK = false;
      if (fromF === 0) castle.wQ = false;
    } else if (piece.color === 'b' && fromR === 0) {
      if (fromF === 7) castle.bK = false;
      if (fromF === 0) castle.bQ = false;
    }
  }
  if (captured === 'R') {
    if (toR === 0 && toF === 0) castle.bQ = false;
    if (toR === 0 && toF === 7) castle.bK = false;
    if (toR === 7 && toF === 0) castle.wQ = false;
    if (toR === 7 && toF === 7) castle.wK = false;
  }

  let enPassant: [number, number] | null = null;
  if (piece.type === 'P' && Math.abs(toR - fromR) === 2) enPassant = [(toR + fromR) / 2, toF];

  const halfMove = (piece.type === 'P' || captured) ? 0 : state.halfMove + 1;
  const fullMove = state.turn === 'b' ? state.fullMove + 1 : state.fullMove;

  const san = sanFor(piece.type, fromR, fromF, toR, toF, captured, castleType, isPromotion ? promotion : undefined);
  const record: MoveRecord = {
    from: [fromR, fromF], to: [toR, toF],
    piece: piece.type, captured,
    promotion: isPromotion ? promotion : undefined,
    castle: castleType,
    enPassant: enPassantCapture,
    san,
  };

  return {
    board, turn: state.turn === 'w' ? 'b' : 'w', castle, enPassant,
    halfMove, fullMove,
    history: [...state.history, record],
    lastMove: { from: [fromR, fromF], to: [toR, toF] },
  };
}

function sanFor(
  piece: PieceType, fromR: number, fromF: number, toR: number, toF: number,
  captured: PieceType | undefined, castle: 'K' | 'Q' | undefined, promotion: PieceType | undefined,
): string {
  if (castle === 'K') return 'O-O';
  if (castle === 'Q') return 'O-O-O';
  const dest = `${FILES[toF]}${8 - toR}`;
  const cap = captured ? 'x' : '';
  if (piece === 'P') {
    const fromFile = captured ? FILES[fromF] : '';
    return `${fromFile}${cap}${dest}${promotion ? '=' + promotion : ''}`;
  }
  return `${piece}${cap}${dest}`;
}

function allLegalMoves(state: GameState): Array<{ from: [number, number]; to: [number, number] }> {
  const out: Array<{ from: [number, number]; to: [number, number] }> = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = state.board[r][f];
    if (!p || p.color !== state.turn) continue;
    for (const m of legalMoves(state, r, f)) out.push({ from: [r, f], to: m });
  }
  return out;
}

function gameStatus(state: GameState): 'play' | 'checkmate' | 'stalemate' | 'draw50' {
  if (state.halfMove >= 100) return 'draw50';
  const moves = allLegalMoves(state);
  if (moves.length === 0) return isCheck(state, state.turn) ? 'checkmate' : 'stalemate';
  return 'play';
}

// ─ Module exporté ───────────────────────────────────────────────────────
export const ChessGame: GameModule = {
  id: 'chess',
  apiId: 'chess',
  name: 'Échecs',
  description: '1v1 façon chess.com. P1 = blancs, P2 = noirs. Échec et mat, prise en passant, roque inclus.',
  Component: ChessComponent,
};

function ChessComponent({ onFinish, player1, player2, mode = 'local', matchId }: GameProps) {
  const emotes = useEmotePair({ matchId, mode });
  const [state, setState] = useState<GameState>(initGameState);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [finished, setFinished] = useState(false);
  // Drag-and-drop : suit le pointeur (souris ou doigt) avec position fixed,
  // déplace la pièce de l'origine vers la case relâchée.
  const [drag, setDrag] = useState<{
    from: [number, number];
    curX: number; curY: number;
    pieceSize: number;
  } | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  // pointerdown enregistre la position de départ ; si la souris bouge > 4px
  // avant le pointerup, on entre en drag. Sinon c'est un simple click et on
  // garde le comportement click-to-move existant.
  const pendingDragRef = useRef<{ from: [number, number]; startX: number; startY: number; pointerId: number } | null>(null);

  const legalForSelected = useMemo(
    () => selected ? legalMoves(state, selected[0], selected[1]) : [],
    [state, selected],
  );
  const status = useMemo(() => gameStatus(state), [state]);
  const inCheck = useMemo(() => isCheck(state, state.turn), [state]);
  const checkSquare = useMemo(
    () => (inCheck || status === 'checkmate') ? findKing(state, state.turn) : null,
    [state, inCheck, status],
  );

  useEffect(() => {
    if (finished) return;
    if (status === 'checkmate') {
      setFinished(true);
      // L'autre couleur gagne (la couleur courante est mat)
      const winnerIsWhite = state.turn === 'b';
      const sc1 = winnerIsWhite ? 1 : 0;
      const sc2 = winnerIsWhite ? 0 : 1;
      setTimeout(() => onFinish(sc1, sc2), 1800);
    } else if (status === 'stalemate' || status === 'draw50') {
      setFinished(true);
      setTimeout(() => onFinish(0, 0), 1800);
    }
  }, [status, state.turn, finished, onFinish]);

  function onSquareClick(r: number, f: number) {
    // Garde le comportement click-to-move pour ceux qui préfèrent (et pour la
    // 2e étape du flow "sélectionne puis click sur la cible").
    if (status !== 'play' || finished) return;
    if (selected) {
      const isLegal = legalForSelected.some(([lr, lf]) => lr === r && lf === f);
      if (isLegal) {
        setState(applyMove(state, selected[0], selected[1], r, f, 'Q'));
        setSelected(null);
        return;
      }
      const p = state.board[r][f];
      if (p && p.color === state.turn) setSelected([r, f]);
      else setSelected(null);
    } else {
      const p = state.board[r][f];
      if (p && p.color === state.turn) setSelected([r, f]);
    }
  }

  // Calcule la case (rank, file) du plateau à partir de coordonnées clientX/clientY.
  function squareAtClient(clientX: number, clientY: number): [number, number] | null {
    const board = boardRef.current;
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const f = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const r = Math.floor(((clientY - rect.top) / rect.height) * 8);
    return [Math.max(0, Math.min(7, r)), Math.max(0, Math.min(7, f))];
  }

  // ─ Pointer events pour drag-and-drop ──────────────────────────────────
  function onSquarePointerDown(e: React.PointerEvent<HTMLButtonElement>, r: number, f: number) {
    if (status !== 'play' || finished) return;
    const piece = state.board[r][f];
    if (!piece) return;
    if (piece.color !== state.turn) return;
    // Capture le pointeur pour suivre le drag même si le doigt sort de la case
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* OK si pas supporté */ }
    setSelected([r, f]);
    pendingDragRef.current = { from: [r, f], startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
  }

  function onSquarePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const pending = pendingDragRef.current;
    if (pending && pending.pointerId === e.pointerId && !drag) {
      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (Math.hypot(dx, dy) > 4) {
        // Démarre le drag visuel — la pièce suit le pointeur
        const board = boardRef.current;
        const pieceSize = board ? board.getBoundingClientRect().width / 8 : 60;
        setDrag({ from: pending.from, curX: e.clientX, curY: e.clientY, pieceSize });
      }
      return;
    }
    if (drag) {
      setDrag({ ...drag, curX: e.clientX, curY: e.clientY });
    }
  }

  function onSquarePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const pending = pendingDragRef.current;
    pendingDragRef.current = null;
    if (drag) {
      // Drop : trouve la case sous le pointeur
      const target = squareAtClient(e.clientX, e.clientY);
      if (target) {
        const [tr, tf] = target;
        const isLegal = legalForSelected.some(([lr, lf]) => lr === tr && lf === tf);
        if (isLegal && !(drag.from[0] === tr && drag.from[1] === tf)) {
          setState(applyMove(state, drag.from[0], drag.from[1], tr, tf, 'Q'));
          setSelected(null);
        }
        // Si on lâche sur la case d'origine, on garde la sélection (= click)
      }
      setDrag(null);
    } else if (pending) {
      // Pas de drag → simple click, le piece est déjà sélectionnée via setSelected
      // dans onSquarePointerDown. Rien d'autre à faire.
    }
  }

  function resign() {
    if (finished) return;
    // Le joueur courant abandonne
    setFinished(true);
    const winnerIsWhite = state.turn === 'b';
    const sc1 = winnerIsWhite ? 1 : 0;
    const sc2 = winnerIsWhite ? 0 : 1;
    setTimeout(() => onFinish(sc1, sc2), 600);
  }

  const turnLabel = state.turn === 'w'
    ? `🤍 ${player1?.pseudo ?? 'Blancs'}`
    : `🖤 ${player2?.pseudo ?? 'Noirs'}`;
  const turnColor = state.turn === 'w' ? '#cdcdcd' : '#888';

  const statusLabel = (() => {
    if (status === 'checkmate') {
      const winnerColor = state.turn === 'w' ? 'Noirs' : 'Blancs';
      const winnerPseudo = state.turn === 'w' ? (player2?.pseudo ?? 'Noirs') : (player1?.pseudo ?? 'Blancs');
      return `♚ Échec et mat — ${winnerColor} (${winnerPseudo}) gagne !`;
    }
    if (status === 'stalemate') return '🤝 Pat — match nul';
    if (status === 'draw50') return '🤝 Règle des 50 coups — match nul';
    if (inCheck) return `⚠️ ${turnLabel} en échec`;
    return `Au trait : ${turnLabel}`;
  })();

  // Echecs : J1 = Blancs (host/local), J2 = Noirs (guest). Le bandeau en
  // haut affiche l'adversaire (Noirs), celui en bas le joueur courant
  // (Blancs). Bulles emote attachées au bandeau correspondant.
  const whiteEmoteKey = mode === 'guest' ? emotes.opponentKey : emotes.myKey;
  const blackEmoteKey = mode === 'guest' ? emotes.myKey : emotes.opponentKey;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, zIndex: 5 }}>
        <EmotePicker onPick={emotes.triggerMine} />
      </div>
      {/* Bandeau noirs en haut (vue normale : blancs en bas) */}
      <PlayerStrip
        side="b"
        pseudo={player2?.pseudo ?? 'Noirs'}
        captured={state.history.filter(h => h.captured && state.board /* placeholder */).map(h => h)}
        history={state.history}
        emoteKey={blackEmoteKey}
      />

      {/* Status */}
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 700,
        fontSize: 16, textAlign: 'center',
        padding: '8px 16px', borderRadius: 999,
        background: status !== 'play' ? 'color-mix(in oklab, var(--accent) 18%, var(--surface))'
                  : inCheck ? 'color-mix(in oklab, var(--loss) 18%, var(--surface))'
                  : 'var(--surface)',
        border: `2px solid ${status !== 'play' ? 'var(--accent)' : inCheck ? 'var(--loss)' : 'var(--line)'}`,
        color: status !== 'play' ? 'var(--accent)' : inCheck ? 'var(--loss)' : turnColor,
      }}>
        {statusLabel}
      </div>

      {/* Échiquier */}
      <ChessBoard
        boardRef={boardRef}
        state={state}
        selected={selected}
        legalMoves={legalForSelected}
        checkSquare={checkSquare}
        onSquareClick={onSquareClick}
        onSquarePointerDown={onSquarePointerDown}
        onSquarePointerMove={onSquarePointerMove}
        onSquarePointerUp={onSquarePointerUp}
        hidePieceAt={drag ? drag.from : null}
        hoveredSquare={drag ? squareAtClient(drag.curX, drag.curY) : null}
      />

      {/* Pièce draggée — overlay fixed qui suit le pointeur */}
      {drag && (
        (() => {
          const piece = state.board[drag.from[0]][drag.from[1]];
          if (!piece) return null;
          return (
            <div style={{
              position: 'fixed',
              left: drag.curX - drag.pieceSize / 2,
              top: drag.curY - drag.pieceSize / 2,
              width: drag.pieceSize, height: drag.pieceSize,
              pointerEvents: 'none', zIndex: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: drag.pieceSize * 0.85, lineHeight: 1,
              color: piece.color === 'w' ? '#fff' : '#0a0a0a',
              textShadow: piece.color === 'w'
                ? '0 2px 6px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.9)'
                : '0 2px 4px rgba(255,255,255,0.25)',
              fontFamily: '"Arial Unicode MS", "DejaVu Sans", sans-serif',
              fontWeight: 900,
              filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.6))',
              transform: 'scale(1.1)',
              transition: 'none',
            }}>
              {PIECE_UNI[piece.color][piece.type]}
            </div>
          );
        })()
      )}

      {/* Bandeau blancs en bas */}
      <PlayerStrip
        side="w"
        pseudo={player1?.pseudo ?? 'Blancs'}
        captured={[]}
        history={state.history}
        emoteKey={whiteEmoteKey}
      />

      {/* Bouton abandonner */}
      {!finished && status === 'play' && (
        <button className="btn btn-line btn-sm" onClick={() => { if (window.confirm('Abandonner la partie ?')) resign(); }}>
          🏳️ Abandonner
        </button>
      )}

      {/* Historique des coups */}
      {state.history.length > 0 && (
        <div style={{
          width: '100%', maxWidth: 560, padding: 12,
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12,
          maxHeight: 160, overflowY: 'auto',
        }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}><span className="label">Historique</span></div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '2px 12px',
            fontFamily: 'monospace', fontSize: 13,
          }}>
            {Array.from({ length: Math.ceil(state.history.length / 2) }, (_, i) => {
              const wMove = state.history[i * 2];
              const bMove = state.history[i * 2 + 1];
              return (
                <div key={i} style={{ display: 'contents' }}>
                  <span style={{ color: 'var(--muted)' }}>{i + 1}.</span>
                  <span>{wMove?.san ?? ''}</span>
                  <span>{bMove?.san ?? ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ChessBoard({
  state, selected, legalMoves, checkSquare, onSquareClick,
  boardRef, onSquarePointerDown, onSquarePointerMove, onSquarePointerUp,
  hidePieceAt, hoveredSquare,
}: {
  state: GameState; selected: [number, number] | null;
  legalMoves: [number, number][]; checkSquare: [number, number] | null;
  onSquareClick: (r: number, f: number) => void;
  boardRef: React.MutableRefObject<HTMLDivElement | null>;
  onSquarePointerDown: (e: React.PointerEvent<HTMLButtonElement>, r: number, f: number) => void;
  onSquarePointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onSquarePointerUp:   (e: React.PointerEvent<HTMLButtonElement>) => void;
  hidePieceAt: [number, number] | null;
  hoveredSquare: [number, number] | null;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 4,
      width: '100%', maxWidth: 560,
    }}>
      {/* Labels rangs à gauche + plateau */}
      <div style={{ display: 'grid', gridTemplateRows: 'repeat(8, 1fr)' }}>
        {[8, 7, 6, 5, 4, 3, 2, 1].map((r) => (
          <div key={r} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--muted)', fontFamily: 'monospace', fontSize: 11,
            width: 16,
          }}>{r}</div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div ref={boardRef} style={{
          display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)',
          aspectRatio: '1', borderRadius: 8, overflow: 'hidden',
          border: '2px solid #5e3b1a',
          boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
          touchAction: 'none', userSelect: 'none',
        }}>
          {state.board.map((row, r) => row.map((sq, f) => {
            const isLight = (r + f) % 2 === 0;
            const isSel = selected?.[0] === r && selected?.[1] === f;
            const isLegal = legalMoves.some(([lr, lf]) => lr === r && lf === f);
            const isCapture = isLegal && sq != null;
            const isLastFrom = state.lastMove && state.lastMove.from[0] === r && state.lastMove.from[1] === f;
            const isLastTo   = state.lastMove && state.lastMove.to[0] === r && state.lastMove.to[1] === f;
            const isCheck = checkSquare?.[0] === r && checkSquare?.[1] === f;
            // Case sous le pointeur pendant un drag : on souligne en vert vif si
            // c'est un coup légal (le user voit où la pièce va atterrir).
            const isHoveredLegal = hoveredSquare && hoveredSquare[0] === r && hoveredSquare[1] === f && isLegal;
            // La pièce d'origine pendant un drag : on la cache dans la case
            // (l'overlay fixed la rend ailleurs).
            const isDragOrigin = hidePieceAt && hidePieceAt[0] === r && hidePieceAt[1] === f;
            const baseColor = isLight ? '#eeeed2' : '#769656';
            const lastMoveColor = isLastFrom || isLastTo ? 'rgba(255, 235, 110, 0.55)' : 'transparent';
            const selColor = isSel ? 'rgba(187, 203, 43, 0.85)' : 'transparent';
            const checkBg = isCheck
              ? 'radial-gradient(circle at center, rgba(255, 75, 75, 0.75), rgba(255, 75, 75, 0) 60%)'
              : 'transparent';

            return (
              <button
                key={`${r}-${f}`}
                onClick={() => onSquareClick(r, f)}
                onPointerDown={(e) => onSquarePointerDown(e, r, f)}
                onPointerMove={onSquarePointerMove}
                onPointerUp={onSquarePointerUp}
                onPointerCancel={onSquarePointerUp}
                style={{
                  position: 'relative', aspectRatio: '1',
                  background: baseColor, border: 'none', padding: 0, margin: 0, cursor: 'pointer',
                  fontSize: 'min(8vw, 42px)',
                  color: sq?.color === 'w' ? '#fff' : '#0a0a0a',
                  textShadow: sq?.color === 'w'
                    ? '0 1px 2px rgba(0,0,0,0.6), 0 0 1px rgba(0,0,0,0.8)'
                    : '0 1px 1px rgba(255,255,255,0.15)',
                  lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: '"Arial Unicode MS", "DejaVu Sans", sans-serif',
                  fontWeight: 900,
                  outline: 'none',
                  touchAction: 'none',
                }}
              >
                <div style={{ position: 'absolute', inset: 0, background: checkBg, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', inset: 0, background: lastMoveColor, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', inset: 0, background: selColor, pointerEvents: 'none' }} />
                {/* Hover de drop : bordure verte épaisse autour de la case cible */}
                {isHoveredLegal && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    boxShadow: 'inset 0 0 0 4px rgba(60, 180, 60, 0.85)',
                    pointerEvents: 'none',
                  }} />
                )}
                {sq && !isDragOrigin && (
                  <span style={{ position: 'relative', zIndex: 1 }}>{PIECE_UNI[sq.color][sq.type]}</span>
                )}
                {isLegal && !isCapture && (
                  <div style={{
                    position: 'absolute', width: '26%', height: '26%',
                    borderRadius: '50%', background: 'rgba(0,0,0,0.25)', pointerEvents: 'none',
                  }} />
                )}
                {isCapture && (
                  <div style={{
                    position: 'absolute', inset: '6%', borderRadius: '50%',
                    border: '4px solid rgba(0,0,0,0.32)', pointerEvents: 'none',
                  }} />
                )}
              </button>
            );
          }))}
        </div>
        {/* Labels colonnes en bas */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', marginTop: 2 }}>
          {FILES.map((f) => (
            <div key={f} style={{
              textAlign: 'center', color: 'var(--muted)', fontFamily: 'monospace', fontSize: 11,
            }}>{f}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerStrip({ side, pseudo, history, emoteKey }: {
  side: Color; pseudo: string; captured: unknown; history: MoveRecord[]; emoteKey?: string | null;
}) {
  // On affiche les pièces que CE joueur a capturées (= celles de la couleur opposée prises)
  const myColor = side;
  const enemy = side === 'w' ? 'b' : 'w';
  const myCaptures = history
    .filter(h => h.captured && h.piece && state2colorFromHistoryIdx(history, h, side))
    .map(h => h.captured!);
  // Helper : la pièce capturée appartient à l'enemy si c'est moi qui ai joué le coup
  // → on filtre les coups joués par moi (alternance turn → blanc joue les indexes pairs)
  void enemy; void myColor; void myCaptures;
  // En pratique : indexes pairs = blancs jouent, indexes impairs = noirs
  const captures = history.flatMap((h, i) => {
    if (!h.captured) return [];
    const playedByWhite = i % 2 === 0;
    const capturedColor: Color = playedByWhite ? 'b' : 'w';
    if (capturedColor === enemy) return [{ type: h.captured, color: capturedColor }];
    return [];
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 12px', borderRadius: 999,
      background: 'var(--surface)', border: '1px solid var(--line)',
      maxWidth: 560, width: '100%',
    }}>
      <span style={{ fontSize: 18 }}>{side === 'w' ? '🤍' : '🖤'}</span>
      <strong style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center' }}>
        {pseudo}
        <EmoteBubble emoteKey={emoteKey} side="right" />
      </strong>
      <div style={{ flex: 1, display: 'flex', gap: 0, alignItems: 'center', overflow: 'hidden' }}>
        {captures.map((c, i) => (
          <span key={i} style={{
            fontSize: 18, lineHeight: 1, opacity: 0.8,
            color: c.color === 'w' ? '#fff' : '#0a0a0a',
            textShadow: c.color === 'w' ? '0 0 2px rgba(0,0,0,0.5)' : 'none',
            marginLeft: -3,
          }}>{PIECE_UNI[c.color][c.type]}</span>
        ))}
      </div>
    </div>
  );
}

// no-op compat helper (vu que le typage strict de capture filter est complexe)
function state2colorFromHistoryIdx(_h: MoveRecord[], _m: MoveRecord, _s: Color): boolean { return true; }
