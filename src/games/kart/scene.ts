import * as THREE from 'three';
import type { ActiveItem, ItemBox, KartState, TrackData } from './types';
import { emoteByKey, emoteCanvasFor } from '../../lib/emotes';

// Tout le visuel three.js du jeu. Pas d'assets externes — primitives + matériaux
// pour un rendu arcade low-poly cohérent.

const KART_COLORS = [0xff3b3b, 0x3bb3ff, 0x3bff7c, 0xffd23b];

export interface SceneHandles {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  cameras: THREE.PerspectiveCamera[];  // une par viewport (1 ou 2)
  kartMeshes: Map<string, THREE.Group>;
  emoteSprites: Map<string, THREE.Sprite>;
  itemBoxMeshes: Map<string, THREE.Mesh>;
  activeItemMeshes: Map<string, THREE.Object3D>;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

export function buildScene(track: TrackData, canvas: HTMLCanvasElement, splitScreen: boolean): SceneHandles {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x6ab7ff);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x6ab7ff, 80, 380);

  // Lumières
  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.position.set(60, 100, 30);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));

  // Sol herbe
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0x3aa84a }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  scene.add(grass);

  // Route — ribbon entre bord gauche et bord droit de la centerline
  scene.add(buildRoadMesh(track));
  // Ligne de départ
  scene.add(buildStartLineMesh(track));
  // Plots décor au bord
  scene.add(buildDecor(track));

  // Caméras (1 ou 2)
  const cameras: THREE.PerspectiveCamera[] = [];
  const n = splitScreen ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const cam = new THREE.PerspectiveCamera(62, 1, 0.1, 800);
    cam.position.set(0, 6, 10);
    cameras.push(cam);
  }

  const kartMeshes = new Map<string, THREE.Group>();
  const emoteSprites = new Map<string, THREE.Sprite>();
  const itemBoxMeshes = new Map<string, THREE.Mesh>();
  const activeItemMeshes = new Map<string, THREE.Object3D>();

  const resize = (w: number, h: number) => {
    renderer.setSize(w, h, false);
    if (splitScreen) {
      // Vertical split : P1 = haut, P2 = bas → aspect = w / (h/2)
      const aspect = w / (h / 2);
      cameras.forEach((c) => { c.aspect = aspect; c.updateProjectionMatrix(); });
    } else {
      cameras[0].aspect = w / h;
      cameras[0].updateProjectionMatrix();
    }
  };

  const dispose = () => {
    renderer.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose?.());
      else mat?.dispose?.();
    });
  };

  return { scene, renderer, cameras, kartMeshes, emoteSprites, itemBoxMeshes, activeItemMeshes, resize, dispose };
}

function buildRoadMesh(track: TrackData): THREE.Mesh {
  const halfW = track.width / 2;
  const verts: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const S = track.samples.length;
  for (let i = 0; i < S; i++) {
    const s = track.samples[i];
    const lx = s.x + s.normalX * halfW;
    const lz = s.z + s.normalZ * halfW;
    const rx = s.x - s.normalX * halfW;
    const rz = s.z - s.normalZ * halfW;
    verts.push(lx, 0.01, lz);
    verts.push(rx, 0.01, rz);
    uvs.push(0, s.cumLen / 6);
    uvs.push(1, s.cumLen / 6);
  }
  for (let i = 0; i < S; i++) {
    const a = (i * 2) % (S * 2);
    const b = (i * 2 + 1) % (S * 2);
    const c = ((i + 1) * 2) % (S * 2);
    const d = ((i + 1) * 2 + 1) % (S * 2);
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Texture damier en bord de piste — généré par canvas
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 64;
  texCanvas.height = 64;
  const ctx = texCanvas.getContext('2d')!;
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillRect(32, 32, 32, 32);
  // Bandes blanches latérales
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 4);
  ctx.fillRect(0, 60, 64, 4);
  const tex = new THREE.CanvasTexture(texCanvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);

  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex });
  return new THREE.Mesh(geo, mat);
}

