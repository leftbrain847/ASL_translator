/**
 * Turns signs into hand poses over time. The avatar draws these frames; the recognizer's self-test feeds the
 * same frames through a fake camera, so both directions share one definition of each sign.
 */
import { BASE_LOCS, dirFor, locFor, REST } from './body';
import { blendLocal, contactLocal, defaultContact, HANDSHAPES, localHand, placeHand, wristFor, type Handshape, type Landmarks, type Orient, type ShapeName } from './hand';
import type { BaseSpec, Face, HandSpec, Mark, SignDef } from './sign';
import { add, cross, lerp, norm, orthoTo, rotate, scale, slerp, smooth, sub, type V3 } from './vec';

/** Timing and motion sizes, in seconds and body units. */
export const MOTION = {
  signBase: 0.55,
  perRep: 0.28,
  maxSign: 1.5,
  hold: 0.7,
  transition: 0.26,
  fromRest: 0.4,
  toRest: 0.5,
  tapSize: 0.07,
  shakeSize: 0.06,
  arcSize: 0.12,
  circleSize: 0.09,
  nodDeg: 28,
  wiggleDeg: 22,
  touchGap: 0.025,
  /** Reduplication: share of each repetition spent moving back to the start, and the offsets between repetitions. */
  redupReturn: 0.3,
  redupStep: 0.12,
  redupCircle: 0.06,
  redupTime: 0.75,
  /** Facial grammar starts a little before its first sign and lets go a little after its last. */
  markLead: 0.12,
  markTail: 0.1,
};

export interface HandState { local: Landmarks; orient: Orient; wrist: V3 }

const LOCAL_CACHE = new Map<ShapeName, Landmarks>();
const local = (s: ShapeName): Landmarks => {
  let l = LOCAL_CACHE.get(s);
  if (!l) LOCAL_CACHE.set(s, (l = localHand(HANDSHAPES[s])));
  return l;
};

const orientOf = (palm: HandSpec['palm'], fingers: HandSpec['fingers'], left: boolean): Orient => {
  const n = dirFor(palm, left);
  return { n, f: orthoTo(dirFor(fingers, left), n) };
};

/** The relaxed hand at rest by the hips. */
export function restState(left: boolean): HandState {
  const o: Orient = { f: [0, -1, 0.1], n: left ? [1, 0, 0] : [-1, 0, 0] };
  return { local: local('OB'), orient: { f: norm(o.f), n: orthoTo(o.n, norm(o.f)) }, wrist: left ? REST.left.wrist : REST.right.wrist };
}

const DEFAULT_BASE: BaseSpec = { shape: 'B', palm: 'up', fingers: 'fwd+in', loc: 'neutral', contact: 'palm' };

function baseState(spec: BaseSpec): HandState {
  const l = local(spec.shape);
  const o = orientOf(spec.palm, spec.fingers, true);
  const target = add(locFor(spec.loc, true), [0.14, 0.02, 0]);    // the base hand sits a little toward the middle
  return { local: l, orient: o, wrist: wristFor(l, o, spec.contact ?? 'palm', target, true) };
}

/** Body-space point on the base hand for a base location. */
function basePoint(loc: HandSpec['loc'], base: HandState): V3 {
  const lm = placeHand(base.local, base.orient, base.wrist, true);
  const P = (c: Parameters<typeof contactLocal>[1]) => placeHand([contactLocal(base.local, c)], base.orient, base.wrist, true)[0]!;
  const n = base.orient.n;
  switch (loc) {
    case 'basePalm': return add(P('palm'), scale(n, MOTION.touchGap));
    case 'baseBack': return add(P('back'), scale(n, -MOTION.touchGap));
    case 'baseTip': return add(lm[8]!, scale(base.orient.f, MOTION.touchGap));
    case 'baseWrist': return add(lm[0]!, scale(n, -0.06));
    default: return add(P('palm'), scale(n, 0.14));
  }
}

const tri = (x: number): number => 1 - Math.abs(1 - 2 * (x - Math.floor(x)));   // 0→1→0 per unit

/**
 * Pose of both hands at phase u ∈ [0, 1] of a sign. A missing hand stays at rest. A reduplicated sign makes
 * its movement n times, returning to the start between repetitions, each repetition offset by its kind: along
 * a line (plural), around a small circle (continuous) or a little forward (habitual).
 */
