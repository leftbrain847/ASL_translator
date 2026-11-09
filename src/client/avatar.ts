/**
 * The signing stage: arms and hands only, as flat silhouettes drawn on a canvas from motion.ts frames (see
 * docs/DESIGN.md). Arms are solved with two-bone IK from shoulder to wrist; the shoulders sit either side just
 * below the head guide. The dominant arm is light ink, the other dim; two ghost frames and a dotted trail show the
 * movement, and an accent ring marks where the sign is made. The view looks down a little, so a palm held flat
 * shows as a foreshortened palm rather than an edge.
 *
 * A face appears only while ASL grammar is on it (question or topic brows, a headshake): thin lines for brows,
 * eyes and mouth inside the dashed head guide, faded in and out. The rest of the time there is just the guide.
 */
import { BASE_LOCS, FOREARM, LOCATIONS, SHOULDER, UPPER_ARM, type Loc } from '../asl/body';
import type { Landmarks } from '../asl/hand';
import type { Frame } from '../asl/motion';
import { add, cross, dot, len, norm, scale, sub, type V3 } from '../asl/vec';

/** Drawing settings: proportions in body units, colors from CSS tokens. */
export const AVATAR = {
  perspective: 3.4,
  headCenter: [0, 0.86, 0] as V3,
  headRadius: [0.25, 0.31] as const,
  /** Mirror view: the signer's right hand is drawn on the viewer's right, like following along in a mirror. */
  mirror: true,
  /** The camera looks down by this angle (radians), so depth shows: a flat palm reads as a palm. */
  viewTilt: 0.42,
  upperArmWidth: 0.17,
  forearmWidth: 0.14,
  /** Hands are drawn larger than life around the wrist, so the palm is ~40% of the forearm, as in the design. */
  handScale: 1.3,
  fingerWidth: 0.033,
  thumbWidth: 0.038,
  /** The thin background gap drawn around each finger, in px, so the fingers read as separate. */
  fingerGap: 1.6,
  /** Elbow pole: elbows hang down, a little out and back. */
  elbowPole: [0.3, -1.2, 0.5] as V3,
  /** A hand that isn't up in signing space is drawn as a soft fist (body units). */
  fist: { length: 0.22, width: 0.18, radius: 0.07 },
  /** Ghost frames: how long ago (ms) and how strong. */
  ghosts: [{ agoMs: 320, alpha: 0.14 }, { agoMs: 160, alpha: 0.28 }],
  /** The dotted trail follows the dominant palm over this window. */
  trailMs: 700,
  trailMinPx: 18,
  /** Location ring radius, in body units. */
  ringRadius: 0.09,
  /** The grammar face: fade time, line strength and how far a headshake turns the features. */
  face: { fadeMs: 160, alpha: 0.7, line: 1.6, turn: 0.8 },
};

/** Pure: whether the face should show: brows raised or furrowed, or a headshake on. */
export function faceShown(face: Frame['face']): boolean {
  return Math.abs(face.brows) > 0.01 || face.shake;
}

/** Pure: the face's fade level after dtMs, easing toward shown (1) or hidden (0). */
export function faceStep(level: number, shown: boolean, dtMs: number): number {
  const k = Math.min(1, Math.max(0, dtMs) / AVATAR.face.fadeMs);
  return level + ((shown ? 1 : 0) - level) * k;
}

interface Colors { ink: string; dim: string; guide: string; accent: string; glow: string; bg: string }

function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { ink: v('--ink', '#ecebe8'), dim: v('--ink-dim', '#3a3d45'), guide: v('--guide', '#2a2d34'), accent: v('--accent', '#6ea8fe'), glow: v('--glow', '#23262e'), bg: v('--bg', '#0e0f12') };
}

