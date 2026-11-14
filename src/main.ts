// Arranque, bucle principal, cambio de escenas, interacción (E), mapa (M), buscador (Ctrl+F)
// y ganchos deterministas para tests (window.__invite).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GameScene, Interactable } from './core';
import { DUNGEON, INVITATION, PLACES } from './content/ideas';
import { Player, isMoveKey } from './player';
import { UI, drawMap, SearchEntry } from './ui';
import { ForestScene } from './world/forest';
import { RoomScene, TexLib } from './world/rooms';
import { DungeonScene } from './world/dungeon';
import { GameAudio } from './audio';
import { TouchControls, isTouchDevice, FOV } from './touch';

const params = new URLSearchParams(location.search);
const TOUCH = isTouchDevice(params);
if (TOUCH) document.body.classList.add('touch');
const QUALITY: 'low' | 'high' = params.get('quality') === 'low' ? 'low' : 'high';
const ROOMS = ['cana', 'abuelas', 'gnomos'];
/** de qué escena cuelga cada una (la mazmorra está bajo la casita de gnomos) */
const PARENT: Record<string, string> = { cana: 'bosque', abuelas: 'bosque', gnomos: 'bosque', mazmorra: 'gnomos' };
const CARD_KEY = 'invite.card.v1';
// en tests y capturas (autostart) la calidad no se ajusta sola
const ADAPTIVE = QUALITY === 'high' && !params.has('autostart');

