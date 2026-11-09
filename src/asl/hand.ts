/**
 * One hand model for both directions. The avatar draws it; the recognizer measures the same features on a
 * camera hand (MediaPipe's 21 landmarks) and compares them with these templates.
 *
 * Hand-local frame (right hand): x = thumb side, y = along the fingers, z = out of the palm. Units: hand
 * length (wrist to middle fingertip) is about 1. A left hand is the same geometry with x mirrored.
 */
import { add, angle, cross, dist, dot, len, norm, orthoTo, rotate, scale, sub, type V3 } from './vec';

/** Hand length in body units (shoulder width = 1). */
export const HAND_SCALE = 0.5;

const D = Math.PI / 180;

/** [MCP flex, PIP flex, spread] in degrees for index, middle, ring, pinky. DIP follows PIP (×0.7). */
export type Finger = readonly [number, number, number];
export type ThumbMode = 'out' | 'side' | 'up' | 'across' | 'over' | 'tuck' | 'c' | 'touchIndex' | 'touchMiddle' | 'touchRing' | 'touchPinky' | 'between' | 'underMiddle' | 'underRing';

export interface Handshape {
  fingers: readonly [Finger, Finger, Finger, Finger];
  thumb: ThumbMode;
}

const E: Finger = [0, 0, 0];      // extended
const F: Finger = [88, 100, 0];   // folded into the palm
const sp = (f: Finger, s: number): Finger => [f[0], f[1], s];

/** The handshapes the lexicon uses. Names follow common ASL handshape labels. */
export const HANDSHAPES = {
  B: { fingers: [E, E, E, E], thumb: 'tuck' },
  OB: { fingers: [E, E, E, E], thumb: 'side' },                 // open B: flat, thumb along the side
  '5': { fingers: [sp(E, 14), sp(E, 4), sp(E, -6), sp(E, -16)], thumb: 'out' },
  '4': { fingers: [sp(E, 10), sp(E, 3), sp(E, -5), sp(E, -12)], thumb: 'tuck' },
  A: { fingers: [F, F, F, F], thumb: 'side' },
  S: { fingers: [F, F, F, F], thumb: 'over' },
  T: { fingers: [[80, 95, 0], F, F, F], thumb: 'between' },
  '10': { fingers: [F, F, F, F], thumb: 'up' },
  '1': { fingers: [E, F, F, F], thumb: 'over' },
  L: { fingers: [E, F, F, F], thumb: 'out' },
  X: { fingers: [[25, 100, 0], F, F, F], thumb: 'over' },
  V: { fingers: [sp(E, 10), sp(E, -6), F, F], thumb: 'over' },
  U: { fingers: [sp(E, 2), sp(E, -2), F, F], thumb: 'over' },
  '3': { fingers: [sp(E, 10), sp(E, -6), F, F], thumb: 'out' },
  W: { fingers: [sp(E, 12), sp(E, 0), sp(E, -10), F], thumb: 'touchPinky' },
  Y: { fingers: [F, F, F, sp(E, -25)], thumb: 'out' },
  I: { fingers: [F, F, F, sp(E, -6)], thumb: 'over' },
  ILY: { fingers: [sp(E, 6), F, F, sp(E, -20)], thumb: 'out' },
  C: { fingers: [[35, 50, 2], [35, 50, 0], [35, 50, -2], [35, 50, -4]], thumb: 'c' },
  O: { fingers: [[45, 75, 0], [48, 72, 0], [50, 70, 0], [52, 68, 0]], thumb: 'touchIndex' },
  flatO: { fingers: [[60, 15, 0], [62, 12, 0], [64, 12, 0], [66, 12, 0]], thumb: 'touchIndex' },
  bentB: { fingers: [[85, 5, 0], [85, 5, 0], [85, 5, 0], [85, 5, 0]], thumb: 'side' },
  claw: { fingers: [[25, 80, 14], [25, 80, 4], [25, 80, -6], [25, 80, -16]], thumb: 'c' },
  F: { fingers: [[50, 75, 0], sp(E, 4), sp(E, -6), sp(E, -16)], thumb: 'touchIndex' },
  open8: { fingers: [sp(E, 14), [55, 30, 0], sp(E, -6), sp(E, -16)], thumb: 'out' },
  '8': { fingers: [sp(E, 14), [55, 70, 0], sp(E, -6), sp(E, -16)], thumb: 'touchMiddle' },
  H: { fingers: [sp(E, 1), sp(E, -1), F, F], thumb: 'over' },   // same fingers as U; held sideways
  N3: { fingers: [sp(E, 2), sp(E, -2), F, F], thumb: 'out' },   // index + middle + thumb open (NO, start)
  NC: { fingers: [[40, 40, 0], [40, 40, 0], F, F], thumb: 'touchMiddle' }, // ... snapped closed (NO, end)
  // Manual alphabet shapes not covered above (fingerspell.ts maps every letter to a shape).
  D: { fingers: [E, [45, 75, 0], [50, 70, 0], [52, 68, 0]], thumb: 'touchMiddle' },   // index up, others ring the thumb
  E: { fingers: [[70, 110, 0], [70, 110, 0], [70, 110, 0], [70, 110, 0]], thumb: 'tuck' }, // fingertips bent down to the tucked thumb
  G: { fingers: [E, F, F, F], thumb: 'up' },                     // index and thumb parallel, held sideways
  K: { fingers: [sp(E, 10), [35, 0, -8], F, F], thumb: 'between' }, // index up, middle angled out, thumb between
  M: { fingers: [[85, 95, 0], [85, 95, 0], [85, 95, 0], F], thumb: 'underRing' },    // thumb under three fingers
  N: { fingers: [[85, 95, 0], [85, 95, 0], F, F], thumb: 'underMiddle' },            // thumb under two fingers
  R: { fingers: [sp(E, -8), sp(E, 10), F, F], thumb: 'over' },    // index and middle crossed
  '7': { fingers: [sp(E, 12), sp(E, 2), [45, 75, 0], sp(E, -14)], thumb: 'touchRing' }, // number 7: thumb to ring
} as const satisfies Record<string, Handshape>;

