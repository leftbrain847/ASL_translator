/** Small 3-vector helpers. Body space: x = signer's right, y = up, z = toward the signer's back (so "forward",
 * toward the viewer, is -z). This frame is right-handed, so hand geometry built in it is physically correct. */
export type V3 = readonly [number, number, number];

export const v = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3): number => len(sub(a, b));
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0];
};
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mirrorX = (a: V3): V3 => [-a[0], a[1], a[2]];
export const angle = (a: V3, b: V3): number => {
  const d = dot(norm(a), norm(b));
  return Math.acos(Math.max(-1, Math.min(1, d)));
};
/** Rotate `p` about unit axis `k` by `t` radians (Rodrigues). */
export const rotate = (p: V3, k: V3, t: number): V3 => {
  const c = Math.cos(t), s = Math.sin(t);
  return add(add(scale(p, c), scale(cross(k, p), s)), scale(k, dot(k, p) * (1 - c)));
};
/** Spherical interpolation between unit vectors (falls back to lerp when nearly parallel or opposite). */
export const slerp = (a: V3, b: V3, t: number): V3 => {
  const th = angle(a, b);
  if (th < 1e-4) return norm(lerp(a, b, t));
  if (Math.PI - th < 1e-3) {
    const axis = norm(Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0]));
    return rotate(a, axis, th * t);
  }
  const s = Math.sin(th);
  return norm(add(scale(a, Math.sin((1 - t) * th) / s), scale(b, Math.sin(t * th) / s)));
};
/** Make `f` perpendicular to `n` (Gram-Schmidt), both unit. */
export const orthoTo = (f: V3, n: V3): V3 => norm(sub(f, scale(n, dot(f, n))));
export const smooth = (t: number): number => t * t * (3 - 2 * t);
