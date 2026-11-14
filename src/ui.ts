// Interfaz: carga/inicio, HUD, lector de mensajes, mapa (M) y buscador (Ctrl+F).
import { INVITATION, PLACES } from './content/ideas';
import { Geo } from './world/geo';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface SearchEntry { id: string; label: string; place: string; isPlace: boolean }

export class UI {
  readerOpen = false; mapOpen = false; searchOpen = false; invitationOpen = false; noticeOpen = false;
  onPick: (e: SearchEntry) => void = () => {};
  onClose: () => void = () => {};
  private entries: SearchEntry[] = [];
  private shown: SearchEntry[] = [];
  private sel = 0;
  private toastTimer = 0;

  constructor() {
    for (const p of PLACES) {
      this.entries.push({ id: p.id, label: p.name, place: p.kind === 'sala' ? 'sala' : 'lugar', isPlace: true });
      for (const o of p.objects) this.entries.push({ id: o.id, label: o.name, place: p.name, isPlace: false });
    }
    const input = $<HTMLInputElement>('search-input');
    input.addEventListener('input', () => this.filter(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { this.sel = Math.min(this.shown.length - 1, this.sel + 1); this.paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.sel = Math.max(0, this.sel - 1); this.paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { const pick = this.shown[this.sel]; if (pick) { this.closeSearch(); this.onPick(pick); } e.preventDefault(); }
      else if (e.key === 'Escape') { this.closeSearch(); e.preventDefault(); }
      e.stopPropagation();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    // cerrar con un toque (o click): lector, mapa e invitación en cualquier lugar; el buscador, fuera de su caja
    const tapClose = (id: string, close: () => void, outsideOnly = false) => $(id).addEventListener('click', (e) => {
      if (performance.now() - this.openedAt < 400) return; // el mismo toque que lo abrió
      if (outsideOnly && e.target !== $(id)) return;
      close();
    });
    tapClose('reader', () => this.readerOpen && this.closeReader());
    tapClose('map', () => this.mapOpen && this.closeMap());
    tapClose('invitation', () => this.invitationOpen && this.closeInvitation());
    tapClose('search', () => this.searchOpen && this.closeSearch(), true);
  }
  private openedAt = 0;

  get anyOpen() { return this.readerOpen || this.mapOpen || this.searchOpen || this.invitationOpen || this.noticeOpen; }

  // ---------------------------------------------------------------- mazmorra e invitación
  private foundTimer = 0;
  static clock(ms: number) {
    const s = Math.max(0, Math.ceil(ms / 1000)), p = (n: number) => String(n).padStart(2, '0');
    return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }
  /** Cartel grande y pasajero ("You found it!"). */
  showFound(title: string, sub: string) {
    $('found-title').textContent = title; $('found-sub').textContent = sub; $('found').classList.add('open');
    clearTimeout(this.foundTimer); this.foundTimer = window.setTimeout(() => $('found').classList.remove('open'), 5000);
  }
  /** Llave e invitación que lleva el jugador (cardMs = tiempo que le queda, o null). */
  inventory(key: boolean, cardMs: number | null) {
    $('inv-key').classList.toggle('on', key);
    $('inv-card').classList.toggle('on', cardMs !== null);
    if (cardMs !== null) { const t = UI.clock(cardMs); if ($('inv-time').textContent !== t) { $('inv-time').textContent = t; $('invitation-time').textContent = t; } }
  }
  openInvitation() {
    $('invitation-body').textContent = INVITATION.body;
    const lines = $('invitation-lines'); lines.innerHTML = '';
    INVITATION.lines.forEach((l) => { lines.append(l, document.createElement('br')); });
    $('invitation-closing').textContent = INVITATION.closing;
    $('found').classList.remove('open');
    $('invitation').classList.add('open'); this.invitationOpen = true; this.openedAt = performance.now();
  }
  closeInvitation() { $('invitation').classList.remove('open'); this.invitationOpen = false; this.onClose(); }
  notice(text: string) {
    $('notice-text').textContent = text; $('notice').classList.add('open'); this.noticeOpen = true;
    $('notice-ok').onclick = () => this.closeNotice();
  }
  closeNotice() { $('notice').classList.remove('open'); this.noticeOpen = false; this.onClose(); }

  progress(p: number, text?: string) {
    ($('bar').firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    if (text) $('loading-text').textContent = text;
  }
  showStart() { $('loading').classList.remove('open'); $('loading').classList.add('hidden'); $('start').classList.remove('hidden'); $('start').classList.add('open'); }
  hideStart() { $('start').classList.remove('open'); $('start').classList.add('hidden'); }
  get started() { return $('start').classList.contains('hidden') && $('loading').classList.contains('hidden'); }

  prompt(text: string | null) {
    const el = $('prompt');
    if (text) { if (el.textContent !== text) el.textContent = text; el.classList.add('on'); } else el.classList.remove('on');
  }
  toast(title: string, sub = '') {
    const el = $('toast');
    el.innerHTML = '';
    el.append(title);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
    el.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('on'), 4200);
  }
  walkHint(text: string | null) { const el = $('walk'); if (text) { el.textContent = text; el.classList.add('on'); } else el.classList.remove('on'); }
  fade(v: number) { $('fade').style.opacity = String(v); }

  openReader(place: string, title: string, text: string) {
    $('reader-place').textContent = place; $('reader-title').textContent = title; $('reader-text').textContent = text;
    $('reader').classList.add('open'); this.readerOpen = true; this.openedAt = performance.now();
  }
  closeReader() { $('reader').classList.remove('open'); this.readerOpen = false; this.onClose(); }

  openMap(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
    const cv = $<HTMLCanvasElement>('map-canvas');
    draw(cv.getContext('2d')!, cv.width, cv.height);
    $('map').classList.add('open'); this.mapOpen = true; this.openedAt = performance.now();
  }
  closeMap() { $('map').classList.remove('open'); this.mapOpen = false; this.onClose(); }

  openSearch() {
    $('search').classList.add('open'); this.searchOpen = true; this.openedAt = performance.now();
    const input = $<HTMLInputElement>('search-input');
    input.value = ''; this.filter(''); input.focus();
  }
  closeSearch() { $('search').classList.remove('open'); this.searchOpen = false; $<HTMLInputElement>('search-input').blur(); this.onClose(); }

  private filter(q: string) {
    const tokens = norm(q).split(/\s+/).filter(Boolean);
    this.shown = this.entries.filter((e) => { const hay = norm(`${e.label} ${e.place}`); return tokens.every((t) => hay.includes(t)); });
    this.sel = 0; this.paint();
  }
  private paint() {
    const ul = $('results');
    ul.innerHTML = '';
    this.shown.forEach((e, i) => {
      const li = document.createElement('li');
      li.dataset.id = e.id;
      if (i === this.sel) li.classList.add('sel');
      const a = document.createElement('span'); a.textContent = e.label;
      const b = document.createElement('small'); b.textContent = e.place;
      li.append(a, b);
      li.addEventListener('click', () => { this.closeSearch(); this.onPick(e); });
      ul.append(li);
    });
    ul.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
}

export interface MapPlace { name: string; x: number; z: number; kind: string }

/** Dibuja el mapa del bosque con la forma del Cono Sur. */
export function drawMap(c: CanvasRenderingContext2D, W: number, H: number, geo: Geo, places: MapPlace[], px: number, pz: number, yaw: number) {
  const b = geo.bounds, pad = 34;
  const s = Math.min((W - pad * 2) / (b.maxX - b.minX), (H - pad * 2) / (b.maxZ - b.minZ));
  const ox = (W - (b.maxX - b.minX) * s) / 2 - b.minX * s, oz = (H - (b.maxZ - b.minZ) * s) / 2 - b.minZ * s;
  const X = (x: number) => x * s + ox, Z = (z: number) => z * s + oz;
  const sea = c.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#cfe0d6'); sea.addColorStop(1, '#b7cfd2');
  c.fillStyle = sea; c.fillRect(0, 0, W, H);
  // tierra
  for (const pass of [0, 1]) for (const r of geo.rings) {
    c.beginPath();
    for (let i = 0; i < r.pts.length; i += 2) i ? c.lineTo(X(r.pts[i]), Z(r.pts[i + 1])) : c.moveTo(X(r.pts[i]), Z(r.pts[i + 1]));
    c.closePath();
    if (pass === 0) { c.fillStyle = '#d9cf9a'; c.fill(); c.strokeStyle = '#d9cf9a'; c.lineWidth = 3; c.stroke(); }
    else { c.strokeStyle = 'rgba(90,70,40,0.35)'; c.lineWidth = 0.8; c.stroke(); }
  }
  // cobertura de bosque y cordillera
  const step = 3;
  for (let z = b.minZ; z < b.maxZ; z += step) for (let x = b.minX; x < b.maxX; x += step) {
    if (geo.sample(geo.sdf, x, z) < 1) continue;
    const d = geo.biome(x, z).density;
    const x0 = Math.round(X(x - step / 2)), z0 = Math.round(Z(z - step / 2));
    c.fillStyle = `rgba(52,104,48,${Math.min(0.55, d * 0.36)})`;
    c.fillRect(x0, z0, Math.round(X(x + step / 2)) - x0, Math.round(Z(z + step / 2)) - z0);
  }
  c.strokeStyle = 'rgba(80,60,40,0.8)'; c.lineWidth = 1.8;
  for (let z = b.minZ; z < b.maxZ; z += 7) for (let x = b.minX; x < b.maxX; x += 2) {
    if (geo.sample(geo.sdf, x, z) < 1 || geo.sample(geo.andes, x, z) > 1.2) continue;
    c.beginPath(); c.moveTo(X(x) - 8, Z(z) + 6); c.lineTo(X(x), Z(z) - 8); c.lineTo(X(x) + 8, Z(z) + 6); c.stroke();
    break;
  }
  // ríos
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const r of geo.rivers) {
    c.strokeStyle = '#3f86a8'; c.lineWidth = r.main ? 7 : 3.5;
    c.beginPath();
    for (let i = 0; i < r.n; i++) i ? c.lineTo(X(r.pts[i * 2]), Z(r.pts[i * 2 + 1])) : c.moveTo(X(r.pts[i * 2]), Z(r.pts[i * 2 + 1]));
    c.stroke();
  }
  for (const r of geo.rivers) {
    const m = Math.floor(r.n * (r.main ? 0.72 : 0.3));
    c.font = 'italic 20px Georgia, serif'; c.textAlign = 'left'; c.lineWidth = 4; c.strokeStyle = 'rgba(247,237,214,0.8)';
    c.strokeText(r.name, X(r.pts[m * 2]) + 10, Z(r.pts[m * 2 + 1]) + 22); c.fillStyle = '#2a5f7a'; c.fillText(r.name, X(r.pts[m * 2]) + 10, Z(r.pts[m * 2 + 1]) + 22);
  }
  // lugares
  c.textAlign = 'center';
  for (const p of places) {
    const x = X(p.x), z = Z(p.z);
    c.fillStyle = p.kind === 'sala' ? '#8a2f1c' : '#2f5d2a'; c.strokeStyle = '#fff7e0'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(x, z - 13); c.lineTo(x + 11, z); c.lineTo(x, z + 13); c.lineTo(x - 11, z); c.closePath(); c.fill(); c.stroke();
    c.font = '600 25px Georgia, serif';
    const half = c.measureText(p.name).width / 2 + 8, tx = Math.min(W - half, Math.max(half, x));
    c.lineWidth = 6; c.strokeStyle = 'rgba(247,237,214,0.92)';
    c.strokeText(p.name, tx, z - 20); c.fillStyle = '#3a2a1a'; c.fillText(p.name, tx, z - 20);
  }
  // jugador
  c.save(); c.translate(X(px), Z(pz));
  c.fillStyle = 'rgba(192,57,43,0.22)'; c.beginPath(); c.arc(0, 0, 26, 0, Math.PI * 2); c.fill();
  c.rotate(-yaw);
  c.fillStyle = '#c0392b'; c.strokeStyle = '#fff'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(0, -20); c.lineTo(13, 14); c.lineTo(0, 7); c.lineTo(-13, 14); c.closePath(); c.fill(); c.stroke();
  c.restore();
  // norte y escala
  c.fillStyle = '#3a2a1a'; c.font = '600 26px Georgia, serif'; c.textAlign = 'center';
  c.fillText('N', W - 44, 46); c.beginPath(); c.moveTo(W - 44, 54); c.lineTo(W - 35, 80); c.lineTo(W - 53, 80); c.closePath(); c.fill();
  c.strokeStyle = '#3a2a1a'; c.lineWidth = 3; c.beginPath(); c.moveTo(28, H - 30); c.lineTo(28 + 100 * s, H - 30); c.stroke();
  c.textAlign = 'left'; c.font = '20px Georgia, serif'; c.fillText('100 m = 100 s a pie', 28, H - 42);
}
