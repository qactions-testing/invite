// Controles táctiles (solo celulares/tablets): joystick para caminar, deslizar para mirar,
// pellizcar para hacer zoom (FOV de la cámara), tocar un objeto para usarlo y botones con texto.
import * as THREE from 'three';
import { Player } from './player';

/** Lo que los controles necesitan del juego. */
export interface TouchHost {
  started: boolean; busy: boolean; hasCard: boolean; anyOpen: boolean; hovering: boolean;
  player: Player; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement;
  interact(): void; toggleMap(): void; openSearch(): void; showCard(): void; closeAll(): void;
}

/** Pantalla táctil como puntero principal (celular/tablet). `?touch=1|0` lo fuerza. */
export function isTouchDevice(params: URLSearchParams) {
  const f = params.get('touch');
  if (f === '1') return true;
  if (f === '0') return false;
  return matchMedia('(pointer: coarse)').matches;
}

export const FOV = { base: 68, min: 28, max: 75 };

export class TouchControls {
  private stick = document.getElementById('stick')!;
  private knob = document.getElementById('knob')!;
  private btns = new Map<string, HTMLButtonElement>();
  private stickId: number | null = null;
  private stickC = { x: 0, y: 0 };
  /** dedos sobre el mundo: id → última posición */
  private fingers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number; moved: boolean }>();
  private pinchD = 0;
  private lastPanel = false;
  /** momento del último toque en un botón: el click fantasma que el navegador manda después no debe caer en otro botón */
  lastAction = 0;

  constructor(private host: TouchHost) {
    document.querySelectorAll<HTMLButtonElement>('#tbtns button').forEach((b) => this.btns.set(b.dataset.a!, b));
    // pointerdown/up y no click: un segundo dedo (mientras otro sostiene el joystick) no genera click
    for (const [a, b] of this.btns) {
      let id: number | null = null;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; b.classList.add('down'); });
      b.addEventListener('pointerup', (e) => { if (e.pointerId !== id) return; id = null; b.classList.remove('down'); this.lastAction = performance.now(); this.action(a); });
      b.addEventListener('pointercancel', () => { id = null; b.classList.remove('down'); });
      b.addEventListener('pointerleave', () => { id = null; b.classList.remove('down'); });
    }

    // joystick
    this.stick.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      try { this.stick.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      const r = this.stick.getBoundingClientRect();
      this.stickC = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.stick.classList.add('on');
      this.moveStick(e.clientX, e.clientY);
    });
    this.stick.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY); });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null; this.stick.classList.remove('on');
      this.knob.style.transform = ''; this.host.player.stick = [0, 0];
    };
    this.stick.addEventListener('pointerup', endStick);
    this.stick.addEventListener('pointercancel', endStick);

    // mirar, pellizcar y tocar sobre el mundo
    const cv = host.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault(); // evita los mouse events emulados (click doble, pointer lock)
      this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
      if (this.fingers.size === 2) this.pinchD = this.spread();
    });
    cv.addEventListener('pointermove', (e) => {
      const f = this.fingers.get(e.pointerId);
      if (!f) return;
      const dx = e.clientX - f.x, dy = e.clientY - f.y;
      f.x = e.clientX; f.y = e.clientY;
      if (Math.hypot(f.x - f.x0, f.y - f.y0) > 10) f.moved = true;
      if (this.fingers.size >= 2) {
        const d = this.spread();
        if (this.pinchD > 0 && d > 0) this.zoom(this.pinchD / d);
        this.pinchD = d;
        return;
      }
      if (!this.host.started || this.host.anyOpen || this.host.busy) return;
      const k = 3.2 * (this.host.camera.fov / FOV.base);
      this.host.player.look(dx * k, dy * k);
    });
    const endFinger = (e: PointerEvent) => {
      const f = this.fingers.get(e.pointerId);
      if (!f) return;
      const multi = this.fingers.size > 1;
      this.fingers.delete(e.pointerId);
      this.pinchD = this.fingers.size >= 2 ? this.spread() : 0;
      // toque corto sin arrastre: usar lo que se mira (como el click o la E)
      if (e.type === 'pointerup' && !multi && !f.moved && performance.now() - f.t0 < 450 && this.host.started && !this.host.anyOpen && this.host.hovering) this.host.interact();
    };
    cv.addEventListener('pointerup', endFinger);
    cv.addEventListener('pointercancel', endFinger);
  }

  private spread() {
    const p = [...this.fingers.values()];
    return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  /** k > 1 aleja (más campo de visión), k < 1 acerca. */
  zoom(k: number) {
    const cam = this.host.camera;
    cam.fov = THREE.MathUtils.clamp(cam.fov * k, FOV.min, FOV.max);
    cam.updateProjectionMatrix();
  }

  private moveStick(x: number, y: number) {
    const R = this.stick.clientWidth / 2;
    let dx = x - this.stickC.x, dy = y - this.stickC.y;
    const d = Math.hypot(dx, dy), max = R * 0.62;
    const kx = d > max ? max / d : 1;
    this.knob.style.transform = `translate(${dx * kx}px, ${dy * kx}px)`;
    // zona muerta del 22 %; fuera de ella, dirección pura: la velocidad es fija (3 m/s, 6 trotando)
    if (d < R * 0.22) { this.host.player.stick = [0, 0]; return; }
    this.host.player.stick = [dx / d, -dy / d];
  }

  action(a: string) {
    const h = this.host;
    if (!h.started) return;
    if (a === 'close') { h.closeAll(); return; }
    if (a === 'run') { h.player.run = !h.player.run; return; }
    if (h.anyOpen) return;
    if (a === 'read') h.interact();
    else if (a === 'map') h.toggleMap();
    else if (a === 'search') h.openSearch();
    else if (a === 'card') h.showCard();
  }

  /** Cada cuadro: estado visual de los botones. */
  update() {
    const panel = this.host.anyOpen;
    if (panel !== this.lastPanel) {
      this.lastPanel = panel;
      document.body.classList.toggle('panel', panel);
      if (panel && this.stickId !== null) { this.stickId = null; this.stick.classList.remove('on'); this.knob.style.transform = ''; this.host.player.stick = [0, 0]; }
    }
    this.btns.get('run')!.classList.toggle('on', this.host.player.run);
    this.btns.get('card')!.classList.toggle('off', !this.host.hasCard);
    this.btns.get('read')!.classList.toggle('ready', this.host.hovering);
  }
}
