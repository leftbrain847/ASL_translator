/**
 * ASL → gloss. Streams body-space frames, cuts them into signs at pauses (or when the hands drop), and
 * matches each piece against every lexicon sign's template with subsequence dynamic time warping, so a
 * sign made faster, slower or after a lead-in movement still lines up.
 *
 * Templates come from the motion engine (motion.ts), the same definitions the avatar performs. That keeps
 * the two directions consistent, but it also means accuracy on real signers is only as good as those
 * definitions: the self-test proves the pipeline, not real-world accuracy.
 */
import type { BodyFrame } from './camera';
import { measureOrient, placeHand, shapeDistance, shapeFeatures, type Landmarks } from './hand';
import { evaluate } from './motion';
import type { SignDef } from './sign';
import { angle, dot, type V3 } from './vec';

export const RECOGNIZER = {
  /** Samples per template. */
  templateSamples: 14,
  /** A hand whose wrist is below this (body units) counts as down / at rest. */
  downY: -0.85,
  /** Hand speed (body units per second, fastest of palm and fingertips) below which it counts as still. */
  stillSpeed: 0.32,
  /** Window (seconds) over which hand speed is measured. */
  speedWindow: 0.2,
  /** Body units of movement counted per radian of palm turn, and per unit of handshape change. */
  turnLever: 0.2,
  shapeLever: 0.12,
  /** Stillness that ends a phrase (seconds), and the longest phrase decoded at once. */
  phrasePause: 0.7,
  maxPhrase: 12,
  /** Frames per second the decoder looks at. */
  decodeFps: 15,
  /** Decoder costs: per filler frame, per sign inserted, per template sample stacked on one frame. */
  decode: { filler: 1.15, stillFiller: 0.7, insert: 1.2, stall: 0.3 },
  /** Two reads of one sign closer together than this (seconds) are merged into one. */
  mergeGap: 0.3,
  /** A piece shorter than this is ignored (seconds). */
  minPiece: 0.25,
  /** Pieces whose best match costs more than this are reported as not recognized. */
  maxCost: 1.15,
  /** Landmark smoothing (exponential moving average weight of the newest frame), as trackers usually need. */
  smoothing: 0.55,
  weights: { palm: 3.2, tip: 2.0, orient: 0.9, shape: 0.4, other: 1.6, otherMissing: 1.1, otherShape: 0.12 },
};

interface Feat {
  palm: [number, number];
  tip: [number, number];
  f: V3;
  n: V3;
  shape: number[];
  other: { palm: [number, number]; shape: number[] } | null;
}

const mirrorLm = (l: Landmarks): Landmarks => l.map((p) => [-p[0], p[1], p[2]] as V3);
const palmOf = (l: Landmarks): [number, number] => [(l[0]![0] + l[5]![0] + l[9]![0] + l[17]![0]) / 4, (l[0]![1] + l[5]![1] + l[9]![1] + l[17]![1]) / 4];

export function featOf(right: Landmarks, left: Landmarks | null): Feat {
  const o = measureOrient(right);
  // The left hand is measured as if it were a right hand (mirror first), so shape templates apply.
  return {
    palm: palmOf(right),
    tip: [right[8]![0], right[8]![1]],
    f: o.f,
    n: o.n,
    shape: shapeFeatures(right),
    other: left ? { palm: palmOf(left), shape: shapeFeatures(mirrorLm(left)) } : null,
  };
}

function cost(a: Feat, b: Feat): number {
  const w = RECOGNIZER.weights;
  const d2 = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let c = w.palm * d2(a.palm, b.palm) + w.tip * d2(a.tip, b.tip);
  c += w.orient * ((1 - dot(a.f, b.f)) + 0.8 * (1 - dot(a.n, b.n)));
  c += w.shape * shapeDistance(a.shape, b.shape);
  if (a.other && b.other) c += w.other * d2(a.other.palm, b.other.palm) + w.otherShape * shapeDistance(a.other.shape, b.other.shape);
  else if (a.other || b.other) c += w.otherMissing;
  return c;
}

const TEMPLATE_CACHE = new WeakMap<SignDef, Feat[]>();
export function template(sign: SignDef): Feat[] {
  let t = TEMPLATE_CACHE.get(sign);
  if (t) return t;
  t = [];
  const n = RECOGNIZER.templateSamples;
  for (let i = 0; i < n; i++) {
    const s = evaluate(sign, i / (n - 1));
    const right = placeHand(s.right.local, s.right.orient, s.right.wrist, false);
    const left = s.left ? placeHand(s.left.local, s.left.orient, s.left.wrist, true) : null;
    t.push(featOf(right, left));
  }
  TEMPLATE_CACHE.set(sign, t);
  return t;
}