function buildStartLineMesh(track: TrackData): THREE.Group {
  const g = new THREE.Group();
  const s = track.samples[track.startIndex];
  const halfW = track.width / 2;
  const w = track.width;
  const geo = new THREE.PlaneGeometry(w, 2);
  // damier blanc/noir
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 32; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#111111';
    ctx.fillRect(i * 8, 0, 8, 16);
    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#ffffff';
    ctx.fillRect(i * 8, 16, 8, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const plane = new THREE.Mesh(geo, mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(s.x, 0.02, s.z);
  // Orienter la ligne perp à la tangente : par défaut PlaneGeometry est dans le plan XZ après rotation
  plane.rotation.z = Math.atan2(s.tangentZ, s.tangentX);
  g.add(plane);

  // Arche poteau de départ
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xff3b3b });
  const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8), poleMat);
  const pole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8), poleMat);
  pole1.position.set(s.x + s.normalX * halfW, 4, s.z + s.normalZ * halfW);
  pole2.position.set(s.x - s.normalX * halfW, 4, s.z - s.normalZ * halfW);
  g.add(pole1, pole2);
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(w, 1, 0.5),
    new THREE.MeshLambertMaterial({ color: 0xffd23b }),
  );
  top.position.set(s.x, 8, s.z);
  top.rotation.y = -Math.atan2(s.tangentZ, s.tangentX);
  g.add(top);
  return g;
}

function buildDecor(track: TrackData): THREE.Group {
  const g = new THREE.Group();
  const halfW = track.width / 2 + 2.5;
  // Plots de pneus tous les ~30 unités
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });
  for (let i = 0; i < track.samples.length; i += 18) {
    const s = track.samples[i];
    for (const side of [1, -1]) {
      const px = s.x + s.normalX * halfW * side;
      const pz = s.z + s.normalZ * halfW * side;
      const stack = new THREE.Group();
      for (let h = 0; h < 2; h++) {
        const tire = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.35, 8, 12), tireMat);
        tire.rotation.x = Math.PI / 2;
        tire.position.set(px, 0.4 + h * 0.7, pz);
        stack.add(tire);
      }
      g.add(stack);
    }
  }
  // Arbres très simples (cône + cylindre) hors de la piste
  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2;
    const r = 160 + (i % 5) * 12;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.8, 4),
      new THREE.MeshLambertMaterial({ color: 0x5b3a1a }),
    );
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, 5, 8),
      new THREE.MeshLambertMaterial({ color: 0x227a30 }),
    );
    trunk.position.set(Math.cos(angle) * r, 2, Math.sin(angle) * r);
    crown.position.set(trunk.position.x, 5.5, trunk.position.z);
    g.add(trunk, crown);
  }
  return g;
}

export function buildKartMesh(color: number, pseudo: string): THREE.Group {
  const g = new THREE.Group();
  // Châssis
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.6, 3.0),
    new THREE.MeshLambertMaterial({ color }),
  );
  body.position.y = 0.8;
  g.add(body);
  // Capot avant biseauté
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.5, 1.2),
    new THREE.MeshLambertMaterial({ color }),
  );
  nose.position.set(0, 0.75, 1.6);
  g.add(nose);
  // Aileron arrière
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.15, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x222222 }),
  );
  wing.position.set(0, 1.3, -1.4);
  g.add(wing);
  // Pilote : sphère + cône
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0xfde0c6 }),
  );
  head.position.set(0, 1.7, 0.2);
  g.add(head);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color }),
  );
  helmet.position.set(0, 1.7, 0.2);
  g.add(helmet);
  // Roues — 4 cylindres
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 14);
  const wheelOffsets: Array<[number, number, number]> = [
    [-1.0, 0.45,  1.0],
    [ 1.0, 0.45,  1.0],
    [-1.0, 0.45, -1.0],
    [ 1.0, 0.45, -1.0],
  ];
  for (const [x, y, z] of wheelOffsets) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, y, z);
    g.add(w);
  }
  // Pancarte pseudo au-dessus
  const sign = buildPseudoSign(pseudo, color);
  sign.position.y = 2.7;
  g.add(sign);
  return g;
}

function buildPseudoSign(pseudo: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  roundRect(ctx, 0, 0, 256, 64, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pseudo.slice(0, 12), 128, 34);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(4, 1, 1);
  return sp;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

export function buildItemBoxMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  // ?-cube : matériau émissif jaune néon + wireframe gold dessus
  const mat = new THREE.MeshLambertMaterial({ color: 0xffd23b, emissive: 0x553300 });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 1.4;
  return m;
}

