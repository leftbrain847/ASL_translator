/**
 * The signing avatar: a calm, stylized figure drawn on a canvas from motion.ts frames. Arms are solved with
 * two-bone IK from shoulder to wrist; hands are drawn bone by bone, back to front, so handshapes read clearly.
 */
import { FOREARM, SHOULDER, UPPER_ARM } from '../asl/body';
import type { Landmarks } from '../asl/hand';
import type { Frame } from '../asl/motion';
import { add, cross, dot, len, norm, scale, sub, type V3 } from '../asl/vec';

/** Drawing settings: proportions in body units, colors from CSS tokens. */
export const AVATAR = {
  perspective: 3.4,
  headCenter: [0, 0.86, 0] as V3,
  headRadius: [0.25, 0.31] as const,
  upperArmWidth: 0.2,
  forearmWidth: 0.15,
  fingerWidth: 0.047,
  thumbWidth: 0.053,
  elbowPole: [0.9, -1.1, 0.15] as V3,
};

interface Colors { body: string; bodyEdge: string; skin: string; skinShade: string; face: string; hair: string; accent: string; glow: string }

function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    body: v('--avatar-body', '#273445'), bodyEdge: v('--avatar-edge', '#3a4b61'), skin: v('--avatar-skin', '#e9c3a6'),
    skinShade: v('--avatar-skin-shade', '#c99d80'), face: v('--avatar-face', '#1a222d'), hair: v('--avatar-hair', '#3b4250'), accent: v('--accent', '#7cc4ff'), glow: v('--avatar-glow', 'rgba(124,196,255,0.18)'),
  };
}

/** Elbow position for a shoulder and wrist (2-bone IK with a pole pointing down, out and back). */
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

