// Audio 100 % sintetizado con WebAudio (sin archivos):
// guitarra española y banjo por Karplus-Strong; quena, siku y flauta traversa con soplo filtrado;
// cantos de aves sudamericanas por síntesis FM, posicionados en 3D; viento, agua y crepitar del fuego.
import * as THREE from 'three';
import { mulberry32, Rng } from './util';

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

// progresión en La menor, compás de 6/8 lento (negra con puntillo = 1 s)
const CH: Record<string, { bass: number; tones: number[] }> = {
  Am: { bass: 45, tones: [52, 57, 60, 64] }, F: { bass: 41, tones: [53, 57, 60, 65] }, G: { bass: 43, tones: [50, 55, 59, 62] },
  C: { bass: 48, tones: [52, 55, 60, 64] }, Dm: { bass: 50, tones: [53, 57, 62, 65] }, E7: { bass: 40, tones: [52, 56, 59, 62] }, Em: { bass: 40, tones: [52, 55, 59, 64] },
};
const SONG = ['Am', 'Am', 'F', 'G', 'Am', 'Dm', 'E7', 'Am', 'C', 'G', 'Am', 'Em', 'F', 'C', 'E7', 'E7'];
const PENTA = [69, 72, 74, 76, 79, 81, 84]; // La menor pentatónica
const EIGHTH = 1 / 3;

type Wind = 'quena' | 'siku' | 'flauta';