export function buildActiveItemMesh(kind: 'banana' | 'shell'): THREE.Object3D {
  if (kind === 'banana') {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.25, 8, 12, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0xfddf3a }),
    );
    body.rotation.x = -Math.PI / 2;
    body.position.y = 0.6;
    g.add(body);
    return g;
  }
  const shell = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xe53935 }),
  );
  dome.position.y = 0.7;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 0.25, 14),
    new THREE.MeshLambertMaterial({ color: 0xfddf3a }),
  );
  base.position.y = 0.4;
  shell.add(dome, base);
  return shell;
}

// Sync visuels ←→ état logique.
export function syncMeshes(state: { karts: KartState[]; itemBoxes: ItemBox[]; activeItems: ActiveItem[] }, h: SceneHandles, now: number) {
  // Karts
  for (const kart of state.karts) {
    let m = h.kartMeshes.get(kart.id);
    if (!m) {
      const colorIdx = state.karts.indexOf(kart);
      m = buildKartMesh(kart.color || KART_COLORS[colorIdx % KART_COLORS.length], kart.pseudo);
      h.kartMeshes.set(kart.id, m);
      h.scene.add(m);
    }
    m.position.set(kart.x, kart.y, kart.z);
    m.rotation.y = -kart.heading + Math.PI / 2;
    // Légère "secousse" si stun
    if (now < kart.stunUntil) {
      m.position.y = Math.sin(now * 0.03) * 0.15;
    }
  }

  // Boxes
  for (const box of state.itemBoxes) {
    let m = h.itemBoxMeshes.get(box.id);
    if (!m) {
      m = buildItemBoxMesh();
      m.position.set(box.x, 1.4, box.z);
      h.itemBoxMeshes.set(box.id, m);
      h.scene.add(m);
    }
    const active = box.respawnAt < now;
    m.visible = active;
    m.rotation.y = now * 0.002;
    m.position.y = 1.4 + Math.sin(now * 0.004) * 0.2;
  }

  // Items actifs
  const seen = new Set<string>();
  for (const item of state.activeItems) {
    seen.add(item.id);
    let mesh = h.activeItemMeshes.get(item.id);
    if (!mesh) {
      mesh = buildActiveItemMesh(item.kind === 'shell' ? 'shell' : 'banana');
      h.activeItemMeshes.set(item.id, mesh);
      h.scene.add(mesh);
    }
    mesh.position.set(item.x, 0.5, item.z);
    if (item.kind === 'shell') {
      mesh.rotation.y = Math.atan2(-item.vz, item.vx);
    } else {
      mesh.rotation.y += 0.04;
    }
  }
  // Cleanup items expirés
  for (const [id, mesh] of h.activeItemMeshes) {
    if (!seen.has(id)) {
      h.scene.remove(mesh);
      h.activeItemMeshes.delete(id);
    }
  }
}

// Caméra 100% rigide. ZERO lerp, ZERO smoothing. À chaque frame on calcule
// la position cible depuis (kart.x, kart.z, kart.heading) et on la POSE,
// puis on force cam.up = +Y (sinon trois cumul de lookAt peut faire dériver
// l'up vector et casser le centrage), puis lookAt sur le kart.
//
// Plusieurs essais précédents avec lerp / snap-X-Z-lerp-Y ont laissé filer
// le kart sur le bord de l'écran en virage rapide (cf. screenshots du
// playtest). La conclusion : aucun lerp en 3e personne. Le kart EST le
// centre de l'écran, point final.
export function followKart(cam: THREE.PerspectiveCamera, kart: KartState, fpsMode: boolean, _dt: number, _snap = false) {
  const c = Math.cos(kart.heading);
  const s = Math.sin(kart.heading);
  cam.up.set(0, 1, 0);
  if (fpsMode) {
    cam.position.set(kart.x + c * 0.4, 1.6, kart.z + s * 0.4);
    cam.lookAt(kart.x + c * 6, 1.5, kart.z + s * 6);
  } else {
    // 3e personne dézoomée (15u derrière, 9u en hauteur, lookAt 2u au-dessus
    // du kart pour voir la route devant sans pousser le kart en bas d'écran).
    cam.position.set(kart.x - c * 15, 9, kart.z - s * 15);
    cam.lookAt(kart.x, 1.5, kart.z);
  }
}