export class Avatar {
  private ctx: CanvasRenderingContext2D;
  private colors: Colors;
  private w = 0;
  private h = 0;
  private S = 1;
  private cx = 0;
  private cy = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d not available');
    this.ctx = ctx;
    this.colors = readColors(canvas);
    this.resize();
    // The canvas has no size until it's laid out (and changes with the window): follow its box.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(canvas);
  }

  /** Re-read theme colors (after a light/dark change). */
  retheme(): void { this.colors = readColors(this.canvas); }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Frame the head, shoulders and signing space.
    this.S = Math.min(this.w / 2.5, this.h / 2.75);
    this.cx = this.w / 2;
    this.cy = this.h * 0.5;
  }

  /** Body space → screen. The signer faces the viewer, so their right is on the viewer's left. */
  private p(b: V3): { x: number; y: number; k: number } {
    const k = AVATAR.perspective / (AVATAR.perspective + b[2]);
    return { x: this.cx - b[0] * this.S * k, y: this.cy - (b[1] + 0.05) * this.S * k, k };
  }

  draw(f: Frame): void {
    const { ctx, colors: C } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    // Soft spotlight behind the figure.
    const head = this.p(AVATAR.headCenter);
    const g = ctx.createRadialGradient(head.x, head.y + this.S * 0.6, this.S * 0.1, head.x, head.y + this.S * 0.6, this.S * 1.6);
    g.addColorStop(0, C.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    this.torso();
    // Arms and hands, farthest first.
    const arms = [
      { left: false, lm: f.right },
      { left: true, lm: f.left },
    ].map((a) => ({ ...a, depth: a.lm[9]![2] }));
    const behind = arms.filter((a) => a.depth > -0.12).sort((a, b) => b.depth - a.depth);
    const front = arms.filter((a) => a.depth <= -0.12).sort((a, b) => b.depth - a.depth);
    for (const a of behind) this.arm(a.lm, a.left);
    this.head(f.face);
    for (const a of front) this.arm(a.lm, a.left);
  }

  private torso(): void {
    const { ctx, colors: C } = this;
    const pt = (x: number, y: number, z = 0) => this.p([x, y, z]);
    const n1 = pt(-0.14, 0.3), n2 = pt(0.14, 0.3);
    const sL = pt(-0.56, 0.1), sR = pt(0.56, 0.1);
    const wL = pt(-0.5, -1.3), wR = pt(0.5, -1.3);
    ctx.beginPath();
    ctx.moveTo(n1.x, n1.y);
    ctx.quadraticCurveTo(sL.x * 0.6 + n1.x * 0.4, pt(0, 0.2).y, sL.x, sL.y + this.S * 0.12);
    ctx.lineTo(wL.x, wL.y);
    ctx.lineTo(wR.x, wR.y);
    ctx.lineTo(sR.x, sR.y + this.S * 0.12);
    ctx.quadraticCurveTo(sR.x * 0.6 + n2.x * 0.4, pt(0, 0.2).y, n2.x, n2.y);
    ctx.quadraticCurveTo((n1.x + n2.x) / 2, pt(0, 0.22).y, n1.x, n1.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, n1.y, 0, wL.y);
    g.addColorStop(0, C.bodyEdge);
    g.addColorStop(0.35, C.body);
    g.addColorStop(1, C.body);
    ctx.fillStyle = g;
    ctx.fill();
    // Neck: from the collar up under the chin.
    const nk = pt(0, 0.62), nb = pt(0, 0.28);
    const half = Math.abs(n2.x - n1.x) * 0.36;
    const ng = ctx.createLinearGradient(0, nk.y, 0, nb.y);
    ng.addColorStop(0, C.skinShade);
    ng.addColorStop(1, C.skin);
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.moveTo(nk.x - half, nk.y);
    ctx.lineTo(nk.x + half, nk.y);
    ctx.lineTo(nb.x + half * 1.1, nb.y);
    ctx.quadraticCurveTo(nb.x, nb.y + this.S * 0.06, nb.x - half * 1.1, nb.y);
    ctx.closePath();
    ctx.fill();
  }

  private head(face: Frame['face']): void {
    const { ctx, colors: C } = this;
    const c = this.p(AVATAR.headCenter);
    const rx = AVATAR.headRadius[0] * this.S, ry = AVATAR.headRadius[1] * this.S;
    const yaw = face.yaw;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(face.tilt);
    ctx.fillStyle = C.skin;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * (1 - Math.abs(yaw) * 0.12), ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hair cap.
    ctx.fillStyle = C.hair;
    ctx.beginPath();
    ctx.ellipse(0, -ry * 0.35, rx * 1.03, ry * 0.72, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    const fx = -yaw * rx * 0.55;      // features slide as the head turns
    ctx.fillStyle = C.face;
    // Eyes.
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(fx + s * rx * 0.38, ry * 0.02, rx * 0.075, ry * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Brows carry grammar: raised for yes/no questions, drawn together and down for WH-questions.
    ctx.strokeStyle = C.face;
    ctx.lineWidth = Math.max(2, this.S * 0.022);
    ctx.lineCap = 'round';
    const lift = face.brows * ry * 0.09;
    for (const s of [-1, 1]) {
      const inner = fx + s * rx * 0.2, outer = fx + s * rx * 0.56;
      const furrow = face.brows < 0 ? -face.brows * ry * 0.06 : 0;
      ctx.beginPath();
      ctx.moveTo(inner, -ry * 0.25 - lift + furrow);
      ctx.quadraticCurveTo((inner + outer) / 2, -ry * 0.29 - lift + furrow * 0.4, outer, -ry * 0.23 - lift);
      ctx.stroke();
    }
    // Mouth.
    ctx.lineWidth = Math.max(1.5, this.S * 0.016);
    ctx.beginPath();
    ctx.moveTo(fx - rx * 0.18, ry * 0.45);
    ctx.quadraticCurveTo(fx, ry * (0.5 - face.brows * 0.02), fx + rx * 0.18, ry * 0.45);
    ctx.stroke();
    ctx.restore();
  }

  private limb(a: V3, b: V3, width: number, color: string): void {
    const { ctx } = this;
    const p = this.p(a), q = this.p(b);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * this.S * (p.k + q.k) / 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }

  private arm(lm: Landmarks, left: boolean): void {
    const C = this.colors;
    const sh: V3 = left ? [-SHOULDER[0], SHOULDER[1], SHOULDER[2]] : SHOULDER;
    const wrist = lm[0]!;
    const el = elbow(sh, wrist, left);
    this.limb(sh, el, AVATAR.upperArmWidth, C.body);
    this.limb(el, wrist, AVATAR.forearmWidth, C.bodyEdge);
    this.hand(lm);
  }

  private hand(lm: Landmarks): void {
    const { ctx, colors: C } = this;
    // Palm: wrist, thumb base, index knuckle, pinky knuckle.
    const palmIds = [0, 1, 5, 9, 13, 17];
    const palmZ = palmIds.reduce((s, i) => s + lm[i]![2], 0) / palmIds.length;
    const fingers = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
    const depth = (ids: number[]) => ids.reduce((s, i) => s + lm[i]![2], 0) / ids.length;
    const drawFinger = (ids: number[], thumb: boolean) => {
      for (let k = 0; k < ids.length - 1; k++) {
        this.limb(lm[ids[k]!]!, lm[ids[k + 1]!]!, thumb ? AVATAR.thumbWidth : AVATAR.fingerWidth, k === ids.length - 2 ? C.skin : C.skin);
      }
    };
    const sorted = fingers.map((ids, i) => ({ ids, thumb: i === 0, z: depth(ids.slice(1)) })).sort((a, b) => b.z - a.z);
    for (const f of sorted) if (f.z > palmZ) drawFinger(f.ids, f.thumb);
    ctx.fillStyle = C.skinShade;
    ctx.strokeStyle = C.skinShade;
    ctx.lineJoin = 'round';
    ctx.lineWidth = AVATAR.fingerWidth * this.S * 0.9;
    ctx.beginPath();
    [0, 1, 5, 9, 13, 17].forEach((i, k) => {
      const q = this.p(lm[i]!);
      if (k === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const f of sorted) if (f.z <= palmZ) drawFinger(f.ids, f.thumb);
  }
}
