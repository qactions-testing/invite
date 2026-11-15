// Arranque, bucle principal, cambio de escenas, interacción (E), mapa (M), buscador (Ctrl+F)
// y ganchos deterministas para tests (window.__invite).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { GameScene, Interactable } from './core';
import { DUNGEON, INVITATION, PLACES } from './content/ideas';
import { Player, isMoveKey } from './player';
import { UI, drawMap, SearchEntry } from './ui';
import { ForestScene } from './world/forest';
import { RoomScene, TexLib } from './world/rooms';
import { DungeonScene } from './world/dungeon';
import { GameAudio } from './audio';
import { TouchControls, isTouchDevice, FOV } from './touch';
import { Cat } from './cat';

const params = new URLSearchParams(location.search);
const TOUCH = isTouchDevice(params);
if (TOUCH) document.body.classList.add('touch');
const QUALITY: 'low' | 'high' = params.get('quality') === 'low' ? 'low' : 'high';
const ROOMS = ['cana', 'abuelas', 'gnomos'];
const CARD_KEY = 'invite.card.v1', QUALITY_KEY = 'invite.quality.v2', MUSIC_KEY = 'invite.music.v1';
const SHOW_FPS = params.has('fps');

/** Calidad gráfica (botón en pantalla). Distancias de dibujo: [pasto, plantas, árboles] en m. */
type Level = 'alta' | 'media' | 'baja';
const LEVELS: Level[] = ['alta', 'media', 'baja'];
const QSET: Record<Level, { label: string; dpr: number; shadow: number; bloom: boolean; lights: number; ranges: [number, number, number] }> = {
  alta: { label: 'Alta', dpr: 1.5, shadow: 1024, bloom: true, lights: 3, ranges: [60, 100, 230] },
  media: { label: 'Media', dpr: 1, shadow: 512, bloom: false, lights: 2, ranges: [45, 75, 165] },
  baja: { label: 'Baja', dpr: 0.75, shadow: 0, bloom: false, lights: 1, ranges: [30, 55, 135] },
};
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

class Game {
  renderer!: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private fxaa: ShaderPass | null = null;
  camera = new THREE.PerspectiveCamera(FOV.base, innerWidth / innerHeight, 0.08, 2600);
  touch: TouchControls | null = null;
  /** el gato tuxedo que acompaña al jugador */
  cat = new Cat();
  private meowT = 6;
  /** dónde puede pararse el gato: en el bosque, tierra firme sin troncos ni agua; en las salas, donde no haya pared */
  private canStand = (x: number, z: number) => (this.current === this.forest ? this.forest.nav.walkable(x, z) : true);
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
  /** viaje rápido en curso (buscador o mapa) */
  travelling = false;
  level: Level = 'alta';
  private lightCache = new Map<string, THREE.PointLight[]>();
  private lightTick = 0; private shadowAt = new THREE.Vector3(1e9, 0, 0);
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3();
  private fps = { n: 0, t: 0, worst: 0 };
  private ray = new THREE.Raycaster();
  private drag = false;
  errors: string[] = [];