export type ShapeName = keyof typeof HANDSHAPES;
export const SHAPE_NAMES = Object.keys(HANDSHAPES) as ShapeName[];

// Bone geometry (local units).
const MCP: readonly V3[] = [[0.1, 0.42, 0], [0.0, 0.44, 0], [-0.09, 0.42, 0], [-0.17, 0.38, 0]];
const BONES: readonly (readonly [number, number, number])[] = [[0.22, 0.13, 0.1], [0.25, 0.15, 0.1], [0.23, 0.14, 0.1], [0.17, 0.11, 0.09]];
const CMC: V3 = [0.12, 0.08, 0.03];
const Z: V3 = [0, 0, 1];

/** The 21 landmarks, MediaPipe order: 0 wrist; 1-4 thumb; 5-8 index; 9-12 middle; 13-16 ring; 17-20 pinky. */
export type Landmarks = V3[];

function finger(i: number, f: Finger): V3[] {
  const m = MCP[i]!;
  const b = BONES[i]!;
  const d0 = rotate([0, 1, 0], Z, -f[2] * D);   // + spread tilts toward the thumb
  const axis = norm(cross(d0, Z));
  const a1 = f[0] * D, a2 = f[1] * D, a3 = f[1] * 0.7 * D;
  const dir = (a: number) => rotate(d0, axis, a);   // flexion curls toward the palm (+z)
  const pip = add(m, scale(dir(a1), b[0]));
  const dip = add(pip, scale(dir(a1 + a2), b[1]));
  const tip = add(dip, scale(dir(a1 + a2 + a3), b[2]));
  return [m, pip, dip, tip];
}