// Affiche / met à jour l'emote au-dessus de chaque kart actif.
// 2 rendus possibles :
//  - sprite (par défaut) : bullet canvas avec emoji + label, animé via scale
//    et rotation selon le 'shake' de l'emote.
//  - custom3d='sharknado'  : groupe 3D = cône tornade qui tourne + 3 requins
//    en orbite verticale + spirale de débris. Beaucoup plus expressif que
//    le sprite plat pour ce qu'on veut transmettre.
//
// On garde un seul registre h.emoteSprites — qu'il s'agisse d'un Sprite ou
// d'un Group, three.js sait remove() les deux pareils.
export function syncEmotes(karts: KartState[], h: SceneHandles, now: number) {
  const live = new Set<string>();
  for (const kart of karts) {
    const active = kart.emoteKey && (kart.emoteUntil ?? 0) > now;
    if (!active) continue;
    live.add(kart.id);
    const def = emoteByKey(kart.emoteKey!);
    if (!def) continue;

    const remaining = (kart.emoteUntil! - now) / 2500;
    const opacity = remaining > 0.85
      ? (1 - remaining) / 0.15
      : remaining < 0.2
      ? remaining / 0.2
      : 1;
    const opacityClamped = Math.max(0, Math.min(1, opacity));

    let obj = h.emoteSprites.get(kart.id) as THREE.Object3D | undefined;

    // Si le type d'emote diffère (sprite ↔ 3d), on remplace l'objet.
    const wantedKind = def.custom3d ? def.custom3d : 'sprite';
    const currentKind = obj?.userData?.emoteKind as string | undefined;
    if (obj && currentKind !== wantedKind) {
      h.scene.remove(obj);
      disposeObject(obj);
      obj = undefined;
      h.emoteSprites.delete(kart.id);
    }

    if (!obj) {
      if (def.custom3d === 'sharknado') {
        obj = buildSharknado();
      } else {
        const tex = new THREE.CanvasTexture(emoteCanvasFor(def));
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sp = new THREE.Sprite(mat);
        sp.scale.set(3, 3, 1);
        obj = sp;
      }
      obj.userData.emoteKind = wantedKind;
      h.scene.add(obj);
      // On stocke en cast — le map type est Sprite mais on triche
      h.emoteSprites.set(kart.id, obj as unknown as THREE.Sprite);
    } else if (!def.custom3d) {
      // Sprite existant, peut-être emote changé : refresh texture
      const sp = obj as THREE.Sprite;
      const mat = sp.material as THREE.SpriteMaterial;
      const map = mat.map as THREE.CanvasTexture | null;
      const wantedCanvas = emoteCanvasFor(def);
      if (!map || map.image !== wantedCanvas) {
        if (map) map.dispose();
        mat.map = new THREE.CanvasTexture(wantedCanvas);
        mat.needsUpdate = true;
      }
    }

    obj.position.set(kart.x, 4.6 + Math.sin(now * 0.006) * 0.2, kart.z);
    obj.visible = opacityClamped > 0;

    if (def.custom3d === 'sharknado') {
      animateSharknado(obj as THREE.Group, now, opacityClamped);
    } else {
      const sp = obj as THREE.Sprite;
      (sp.material as THREE.SpriteMaterial).opacity = opacityClamped;
      animateSprite(sp, def, now);
    }
  }
  // Cleanup des emotes expirés
  for (const [id, sp] of h.emoteSprites) {
    if (!live.has(id)) {
      h.scene.remove(sp);
      disposeObject(sp);
      h.emoteSprites.delete(id);
    }
  }
}

function animateSprite(sp: THREE.Sprite, def: { shake: string }, now: number) {
  const t = now * 0.01;
  let scale = 1;
  let rotation = 0;
  switch (def.shake) {
    case 'mad':    scale = 1 + Math.sin(t * 3.5) * 0.14; rotation = Math.sin(t * 6) * 0.18; break;
    case 'flex':   scale = 1 + Math.sin(t * 1.6) * 0.10; break;
    case 'spin':   rotation = (now * 0.0045) % (Math.PI * 2); scale = 1 + Math.sin(t * 2) * 0.06; break;
    case 'cry':    scale = 1 - Math.abs(Math.sin(t * 1.5)) * 0.10; rotation = Math.sin(t) * 0.12; break;
    case 'bounce': scale = 1 + Math.abs(Math.sin(t * 2.5)) * 0.18; break;
    case 'pulse':  scale = 1 + Math.sin(t * 1.2) * 0.18; break;
    default:       scale = 1 + Math.sin(t * 0.7) * 0.05;
  }
  sp.scale.set(3 * scale, 3 * scale, 1);
  sp.material.rotation = rotation;
}