class Game {
  renderer!: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  camera = new THREE.PerspectiveCamera(FOV.base, innerWidth / innerHeight, 0.08, 2600);
  touch: TouchControls | null = null;
  ui = new UI(); player = new Player(); audio = new GameAudio(); lib = new TexLib();
  forest!: ForestScene;
  dungeon: DungeonScene | null = null;
  /** invitación en poder del jugador (se autodestruye a las 2 horas) */
  card: { takenAt: number } | null = null;
  clockOffset = 0; trapOpen = false;
  private trapPending = false; private expiredOnLoad = false; private lastRoom = -1;
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
    try {
      this.dungeon = await DungeonScene.load(this.lib, {
        onKey: () => { this.audio.sfx('key'); this.audio.sfx('door'); this.ui.toast(DUNGEON.keyTaken); },
        onLocked: () => { this.audio.sfx('lock'); this.ui.toast('Puerta cerrada', DUNGEON.lockedDoor.replace('\n', ' ')); },
        onFound: () => { this.audio.sfx('chest'); this.ui.showFound(DUNGEON.found, DUNGEON.foundSub); },
        onTake: () => this.takeCard(),
      });
      this.scenes.mazmorra = this.dungeon;
    } catch (e) { console.warn('mazmorra no disponible', e); }
    this.loadCard();
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
    this.ui.onClose = () => {
      this.player.enabled = this.started && !this.ui.anyOpen;
      // leer la trampilla es "la señal": al cerrar el mensaje, el candado cede
      if (this.trapPending && !this.ui.readerOpen) {
        this.trapPending = false;
        if (this.dungeon) { this.trapOpen = true; this.audio.sfx('lock'); this.ui.toast('La trampilla se abrió', TOUCH ? 'tocala para bajar a la mazmorra' : 'E para bajar a la mazmorra'); }
      }
    };
    document.getElementById('inv-card')!.addEventListener('click', () => this.showCard());
    if (params.has('autostart')) this.start(false);
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  start(lock = true) {
    if (this.started) return;
    this.started = true; this.player.enabled = true;
    document.body.classList.add('playing');
    if (TOUCH) lock = false;
    this.ui.hideStart();
    this.audio.start();
    if (lock) this.lock();
    this.ui.toast(this.current.name, 'cinco de la tarde');
    if (this.expiredOnLoad) { this.expiredOnLoad = false; this.player.enabled = false; this.ui.notice(DUNGEON.expired); }
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
        if (this.ui.searchOpen) this.ui.closeSearch(); else this.openSearch();
        return;
      }
      if (!this.started || this.ui.searchOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyM') { this.toggleMap(); return; }
      if (e.code === 'Escape') { this.closePanels(); return; }
      if (e.code === 'KeyI') { this.ui.invitationOpen ? this.ui.closeInvitation() : this.showCard(); return; }
      if (e.code === 'KeyE' && !e.repeat) { this.interact(); return; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { this.player.keys.add(e.code); return; }
      if (isMoveKey(e.code)) {
        e.preventDefault();
        if (this.walking) this.cancelWalk();
        this.player.keys.add(e.code);
      }
    });
    addEventListener('keyup', (e) => this.player.keys.delete(e.code));
    addEventListener('blur', () => this.player.keys.clear());
    cv.addEventListener('mousedown', () => { this.drag = true; if (this.started && !this.ui.anyOpen && this.hover?.click) this.interact(); if (this.started && !this.ui.anyOpen && document.pointerLockElement !== cv) this.lock(); });
    addEventListener('mouseup', () => { this.drag = false; });
    addEventListener('mousemove', (e) => {
      if (!this.started || this.ui.anyOpen || this.walking) return;
      if (document.pointerLockElement === cv || this.drag) this.player.look(e.movementX, e.movementY);
    });
    if (TOUCH) {
      const g = this;
      this.touch = new TouchControls({
        get started() { return g.started; }, get walking() { return g.walking; }, get hasCard() { return !!g.card; },
        get anyOpen() { return g.ui.anyOpen; }, get hovering() { return !!g.hover; },
        player: this.player, camera: this.camera, canvas: cv,
        interact: () => this.interact(), toggleMap: () => this.toggleMap(), openSearch: () => this.openSearch(),
        showCard: () => this.showCard(), closeAll: () => this.closeAll(), cancelWalk: () => this.cancelWalk(),
      });
    }
  }
  /** Ctrl+F o el botón Buscar */
  openSearch() {
    if (!this.started || this.ui.searchOpen) return;
    this.ui.readerOpen && this.ui.closeReader(); this.ui.mapOpen && this.ui.closeMap();
    document.exitPointerLock?.(); this.player.keys.clear(); this.player.enabled = false;
    this.ui.openSearch();
  }
  /** Esc: cierra el panel abierto */
  closePanels() {
    this.ui.readerOpen && this.ui.closeReader(); this.ui.mapOpen && this.ui.closeMap(); this.ui.searchOpen && this.ui.closeSearch();
    this.ui.invitationOpen && this.ui.closeInvitation(); this.ui.noticeOpen && this.ui.closeNotice();
  }
  /** botón Cerrar (táctil): cierra paneles y corta la caminata automática */
  closeAll() { this.closePanels(); if (this.walking) this.cancelWalk(); }

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
    this.lastRoom = -1;
    if (this.started && id !== 'mazmorra') sc.indoor ? this.ui.toast(sc.name, PLACES.find((p) => p.id === id)?.idea ?? '') : this.ui.toast(sc.name);
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
    const text = !h ? null : h.id === 'trampilla' && this.trapOpen ? 'E — Bajar a la mazmorra' : h.prompt ?? (h.action === 'read' ? `E — Leer: ${h.name}` : h.target === 'bosque' ? 'E — Salir al bosque' : `E — Entrar: ${h.name}`);
    // en táctil se toca el objeto (o el botón Leer): sin la tecla
    this.ui.prompt(text && TOUCH ? `Tocá · ${text.replace(/^(Click o )?E — /, '')}` : text);
  }
  interact() {
    if (this.ui.invitationOpen) { this.ui.closeInvitation(); return; }
    if (this.ui.noticeOpen) { this.ui.closeNotice(); return; }
    if (this.ui.readerOpen) { this.ui.closeReader(); return; }
    if (this.ui.mapOpen) return;
    const h = this.hover;
    if (!h) return;
    if (h.id === 'trampilla' && this.trapOpen) { this.audio.sfx('door'); this.go('mazmorra'); return; }
    if (h.onUse) { h.onUse(); return; }
    if (h.action === 'read') {
      const place = PLACES.find((p) => p.id === h.placeId)!;
      this.player.enabled = false; this.player.keys.clear();
      this.ui.openReader(place.name, h.name, h.message ?? '');
      this.audio.chime();
      if (h.id === 'trampilla') this.trapPending = true;
    } else if (h.target) this.go(h.target);
  }

  // ---------------------------------------------------------------- invitación (se autodestruye a las 2 h)
  now() { return Date.now() + this.clockOffset; }
  get cardLeft(): number | null { return this.card ? INVITATION.lifetimeMs - (this.now() - this.card.takenAt) : null; }
  private loadCard() {
    try {
      const raw = JSON.parse(localStorage.getItem(CARD_KEY) ?? 'null');
      if (!raw || typeof raw.takenAt !== 'number') return;
      if (this.now() - raw.takenAt < INVITATION.lifetimeMs) { this.card = { takenAt: raw.takenAt }; this.dungeon?.restoreHeld(); }
      else { localStorage.removeItem(CARD_KEY); this.expiredOnLoad = true; }
    } catch { /* sin almacenamiento: la invitación dura lo que dure la pestaña */ }
  }
  private takeCard() {
    this.card = { takenAt: this.now() };
    try { localStorage.setItem(CARD_KEY, JSON.stringify(this.card)); } catch { /* idem */ }
    this.audio.fanfare();
    this.showCard();
  }
  showCard() {
    if (!this.card || !this.started || this.ui.anyOpen) return;
    this.cancelWalk(); this.player.enabled = false; this.player.keys.clear();
    document.exitPointerLock?.();
    this.ui.inventory(false, this.cardLeft);
    this.ui.openInvitation();
  }
  private expireCard() {
    this.card = null;
    try { localStorage.removeItem(CARD_KEY); } catch { /* idem */ }
    this.dungeon?.reset();
    this.ui.invitationOpen && this.ui.closeInvitation();
    this.player.enabled = false; this.player.keys.clear();
    this.audio.sfx('lock');
    this.ui.notice(DUNGEON.expired);
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
  private pathTo(to: THREE.Vector3): THREE.Vector3[] {
    if (!this.current.indoor) return this.forestPath(to);
    return this.current.route ? this.current.route(this.player.pos, to) : [to.clone()];
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
    this.ui.walkHint(`Caminando hacia ${label}… (${TOUCH ? 'el joystick o Cerrar cancelan' : 'una tecla de movimiento cancela'})`);
    const done = () => { if (token !== this.walkToken) return; this.walking = false; this.ui.walkHint(null); this.ui.toast(label); };
    const next = () => {
      if (token !== this.walkToken) return;
      const cur = this.current.id;
      if (cur !== scene) {
        // siguiente escena del recorrido: se baja hacia el destino o se sale hacia la escena madre
        const chain: string[] = [];
        for (let q: string | undefined = scene; q; q = PARENT[q]) chain.push(q);
        const k = chain.indexOf(cur), hop = k > 0 ? chain[k - 1] : PARENT[cur];
        let door: Interactable | undefined, at: THREE.Vector3 | undefined;
        if (cur === 'bosque') { door = this.forest.interactables.find((i) => i.id === `puerta-${hop}`); at = this.forest.doors[hop]?.pos; }
        else if (k > 0) { door = this.current.interactables.find((i) => i.id === 'trampilla'); at = door?.pos; this.trapOpen = true; }
        else { door = this.current.interactables.find((i) => i.action === 'door' && i.target === hop); at = door?.pos; }
        if (!door || !at || !this.scenes[hop]) { done(); return; }
        this.player.walkPath(this.pathTo(at), door.pos, () => token === this.walkToken && this.go(hop, next), cur === 'bosque' ? 0.5 : 1.4);
        return;
      }
      if (!pos) { done(); return; }
      this.player.walkPath(this.pathTo(pos), pos, done, stop);
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
    // invitación: cuenta regresiva y autodestrucción
    if (this.card && this.cardLeft! <= 0) this.expireCard();
    this.ui.inventory(!!this.dungeon?.hasKey && !this.card, this.cardLeft);
    if (this.dungeon && this.current === this.dungeon && this.started) {
      const r = this.dungeon.roomAt(this.player.pos.x, this.player.pos.z);
      if (r >= 0 && r !== this.lastRoom) { this.lastRoom = r; this.ui.toast(DUNGEON.rooms[r], `${DUNGEON.name} · cuarto ${r + 1} de 5`); }
    }
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
    this.touch?.update();
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
      posOf: (id: string) => g.findInteractable(id)?.it.pos.toArray() ?? null,
      /** atajos de prueba: tomar la llave o la invitación sin apuntarles */
      dungeonAct: (a: 'key' | 'card') => (a === 'key' ? g.dungeon?.takeKey() : g.dungeon?.takeCard()),
      /** adelanta el reloj de la invitación (ms) */
      advanceClock: (ms: number) => { g.clockOffset += ms; },
      clearCard: () => { try { localStorage.removeItem(CARD_KEY); } catch { /* */ } g.card = null; g.trapOpen = false; g.dungeon?.reset(); },
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
          dungeon: g.dungeon?.info() ?? null, room: g.dungeon && g.current === g.dungeon ? g.dungeon.roomAt(g.player.pos.x, g.player.pos.z) : -1,
          trapOpen: g.trapOpen, card: g.card ? { leftMs: g.cardLeft } : null,
          invitation: g.ui.invitationOpen ? document.querySelector('#invitation .card')!.textContent : null,
          notice: g.ui.noticeOpen ? document.getElementById('notice-text')!.textContent : null,
          found: document.getElementById('found')!.classList.contains('open') ? document.getElementById('found-title')!.textContent : null,
          speed: g.player.speed, run: g.player.run, fov: g.camera.fov, touch: !!g.touch,
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