/** Elbow position for a shoulder and wrist (2-bone IK; the pole sets which way the elbow bends). */
export function elbow(shoulder: V3, wrist: V3, left: boolean): V3 {
  const a = UPPER_ARM, b = FOREARM;
  const d0 = sub(wrist, shoulder);
  const d = Math.min(len(d0), a + b - 1e-3);
  const dir = norm(d0);
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const pole: V3 = [AVATAR.elbowPole[0] * (left ? -1 : 1), AVATAR.elbowPole[1], AVATAR.elbowPole[2]];
  let pp = sub(pole, scale(dir, dot(pole, dir)));
  if (len(pp) < 1e-6) pp = cross(dir, [0, 0, 1]);
  return add(add(shoulder, scale(dir, along)), scale(norm(pp), h));
}

/** Pure: a hand's landmarks scaled about its wrist (the drawn hand is larger than life). */
export function scaleHand(lm: Landmarks, k: number): Landmarks {
  const w = lm[0]!;
  return lm.map((q) => add(w, scale(sub(q, w), k))) as unknown as Landmarks;
}

/** One remembered frame of the dominant hand, for ghosts and the trail. */
export interface Past { at: number; lm: Landmarks; up: boolean }

/** Pure: the remembered frame closest to `agoMs` before `now`, if the history reaches back that far. */
export function ghostAt(history: readonly Past[], now: number, agoMs: number): Past | null {
  const want = now - agoMs;
  if (!history.length || history[0]!.at > want) return null;
  let best = history[0]!;
  for (const h of history) if (Math.abs(h.at - want) < Math.abs(best.at - want)) best = h;
  return best;
}

/** Pure: the trail, oldest first: the dominant palm centre over the last `windowMs`. */
export function trail(history: readonly Past[], now: number, windowMs: number): V3[] {
  return history.filter((h) => now - h.at <= windowMs).map((h) => h.lm[9]!);
}

