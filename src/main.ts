// Arranque, bucle principal, cambio de escenas, interacción (E), mapa (M), buscador (Ctrl+F)
// y ganchos deterministas para tests (window.__invite).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GameScene, Interactable } from './core';
import { PLACES } from './content/ideas';
import { Player, isMoveKey } from './player';
import { UI, drawMap, SearchEntry } from './ui';
import { ForestScene } from './world/forest';
import { RoomScene, TexLib } from './world/rooms';
import { GameAudio } from './audio';

const params = new URLSearchParams(location.search);
const QUALITY: 'low' | 'high' = params.get('quality') === 'low' ? 'low' : 'high';
const ROOMS = ['cana', 'abuelas', 'gnomos'];
// en tests y capturas (autostart) la calidad no se ajusta sola
const ADAPTIVE = QUALITY === 'high' && !params.has('autostart');

class Game {
  renderer!: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 2600);
  ui = new UI(); player = new Player(); audio = new GameAudio(); lib = new TexLib();
  forest!: ForestScene;
  scenes: Record<string, GameScene> = {};
  current!: GameScene;
  t = 0; manual = false; started = false;
  hover: Interactable | null = null;
  private last = 0; private fadeK = 0;
  private trans: { to: string; from: string; phase: 0 | 1; then?: () => void } | null = null;
  private nearPlace: string | null = null; private placeT = 0;
  private walkToken = 0; walking = false;
  private ray = new THREE.Raycaster();
  private drag = false;
  errors: string[] = [];

  async init() {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: QUALITY === 'low', powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, QUALITY === 'low' ? 1 : 2));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = QUALITY === 'high'; r.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('app')!.append(r.domElement);

    this.forest = await ForestScene.create(r, this.lib, QUALITY, (p, t) => this.ui.progress(p, t));
    this.scenes.bosque = this.forest;
    for (const id of ROOMS) {
      try { this.scenes[id] = await RoomScene.load(id, this.lib); }
      catch (e) { console.warn(`sala ${id} no disponible`, e); }
    }
    if (QUALITY === 'high') {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, rt);
      this.renderPass = new RenderPass(this.forest.scene, this.camera);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.65, 0.92);
      this.composer.addPass(this.renderPass); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    }
    this.setScene('bosque', null);
    this.bind();
    this.ui.progress(1, 'Listo');
    this.ui.showStart();
    this.ui.onPick = (e) => this.walkTo(e.id);
    this.ui.onClose = () => { this.player.enabled = this.started && !this.ui.anyOpen; };
    if (params.has('autostart')) this.start(false);
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  start(lock = true) {
    if (this.started) return;
    this.started = true; this.player.enabled = true;
    this.ui.hideStart();
    this.audio.start();
    if (lock) this.lock();
    this.ui.toast(this.current.name, 'cinco de la tarde');
  }
  private lock() { try { (this.renderer.domElement.requestPointerLock() as any)?.catch?.(() => {}); } catch { /* sin pointer lock: se mira arrastrando */ } }

  private bind() {
    const cv = this.renderer.domElement;
    document.getElementById('enter')!.addEventListener('click', () => this.start());
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer?.setSize(innerWidth, innerHeight); this.bloom?.resolution.set(s.x / 2, s.y / 2);
    });
    addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
        e.preventDefault();
        if (!this.started) return;
        if (this.ui.searchOpen) this.ui.closeSearch();
        else { this.ui.readerOpen && this.ui.closeReader(); this.ui.mapOpen && this.ui.closeMap(); document.exitPointerLock?.(); this.player.keys.clear(); this.player.enabled = false; this.ui.openSearch(); }
        return;
      }
      if (!this.started || this.ui.searchOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyM') { this.toggleMap(); return; }
      if (e.code === 'Escape') { this.ui.readerOpen && this.ui.closeReader(); this.ui.mapOpen && this.ui.closeMap(); return; }
      if (e.code === 'KeyE' && !e.repeat) { this.interact(); return; }
      if (isMoveKey(e.code)) {
        e.preventDefault();
        if (this.walking) this.cancelWalk();
        this.player.keys.add(e.code);
      }
    });
    addEventListener('keyup', (e) => this.player.keys.delete(e.code));
    addEventListener('blur', () => this.player.keys.clear());
    cv.addEventListener('mousedown', () => { this.drag = true; if (this.started && !this.ui.anyOpen && document.pointerLockElement !== cv) this.lock(); });
    addEventListener('mouseup', () => { this.drag = false; });
    addEventListener('mousemove', (e) => {
      if (!this.started || this.ui.anyOpen || this.walking) return;
      if (document.pointerLockElement === cv || this.drag) this.player.look(e.movementX, e.movementY);
    });
  }

  // ---------------------------------------------------------------- escenas
  setScene(id: string, from: string | null) {
    const sc = this.scenes[id];
    if (!sc) return false;
    this.current = sc;
    const e = sc.entry(from);
    this.player.pos.copy(e.pos); this.player.yaw = e.yaw; this.player.pitch = 0;
    if (this.renderPass) this.renderPass.scene = sc.scene;
    if (this.bloom) this.bloom.strength = sc.indoor ? 0.42 : 0.3;
    this.hover = null; this.nearPlace = sc.indoor ? id : null;
    if (this.started) sc.indoor ? this.ui.toast(sc.name, PLACES.find((p) => p.id === id)?.idea ?? '') : this.ui.toast(sc.name);
    return true;
  }
  go(target: string, then?: () => void) {
    if (this.trans || !this.scenes[target]) { if (!this.scenes[target]) this.ui.toast('Todavía cerrado', 'esta sala se abre pronto'); return; }
    this.trans = { to: target, from: this.current.id, phase: 0, then };
  }

  // ---------------------------------------------------------------- interacción
  private pick() {
    this.hover = null;
    if (this.started && !this.ui.anyOpen && !this.trans) {
      const list = this.current.interactables, dir = this.camera.getWorldDirection(new THREE.Vector3());
      this.ray.set(this.camera.position, dir); this.ray.far = 3.4;
      const hit = this.ray.intersectObjects(list.map((i) => i.object), true)[0];
      if (hit) {
        let o: THREE.Object3D | null = hit.object, id: string | undefined;
        while (o && !(id = o.userData.interactId)) o = o.parent;
        this.hover = list.find((i) => i.id === id) ?? null;
      }
      if (!this.hover) {
        let best = 0.19;
        for (const i of list) {
          const v = i.pos.clone().sub(this.camera.position), d = v.length();
          if (d > 3.3) continue;
          const a = Math.acos(THREE.MathUtils.clamp(v.dot(dir) / d, -1, 1));
          if (a < best) { best = a; this.hover = i; }
        }
      }
    }
    const h = this.hover;
    this.ui.prompt(!h ? null : h.action === 'read' ? `E — Leer: ${h.name}` : h.target === 'bosque' ? 'E — Salir al bosque' : `E — Entrar: ${h.name}`);
  }
  interact() {
    if (this.ui.readerOpen) { this.ui.closeReader(); return; }
    if (this.ui.mapOpen) return;
    const h = this.hover;
    if (!h) return;
    if (h.action === 'read') {
      const place = PLACES.find((p) => p.id === h.placeId)!;
      this.player.enabled = false; this.player.keys.clear();
      this.ui.openReader(place.name, h.name, h.message ?? '');
      this.audio.chime();
    } else if (h.target) this.go(h.target);
  }
  toggleMap() {
    if (this.ui.mapOpen) { this.ui.closeMap(); return; }
    this.ui.readerOpen && this.ui.closeReader();
    this.player.enabled = false; this.player.keys.clear();
    const f = this.forest;
    // dentro de una sala, el marcador queda en su puerta
    const door = this.current.indoor ? f.doors[this.current.id] : null;
    const px = door ? door.pos.x : this.player.pos.x, pz = door ? door.pos.z : this.player.pos.z;
    this.ui.openMap((c, w, h) => drawMap(c, w, h, f.geo, PLACES.map((p) => ({ name: p.name, kind: p.kind, ...f.placePos[p.id] })), px, pz, this.player.yaw));
  }

  // ---------------------------------------------------------------- caminar hasta un objeto (Ctrl+F)
  findInteractable(id: string): { scene: string; it: Interactable } | null {
    for (const [sid, sc] of Object.entries(this.scenes)) { const it = sc.interactables.find((i) => i.id === id); if (it) return { scene: sid, it }; }
    return null;
  }
  private forestPath(to: THREE.Vector3): THREE.Vector3[] {
    const p = this.player.pos, cells = this.forest.nav.find(p.x, p.z, to.x, to.z);
    const pts = (cells ?? []).slice(1).map(([x, z]) => new THREE.Vector3(x, 0, z));
    pts.push(to.clone());
    return pts;
  }
  cancelWalk() { this.walkToken++; this.walking = false; this.player.cancelAuto(); this.ui.walkHint(null); }
  walkTo(id: string): boolean {
    let scene: string, pos: THREE.Vector3 | null, stop = 1.5, label: string;
    const place = PLACES.find((p) => p.id === id);
    if (place) {
      label = place.name;
      if (place.kind === 'natural') { const q = this.forest.placePos[id]; scene = 'bosque'; pos = new THREE.Vector3(q.x, this.forest.groundY(q.x, q.z) + 1, q.z); stop = id === 'estanque' ? 10.5 : 4; }
      else { scene = id; pos = null; }
    } else {
      const f = this.findInteractable(id);
      if (!f) return false;
      scene = f.scene; pos = f.it.pos; label = f.it.name;
    }
    if (!this.scenes[scene]) { this.ui.toast('Todavía cerrado', 'esta sala se abre pronto'); return false; }
    this.cancelWalk();
    const token = ++this.walkToken;
    this.walking = true; this.player.keys.clear();
    this.ui.walkHint(`Caminando hacia ${label}… (una tecla de movimiento cancela)`);
    const done = () => { if (token !== this.walkToken) return; this.walking = false; this.ui.walkHint(null); this.ui.toast(label); };
    const next = () => {
      if (token !== this.walkToken) return;
      if (this.current.id !== scene) {
        if (this.current.indoor) {
          const door = this.current.interactables.find((i) => i.action === 'door')!;
          this.player.walkPath([door.pos.clone()], null, () => token === this.walkToken && this.go('bosque', next), 1.4);
        } else {
          const spot = this.forest.doors[scene], door = this.forest.interactables.find((i) => i.id === `puerta-${scene}`)!;
          this.player.walkPath(this.forestPath(spot.pos), door.pos, () => token === this.walkToken && this.go(scene, next), 0.5);
        }
        return;
      }
      if (!pos) { done(); return; }
      this.player.walkPath(this.current.indoor ? [pos.clone()] : this.forestPath(pos), pos, done, stop);
    };
    next();
    return true;
  }

  // ---------------------------------------------------------------- bucle
  update(dt: number) {
    this.t += dt;
    if (this.trans) {
      const tr = this.trans;
      if (tr.phase === 0) { this.fadeK = Math.min(1, this.fadeK + dt / 0.35); if (this.fadeK >= 1) { this.setScene(tr.to, tr.from); tr.phase = 1; } }
      else { this.fadeK = Math.max(0, this.fadeK - dt / 0.35); if (this.fadeK <= 0) { this.trans = null; tr.then?.(); } }
    } else this.player.update(dt, this.current);
    this.player.apply(this.camera);
    this.current.update(dt, this.t, this.camera, this.renderer.domElement.height);
    this.pick();
    this.placeT -= dt;
    if (this.placeT <= 0 && !this.current.indoor && this.started) {
      this.placeT = 0.5;
      let near: string | null = null;
      for (const p of PLACES) { const q = this.forest.placePos[p.id]; if (Math.hypot(q.x - this.player.pos.x, q.z - this.player.pos.z) < 13) near = p.id; }
      if (near && near !== this.nearPlace) { const p = PLACES.find((q) => q.id === near)!; this.ui.toast(p.name, p.idea); }
      this.nearPlace = near;
    }
    this.audio.update(dt, this.camera, this.current.ambience?.(this.camera.position) ?? { water: 0, fire: 0, cave: 0 }, this.current.indoor);
    this.ui.fade(this.fadeK);
  }
  render() { if (this.composer) this.composer.render(); else this.renderer.render(this.current.scene, this.camera); }
  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.manual) return;
    this.update(dt); this.render();
    // calidad adaptativa: si el equipo no llega a ~24 fps, baja resolución y luego sombras/bloom
    if (ADAPTIVE && this.started && this.perf.level < 2) {
      const p = this.perf;
      p.ema = p.n ? p.ema * 0.95 + dt * 0.05 : dt;
      if (++p.n > 150 && p.ema > 0.042) { p.level++; p.n = 0; this.degrade(p.level); }
    }
  };
  private perf = { ema: 0, n: 0, level: 0 };
  private degrade(level: number) {
    if (level === 1) { this.renderer.setPixelRatio(1); this.composer?.setPixelRatio(1); }
    else { this.forest.atmo.light.castShadow = false; this.composer = null; }
    console.info(`[invite] calidad reducida (nivel ${level}) para sostener la fluidez`);
  }

  // ---------------------------------------------------------------- ganchos de test
  debug() {
    const g = this, f = this.forest;
    return {
      ready: true, quality: QUALITY,
      manual: (on: boolean) => { g.manual = on; },
      step: (sec: number, hz = 60) => { g.manual = true; const n = Math.round(sec * hz); for (let i = 0; i < n; i++) g.update(1 / hz); g.render(); },
      render: () => g.render(),
      start: () => g.start(false),
      look: (yaw: number, pitch = 0) => { g.player.yaw = yaw; g.player.pitch = pitch; },
      lookAt: (id: string) => {
        const it = g.current.interactables.find((i) => i.id === id);
        if (!it) return false;
        const d = it.pos.clone().sub(new THREE.Vector3(g.player.pos.x, g.player.pos.y + g.player.eye, g.player.pos.z));
        g.player.yaw = Math.atan2(-d.x, -d.z); g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        return true;
      },
      /** lleva al jugador a un lugar (o a x/z), a `dist` metros mirando hacia su centro */
      teleport: (target: string | { x: number; z: number; yaw?: number; scene?: string }, distArg?: number, angle?: number) => {
        const dist = distArg ?? 6;
        g.cancelWalk(); g.trans = null; g.fadeK = 0;
        if (typeof target !== 'string') {
          if (target.scene && target.scene !== g.current.id) g.setScene(target.scene, null);
          g.player.pos.set(target.x, g.current.groundY(target.x, target.z), target.z); g.player.yaw = target.yaw ?? g.player.yaw; g.player.pitch = 0;
          return true;
        }
        const place = PLACES.find((p) => p.id === target);
        if (!place) { const fi = g.findInteractable(target); if (!fi) return false; if (fi.scene !== g.current.id) g.setScene(fi.scene, fi.scene === 'bosque' ? null : 'bosque'); if (!g.current.indoor) { const a = angle ?? 0.6; g.player.pos.set(fi.it.pos.x + Math.cos(a) * dist, 0, fi.it.pos.z + Math.sin(a) * dist); } g.player.pos.y = g.current.groundY(g.player.pos.x, g.player.pos.z); return true; }
        if (place.kind === 'sala' && g.scenes[place.id] && distArg === undefined) return g.setScene(place.id, 'bosque'); // sin distancia: adentro de la sala
        if (g.current.id !== 'bosque') g.setScene('bosque', null);
        const q = f.placePos[target], a = angle ?? Math.atan2(f.spawn.pos.z - q.z, f.spawn.pos.x - q.x);
        const x = q.x + Math.cos(a) * dist, z = q.z + Math.sin(a) * dist;
        g.player.pos.set(x, f.groundY(x, z), z); g.player.yaw = Math.atan2(-(q.x - x), -(q.z - z)); g.player.pitch = -0.08;
        return true;
      },
      interact: () => g.interact(),
      walkTo: (id: string) => g.walkTo(id),
      portraits: (v: number | null) => { f.portraits.force = v; if (v !== null) f.portraits.show = v; },
      state: () => {
        const room = g.current instanceof RoomScene ? g.current : null;
        return {
          started: g.started, scene: g.current.id, pos: g.player.pos.toArray(), yaw: g.player.yaw, pitch: g.player.pitch, walked: g.player.walked,
          walking: g.walking, transition: !!g.trans, hover: g.hover?.id ?? null, t: g.t,
          reader: g.ui.readerOpen ? { title: document.getElementById('reader-title')!.textContent, text: document.getElementById('reader-text')!.textContent } : null,
          map: g.ui.mapOpen, search: g.ui.searchOpen,
          world: {
            widthM: f.geo.bounds.maxX - f.geo.bounds.minX, heightM: f.geo.bounds.maxZ - f.geo.bounds.minZ,
            trees: f.flora.treeCount, plants: f.flora.plantCount, fish: f.fishCount,
            rivers: f.geo.rivers.map((r) => ({ id: r.id, name: r.name, main: r.main, length: r.n })),
            birds: [...new Set(f.atmo.birds.kinds)],
          },
          places: PLACES.map((p) => ({ id: p.id, name: p.name, kind: p.kind, scene: p.scene, ...f.placePos[p.id], objects: p.objects.map((o) => o.id) })),
          scenes: Object.fromEntries(Object.entries(g.scenes).map(([k, s]) => [k, s.interactables.map((i) => i.id)])),
          fire: f.fire.level, fireLight: f.fire.light?.intensity ?? 0, roomFire: room?.uFire.value ?? null, hearts: room?.hearts?.alive ?? 0,
          waterTime: f.water.shared.uTime.value, portraits: f.portraits.show,
          audio: g.audio.state(), errors: g.errors,
        };
      },
    };
  }
}

const game = new Game();
addEventListener('error', (e) => game.errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => game.errors.push(String(e.reason)));
game.init().then(() => { (window as any).__invite = game.debug(); }).catch((e) => {
  console.error(e);
  document.getElementById('loading-text')!.textContent = `No se pudo cargar el bosque: ${e?.message ?? e}`;
  (window as any).__inviteError = String(e?.stack ?? e);
});