export interface Guess { gloss: string; cost: number }
export interface Recognized { best: Guess | null; top: Guess[]; start: number; end: number }

interface Hist { gloss: string; start: number; end: number; cost: number; prev: Hist | null }
interface Cell { score: number; start: number; sum: number; n: number; hist: Hist | null }
const NONE: Cell = { score: Infinity, start: 0, sum: 0, n: 0, hist: null };

/**
 * Connected-sign decoding (one-stage dynamic programming, as in connected-word speech recognition): explains
 * a stretch of frames as filler (rest, lead-ins, transitions, holds) and signs, each sign a full warped pass
 * through its template. Filler costs a fixed amount per frame, so a sign is chosen only where it explains the
 * movement better than "just moving"; a still template can't claim a moving sign's frames.
 */
export function decode(xs: Feat[], times: number[], lexicon: readonly SignDef[]): Recognized[] {
  const { filler, stillFiller, insert, stall } = RECOGNIZER.decode;
  // Filler is cheaper on frames where the hand is still (holds, rests), so a pause isn't read as a sign.
  const fillCost = xs.map((x, t) => {
    const a = xs[Math.max(0, t - 2)]!, b = xs[Math.min(xs.length - 1, t + 2)]!;
    const dt = (times[Math.min(xs.length - 1, t + 2)]! - times[Math.max(0, t - 2)]!) || 1;
    return Math.hypot(b.palm[0] - a.palm[0], b.palm[1] - a.palm[1]) / dt < RECOGNIZER.stillSpeed ? stillFiller : filler;
  });
  const T = xs.length, V = lexicon.length;
  if (!T) return [];
  const tpl = lexicon.map((s) => template(s));
  let prev: Cell[][] = tpl.map((t) => t.map(() => NONE));
  let cur: Cell[][] = tpl.map((t) => t.map(() => NONE));
  let fill: { score: number; hist: Hist | null } = { score: 0, hist: null };
  let bestEnd: { score: number; hist: Hist | null } = { score: Infinity, hist: null };
  for (let t = 0; t < T; t++) {
    // Where a new sign can start from: filler, or right after another sign ended.
    const from = fill.score <= bestEnd.score ? fill : bestEnd;
    const entry = from.score + insert;
    let nextEnd = { score: Infinity, hist: null as Hist | null };
    for (let v = 0; v < V; v++) {
      const y = tpl[v]!, m = y.length, P = prev[v]!, C = cur[v]!;
      for (let j = 0; j < m; j++) {
        const c = cost(xs[t]!, y[j]!);
        let b: Cell;
        if (j === 0) {
          const stay = P[0]!;
          b = stay.score <= entry ? stay : { score: entry, start: t, sum: 0, n: 0, hist: from.hist };
        } else {
          b = P[j - 1]!;
          if (P[j]!.score < b.score) b = P[j]!;
          const h = C[j - 1]!;
          if (h.score + stall < b.score) b = { ...h, score: h.score + stall };
        }
        C[j] = b.score === Infinity ? NONE : { score: b.score + c, start: b.start, sum: b.sum + c, n: b.n + 1, hist: b.hist };
      }
      const e = C[m - 1]!;
      if (e.score < nextEnd.score) {
        nextEnd = { score: e.score, hist: { gloss: lexicon[v]!.gloss, start: e.start, end: t, cost: e.sum / Math.max(1, e.n), prev: e.hist } };
      }
    }
    fill = { score: Math.min(fill.score, bestEnd.score) + fillCost[t]!, hist: fill.score <= bestEnd.score ? fill.hist : bestEnd.hist };
    bestEnd = nextEnd;
    [prev, cur] = [cur, prev];
  }
  let h = (fill.score <= bestEnd.score ? fill : bestEnd).hist;
  const out: Recognized[] = [];
  for (; h; h = h.prev) {
    const g = { gloss: h.gloss, cost: h.cost };
    const r: Recognized = { best: h.cost <= RECOGNIZER.maxCost ? g : null, top: [g], start: times[h.start] ?? 0, end: times[h.end] ?? 0 };
    // The same sign again straight after itself is almost always its own hold or return, not a repeat.
    const next = out[0];
    if (next && next.top[0]?.gloss === g.gloss && next.start - r.end <= RECOGNIZER.mergeGap) { next.start = r.start; if (r.best && (!next.best || r.best.cost < next.best.cost)) next.best = r.best; continue; }
    out.unshift(r);
  }
  return out;
}