export class Avatar {
  private ctx: CanvasRenderingContext2D;
  private colors: Colors;
  private w = 0;
  private h = 0;
  private S = 1;
  private cx = 0;
  private cy = 0;
  private history: Past[] = [];
  private marker: Loc | null = null;
  private ghostCanvas: HTMLCanvasElement;
  private faceLevel = 0;
  private faceBrows = 0;
  private faceFrown = false;
  private lastDraw = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d not available');
    this.ctx = ctx;
    this.ghostCanvas = document.createElement('canvas');
    this.colors = readColors(canvas);
    this.resize();
    // The canvas has no size until it's laid out (and changes with the window): follow its box.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(canvas);
  }

  /** Re-read theme colors. */
  retheme(): void { this.colors = readColors(this.canvas); }

  /** Where the current sign is made (ringed in the accent color), or null between signs. */
  mark(loc: Loc | null): void { this.marker = loc; }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    for (const c of [this.canvas, this.ghostCanvas]) { c.width = Math.round(this.w * dpr); c.height = Math.round(this.h * dpr); }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ghostCanvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Frame the head guide and the signing space.
    this.S = Math.min(this.w / 2.7, this.h / 2.45);
    this.cx = this.w / 2;
    // the head guide's top sits just inside the stage
    this.cy = this.S * (AVATAR.headCenter[1] * Math.cos(AVATAR.viewTilt) + AVATAR.headRadius[1] + 0.05) + this.h * 0.05;
  }

  /** Body space → screen. The signer faces the viewer, so their right is on the viewer's left. */
  private p(b: V3): { x: number; y: number; k: number } {
    const c = Math.cos(AVATAR.viewTilt), s = Math.sin(AVATAR.viewTilt);
    const y = b[1] * c + b[2] * s, z = -b[1] * s + b[2] * c;   // looking down: nearer points sit lower
    const k = AVATAR.perspective / (AVATAR.perspective + z);
    return { x: this.cx + (AVATAR.mirror ? 1 : -1) * b[0] * this.S * k, y: this.cy - (y + 0.05) * this.S * k, k };
  }

  draw(f: Frame, now = performance.now()): void {
    const { ctx, colors: C } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const head = this.p(AVATAR.headCenter);
    const g = ctx.createRadialGradient(this.cx, head.y + this.S * 0.4, this.S * 0.05, this.cx, head.y + this.S * 0.4, this.S * 1.7);
    g.addColorStop(0, C.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // Faint dashed head: the only location guide.
    ctx.save();
    ctx.strokeStyle = C.guide;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.ellipse(head.x, head.y, AVATAR.headRadius[0] * this.S, AVATAR.headRadius[1] * this.S, f.face.tilt, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // The face, only while grammar is on it; it keeps its last expression while it fades out.
    const shown = faceShown(f.face);
    if (shown) { this.faceBrows = f.face.brows; this.faceFrown = f.face.shake; }
    this.faceLevel = faceStep(this.faceLevel, shown, this.lastDraw ? now - this.lastDraw : 0);
    this.lastDraw = now;
    if (this.faceLevel > 0.02) this.face(head, f.face);

    this.history.push({ at: now, lm: f.right, up: f.rightUp });
    const keep = Math.max(AVATAR.trailMs, ...AVATAR.ghosts.map((x) => x.agoMs)) + 100;
    while (this.history.length && now - this.history[0]!.at > keep) this.history.shift();

    // The other arm, dim, behind everything.
    this.arm(ctx, f.left, true, C.dim, f.leftUp);
    // Ghosts of the dominant arm: drawn whole off-screen, then laid down faint so overlaps don't double up.
    const gctx = this.ghostCanvas.getContext('2d');
    if (gctx) {
      for (const gh of AVATAR.ghosts) {
        const past = ghostAt(this.history, now, gh.agoMs);
        if (!past) continue;
        gctx.clearRect(0, 0, this.w, this.h);
        this.arm(gctx, past.lm, false, C.ink, past.up);
        ctx.save();
        ctx.globalAlpha = gh.alpha;
        ctx.drawImage(this.ghostCanvas, 0, 0, this.w, this.h);
        ctx.restore();
      }
    }
    this.trail(now);
    this.ring(f);
    this.arm(ctx, f.right, false, C.ink, f.rightUp);
  }

  /** Brows, eyes and mouth as thin lines inside the head guide. */
  private face(head: { x: number; y: number }, fc: Frame['face']): void {
    const { ctx, colors: C } = this;
    const rx = AVATAR.headRadius[0] * this.S, ry = AVATAR.headRadius[1] * this.S;
    const b = this.faceBrows;
    ctx.save();
    ctx.translate(head.x + fc.yaw * rx * AVATAR.face.turn * (AVATAR.mirror ? -1 : 1), head.y);
    ctx.rotate(fc.tilt);
    ctx.globalAlpha = this.faceLevel * AVATAR.face.alpha;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = AVATAR.face.line;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const side of [-1, 1]) {
      // raised brows sit higher and arch; furrowed ones drop and slope down toward the middle
      const y = -0.3 * ry - b * 0.09 * ry;
      const inner = y + (b < 0 ? -b * 0.08 * ry : 0);
      const x0 = side * 0.14 * rx, x1 = side * 0.56 * rx;
      ctx.moveTo(x0, inner);
      ctx.quadraticCurveTo((x0 + x1) / 2, y - 0.05 * ry * (1 + Math.max(0, b)), x1, y + 0.02 * ry);
      // eyes: short strokes, narrower when furrowed
      const ew = (b < 0 ? 0.12 : 0.16) * rx;
      ctx.moveTo(side * 0.35 * rx - ew / 2, -0.1 * ry);
      ctx.lineTo(side * 0.35 * rx + ew / 2, -0.1 * ry);
    }
    // mouth: flat, or turned down with a headshake
    const my = 0.42 * ry, mw = 0.2 * rx;
    ctx.moveTo(-mw, my + (this.faceFrown ? 0.03 * ry : 0));
    ctx.quadraticCurveTo(0, my - (this.faceFrown ? 0.05 * ry : 0), mw, my + (this.faceFrown ? 0.03 * ry : 0));
    ctx.stroke();
    ctx.restore();
  }

  private trail(now: number): void {
    const { ctx, colors: C } = this;
    const pts = trail(this.history, now, AVATAR.trailMs).map((b) => this.p(b));
    if (pts.length < 2) return;
    const a = pts[0]!, z = pts[pts.length - 1]!;
    if (Math.hypot(z.x - a.x, z.y - a.y) < AVATAR.trailMinPx) return;
    ctx.save();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([1, 7]);
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.restore();
  }

  private ring(f: Frame): void {
    if (!this.marker) return;
    const { ctx, colors: C } = this;
    const at: V3 = BASE_LOCS.has(this.marker) ? f.left[9]! : LOCATIONS[this.marker];
    const q = this.p(at);
    ctx.save();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(q.x, q.y, AVATAR.ringRadius * this.S * q.k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private limb(c: CanvasRenderingContext2D, a: V3, b: V3, width: number, color: string | CanvasGradient, cap: CanvasLineCap = 'round'): void {
    const p = this.p(a), q = this.p(b);
    c.strokeStyle = color;
    c.lineWidth = width * this.S * (p.k + q.k) / 2;
    c.lineCap = cap;
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(q.x, q.y);
    c.stroke();
  }

  private arm(c: CanvasRenderingContext2D, lm: Landmarks, left: boolean, color: string, up: boolean): void {
    const sh: V3 = left ? [-SHOULDER[0], SHOULDER[1], SHOULDER[2]] : SHOULDER;
    const wrist = lm[0]!;
    const el = elbow(sh, wrist, left);
    this.limb(c, sh, el, AVATAR.upperArmWidth, color);
    this.limb(c, el, wrist, AVATAR.forearmWidth, color);
    if (up) this.hand(c, scaleHand(lm, AVATAR.handScale), color);
    else this.fist(c, el, wrist, color);
  }

  /** A relaxed hand: a soft fist continuing the forearm, with a thumb nub. */
  private fist(c: CanvasRenderingContext2D, el: V3, wrist: V3, color: string): void {
    const e = this.p(el), w = this.p(wrist);
    const ang = Math.atan2(w.y - e.y, w.x - e.x);
    const F = AVATAR.fist, k = this.S * w.k;
    c.save();
    c.translate(w.x, w.y);
    c.rotate(ang);
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(-F.length * 0.15 * k, (-F.width / 2) * k, F.length * k, F.width * k, F.radius * k);
    c.fill();
    c.beginPath();
    c.roundRect(F.length * 0.1 * k, (-F.width / 2 - 0.035) * k, F.length * 0.55 * k, 0.06 * k, 0.03 * k);
    c.fill();
    c.restore();
  }

  /** A flat hand: one color, palm filled, fingers as rounded strokes with a thin gap around each. */
  private hand(c: CanvasRenderingContext2D, lm: Landmarks, color: string): void {
    const k = AVATAR.handScale;
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineJoin = 'round';
    c.lineWidth = AVATAR.fingerWidth * k * this.S * 0.9;
    c.beginPath();
    [0, 1, 5, 9, 13, 17].forEach((i, n) => {
      const q = this.p(lm[i]!);
      if (n === 0) c.moveTo(q.x, q.y); else c.lineTo(q.x, q.y);
    });
    c.closePath();
    c.fill();
    c.stroke();
    // Fingers, farthest first; each gets a background-coloured outline so neighbours stay apart.
    const chains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
    const order = chains.map((ids, i) => ({ ids, thumb: i === 0, z: ids.slice(1).reduce((s, j) => s + lm[j]![2], 0) }))
      .sort((a, b) => b.z - a.z);
    for (const f of order) {
      const wdt = (f.thumb ? AVATAR.thumbWidth : AVATAR.fingerWidth) * k;
      const path = f.ids.map((j) => this.p(lm[j]!));
      const stroke = (style: string, extra: number) => {
        c.strokeStyle = style;
        c.lineWidth = wdt * this.S * path[0]!.k + extra;
        c.lineCap = 'round';
        c.beginPath();
        path.forEach((q, n) => (n ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
        c.stroke();
      };
      // the outline starts past the knuckle, so it parts the fingers without cutting into the palm
      const knuckle = path.shift()!;
      path.unshift({ x: (knuckle.x + path[0]!.x) / 2, y: (knuckle.y + path[0]!.y) / 2, k: knuckle.k });
      stroke(this.colors.bg, AVATAR.fingerGap * 2);
      path[0] = knuckle;
      stroke(color, 0);
    }
  }
}
