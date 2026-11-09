/**
 * The signing stage: arms and hands only, as flat silhouettes drawn on a canvas from motion.ts frames (see
 * docs/DESIGN.md). Forearms rise from below the frame to each wrist. The dominant arm is light ink, the
 * other dim; two ghost frames and a dotted trail show the movement, and an accent ring marks where the sign is made.
 */
import { BASE_LOCS, LOCATIONS, type Loc } from '../asl/body';
import type { Landmarks } from '../asl/hand';
import type { Frame } from '../asl/motion';
import type { V3 } from '../asl/vec';

/** Drawing settings: proportions in body units, colors from CSS tokens. */
export const AVATAR = {
  perspective: 3.4,
  headCenter: [0, 0.86, 0] as V3,
  headRadius: [0.25, 0.31] as const,
  forearmWidth: 0.15,
  fingerWidth: 0.047,
  thumbWidth: 0.053,
  /** Forearms only: each rises from a fixed point just below the stage (body units out from the middle), widening a
   * little toward it, so the arms read as coming from below the frame. */
  forearmWiden: 1.45,
  armAnchorX: 0.85,
  /** Ghost frames: how long ago (ms) and how strong. */
  ghosts: [{ agoMs: 320, alpha: 0.14 }, { agoMs: 160, alpha: 0.28 }],
  /** The dotted trail follows the dominant palm over this window. */
  trailMs: 700,
  trailMinPx: 18,
  /** Location ring radius, in body units. */
  ringRadius: 0.09,
};

interface Colors { ink: string; dim: string; guide: string; accent: string; glow: string }

function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { ink: v('--ink', '#ecebe8'), dim: v('--ink-dim', '#3a3d45'), guide: v('--guide', '#2a2d34'), accent: v('--accent', '#6ea8fe'), glow: v('--glow', '#23262e') };
}

/** One remembered frame of the dominant hand, for ghosts and the trail. */
export interface Past { at: number; lm: Landmarks }

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
    this.S = Math.min(this.w / 2.4, this.h / 2.75);
    this.cx = this.w / 2;
    // the head guide's top sits just inside the stage
    this.cy = this.S * (AVATAR.headCenter[1] + AVATAR.headRadius[1] + 0.05) + this.h * 0.06;
  }

  /** Body space → screen. The signer faces the viewer, so their right is on the viewer's left. */
  private p(b: V3): { x: number; y: number; k: number } {
    const k = AVATAR.perspective / (AVATAR.perspective + b[2]);
    return { x: this.cx - b[0] * this.S * k, y: this.cy - (b[1] + 0.05) * this.S * k, k };
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

    this.history.push({ at: now, lm: f.right });
    const keep = Math.max(AVATAR.trailMs, ...AVATAR.ghosts.map((x) => x.agoMs)) + 100;
    while (this.history.length && now - this.history[0]!.at > keep) this.history.shift();

    // The other arm, dim, behind everything.
    this.arm(ctx, f.left, true, C.dim);
    // Ghosts of the dominant arm: drawn whole off-screen, then laid down faint so overlaps don't double up.
    const gctx = this.ghostCanvas.getContext('2d');
    if (gctx) {
      for (const gh of AVATAR.ghosts) {
        const past = ghostAt(this.history, now, gh.agoMs);
        if (!past) continue;
        gctx.clearRect(0, 0, this.w, this.h);
        this.arm(gctx, past.lm, false, C.ink);
        ctx.save();
        ctx.globalAlpha = gh.alpha;
        ctx.drawImage(this.ghostCanvas, 0, 0, this.w, this.h);
        ctx.restore();
      }
    }
    this.trail(now);
    this.ring(f);
    this.arm(ctx, f.right, false, C.ink);
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

  private arm(c: CanvasRenderingContext2D, lm: Landmarks, left: boolean, color: string): void {
    const w = this.p(lm[0]!);
    // The signer's right arm is on the viewer's left.
    const end = { x: this.cx + (left ? 1 : -1) * AVATAR.armAnchorX * this.S, y: this.h + 30 };
    const dx = end.x - w.x, dy = end.y - w.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const half = (AVATAR.forearmWidth * this.S * w.k) / 2, far = half * AVATAR.forearmWiden;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(w.x - uy * half, w.y + ux * half);
    c.lineTo(end.x - uy * far, end.y + ux * far);
    c.lineTo(end.x + uy * far, end.y - ux * far);
    c.lineTo(w.x + uy * half, w.y - ux * half);
    c.closePath();
    c.fill();
    c.beginPath();
    c.arc(w.x, w.y, half, 0, Math.PI * 2);
    c.fill();
    this.hand(c, lm, color);
  }

  /** A flat hand: one color, palm filled, fingers as rounded strokes. */
  private hand(c: CanvasRenderingContext2D, lm: Landmarks, color: string): void {
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineJoin = 'round';
    c.lineWidth = AVATAR.fingerWidth * this.S * 0.9;
    c.beginPath();
    [0, 1, 5, 9, 13, 17].forEach((i, k) => {
      const q = this.p(lm[i]!);
      if (k === 0) c.moveTo(q.x, q.y); else c.lineTo(q.x, q.y);
    });
    c.closePath();
    c.fill();
    c.stroke();
    for (const [i, ids] of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].entries()) {
      for (let k = 0; k < ids.length - 1; k++) this.limb(c, lm[ids[k]!]!, lm[ids[k + 1]!]!, i === 0 ? AVATAR.thumbWidth : AVATAR.fingerWidth, color);
    }
  }
}
