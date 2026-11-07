import { synthesize } from '../src/asl/camera';
import { toBody } from '../src/asl/camera';
import { frameAt, timeline, type Frame } from '../src/asl/motion';
import { Recognizer, type Recognized } from '../src/asl/recognize';
import type { SignDef } from '../src/asl/sign';

/** Sign `signs` with a pause after each, film it with the virtual camera, and run the recognizer. */
export function roundTrip(signs: SignDef[], lexicon: readonly SignDef[], opts: { fps?: number; jitter?: number; seed?: number; gap?: number; tempo?: number; space?: number } = {}): Recognized[] {
  const fps = opts.fps ?? 30;
  const tl = timeline(signs, undefined, [], opts.gap ?? 0.45);
  const frames = [];
  // tempo < 1 signs slower; space > 1 makes every movement and reach bigger (a different signer's body and style).
  const tempo = opts.tempo ?? 1, k = opts.space ?? 1;
  const grow = (l: Frame['right']) => l.map((p) => [p[0] * k, p[1] * (1 + (k - 1) * 0.5), p[2] * k] as const) as Frame['right'];
  for (let t = 0; t <= (tl.total + 0.3) / tempo; t += 1 / fps) {
    const f = frameAt(tl, t * tempo);
    frames.push({ t, f: k === 1 ? f : { ...f, right: grow(f.right), left: grow(f.left) } });
  }
  const cam = synthesize(frames, opts.jitter ?? 0, opts.seed ?? 7);
  const rec = new Recognizer(lexicon);
  const out: Recognized[] = [];
  for (const c of cam) {
    const b = toBody(c);
    if (!b) continue;
    const r = rec.push(b);
    if (r) out.push(...r);
  }
  const last = rec.flush();
  if (last) out.push(...last);
  return out;
}