function thumb(mode: ThumbMode, fingers: V3[][]): V3[] {
  const toward = (target: V3): V3[] => {
    const mcp: V3 = [0.2, 0.2, 0.08];
    const ip = add(scale(add(mcp, target), 0.5), [0.04, 0, 0.05]);
    return [CMC, mcp, ip, target];
  };
  const tipOf = (i: number): V3 => fingers[i]![3]!;
  switch (mode) {
    case 'out': return [CMC, [0.24, 0.18, 0.04], [0.34, 0.25, 0.05], [0.43, 0.3, 0.05]];
    case 'side': return [CMC, [0.19, 0.22, 0.05], [0.2, 0.32, 0.07], [0.19, 0.4, 0.08]];
    case 'up': return [CMC, [0.19, 0.24, 0.04], [0.2, 0.36, 0.03], [0.2, 0.47, 0.02]];
    case 'tuck': return [CMC, [0.15, 0.2, 0.07], [0.07, 0.26, 0.09], [-0.01, 0.29, 0.09]];
    case 'across': return [CMC, [0.15, 0.2, 0.08], [0.06, 0.27, 0.12], [-0.04, 0.3, 0.13]];
    case 'over': return [CMC, [0.16, 0.22, 0.1], [0.08, 0.3, 0.17], [-0.02, 0.33, 0.19]];
    case 'between': return [CMC, [0.16, 0.24, 0.1], [0.12, 0.34, 0.15], [0.05, 0.42, 0.14]];
    case 'underMiddle': return [CMC, [0.15, 0.23, 0.11], [0.06, 0.32, 0.15], [-0.05, 0.4, 0.13]];
    case 'underRing': return [CMC, [0.14, 0.22, 0.12], [0.02, 0.31, 0.16], [-0.12, 0.38, 0.13]];
    case 'c': return [CMC, [0.21, 0.2, 0.12], [0.23, 0.29, 0.21], [0.19, 0.36, 0.28]];
    case 'touchIndex': return toward(add(tipOf(0), [0.02, -0.01, 0.02]));
    case 'touchMiddle': return toward(add(tipOf(1), [0.02, -0.01, 0.02]));
    case 'touchRing': return toward(add(tipOf(2), [0.02, -0.01, 0.02]));
    case 'touchPinky': return toward(add(tipOf(3), [0.02, 0, 0.03]));
  }
}

/** Landmarks of a handshape in hand-local coordinates (right hand). */
export function localHand(shape: Handshape): Landmarks {
  const fs = shape.fingers.map((f, i) => finger(i, f));
  return [[0, 0, 0], ...thumb(shape.thumb, fs), ...fs.flat()];
}

/** Blend two handshapes (for transitions and in-sign handshape changes). */
export function blendLocal(a: Landmarks, b: Landmarks, t: number): Landmarks {
  return a.map((p, i) => {
    const q = b[i]!;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t] as V3;
  });
}

/** Points on the hand a sign can put at its location. */
export type Contact = 'tips' | 'index' | 'middle' | 'pinky' | 'thumb' | 'palm' | 'back' | 'knuckles' | 'side' | 'wrist';

export function contactLocal(h: Landmarks, c: Contact): V3 {
  const P = (i: number) => h[i]!;
  switch (c) {
    case 'tips': return scale(add(add(P(8), P(12)), add(P(16), P(20))), 0.25);
    case 'index': return P(8);
    case 'middle': return P(12);
    case 'pinky': return P(20);
    case 'thumb': return P(4);
    case 'palm': return add(scale(add(add(P(0), P(5)), add(P(9), P(17))), 0.25), [0, 0, 0.06]);
    case 'back': return add(scale(add(add(P(0), P(5)), add(P(9), P(17))), 0.25), [0, 0, -0.06]);
    case 'knuckles': return scale(add(add(P(5), P(9)), add(P(13), P(17))), 0.25);
    case 'side': return add(scale(add(P(17), P(0)), 0.5), [-0.04, 0, 0]);
    case 'wrist': return P(0);
  }
}

/** The default contact point for a handshape: the part a signer usually leads with. */
export function defaultContact(shape: ShapeName): Contact {
  switch (shape) {
    case '1': case 'L': case 'X': case 'ILY': return 'index';
    case 'Y': case 'I': return 'pinky';
    case '10': case 'A': return 'thumb';
    case 'S': case 'T': return 'knuckles';
    case '5': case 'claw': case 'C': case 'O': case 'F': case 'open8': case '8': return 'palm';
    default: return 'tips';
  }
}