// ─── Sharknado : cône-tornade + requins en orbite ────────────────────────
// Le groupe expose userData.spinSpeed, userData.sharks (pour anim) et
// userData.fadeMats (pour fade in/out via opacity sur tous les matériaux).
function buildSharknado(): THREE.Group {
  const g = new THREE.Group();
  const fadeMats: THREE.Material[] = [];

  // Tornade : 4 cônes empilés de tailles décroissantes, tournent ensemble
  const funnelGroup = new THREE.Group();
  g.add(funnelGroup);
  const funnelColors = [0xb0c4de, 0xa0b8d4, 0x90accc, 0x80a0c4];
  for (let i = 0; i < 4; i++) {
    const r = 1.6 - i * 0.32;
    const h = 0.9;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 12, 1, true),
      new THREE.MeshLambertMaterial({
        color: funnelColors[i],
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    );
    cone.position.y = 0.4 + i * 0.85;
    cone.rotation.x = Math.PI; // cône pointe vers le bas
    funnelGroup.add(cone);
    fadeMats.push(cone.material as THREE.Material);
  }

  // 3 requins (sprite avec emoji 🦈) qui orbitent à différentes hauteurs
  const sharks: THREE.Sprite[] = [];
  for (let i = 0; i < 3; i++) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🦈', 64, 70);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.0, 1.0, 1);
    g.add(sp);
    sharks.push(sp);
    fadeMats.push(mat);
  }

  // Petits débris (cubes orange-foncé qui tournent dans une spirale)
  const debris: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x553a1a, transparent: true });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), mat);
    g.add(m);
    debris.push(m);
    fadeMats.push(mat);
  }

  g.userData = { sharks, debris, fadeMats, funnelGroup };
  return g;
}

function animateSharknado(g: THREE.Group, now: number, opacity: number) {
  const t = now * 0.001;
  const ud = g.userData as {
    sharks: THREE.Sprite[];
    debris: THREE.Mesh[];
    fadeMats: THREE.Material[];
    funnelGroup: THREE.Group;
  };
  // Rotation tornade
  ud.funnelGroup.rotation.y = t * 4;
  // Requins en orbite verticale (rayon 1.6, hauteur 0.5–3.5)
  for (let i = 0; i < ud.sharks.length; i++) {
    const phase = t * 2.6 + (i * (Math.PI * 2) / ud.sharks.length);
    const r = 1.6 + Math.sin(phase * 0.7 + i) * 0.2;
    const yPath = 0.6 + ((Math.sin(phase) + 1) / 2) * 3;
    ud.sharks[i].position.set(Math.cos(phase) * r, yPath, Math.sin(phase) * r);
    // Le sprite reste face caméra (Sprite par défaut), mais on peut le faire scale
    const breath = 1 + Math.sin(t * 6 + i) * 0.1;
    ud.sharks[i].scale.set(breath, breath, 1);
  }
  // Débris en spirale ascendante
  for (let i = 0; i < ud.debris.length; i++) {
    const phase = t * 5 + (i * Math.PI * 2 / ud.debris.length);
    const yPath = (phase * 0.4 + i * 0.3) % 4;
    const r = 0.8 + yPath * 0.2;
    const d = ud.debris[i];
    d.position.set(Math.cos(phase) * r, 0.2 + yPath, Math.sin(phase) * r);
    d.rotation.set(phase, phase * 1.3, phase * 0.7);
  }
  // Fade sur tous les matériaux
  for (const mat of ud.fadeMats) {
    (mat as THREE.MeshLambertMaterial | THREE.SpriteMaterial).opacity =
      Math.min((mat.userData?.baseOpacity as number) ?? 1, opacity);
  }
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((c) => {
    const m = c as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    if ((m as { geometry?: THREE.BufferGeometry }).geometry) (m as { geometry?: THREE.BufferGeometry }).geometry!.dispose?.();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose?.());
    else mat?.dispose?.();
  });
}

export { KART_COLORS };