export function evaluate(sign: SignDef, u: number): { right: HandState; left: HandState | null } {
  if (!sign.redup || sign.redup.n < 2) return evaluateOnce(sign, u);
  const { n, kind } = sign.redup;
  const plain: SignDef = { ...sign, redup: undefined };
  const x = Math.min(n - 1e-9, Math.max(0, u) * n);
  const i = Math.floor(x), ph = x - i;
  const offset = (j: number): V3 => {
    if (kind === 'plural') return [MOTION.redupStep * (j - (n - 1) / 2), 0, 0];
    if (kind === 'continuous') { const a = (2 * Math.PI * j) / n; return [MOTION.redupCircle * Math.sin(a), MOTION.redupCircle * (Math.cos(a) - 1), 0]; }
    return [0, 0, -0.04 * j];
  };
  const shift = (st: { right: HandState; left: HandState | null }, d: V3, both: boolean) => ({
    right: { ...st.right, wrist: add(st.right.wrist, d) },
    left: st.left && both ? { ...st.left, wrist: add(st.left.wrist, d) } : st.left,
  });
  const both = sign.two === 'mirror' || sign.two === 'alternate';
  const r = MOTION.redupReturn;
  if (ph <= 1 - r || i === n - 1) return shift(evaluateOnce(plain, Math.min(1, ph / (1 - r))), offset(i), both);
  // the return stroke: from this repetition's end to the next one's start
  const a = shift(evaluateOnce(plain, 1), offset(i), both), b = shift(evaluateOnce(plain, 0), offset(i + 1), both);
  const k = (ph - (1 - r)) / r;
  return { right: blendState(a.right, b.right, k), left: a.left && b.left ? blendState(a.left, b.left, k) : a.left };
}

function evaluateOnce(sign: SignDef, u: number): { right: HandState; left: HandState | null } {
  const base = sign.two === 'base' ? baseState({ ...DEFAULT_BASE, ...sign.base }) : null;
  const right = evalHand(sign, u, false, base);
  let left: HandState | null = null;
  if (sign.two === 'mirror') left = evalHand(sign, u, true, null);
  else if (sign.two === 'alternate') {
    const reps = sign.dom.reps ?? 1;
    const p = sign.dom.path ?? 'line';
    const lu = p === 'line' || p === 'arc' ? 1 - u : (u + 0.5 / reps) % 1;
    left = evalHand(sign, lu, true, null);
  } else if (base) {
    left = base;
    if (sign.base?.follow) {
      const start = evalHand(sign, 0, false, base).wrist;
      left = { ...base, wrist: add(base.wrist, sub(right.wrist, start)) };
    }
  }
  return { right, left };
}