/** Orientation: finger direction f and palm normal n (unit, orthogonal), in body space. */
export interface Orient { f: V3; n: V3 }

/** Place local landmarks into body space: rotation [t, f, n] with t = f × n, then mirror x for a left hand. */
export function placeHand(local: Landmarks, o: Orient, wrist: V3, left: boolean): Landmarks {
  const f = norm(o.f);
  const n = orthoTo(o.n, f);
  const t = cross(f, n);
  return local.map((p) => {
    const x = left ? -p[0] : p[0];
    const w: V3 = [t[0] * x + f[0] * p[1] + n[0] * p[2], t[1] * x + f[1] * p[1] + n[1] * p[2], t[2] * x + f[2] * p[1] + n[2] * p[2]];
    return add(wrist, scale(w, HAND_SCALE));
  });
}

/** Wrist position that puts `contact` of the placed hand at `target`. */
export function wristFor(local: Landmarks, o: Orient, contact: Contact, target: V3, left: boolean): V3 {
  const c = placeHand([contactLocal(local, contact)], o, [0, 0, 0], left)[0]!;
  return sub(target, c);
}

// ---------------------------------------------------------------- measuring a hand (recognizer side)

/** Orientation measured from landmarks, as if the hand were a right hand (mirror a left hand first). */
export function measureOrient(h: Landmarks): Orient {
  const f = norm(sub(h[9]!, h[0]!));
  const t = orthoTo(sub(h[5]!, h[17]!), f);
  return { f, n: cross(t, f) };
}

/** A scale- and rotation-free description of a handshape (right-hand geometry). */
export function shapeFeatures(h: Landmarks): number[] {
  const P = (i: number) => h[i]!;
  const palm = dist(P(0), P(9)) || 1;
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    const m = 5 + k * 4;
    out.push(angle(sub(P(m), P(0)), sub(P(m + 1), P(m))));   // MCP flex
    out.push(angle(sub(P(m + 1), P(m)), sub(P(m + 2), P(m + 1))) + angle(sub(P(m + 2), P(m + 1)), sub(P(m + 3), P(m + 2)))); // PIP+DIP
  }
  // Thumb tip in the hand's own frame, scaled by palm length.
  const o = measureOrient(h);
  const t = cross(o.f, o.n);
  const rel = scale(sub(P(4), P(0)), 1 / palm);
  out.push(dot(rel, t), dot(rel, o.f), dot(rel, o.n));
  out.push(dist(P(4), P(8)) / palm, dist(P(4), P(12)) / palm, dist(P(4), P(20)) / palm);
  // Spread: index-middle and ring-pinky fingertip separation, relative to palm length.
  out.push(dist(P(8), P(12)) / palm, dist(P(16), P(20)) / palm);
  return out;
}

/** Feature weights: finger flexion matters most; spread least. */
const W = [1.2, 1, 1.2, 1, 1.2, 1, 1.2, 1, 0.9, 0.9, 0.9, 0.8, 0.6, 0.5, 0.5, 0.4];

export function shapeDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i]! - b[i]!) * (W[i] ?? 1);
    s += d * d;
  }
  return Math.sqrt(s);
}

const TEMPLATES = new Map<ShapeName, number[]>(SHAPE_NAMES.map((s) => [s, shapeFeatures(localHand(HANDSHAPES[s]))]));
export const shapeTemplate = (s: ShapeName): number[] => TEMPLATES.get(s)!;

/** Nearest handshapes to measured features, best first. */
export function classifyShape(features: number[]): { shape: ShapeName; d: number }[] {
  return SHAPE_NAMES.map((shape) => ({ shape, d: shapeDistance(features, shapeTemplate(shape)) })).sort((a, b) => a.d - b.d);
}

export const handSpan = (h: Landmarks): number => len(sub(h[9]!, h[0]!));