/** Features for a stretch of body frames, thinned to the decoder's frame rate. */
export function featuresOf(frames: BodyFrame[]): { xs: Feat[]; times: number[] } {
  const xs: Feat[] = [], times: number[] = [];
  let last = -Infinity;
  for (const f of frames) {
    if (!f.right || f.t - last < 1 / RECOGNIZER.decodeFps - 1e-6) continue;
    last = f.t;
    xs.push(featOf(f.right, f.left && f.left[0]![1] > RECOGNIZER.downY ? f.left : null));
    times.push(f.t);
  }
  return { xs, times };
}

/** Recognize every sign in a stretch of frames. */
export function recognizeAll(frames: BodyFrame[], lexicon: readonly SignDef[]): Recognized[] {
  const { xs, times } = featuresOf(frames);
  return decode(xs, times, lexicon);
}

const ema = (a: Landmarks | null | undefined, b: Landmarks | null): Landmarks | null => {
  if (!b || !a) return b;
  const k = RECOGNIZER.smoothing;
  return b.map((p, i) => { const q = a[i]!; return [q[0] + (p[0] - q[0]) * k, q[1] + (p[1] - q[1]) * k, q[2] + (p[2] - q[2]) * k] as V3; });
};
const smoothFrame = (prev: BodyFrame | null, f: BodyFrame): BodyFrame => ({ t: f.t, right: ema(prev?.right, f.right), left: ema(prev?.left, f.left) });

/**
 * Streaming recognizer. Frames are gathered while the hands are up; when they drop, or after a long pause,
 * the stretch is decoded into signs and returned. `partial()` decodes what's been signed so far, for live
 * captions that firm up when the phrase ends.
 */
export class Recognizer {
  private piece: BodyFrame[] = [];
  private last: BodyFrame | null = null;
  private stillSince = -1;
  /** How much the hands are moving right now (body units / s), for the UI's activity meter. */
  speed = 0;

  constructor(private lexicon: readonly SignDef[]) {}

  push(raw: BodyFrame): Recognized[] | null {
    const prev = this.last;
    const f = smoothFrame(prev, raw);
    this.last = f;
    const up = !!f.right && f.right[0]![1] > RECOGNIZER.downY;
    if (!up) { this.speed = 0; this.recent = []; return this.flush(); }
    // Speed over a short window, not frame to frame: tracking jitter cancels out, real movement adds up.
    this.recent.push(f);
    while (this.recent.length > 2 && f.t - this.recent[1]!.t >= RECOGNIZER.speedWindow) this.recent.shift();
    const old = this.recent[0]!;
    if (old !== f && old.right && f.t > old.t) {
      const dt = f.t - old.t;
      const mv = (i: number) => Math.hypot(f.right![i]![0] - old.right![i]![0], f.right![i]![1] - old.right![i]![1]);
      const lm = f.left && old.left ? Math.hypot(f.left[9]![0] - old.left[9]![0], f.left[9]![1] - old.left[9]![1]) : 0;
      // Turning the palm or changing handshape is movement too, even when the hand stays in place.
      const turn = angle(measureOrient(old.right).n, measureOrient(f.right!).n) * RECOGNIZER.turnLever;
      const reshape = shapeDistance(shapeFeatures(old.right), shapeFeatures(f.right!)) * RECOGNIZER.shapeLever;
      this.speed = Math.max(mv(0), mv(8), mv(12), mv(20), lm, turn, reshape) / dt;
    }
    const still = this.speed < RECOGNIZER.stillSpeed;
    // After a phrase ends on a pause, hands held still are just waiting: gather nothing until they move.
    if (this.heldAfterPhrase) {
      if (still) return null;
      this.heldAfterPhrase = false;
    }
    if (!still) this.stillSince = -1;
    else if (this.stillSince < 0) this.stillSince = f.t;
    this.piece.push(f);
    if (this.piece.length && f.t - this.piece[0]!.t > RECOGNIZER.maxPhrase) return this.flush(true);
    if (this.stillSince >= 0 && f.t - this.stillSince >= RECOGNIZER.phrasePause) return this.flush(true);
    return null;
  }

  private heldAfterPhrase = false;
  private recent: BodyFrame[] = [];

  /** What has been signed so far in the current phrase (tentative). */
  partial(): Recognized[] {
    return this.piece.length ? recognizeAll(this.piece, this.lexicon).filter((r) => r.best) : [];
  }

  /** End the current phrase and decode it (e.g. when the camera stops). */
  flush(held = false): Recognized[] | null {
    const piece = this.piece;
    this.piece = [];
    this.stillSince = -1;
    this.heldAfterPhrase = held;
    if (!piece.length || piece[piece.length - 1]!.t - piece[0]!.t < RECOGNIZER.minPiece) return null;
    const r = recognizeAll(piece, this.lexicon);
    return r.length ? r : null;
  }
}