function evalHand(sign: SignDef, u: number, left: boolean, base: HandState | null): HandState {
  const d = sign.dom;
  const reps = d.reps ?? 1;
  const path = d.path ?? (d.to ? 'line' : 'hold');
  const contact0 = d.contact ?? defaultContact(d.shape);
  const contact1 = d.to?.contact ?? contact0;
  const where = (loc: HandSpec['loc']): V3 => (BASE_LOCS.has(loc) && base ? basePoint(loc, base) : locFor(loc, left));
  const P0 = where(d.loc);
  const P1 = d.to?.loc ? where(d.to.loc) : d.to?.move ? add(P0, scale(dirFor(d.to.move, left), d.to.dist ?? 0.25)) : P0;
  const o0 = orientOf(d.palm, d.fingers, left);
  const o1 = orientOf(d.to?.palm ?? d.palm, d.to?.fingers ?? d.fingers, left);
  const s0 = local(d.shape);
  const s1 = local(d.to?.shape ?? d.shape);
  const axis = d.axis ? dirFor(d.axis, left) : null;

  let p: V3 = P0;
  let k = smooth(u);               // progress for shape and orientation change
  let o: Orient = { f: slerp(o0.f, o1.f, k), n: slerp(o0.n, o1.n, k) };
  let shape: Landmarks = blendLocal(s0, s1, k);
  switch (path) {
    case 'hold': break;
    case 'line':
      p = lerp(P0, P1, reps > 1 ? tri(u * reps) : smooth(u));
      break;
    case 'brush': {
      const ph = (u * reps) % 1;
      p = lerp(P0, P1, smooth(Math.min(1, ph * 1.4)));
      break;
    }
    case 'arc': {
      const bulge = axis ?? dirFor('up', left);
      p = add(lerp(P0, P1, smooth(u)), scale(bulge, (d.size ?? MOTION.arcSize) * Math.sin(Math.PI * u)));
      break;
    }
    case 'circle': {
      const nrm = axis ?? dirFor('back', left);
      const e1 = norm(Math.abs(nrm[1]) > 0.9 ? cross(nrm, [1, 0, 0]) : cross(nrm, [0, 1, 0]));
      const e2 = cross(nrm, e1);
      const r = d.size ?? MOTION.circleSize;
      const a = 2 * Math.PI * reps * u;
      const c = sub(lerp(P0, P1, u), scale(e1, r));
      p = add(c, add(scale(e1, r * Math.cos(a)), scale(e2, r * Math.sin(a) * (left ? -1 : 1))));
      break;
    }
    case 'tap': {
      const away = axis ?? dirFor('fwd', left);
      p = add(lerp(P0, P1, u), scale(away, (d.size ?? MOTION.tapSize) * Math.sin(Math.PI * ((u * reps) % 1))));
      break;
    }
    case 'shake': {
      const ax = axis ?? dirFor('out', left);
      p = add(lerp(P0, P1, smooth(u)), scale(ax, (d.size ?? MOTION.shakeSize) * Math.sin(2 * Math.PI * reps * u)));
      break;
    }
    case 'nod': {
      const t = cross(o.f, o.n);
      const a = (MOTION.nodDeg * Math.PI / 180) * (1 - Math.cos(2 * Math.PI * reps * u)) / 2;
      o = { f: rotate(o.f, t, a), n: rotate(o.n, t, a) };
      break;
    }
    case 'wiggle':
    case 'wave': {
      const hs = HANDSHAPES[d.shape] as Handshape;
      const amp = path === 'wave' ? 55 : MOTION.wiggleDeg;
      const fingers = hs.fingers.map((f, i) => {
        const ph = path === 'wave' ? 0 : i * 0.9;
        const w = (1 - Math.cos(2 * Math.PI * reps * u + ph)) / 2;
        return [f[0] + amp * w, f[1] + (path === 'wave' ? 0 : amp * 0.6 * w), f[2]] as const;
      });
      shape = localHand({ fingers: fingers as unknown as Handshape['fingers'], thumb: hs.thumb });
      p = lerp(P0, P1, smooth(u));
      break;
    }
  }
  const contactPt = contactLocal(shape, k < 0.5 ? contact0 : contact1);
  const c = placeHand([contactPt], o, [0, 0, 0], left)[0]!;
  return { local: shape, orient: o, wrist: sub(p, c) };
}

export function signDuration(sign: SignDef): number {
  if (sign.redup && sign.redup.n > 1) return signDuration({ ...sign, redup: undefined }) * (1 + (sign.redup.n - 1) * MOTION.redupTime);
  const d = sign.dom;
  if ((d.path ?? (d.to ? 'line' : 'hold')) === 'hold') return MOTION.hold;
  return Math.min(MOTION.maxSign, MOTION.signBase + MOTION.perRep * (d.reps ?? 1));
}

// ---------------------------------------------------------------- sentences

/** `hold` is when the end pose is let go: equal to `end` unless the timeline pauses after each sign. */
export interface TimedSign { sign: SignDef; start: number; end: number; hold: number; index: number }
/** A facial-grammar span placed in time. */
export interface TimedMark { from: number; to: number; brows: number }
export interface Timeline { signs: TimedSign[]; total: number; face: Face; negateFrom: number; negateTo: number; marks: TimedMark[] }

export interface Frame {
  right: Landmarks;
  left: Landmarks;
  /** Index of the sign being made (or the next one, during a transition); -1 at rest. */
  active: number;
  face: { brows: number; yaw: number; tilt: number };
  /** Whether each hand is up in signing space (for the recognizer's self-test). */
  rightUp: boolean;
  leftUp: boolean;
}