  async init() {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.92;
    // sombras: el sol no se mueve, así que el mapa de sombras se recalcula solo cuando hace falta (ver update)
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false;
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
    this.setScene('bosque', null);
    const saved = store.get(QUALITY_KEY) as Level | null;
    // por defecto Media en PC y celular (Alta queda a mano en el botón)
    this.applyQuality(QUALITY === 'low' ? 'baja' : saved && LEVELS.includes(saved) ? saved : 'media', false);
    this.audio.setMusic(store.get(MUSIC_KEY) !== '0');
    // shaders de todas las escenas compilados de antemano: entrar a una sala o a la mazmorra no traba
    this.ui.progress(0.97, 'Preparando la luz del bosque…');
    for (const sc of Object.values(this.scenes)) {
      this.manageLights(sc, true);
      sc.scene.add(this.cat.group); // el gato también, para que entrar a una sala con él no trabe
      try { await r.compileAsync(sc.scene, this.camera); } catch { /* se compila al dibujar */ }
    }
    this.current.scene.add(this.cat.group);
    this.manageLights(this.current, true);
    this.bind();
    this.ui.progress(1, 'Listo');
    this.ui.showStart();
    this.ui.onPick = (e) => { void this.travelTo(e.id); };
    this.ui.onMapPick = (id) => { void this.travelTo(id); };
    this.ui.onClose = () => {
      this.player.enabled = this.started && !this.ui.anyOpen;
      this.syncPanels(); // los controles vuelven al instante (no un cuadro después)
      // en PC, al cerrar el último panel (tecla o click) se vuelve a capturar el mouse para mirar
      if (!TOUCH && this.started && !this.ui.anyOpen && document.pointerLockElement !== this.renderer.domElement && !params.has('autostart')) this.lock();
      // leer la trampilla es "la señal": al cerrar el mensaje, el candado cede
      if (this.trapPending && !this.ui.readerOpen) {
        this.trapPending = false;
        if (this.dungeon) { this.trapOpen = true; this.audio.sfx('lock'); this.ui.toast('La trampilla se abrió', TOUCH ? 'Tocala para bajar a la mazmorra' : 'E para bajar a la mazmorra'); }
      }
    };
    document.getElementById('inv-card')!.addEventListener('click', () => {
      // un toque en Cerrar (arriba a la derecha) deja un click fantasma justo acá: se ignora
      if (this.touch && performance.now() - this.touch.lastAction < 500) return;
      this.showCard();
    });
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
      this.composer?.setSize(innerWidth, innerHeight); this.sizeBloom();
    });
    const music = document.getElementById('btn-music')!, quality = document.getElementById('btn-quality')!;
    music.addEventListener('click', () => { this.toggleMusic(); music.blur(); });
    quality.addEventListener('click', () => { this.applyQuality(LEVELS[(LEVELS.indexOf(this.level) + 1) % LEVELS.length]); quality.blur(); });
    this.paintMusic();
    addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
        e.preventDefault();
        if (!this.started) return;
        if (this.ui.searchOpen) this.ui.closeSearch(); else this.openSearch();
        return;
      }
      if (!this.started || this.ui.searchOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyM') { this.toggleMap(); return; }
      // zoom: + acerca, - aleja (también el teclado numérico y "=" donde + necesita Shift)
      if (!this.ui.anyOpen && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) { e.preventDefault(); this.zoom(1 / 1.12); return; }
      if (!this.ui.anyOpen && (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')) { e.preventDefault(); this.zoom(1.12); return; }
      if (e.code === 'Escape') { this.closePanels(); return; }
      if (e.code === 'KeyI') { this.ui.invitationOpen ? this.ui.closeInvitation() : this.showCard(); return; }
      if (e.code === 'KeyE' && !e.repeat) { this.interact(); return; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { this.player.keys.add(e.code); return; }
      if (isMoveKey(e.code)) {
        e.preventDefault();
        this.player.keys.add(e.code);
      }
    });
    addEventListener('keyup', (e) => this.player.keys.delete(e.code));
    addEventListener('blur', () => this.player.keys.clear());
    cv.addEventListener('mousedown', () => { this.drag = true; if (this.started && !this.ui.anyOpen && this.hover?.click) this.interact(); if (this.started && !this.ui.anyOpen && document.pointerLockElement !== cv) this.lock(); });
    addEventListener('mouseup', () => { this.drag = false; });
    // rueda del mouse: zoom (hacia adelante acerca)
    cv.addEventListener('wheel', (e) => {
      if (!this.started || this.ui.anyOpen) return;
      e.preventDefault();
      this.zoom(Math.pow(1.0015, THREE.MathUtils.clamp(e.deltaY, -200, 200)));
    }, { passive: false });
    addEventListener('mousemove', (e) => {
      if (!this.started || this.ui.anyOpen || this.travelling) return;
      if (document.pointerLockElement === cv || this.drag) this.player.look(e.movementX, e.movementY);
    });
    if (TOUCH) {
      const g = this;
      this.touch = new TouchControls({
        get started() { return g.started; }, get busy() { return g.travelling; }, get hasCard() { return !!g.card; },
        get anyOpen() { return g.ui.anyOpen; }, get hovering() { return !!g.hover; },
        player: this.player, camera: this.camera, canvas: cv,
        interact: () => this.interact(), toggleMap: () => this.toggleMap(), openSearch: () => this.openSearch(),
        showCard: () => this.showCard(), closeAll: () => this.closeAll(),
      });
    }
  }
  /** Ctrl+F o el botón Buscar */
  openSearch() {
    if (!this.started || this.ui.searchOpen) return;
    this.ui.readerOpen && this.ui.closeReader(); this.ui.mapOpen && this.ui.closeMap();
    document.exitPointerLock?.(); this.player.keys.clear(); this.player.enabled = false;
    this.ui.openSearch();
    this.syncPanels();
  }
  /** Esc: cierra el panel abierto */
  closePanels() {
    this.ui.readerOpen && this.ui.closeReader(); this.ui.mapOpen && this.ui.closeMap(); this.ui.searchOpen && this.ui.closeSearch();
    this.ui.invitationOpen && this.ui.closeInvitation(); this.ui.noticeOpen && this.ui.closeNotice();
  }
  /** Zoom de la cámara (FOV): k > 1 aleja, k < 1 acerca. Rueda, +/- y pellizco. */
  zoom(k: number) {
    this.camera.fov = THREE.MathUtils.clamp(this.camera.fov * k, FOV.min, FOV.max);
    this.camera.updateProjectionMatrix();
  }
  /** botón Cerrar (táctil) */
  closeAll() { this.closePanels(); }

  // ---------------------------------------------------------------- calidad gráfica y música
  /** Aplica un nivel de calidad en caliente (sin recargar) y lo recuerda. */
  applyQuality(level: Level, save = true) {
    const q = QSET[level], r = this.renderer;
    this.level = level;
    r.setPixelRatio(Math.min(devicePixelRatio, q.dpr));
    r.setSize(innerWidth, innerHeight);
    const sun = this.forest.atmo.light;
    sun.castShadow = q.shadow > 0;
    if (q.shadow && sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); sun.shadow.map?.dispose(); (sun.shadow as any).map = null; }
    r.shadowMap.needsUpdate = true;
    if (q.bloom) { this.ensurePost(); this.composer!.setPixelRatio(r.getPixelRatio()); this.composer!.setSize(innerWidth, innerHeight); this.sizeBloom(); }
    else if (this.composer) { this.composer.dispose(); this.composer = null; this.renderPass = null; this.bloom = null; this.fxaa = null; }
    this.forest.flora.ranges = q.ranges;
    this.forest.flora.cull(this.player.pos, true);
    this.lightCache.forEach((_, id) => this.manageLights(this.scenes[id], true));
    const b = document.getElementById('btn-quality');
    if (b) b.textContent = `Calidad: ${q.label}`;
    if (save) store.set(QUALITY_KEY, level);
  }
  private ensurePost() {
    if (this.composer) return;
    const r = this.renderer, size = r.getDrawingBufferSize(new THREE.Vector2());
    // sin antialiasing ×4 en la textura: esa combinación (punto flotante + MSAA) da bloques negros en varios drivers de PC;
    // el borde se suaviza con FXAA al final
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.current.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 4, size.y / 4), 0.3, 0.65, 0.92);
    // un píxel inválido (NaN/inf) en la escena se expandiría con el desenfoque del bloom como un pantallazo negro
    const hp = (this.bloom as any).materialHighPassFilter as THREE.ShaderMaterial;
    hp.fragmentShader = hp.fragmentShader.replace('gl_FragColor = mix( outputColor, texel, alpha );',
      'gl_FragColor = mix( outputColor, texel, alpha );\n\t\t\tif ( any( isnan( gl_FragColor ) ) || any( isinf( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );');
    hp.needsUpdate = true;
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.renderPass); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass()); this.composer.addPass(this.fxaa);
    this.sizeBloom();
    this.bloom.strength = this.current.indoor ? 0.42 : 0.3;
  }
  private sizeBloom() {
    if (!this.bloom) return;
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.bloom.resolution.set(s.x / 4, s.y / 4);
    this.fxaa?.material.uniforms.resolution.value.set(1 / s.x, 1 / s.y);
  }
  /** Deja encendidas solo las luces puntuales más cercanas; la cantidad encendida es fija para no recompilar shaders. */
  private manageLights(sc: GameScene, force = false) {
    if (!force && ((this.lightTick += 1) % 15) !== 7) return; // en otro cuadro que el descarte de la vegetación
    let ls = this.lightCache.get(sc.id);
    if (!ls) { ls = []; sc.scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight) ls!.push(o as THREE.PointLight); }); this.lightCache.set(sc.id, ls); }
    // la mazmorra es chica y vive de sus antorchas: ahí se encienden dos más
    const n = QSET[this.level].lights + (sc.id === 'mazmorra' ? 2 : 0);
    if (ls.length <= n) { for (const l of ls) l.visible = true; return; }
    // las más cercanas a lo que se está mirando (3 m por delante de la cámara), no a los pies
    const focus = this.camera.getWorldDirection(this.tmpB).multiplyScalar(3).add(this.camera.position);
    const d = ls.map((l) => [l.getWorldPosition(this.tmpA).distanceToSquared(focus), l] as const).sort((a, b) => a[0] - b[0]);
    d.forEach(([, l], i) => { l.visible = i < n; });
  }
  toggleMusic() { this.audio.setMusic(!this.audio.musicOn); store.set(MUSIC_KEY, this.audio.musicOn ? '1' : '0'); this.paintMusic(); }
  private paintMusic() {
    const b = document.getElementById('btn-music');
    if (!b) return;
    const on = this.audio.musicOn;
    b.classList.toggle('muted', !on);
    b.setAttribute('aria-label', on ? 'Silenciar la música' : 'Activar la música'); b.title = on ? 'Silenciar la música' : 'Activar la música';
  }

  // ---------------------------------------------------------------- escenas
  setScene(id: string, from: string | null) {
    const sc = this.scenes[id];
    if (!sc) return false;
    this.current = sc;
    const e = sc.entry(from);
    this.player.pos.copy(e.pos); this.player.yaw = e.yaw; this.player.pitch = 0;
    this.cat.snap(this.player, sc, this.canStand);
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
  private pickTick = 0;
  private pick() {
    // qué se está mirando: cada 2 cuadros alcanza (30 veces por segundo) y ahorra el rayo contra todos los objetos
    if (!this.manual && (this.pickTick++ & 1) && !this.ui.anyOpen && !this.trans) return;
    this.hover = null;
    if (this.started && !this.ui.anyOpen && !this.trans) {
      const list = this.current.interactables, dir = this.camera.getWorldDirection(this.tmpB);
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
          const v = this.tmpA.subVectors(i.pos, this.camera.position), d = v.length();
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
      this.syncPanels();
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
    this.player.enabled = false; this.player.keys.clear();
    document.exitPointerLock?.();
    this.ui.inventory(false, this.cardLeft);
    this.ui.openInvitation();
    this.syncPanels();
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
    // en PC se suelta el mouse: aparece el puntero para elegir un lugar sin tener que apretar Esc
    document.exitPointerLock?.();
    const f = this.forest;
    // dentro de una sala, el marcador queda en su puerta
    const door = this.current.indoor ? f.doors[this.current.id] : null;
    const px = door ? door.pos.x : this.player.pos.x, pz = door ? door.pos.z : this.player.pos.z;
    queueMicrotask(() => this.syncPanels());
    this.ui.openMap((c, w, h) => drawMap(c, w, h, f.geo, PLACES.map((p) => ({ id: p.id, name: p.name, kind: p.kind, ...f.placePos[p.id] })), px, pz, this.player.yaw));
  }

  // ---------------------------------------------------------------- viaje rápido (buscador y mapa)
  findInteractable(id: string): { scene: string; it: Interactable } | null {
    for (const [sid, sc] of Object.entries(this.scenes)) { const it = sc.interactables.find((i) => i.id === id); if (it) return { scene: sid, it }; }
    return null;
  }
  /** Un punto pisable a `dist` m de (cx, cz), probando alrededor; el primero intenta desde `prefer` (radianes). */
  private standNear(cx: number, cz: number, dist: number, prefer: number): THREE.Vector3 {
    const f = this.forest, p = new THREE.Vector3();
    for (let k = 0; k < 24; k++) {
      const a = prefer + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      p.set(cx + Math.cos(a) * dist, 0, cz + Math.sin(a) * dist);
      if (!f.nav.walkable(p.x, p.z)) continue;
      const before = p.clone();
      f.collide(p, this.player.radius);
      if (p.distanceTo(before) < 0.05) return p;
    }
    p.set(cx + Math.cos(prefer) * dist, 0, cz + Math.sin(prefer) * dist);
    f.collide(p, this.player.radius);
    return p;
  }
  /** Ubica al jugador en el destino (lugar u objeto), mirándolo. */
  private placeAt(id: string): string | null {
    const f = this.forest, place = PLACES.find((p) => p.id === id);
    const face = (x: number, y: number, z: number) => {
      const e = this.player.pos, dx = x - e.x, dz = z - e.z, dy = y - (e.y + this.player.eye);
      this.player.yaw = Math.atan2(-dx, -dz); this.player.pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.1, 1.1);
    };
    const fromSpawn = (x: number, z: number) => Math.atan2(f.spawn.pos.z - z, f.spawn.pos.x - x);
    if (place) {
      if (place.kind === 'sala' && this.scenes[place.id]) { this.setScene(place.id, 'bosque'); return place.name; }
      const q = f.placePos[id];
      if (this.current.id !== 'bosque') this.setScene('bosque', null);
      const p = this.standNear(q.x, q.z, id === 'estanque' ? 11 : 6, fromSpawn(q.x, q.z));
      this.player.pos.set(p.x, f.groundY(p.x, p.z), p.z);
      face(q.x, this.player.pos.y + this.player.eye - 0.4, q.z);
      return place.name;
    }
    const fi = this.findInteractable(id);
    if (!fi || !this.scenes[fi.scene]) return null;
    const o = fi.it.pos;
    if (fi.scene === 'bosque') {
      if (this.current.id !== 'bosque') this.setScene('bosque', null);
      const p = this.standNear(o.x, o.z, 1.8, fromSpawn(o.x, o.z));
      this.player.pos.set(p.x, f.groundY(p.x, p.z), p.z);
    } else {
      this.setScene(fi.scene, 'bosque');
      const sc = this.current, e = this.player.pos, dx = e.x - o.x, dz = e.z - o.z, l = Math.hypot(dx, dz) || 1;
      const k = Math.min(1.5, l);
      e.set(o.x + (dx / l) * k, 0, o.z + (dz / l) * k);
      sc.collide(e, this.player.radius);
      e.y = sc.groundY(e.x, e.z);
    }
    face(o.x, o.y, o.z);
    return fi.it.name;
  }
  /** Fundido a negro, barra de carga "Llevándote de aquí para allá...", carga del destino y aparición allí. */
  async travelTo(id: string): Promise<boolean> {
    if (this.travelling || !this.started || this.trans) return false;
    const place = PLACES.find((p) => p.id === id), fi = place ? null : this.findInteractable(id);
    if (!place && !fi) return false;
    if (fi && !this.scenes[fi.scene]) { this.ui.toast('Todavía cerrado', 'esta sala se abre pronto'); return false; }
    this.travelling = true;
    const t0 = performance.now();
    this.ui.travelStart(place ? place.name : fi!.it.name);
    this.closePanels();
    document.exitPointerLock?.(); this.player.keys.clear(); this.player.stick = [0, 0]; this.player.enabled = false;
    try {
      await sleep(380); // fundido a negro
      this.ui.travelProgress(0.25);
      this.trans = null; this.fadeK = 0;
      const label = this.placeAt(id) ?? '';
      this.cat.snap(this.player, this.current, this.canStand);
      this.ui.travelProgress(0.5);
      this.forest.flora.cull(this.player.pos, true);
      this.manageLights(this.current, true);
      this.renderer.shadowMap.needsUpdate = true;
      try { await this.renderer.compileAsync(this.current.scene, this.camera); } catch { /* se compila al dibujar */ }
      this.ui.travelProgress(0.8);
      this.update(1 / 60); this.render(); await nextFrame(); this.render();
      this.ui.travelProgress(1);
      await sleep(Math.max(150, 1200 - (performance.now() - t0)));
      this.ui.travelEnd();
      const where = place ? place.idea : PLACES.find((p) => p.id === fi!.it.placeId)?.name ?? '';
      this.ui.toast(label, where);
      this.audio.meow(this.cat.pos); this.meowT = 25 + Math.random() * 35; // el gato llega con vos y avisa
      this.nearPlace = place && place.kind === 'natural' ? place.id : this.nearPlace;
    } finally {
      this.travelling = false;
      if (this.ui.travelOpen) this.ui.travelEnd();
      this.player.enabled = this.started && !this.ui.anyOpen;
      this.syncPanels();
    }
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
    // el reflejo del cielo (se carga aparte) también ilumina al gato dentro de las salas horneadas
    if (!this.cat.hasEnv && this.forest.scene.environment) this.cat.setEnvironment(this.forest.scene.environment);
    if (!this.trans) this.cat.update(dt, this.t, this.player, this.current, this.canStand);
    // de vez en cuando maúlla
    this.meowT -= dt;
    if (this.meowT <= 0 && this.started) { this.audio.meow(this.cat.pos); this.meowT = 25 + Math.random() * 35; }
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
    this.manageLights(this.current);
    // sombras: el sol no se mueve; el mapa se recalcula solo cuando su encuadre se reubica (cada 2 m que avanza el jugador)
    const sun = this.forest.atmo.light;
    if (this.current === this.forest && sun.castShadow && sun.position.distanceToSquared(this.shadowAt) > 0.01) {
      this.renderer.shadowMap.needsUpdate = true; this.shadowAt.copy(sun.position);
    }
    this.syncPanels();
  }
  /** Con un panel abierto se ocultan los botones de esquina y los controles táctiles (salvo Cerrar). */
  private syncPanels() {
    const panel = this.ui.anyOpen;
    if (document.body.classList.contains('panel') !== panel) document.body.classList.toggle('panel', panel);
    this.touch?.update();
  }
  render() { if (this.composer) this.composer.render(); else this.renderer.render(this.current.scene, this.camera); }
  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    // tope de 60 cuadros por segundo: en monitores de 120/144 Hz dibujar más no se ve mejor y le exige el doble a la GPU
    if (!this.manual && now - this.last < 1000 / 62) return;
    const raw = (now - this.last) / 1000, dt = Math.min(0.05, raw);
    this.last = now;
    if (this.manual) return;
    this.update(dt); this.render();
    if (SHOW_FPS) {
      const f = this.fps;
      f.n++; f.t += raw; f.worst = Math.max(f.worst, raw);
      if (f.t >= 0.5) { document.getElementById('fps')!.textContent = `${Math.round(f.n / f.t)} fps · peor ${Math.round(f.worst * 1000)} ms`; f.n = 0; f.t = 0; f.worst = 0; }
    }
  };

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
        g.trans = null; g.fadeK = 0;
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
      meow: () => g.audio.meow(g.cat.pos),
      travelTo: (id: string) => g.travelTo(id),
      /** solo tests: recorre a pie la ruta interna de la escena hasta un objeto (prueba que los cuartos conectan) */
      walkRoute: (id: string) => {
        const it = g.current.interactables.find((i) => i.id === id);
        if (!it || !g.current.route) return false;
        g.player.walkPath(g.current.route(g.player.pos, it.pos), it.pos, null, 1.4);
        return true;
      },
      setQuality: (l: Level) => g.applyQuality(l),
      setFov: (f: number) => { g.camera.fov = f; g.camera.updateProjectionMatrix(); },
      /** Lo que cuesta dibujar un cuadro (vista + sombras). `old`: como antes de las parcelas. */
      renderCost: (old: boolean | 'sin-flora' = false) => {
        if (old === 'sin-flora') f.flora.group.visible = false;
        else if (old) f.flora.drawAll(true);
        const r = g.renderer; r.shadowMap.needsUpdate = true;
        r.info.reset(); r.info.autoReset = false;
        r.render(g.current.scene, g.camera);
        const out = { calls: r.info.render.calls, triangles: r.info.render.triangles };
        r.info.autoReset = true;
        if (old === 'sin-flora') f.flora.group.visible = true;
        else if (old) f.flora.drawAll(false);
        return out;
      },
      /** coordenadas en pantalla de un lugar del mapa abierto (para tests) */
      mapPoint: (id: string) => g.ui.mapPoint(id),
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
          travelling: g.travelling, autoWalk: g.player.auto, transition: !!g.trans, hover: g.hover?.id ?? null, t: g.t,
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
          cat: { pos: g.cat.pos.toArray(), heading: g.cat.heading, gait: g.cat.gait, sit: g.cat.sit, speed: g.cat.speed, gems: g.cat.gems, scene: g.cat.group.parent === g.current.scene, env: g.cat.hasEnv,
            dist: Math.hypot(g.cat.pos.x - g.player.pos.x, g.cat.pos.z - g.player.pos.z) },
          quality: g.level, shadows: g.forest.atmo.light.castShadow, bloom: !!g.composer, pixelRatio: g.renderer.getPixelRatio(),
          chunks: { total: f.flora.chunkCount, visible: f.flora.visibleChunks },
          lights: [...g.lightCache.get(g.current.id) ?? []].filter((l) => l.visible).length,
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
