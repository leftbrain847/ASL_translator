/**
 * Camera frames in the shape MediaPipe's hand and pose landmarkers report them, and the mapping between
 * those and body space. `synthesize` runs the mapping backwards to make camera frames from the avatar, for
 * tests and the in-page self-test.
 *
 * Assumptions about MediaPipe (from its docs; not yet checked against a live camera here):
 * - landmarks are normalized: x by image width, y by image height, z (hands) relative to the wrist on
 *   roughly the same scale as x;
 * - handedness labels assume a mirrored (selfie) image, so on raw camera frames "Left" is the signer's right
 *   hand. `CAMERA.labelsMirrored` flips that if a device turns out to differ.
 */
import { ANCHORS } from './body';
import type { Landmarks } from './hand';
import type { Frame } from './motion';
import type { V3 } from './vec';

export const CAMERA = {
  labelsMirrored: true,
  /** Shoulder width as a fraction of image width in synthesized frames. */
  synthShoulderFrac: 0.26,
  synthWidth: 640,
  synthHeight: 480,
  /** Body-space height below which a synthesized hand is out of shot (the hands rest at about -0.98). */
  synthFrameBottom: -0.9,
};

export interface Pt { x: number; y: number; z: number }
export interface CamHand { landmarks: Pt[]; label: 'Left' | 'Right' }
export interface CamFrame {
  /** Seconds. */
  t: number;
  width: number;
  height: number;
  /** 33 pose landmarks, or null when no person is found. */
  pose: Pt[] | null;
  hands: CamHand[];
}

/** One frame in body space; `right` is the dominant hand (after mirroring for left-handed signers). */
export interface BodyFrame { t: number; right: Landmarks | null; left: Landmarks | null }

/** Camera frame → body space. Returns null when the shoulders can't be seen. */
export function toBody(f: CamFrame, leftHanded = false): BodyFrame | null {
  const sl = f.pose?.[11], sr = f.pose?.[12];
  if (!sl || !sr) return null;
  const W = f.width, H = f.height;
  const cx = ((sl.x + sr.x) / 2) * W, cy = ((sl.y + sr.y) / 2) * H;
  const sw = Math.hypot((sl.x - sr.x) * W, (sl.y - sr.y) * H);
  if (sw < 1) return null;
  const mx = leftHanded ? -1 : 1;
  let right: Landmarks | null = null, left: Landmarks | null = null;
  for (const h of f.hands) {
    if (h.landmarks.length < 21) continue;
    const wz = h.landmarks[0]!.z;
    const lm = h.landmarks.map((p): V3 => [mx * -((p.x * W - cx) / sw), -((p.y * H - cy) / sw), ((p.z - wz) * W) / sw]);
    const physicalRight = (h.label === 'Left') === CAMERA.labelsMirrored;
    const dominant = leftHanded ? !physicalRight : physicalRight;
    if (dominant) right = lm; else left = lm;
  }
  return { t: f.t, right, left };
}

/** Body space → camera frame, using a fixed virtual camera. The signer is right-handed. */
export function toCamera(t: number, right: Landmarks | null, left: Landmarks | null): CamFrame {
  const W = CAMERA.synthWidth, H = CAMERA.synthHeight;
  const sw = CAMERA.synthShoulderFrac * W;
  const cx = W / 2, cy = H * 0.62;
  const pt = (b: V3, wz = 0): Pt => ({ x: (cx - b[0] * sw) / W, y: (cy - b[1] * sw) / H, z: ((b[2] - wz) * sw) / W });
  const pose: Pt[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9, z: 0 }));
  const A = ANCHORS;
  ([[0, A.nose], [2, A.eyeL], [5, A.eyeR], [7, A.earL], [8, A.earR], [9, A.mouthL], [10, A.mouthR], [11, A.shoulderL], [12, A.shoulderR]] as const)
    .forEach(([i, p]) => { pose[i] = pt(p); });
  const hands: CamHand[] = [];
  const label = (physicalRight: boolean): 'Left' | 'Right' => ((physicalRight === CAMERA.labelsMirrored) ? 'Left' : 'Right');
  if (right) hands.push({ landmarks: right.map((p) => pt(p, right[0]![2])), label: label(true) });
  if (left) hands.push({ landmarks: left.map((p) => pt(p, left[0]![2])), label: label(false) });
  return { t, width: W, height: H, pose, hands };
}

/** Small deterministic noise source for tests (no Math.random). */
export function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** Camera frames of the avatar signing. Like a webcam framed head to waist, a hand at rest is out of shot. */
export function synthesize(frames: { t: number; f: Frame }[], jitter = 0, seed = 7): CamFrame[] {
  const r = noise(seed);
  const j = (l: Landmarks): Landmarks => (jitter ? l.map((p) => [p[0] + r() * jitter, p[1] + r() * jitter, p[2] + r() * jitter] as V3) : l);
  const seen = (l: Landmarks): boolean => l[0]![1] > CAMERA.synthFrameBottom;
  return frames.map(({ t, f }) => toCamera(t, seen(f.right) ? j(f.right) : null, seen(f.left) ? j(f.left) : null));
}
