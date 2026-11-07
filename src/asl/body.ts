/**
 * The signer's body in body space (shoulder width = 1; origin between the shoulders; x = signer's right,
 * y = up, z = toward the back, so -z is forward toward the viewer). Locations are given for the dominant
 * (right) hand; the other hand uses the mirror image.
 */
import { add, mirrorX, norm, type V3 } from './vec';

export const SHOULDER: V3 = [0.5, 0, 0];
export const UPPER_ARM = 0.78;
export const FOREARM = 0.72;

/** Face and body anchors, as a pose tracker would report them (MediaPipe pose indices noted). */
export const ANCHORS = {
  nose: [0, 0.8, -0.28] as V3,          // 0
  eyeL: [-0.11, 0.9, -0.22] as V3,      // 2 (signer's left)
  eyeR: [0.11, 0.9, -0.22] as V3,       // 5
  earL: [-0.27, 0.84, -0.02] as V3,     // 7
  earR: [0.27, 0.84, -0.02] as V3,      // 8
  mouthL: [-0.07, 0.66, -0.24] as V3,   // 9
  mouthR: [0.07, 0.66, -0.24] as V3,    // 10
  shoulderL: [-0.5, 0, 0] as V3,        // 11
  shoulderR: [0.5, 0, 0] as V3,         // 12
};

/** Named places on the body. "Side" places are on the dominant side; mirror x for the other hand. */
export const LOCATIONS = {
  topHead: [0.05, 1.18, -0.05],
  forehead: [0.03, 1.04, -0.24],
  temple: [0.24, 0.98, -0.12],
  eye: [0.1, 0.9, -0.27],
  nose: [0, 0.8, -0.31],
  mouth: [0, 0.67, -0.28],
  chin: [0, 0.55, -0.24],
  cheek: [0.19, 0.72, -0.2],
  jaw: [0.17, 0.6, -0.17],
  ear: [0.29, 0.84, -0.04],
  neck: [0, 0.36, -0.13],
  shoulder: [0.4, 0.02, -0.1],
  chest: [0.02, -0.25, -0.2],
  chestSide: [0.2, -0.22, -0.2],
  stomach: [0.02, -0.75, -0.2],
  hip: [0.45, -0.8, -0.15],      // upper thigh / waist, kept within a webcam's frame
  neutral: [0.12, -0.4, -0.5],
  neutralLow: [0.12, -0.62, -0.45],
  neutralHigh: [0.15, 0.1, -0.55],
  forward: [0.12, -0.3, -0.8],
  faceFront: [0.1, 0.8, -0.55],
  headSide: [0.42, 0.92, -0.25],
  side: [0.62, -0.3, -0.42],
  // Places on the base (non-dominant) hand; resolved against where the base hand actually is.
  basePalm: [0, 0, 0],
  baseBack: [0, 0, 0],
  baseTip: [0, 0, 0],
  baseWrist: [0, 0, 0],
  baseHand: [0, 0, 0],
} as const satisfies Record<string, V3>;

export type Loc = keyof typeof LOCATIONS;
export const BASE_LOCS: ReadonlySet<Loc> = new Set<Loc>(['basePalm', 'baseBack', 'baseTip', 'baseWrist', 'baseHand']);

/** Directions, in dominant-hand terms: out = toward the dominant side, in = toward (and past) the midline. */
const DIRS = {
  up: [0, 1, 0], down: [0, -1, 0], fwd: [0, 0, -1], back: [0, 0, 1], out: [1, 0, 0], in: [-1, 0, 0],
} as const satisfies Record<string, V3>;
export type BaseDir = keyof typeof DIRS;
/** One direction or a blend like "up+fwd". */
export type Dir = BaseDir | `${BaseDir}+${BaseDir}`;

export function dirVec(d: Dir): V3 {
  const parts = d.split('+') as BaseDir[];
  return norm(parts.reduce<V3>((acc, p) => add(acc, DIRS[p]), [0, 0, 0]));
}

/** A location for a given hand: the dominant hand uses it as is, the other hand mirrored. */
export const locFor = (loc: Loc, left: boolean): V3 => (left ? mirrorX(LOCATIONS[loc]) : LOCATIONS[loc]);
export const dirFor = (d: Dir, left: boolean): V3 => (left ? mirrorX(dirVec(d)) : dirVec(d));

/** Where the hands rest between sentences. */
export const REST = {
  right: { wrist: [0.42, -0.98, -0.2] as V3 },
  left: { wrist: [-0.42, -0.98, -0.2] as V3 },
};