export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode; private music!: GainNode; private reverbIn!: GainNode; private birdBus!: GainNode; private birdLp!: BiquadFilterNode;
  private guitar!: GainNode; private banjo!: GainNode; private winds!: GainNode;
  private waterG!: GainNode; private fireG!: GainNode; private windG!: GainNode; private caveSend!: GainNode;
  private ks = new Map<string, AudioBuffer>();
  private rng: Rng = mulberry32(1950);
  private nextBar = 0; private bar = 0; private nextBird = 0; private nextCrackle = 0; private nextDrip = 0;
  private melody: { inst: Wind; notes: [number, number, number][] } | null = null; // [compás, corchea, midi]
  private amb = { water: 0, fire: 0, cave: 0 }; private indoor = false;
  private stats = { notes: 0, birdCalls: 0, windNotes: 0, banjoNotes: 0, bars: 0, drumHits: 0, fanfares: 0, sfx: 0, meows: 0, crackles: 0 };
  private limiter = false;
  /** botón de parlante: silencia solo la música (aves, agua, fuego, bombos y trompetas siguen) */
  musicOn = true;
  /** ruido compartido (soplo de los vientos) y chasquidos del fuego: se crean una vez, no en cada nota */
  private breath: AudioBuffer | null = null; private crackles: AudioBuffer[] = [];
  private fwd = new THREE.Vector3();
  /** 0..1: cercanía a la invitación (bombos de ceremonia) */
  drumLevel = 0;
  private timer = 0;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    // 'playback': buffers de audio más grandes; en PCs modestas evita cortes y chasquidos (la latencia no importa acá)
    let c: AudioContext;
    try { c = new AC({ latencyHint: 'playback' }); } catch { c = new AC(); }
    this.ctx = c;
    this.master = c.createGain(); this.master.gain.value = 0.75;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
    // limitador final: nada pasa de −3 dB aunque coincidan bombos, trompetas, aves y música (antes saturaba)
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.12;
    this.master.connect(comp); comp.connect(lim); lim.connect(c.destination);
    this.limiter = true;

    // reverberación: impulso de ruido con caída exponencial
    const len = Math.floor(c.sampleRate * 1.8), ir = c.createBuffer(2, len, c.sampleRate), r = mulberry32(3);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * (1 - i / len) ** 3.2; }
    const conv = c.createConvolver(); conv.buffer = ir;
    this.reverbIn = c.createGain(); this.reverbIn.gain.value = 1;
    const wet = c.createGain(); wet.gain.value = 0.55;
    this.reverbIn.connect(conv); conv.connect(wet); wet.connect(this.master);

    // música: más baja y filtrada, "como algo alejada"
    this.music = c.createGain(); this.music.gain.value = 0.34;
    const far = c.createBiquadFilter(); far.type = 'lowpass'; far.frequency.value = 3400;
    this.music.connect(far); far.connect(this.master);
    const send = c.createGain(); send.gain.value = 0.6; far.connect(send); send.connect(this.reverbIn);
    this.guitar = c.createGain(); this.guitar.gain.value = 1.0;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 190; body.Q.value = 1.1; body.gain.value = 5;
    this.guitar.connect(body); body.connect(this.music);
    this.banjo = c.createGain(); this.banjo.gain.value = 0.3;
    const twang = c.createBiquadFilter(); twang.type = 'peaking'; twang.frequency.value = 2100; twang.Q.value = 1.4; twang.gain.value = 8;
    this.banjo.connect(twang); twang.connect(this.music);
    this.winds = c.createGain(); this.winds.gain.value = 0.5; this.winds.connect(this.music);

    // aves
    this.birdBus = c.createGain(); this.birdBus.gain.value = 0.5;
    this.birdLp = c.createBiquadFilter(); this.birdLp.type = 'lowpass'; this.birdLp.frequency.value = 12000;
    this.birdBus.connect(this.birdLp); this.birdLp.connect(this.master);
    const bs = c.createGain(); bs.gain.value = 0.35; this.birdLp.connect(bs); bs.connect(this.reverbIn);

    // ambiente: viento, agua, fuego
    const noise = c.createBuffer(1, c.sampleRate * 4, c.sampleRate), nd = noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nd.length; i++) { const w = r() * 2 - 1; b0 = 0.997 * b0 + w * 0.03; b1 = 0.985 * b1 + w * 0.09; b2 = 0.95 * b2 + w * 0.18; nd[i] = (b0 + b1 + b2 + w * 0.05) * 1.6; }
    const loop = (filters: [BiquadFilterType, number, number][], gain: number) => {
      const src = c.createBufferSource(); src.buffer = noise; src.loop = true; src.loopStart = 0; src.playbackRate.value = 0.8 + r() * 0.4;
      let node: AudioNode = src;
      for (const [type, f, q] of filters) { const bq = c.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q; node.connect(bq); node = bq; }
      const g = c.createGain(); g.gain.value = gain; node.connect(g); g.connect(this.master); src.start();
      return g;
    };
    this.windG = loop([['bandpass', 520, 0.45]], 0.05);
    this.waterG = loop([['highpass', 700, 0.5], ['lowpass', 4200, 0.5]], 0);
    this.fireG = loop([['lowpass', 520, 0.7]], 0);
    this.caveSend = c.createGain(); this.caveSend.gain.value = 0; this.caveSend.connect(this.reverbIn);

    this.breath = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    { const d = this.breath.getChannelData(0), rb = mulberry32(11); for (let i = 0; i < d.length; i++) d[i] = rb() * 2 - 1; }
    for (let k = 0; k < 16; k++) {
      const rc = mulberry32(40 + k), n = Math.floor(c.sampleRate * (0.008 + rc() * 0.025)), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (rc() * 2 - 1) * (1 - i / n) ** 2;
      this.crackles.push(b);
    }
    this.nextBar = c.currentTime + 0.6; this.nextBird = c.currentTime + 1.2;
    this.timer = window.setInterval(() => this.schedule(), 110);
  }

  // ------------------------------------------------------------ instrumentos
  /** Cuerda pulsada (Karplus-Strong). `bright` 0..1: nylon ≈ 0.25, banjo ≈ 0.95 */
  private pluckBuffer(midi: number, kind: 'nylon' | 'banjo'): AudioBuffer {
    const key = `${kind}${midi}`;
    let buf = this.ks.get(key);
    if (buf) return buf;
    const c = this.ctx!, sr = c.sampleRate, f = mtof(midi), N = Math.max(2, Math.round(sr / f));
    const dur = kind === 'nylon' ? 2.6 : 1.1, decay = kind === 'nylon' ? 0.9965 : 0.991, blend = kind === 'nylon' ? 0.5 : 0.62;
    const line = new Float32Array(N), r = mulberry32(midi * 7 + (kind === 'nylon' ? 1 : 2));
    for (let i = 0; i < N; i++) line[i] = r() * 2 - 1;
    // excitación: el nylon se suaviza (yema del dedo), el banjo queda brillante (uña/púa)
    for (let p = 0; p < (kind === 'nylon' ? 5 : 1); p++) for (let i = 0; i < N; i++) line[i] = 0.5 * (line[i] + line[(i + 1) % N]);
    // posición de pulsación: filtro peine
    const pick = Math.floor(N * (kind === 'nylon' ? 0.22 : 0.1)), ex = Float32Array.from(line);
    for (let i = 0; i < N; i++) line[i] = ex[i] - 0.6 * ex[(i + pick) % N];
    buf = c.createBuffer(1, Math.floor(sr * dur), sr);
    const out = buf.getChannelData(0);
    let k = 0, peak = 0;
    for (let i = 0; i < out.length; i++) {
      const nx = (k + 1) % N, y = line[k];
      line[k] = decay * (blend * y + (1 - blend) * line[nx]);
      out[i] = y; k = nx; if (Math.abs(y) > peak) peak = Math.abs(y);
    }
    const fade = Math.floor(sr * 0.08);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] / (peak || 1)) * Math.min(1, i / 40) * Math.min(1, (out.length - i) / fade);
    this.ks.set(key, buf);
    return buf;
  }
  private pluck(kind: 'nylon' | 'banjo', midi: number, t: number, vel: number) {
    const c = this.ctx!, src = c.createBufferSource(), g = c.createGain();
    src.buffer = this.pluckBuffer(midi, kind); g.gain.value = vel;
    src.connect(g); g.connect(kind === 'nylon' ? this.guitar : this.banjo); src.start(t);
    if (kind === 'nylon') this.stats.notes++; else this.stats.banjoNotes++;
  }
  /** Viento andino: tono + soplo filtrado, con ataque suave y vibrato. */
  private blow(inst: Wind, midi: number, t: number, dur: number, vel: number) {
    const c = this.ctx!, f = mtof(midi + (inst === 'flauta' ? 12 : 0));
    const P = { quena: { breath: 0.16, harm: 0.28, att: 0.07, vib: 5.2, vd: 0.006, type: 'triangle' as OscillatorType },
      siku: { breath: 0.42, harm: 0.12, att: 0.03, vib: 0, vd: 0, type: 'sine' as OscillatorType },
      flauta: { breath: 0.08, harm: 0.18, att: 0.1, vib: 4.6, vd: 0.004, type: 'sine' as OscillatorType } }[inst];
    const env = c.createGain(); env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + P.att); env.gain.setValueAtTime(vel * 0.85, t + Math.max(P.att, dur - 0.12));
    env.gain.linearRampToValueAtTime(0, t + dur + 0.1);
    const o1 = c.createOscillator(); o1.type = P.type; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const h = c.createGain(); h.gain.value = P.harm;
    if (P.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = P.vib; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * P.vd, t + 0.35); l.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency); l.start(t); l.stop(t + dur + 0.2); }
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(6000, f * 4);
    o1.connect(lp); o2.connect(h); h.connect(lp); lp.connect(env);
    // soplo
    const nb = c.createBufferSource();
    nb.buffer = this.breath; nb.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * (inst === 'siku' ? 1.0 : 2.0); bp.Q.value = inst === 'siku' ? 6 : 2.5;
    const bg = c.createGain(); bg.gain.setValueAtTime(P.breath * (inst === 'siku' ? 2.2 : 1), t); bg.gain.exponentialRampToValueAtTime(Math.max(0.001, P.breath), t + 0.09);
    nb.connect(bp); bp.connect(bg); bg.connect(env);
    env.connect(this.winds);
    for (const n of [o1, o2]) { n.start(t); n.stop(t + dur + 0.2); }
    nb.start(t, this.rng() * 2); nb.stop(t + dur + 0.2);
    this.stats.windNotes++;
  }

  // ------------------------------------------------------------ música
  private scheduleBar(t0: number) {
    const idx = this.bar % SONG.length, ch = CH[SONG[idx]], r = this.rng;
    const pat = idx % 4 === 3 ? [0, 1, 2, 3, 2, 1] : idx % 2 ? [0, 2, 3, 2, 1, 2] : [0, 1, 2, 1, 3, 1];
    this.pluck('nylon', ch.bass, t0, 0.62);
    pat.forEach((p, i) => {
      if (i === 0) return;
      this.pluck('nylon', ch.tones[p], t0 + i * EIGHTH + (r() - 0.5) * 0.014, 0.34 + r() * 0.16 + (i === 3 ? 0.08 : 0));
    });
    this.pluck('nylon', ch.tones[pat[0]], t0 + 0.012, 0.3);
    if (idx % 8 === 7) ch.tones.forEach((m, i) => this.pluck('nylon', m, t0 + 5 * EIGHTH + i * 0.03, 0.26)); // rasgueo suave de cierre
    // arreglos de banjo: tres notas agudas al final de algunos compases
    if (idx % 4 === 1 || (idx % 8 === 6 && r() < 0.7)) [2, 3, 2].forEach((p, i) => this.pluck('banjo', ch.tones[p] + 12, t0 + (3.5 + i * 0.5) * EIGHTH, 0.5 - i * 0.08));
    // melodía de viento: una frase de 8 compases cada 16
    const cycle = Math.floor(this.bar / 16), inPhrase = this.bar % 16 >= 8;
    if (this.bar % 16 === 8) {
      const inst = (['quena', 'siku', 'flauta'] as Wind[])[cycle % 3], notes: [number, number, number][] = [];
      let deg = 2 + Math.floor(r() * 3);
      for (let b = 0; b < 8; b++) {
        let e = 0;
        while (e < 6) {
          const d = [3, 3, 2, 1, 6][Math.floor(r() * 5)], len = Math.min(d, 6 - e);
          if (r() > 0.2) { deg = Math.max(0, Math.min(PENTA.length - 1, deg + Math.round((r() - 0.5) * 4))); notes.push([b, e, PENTA[deg] * 100 + len]); }
          e += len;
        }
      }
      this.melody = { inst, notes };
    }
    if (inPhrase && this.melody) {
      const b = (this.bar % 16) - 8;
      for (const [nb, e, packed] of this.melody.notes) {
        if (nb !== b) continue;
        const midi = Math.floor(packed / 100), len = packed % 100, inst = this.melody.inst;
        this.blow(inst, midi, t0 + e * EIGHTH, len * EIGHTH * (inst === 'siku' ? 0.7 : 0.95), inst === 'siku' ? 0.2 : 0.16);
        if (inst === 'siku' && r() < 0.5) this.blow('siku', midi - 5, t0 + e * EIGHTH, len * EIGHTH * 0.7, 0.1); // quintas paralelas
      }
    }
    // bombos de ceremonia: laten más fuerte cuanto más cerca está la invitación
    const dl = this.drumLevel;
    if (dl > 0.03) {
      this.bombo(t0, 0.9 * dl); this.bombo(t0 + 3 * EIGHTH, 0.6 * dl);
      if (dl > 0.35) { this.aro(t0 + 2 * EIGHTH, 0.5 * dl); this.aro(t0 + 5 * EIGHTH, 0.5 * dl); }
      if (dl > 0.7) { this.bombo(t0 + 4.5 * EIGHTH, 0.45 * dl); this.bombo(t0 + 5.5 * EIGHTH, 0.55 * dl); }
    }
    this.bar++; this.stats.bars++;
  }

  // ------------------------------------------------------------ aves
  private chirp(t: number, dur: number, f0: number, f1: number, gain: number, out: AudioNode, type: OscillatorType = 'sine', am = 0) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(50, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g);
    if (am) { const l = c.createOscillator(), lg = c.createGain(), ag = c.createGain(); l.frequency.value = am; lg.gain.value = 0.5; ag.gain.value = 0.5; l.connect(lg); lg.connect(ag.gain); g.connect(ag); ag.connect(out); l.start(t); l.stop(t + dur + 0.05); }
    else g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private birdCall(t: number, listener: THREE.Vector3) {
    const c = this.ctx!, r = this.rng;
    const pan = c.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 6; pan.rolloffFactor = 1.1;
    const a = r() * Math.PI * 2, d = 7 + r() * 22;
    pan.positionX.value = listener.x + Math.cos(a) * d; pan.positionY.value = listener.y + 3 + r() * 7; pan.positionZ.value = listener.z + Math.sin(a) * d;
    pan.connect(this.birdBus);
    const k = Math.floor(r() * 6), v = 0.8 + r() * 0.4;
    if (k === 0) { // benteveo: "bien-te-veo"
      this.chirp(t, 0.13, 2300 * v, 2700 * v, 0.5, pan); this.chirp(t + 0.2, 0.3, 3000 * v, 2250 * v, 0.55, pan); this.chirp(t + 0.56, 0.24, 2500 * v, 1900 * v, 0.5, pan);
    } else if (k === 1) { // hornero: trino que acelera y se frena
      let tt = t; const n = 16;
      for (let i = 0; i < n; i++) { const u = i / (n - 1), gap = 0.16 - 0.1 * Math.sin(Math.PI * u), f = 1900 + 900 * Math.sin(Math.PI * u); this.chirp(tt, 0.07, f * v, f * v * 1.25, 0.45, pan); tt += gap; }
    } else if (k === 2) { // zorzal: frases aflautadas
      let tt = t;
      for (let i = 0; i < 5; i++) { const f = (1700 + r() * 1500) * v, dd = 0.14 + r() * 0.12; this.chirp(tt, dd, f, f * (0.82 + r() * 0.4), 0.42, pan); tt += dd + 0.06 + r() * 0.1; }
    } else if (k === 3) { // chingolo: silbos claros y trino final
      this.chirp(t, 0.26, 4200 * v, 3500 * v, 0.34, pan); this.chirp(t + 0.34, 0.24, 3600 * v, 4300 * v, 0.34, pan);
      for (let i = 0; i < 8; i++) this.chirp(t + 0.68 + i * 0.055, 0.04, 5000 * v, 4500 * v, 0.28, pan);
    } else if (k === 4) { // calandria: imitaciones variadas
      let tt = t;
      for (let i = 0; i < 7; i++) { const f = (1500 + r() * 3000) * v, dd = 0.06 + r() * 0.14; this.chirp(tt, dd, f, f * (0.7 + r() * 0.7), 0.36, pan, 'sine', r() < 0.3 ? 38 : 0); tt += dd + 0.04 + r() * 0.08; }
    } else { // loro barranquero: graznido áspero
      for (let i = 0; i < 2 + Math.floor(r() * 2); i++) this.chirp(t + i * 0.26, 0.18, 1500 * v, 1050 * v, 0.2, pan, 'sawtooth', 70);
    }
    this.stats.birdCalls++;
    window.setTimeout(() => pan.disconnect(), 4500);
  }

  // ------------------------------------------------------------ planificación
  private listenerPos = new THREE.Vector3();
  private schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    // se agenda 1 s por delante; si el navegador se trabó, los compases vencidos se saltean (no suenan todos juntos)
    const now = c.currentTime, horizon = now + 1.0, r = this.rng;
    while (this.nextBar < now + 0.05) this.nextBar += 2;
    while (this.nextBar < horizon) { this.scheduleBar(this.nextBar); this.nextBar += 2; }
    if (this.nextCrackle < now) this.nextCrackle = now;
    if (this.nextBird < now - 0.5) this.nextBird = now;
    if (this.nextBird < horizon) { this.birdCall(Math.max(now, this.nextBird), this.listenerPos); this.nextBird = Math.max(now, this.nextBird) + (this.indoor || this.amb.cave ? 4 + r() * 5 : 1.1 + r() * 2.6); }
    if (this.amb.fire > 0.05 && this.nextCrackle < horizon) {
      // chisporroteo: 2/3 de la cantidad anterior, a la mitad de volumen, con altura variable y ritmo irregular
      const t = Math.max(now, this.nextCrackle), src = c.createBufferSource(), b = this.crackles[Math.floor(r() * this.crackles.length)];
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900 + r() * 2500;
      const g = c.createGain(); g.gain.value = (0.05 + r() * 0.15) * this.amb.fire;
      src.buffer = b; src.playbackRate.value = 0.75 + r() * 0.6;
      src.connect(hp); hp.connect(g); g.connect(this.master); src.start(t);
      this.stats.crackles++;
      // a veces una ráfaga de chasquidos seguidos, a veces silencios largos (promedio ~0,28 s; antes ~0,18 s)
      const q = r();
      this.nextCrackle = t + (q < 0.25 ? 0.03 + r() * 0.08 : 0.1 + r() * r() * 0.75);
    }
    if (this.amb.cave > 0.5 && this.nextDrip < horizon) {
      const t = Math.max(now, this.nextDrip);
      this.chirp(t, 0.09, 1500 + r() * 900, 700, 0.12, this.caveSend); this.chirp(t, 0.09, 1500, 700, 0.05, this.master);
      this.nextDrip = t + 0.8 + r() * 2.8;
    }
  }

  /** Bombo legüero: parche grave con caída de tono. */
  private bombo(t: number, vel: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(105, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.22);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.75);
    o.connect(g); g.connect(this.master); g.connect(this.reverbIn); o.start(t); o.stop(t + 0.8);
    this.stats.drumHits++;
  }
  /** Golpe de palo en el aro. */
  private aro(t: number, vel: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(1150, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.03);
    g.gain.setValueAtTime(vel * 0.35, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
    o.connect(g); g.connect(this.master); g.connect(this.reverbIn); o.start(t); o.stop(t + 0.09);
  }
  /** Trompetitas de victoria al tomar la invitación. */
  fanfare() {
    this.stats.fanfares++;
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + 0.05;
    const blow = (midi: number, t: number, dur: number, vel: number) => {
      const f = mtof(midi), lp = c.createBiquadFilter(), g = c.createGain();
      lp.type = 'lowpass'; lp.Q.value = 2.5; lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(3400, t + 0.05); lp.frequency.linearRampToValueAtTime(1900, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.03); g.gain.setValueAtTime(vel * 0.85, t + Math.max(0.04, dur - 0.06)); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
      for (const det of [-5, 5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + 0.1); }
      lp.connect(g); g.connect(this.master); g.connect(this.reverbIn);
    };
    // ta-ta-ta-TAAA · ta-TAAAA, a dos voces
    [[67, 0, 0.13], [72, 0.16, 0.13], [76, 0.32, 0.13], [79, 0.48, 0.5], [76, 1.06, 0.13], [79, 1.22, 1.1]].forEach(([m, d, len]) => blow(m, t0 + d, len, 0.16));
    [[64, 0.48, 0.5], [72, 1.22, 1.1], [76, 1.22, 1.1]].forEach(([m, d, len]) => blow(m, t0 + d, len, 0.1));
  }
  /** Efectos de la mazmorra. */
  sfx(name: 'key' | 'door' | 'lock' | 'chest') {
    this.stats.sfx++;
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const t = c.currentTime + 0.02;
    if (name === 'key') [[88, 0], [93, 0.07], [100, 0.14]].forEach(([m, d]) => this.chirp(t + d, 0.5, mtof(m), mtof(m), 0.12, this.master));
    else if (name === 'lock') { this.aro(t, 0.9); this.bombo(t + 0.05, 0.35); }
    else {
      // crujido de madera: diente de sierra grave que se frena, y el golpe final
      const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(), dur = name === 'door' ? 1.3 : 0.7;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(name === 'door' ? 70 : 110, t); o.frequency.linearRampToValueAtTime(name === 'door' ? 38 : 60, t + dur);
      lp.type = 'bandpass'; lp.frequency.value = 620; lp.Q.value = 3;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.08); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(lp); lp.connect(g); g.connect(this.master); g.connect(this.reverbIn); o.start(t); o.stop(t + dur + 0.05);
      this.bombo(t + dur, 0.5);
    }
  }

  /** Campanita al abrir un mensaje. */
  chime() {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const t = c.currentTime + 0.02;
    [[81, 0], [88, 0.09]].forEach(([m, d]) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = mtof(m); g.gain.setValueAtTime(0.12, t + d); g.gain.exponentialRampToValueAtTime(0.0008, t + d + 1.1); o.connect(g); g.connect(this.master); g.connect(this.reverbIn); o.start(t + d); o.stop(t + d + 1.2); });
  }

  update(dt: number, cam: THREE.PerspectiveCamera, amb: { water: number; fire: number; cave: number; drums?: number }, indoor: boolean) {
    this.amb = amb; this.drumLevel += ((amb.drums ?? 0) - this.drumLevel) * Math.min(1, dt * 2); this.indoor = indoor; this.listenerPos.copy(cam.position);
    const c = this.ctx;
    if (!c) return;
    const k = Math.min(1, dt * 3), now = c.currentTime, L = c.listener, f = cam.getWorldDirection(this.fwd);
    if (L.positionX) {
      L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { (L as any).setPosition(cam.position.x, cam.position.y, cam.position.z); (L as any).setOrientation(f.x, f.y, f.z, 0, 1, 0); }
    const muffled = indoor || amb.cave > 0.5;
    this.waterG.gain.value += (amb.water * 0.17 - this.waterG.gain.value) * k;
    this.fireG.gain.value += (amb.fire * 0.16 - this.fireG.gain.value) * k;
    this.windG.gain.value += ((muffled ? 0.012 : 0.045 + 0.02 * Math.sin(now * 0.31)) - this.windG.gain.value) * k;
    this.birdBus.gain.value += ((muffled ? 0.14 : 0.5) - this.birdBus.gain.value) * k;
    this.birdLp.frequency.value += ((muffled ? 1600 : 12000) - this.birdLp.frequency.value) * k;
    this.music.gain.value += ((this.musicOn ? (this.drumLevel > 0.1 ? 0.17 : indoor ? 0.27 : 0.34) : 0) - this.music.gain.value) * (this.musicOn ? k : 1);
  }
  /** Maullido del gato ("mi-a-u"): tono que sube y baja con filtros de vocal, desde la posición del gato. */
  meow(pos: THREE.Vector3) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const r = this.rng, t = c.currentTime + 0.02, dur = 0.5 + r() * 0.35, f0 = 480 + r() * 180;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 0.85, t); o.frequency.linearRampToValueAtTime(f0 * 1.4, t + dur * 0.35); o.frequency.linearRampToValueAtTime(f0 * 0.75, t + dur);
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 6.5; vg.gain.value = 10; vib.connect(vg); vg.connect(o.frequency);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.32, t + 0.06); env.gain.setValueAtTime(0.28, t + dur * 0.6); env.gain.linearRampToValueAtTime(0, t + dur);
    // dos formantes: "i" (agudo) → "a" → "u" (grave)
    const mix = c.createGain(); mix.gain.value = 1.4;
    for (const [a, b, e, q, g] of [[2300, 1250, 750, 7, 1], [3300, 2300, 1000, 5, 0.55]]) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
      bp.frequency.setValueAtTime(a, t); bp.frequency.linearRampToValueAtTime(b, t + dur * 0.4); bp.frequency.linearRampToValueAtTime(e, t + dur);
      const bg = c.createGain(); bg.gain.value = g; o.connect(bp); bp.connect(bg); bg.connect(mix);
    }
    const pan = c.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 2; pan.rolloffFactor = 1;
    if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z; } else (pan as any).setPosition(pos.x, pos.y, pos.z);
    mix.connect(env); env.connect(pan); pan.connect(this.master);
    const send = c.createGain(); send.gain.value = 0.25; env.connect(send); send.connect(this.reverbIn);
    o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    window.setTimeout(() => pan.disconnect(), (dur + 0.6) * 1000);
    this.stats.meows++;
  }
  setMusic(on: boolean) { this.musicOn = on; if (!on && this.music) this.music.gain.value = 0; }

  state() {
    return { context: this.ctx?.state ?? 'none', sampleRate: this.ctx?.sampleRate ?? 0, ...this.stats, drumLevel: this.drumLevel, limiter: this.limiter, musicOn: this.musicOn, musicGain: this.music?.gain.value ?? 0, birdGain: this.birdBus?.gain.value ?? 0, melody: this.melody?.inst ?? null, voices: this.ks.size };
  }
}