export function timeline(signs: SignDef[], face: Face = { brows: 0, headshake: false }, negated: number[] = [], gap = 0, marks: readonly Mark[] = []): Timeline {
  let t = MOTION.fromRest;
  const out: TimedSign[] = [];
  signs.forEach((sign, index) => {
    if (index > 0) t += MOTION.transition;
    const dur = signDuration(sign);
    out.push({ sign, start: t, end: t + dur, hold: t + dur + gap, index });
    t += dur + gap;
  });
  const neg = negated.map((i) => out[i]).filter((x): x is TimedSign => !!x);
  const timed = marks.filter((m) => out[m.from] && out[m.to])
    .map((m) => ({ from: out[m.from]!.start - MOTION.markLead, to: out[m.to]!.end + MOTION.markTail, brows: m.brows }));
  return {
    signs: out, total: t + MOTION.toRest, face, marks: timed,
    negateFrom: neg.length ? neg[0]!.start - 0.15 : -1, negateTo: neg.length ? neg[neg.length - 1]!.end + 0.1 : -1,
  };
}

const blendState = (a: HandState, b: HandState, t: number): HandState => {
  const k = smooth(Math.max(0, Math.min(1, t)));
  return { local: blendLocal(a.local, b.local, k), orient: { f: slerp(a.orient.f, b.orient.f, k), n: slerp(a.orient.n, b.orient.n, k) }, wrist: lerp(a.wrist, b.wrist, k) };
};

/** Both hands' state at time `time` of a timeline, including transitions to and from rest. */
export function stateAt(tl: Timeline, time: number): { right: HandState; left: HandState; active: number; rightUp: boolean; leftUp: boolean } {
  const restR = restState(false), restL = restState(true);
  const at = (i: number, u: number) => {
    const s = evaluate(tl.signs[i]!.sign, u);
    return { right: s.right, left: s.left ?? restL, leftUp: !!s.left };
  };
  const n = tl.signs.length;
  if (!n) return { right: restR, left: restL, active: -1, rightUp: false, leftUp: false };
  for (let i = 0; i < n; i++) {
    const s = tl.signs[i]!;
    if (time >= s.start && time <= s.hold) {
      const a = at(i, Math.min(1, (time - s.start) / (s.end - s.start)));
      return { ...a, active: i, rightUp: true };
    }
    const prevEnd = i === 0 ? s.start - MOTION.fromRest : tl.signs[i - 1]!.hold;
    if (time < s.start && time >= prevEnd) {
      const from = i === 0 ? { right: restR, left: restL, leftUp: false } : at(i - 1, 1);
      const to = at(i, 0);
      const k = (time - prevEnd) / (s.start - prevEnd);
      return { right: blendState(from.right, to.right, k), left: blendState(from.left, to.left, k), active: i, rightUp: i > 0 || k > 0.5, leftUp: (from.leftUp && to.leftUp) || (k > 0.5 ? to.leftUp : from.leftUp) };
    }
  }
  const last = at(n - 1, 1);
  const k = (time - tl.signs[n - 1]!.hold) / MOTION.toRest;
  return { right: blendState(last.right, restR, k), left: blendState(last.left, restL, k), active: -1, rightUp: k < 0.5, leftUp: last.leftUp && k < 0.5 };
}

export function frameAt(tl: Timeline, time: number): Frame {
  const s = stateAt(tl, time);
  const shaking = tl.negateFrom >= 0 && time >= tl.negateFrom && time <= tl.negateTo;
  const signing = time > 0.15 && time < tl.total - 0.2;
  // Spans set the brows while they last; with no spans, the sentence's own brows hold throughout.
  const mark = tl.marks.find((m) => time >= m.from && time <= m.to);
  const brows = tl.marks.length ? (mark ? mark.brows : 0) : signing ? tl.face.brows : 0;
  return {
    right: placeHand(s.right.local, s.right.orient, s.right.wrist, false),
    left: placeHand(s.left.local, s.left.orient, s.left.wrist, true),
    active: s.active,
    face: { brows, yaw: shaking ? 0.22 * Math.sin(time * 2 * Math.PI * 2.6) : 0, tilt: brows > 0 ? 0.06 : 0 },
    rightUp: s.rightUp,
    leftUp: s.leftUp,
  };
}
