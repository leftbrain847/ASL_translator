import { describe, expect, it } from 'vitest';
import { dirVec } from '../src/asl/body';
import { noise, toBody, toCamera } from '../src/asl/camera';
import { classifyShape, HANDSHAPES, localHand, placeHand, shapeFeatures, SHAPE_NAMES } from '../src/asl/hand';
import { LEXICON, RECOGNIZED, signByGloss } from '../src/asl/lexicon';
import { evaluate, frameAt, timeline } from '../src/asl/motion';
import { Recognizer } from '../src/asl/recognize';
import { dot, norm, orthoTo } from '../src/asl/vec';
import { ASL, SPOKEN } from '../src/lang';
import { roundTrip } from './roundtrip.helpers';

const en = SPOKEN[0]!;
const gl = (text: string) => en.toSigns(text, ASL).signs.map((s) => s.gloss).join(' ');

describe('lexicon', () => {
  it('has unique glosses and only known handshapes', () => {
    expect(new Set(LEXICON.map((s) => s.gloss)).size).toBe(LEXICON.length);
    for (const s of LEXICON) for (const sh of [s.dom.shape, s.dom.to?.shape, s.base?.shape]) if (sh) expect(SHAPE_NAMES).toContain(sh);
  });

  it('never points the fingers along the palm normal (that leaves the hand’s orientation undefined)', () => {
    const bad: string[] = [];
    for (const s of LEXICON) {
      const chk = (p: Parameters<typeof dirVec>[0], f: Parameters<typeof dirVec>[0], w: string) => { if (Math.abs(dot(dirVec(p), dirVec(f))) > 0.8) bad.push(`${s.gloss} ${w}`); };
      chk(s.dom.palm, s.dom.fingers, 'start');
      chk(s.dom.to?.palm ?? s.dom.palm, s.dom.to?.fingers ?? s.dom.fingers, 'end');
      if (s.base) chk(s.base.palm, s.base.fingers, 'base');
    }
    expect(bad).toEqual([]);
  });

  it('every sign produces finite poses for both hands', () => {
    for (const s of LEXICON) for (const u of [0, 0.5, 1]) {
      const p = evaluate(s, u);
      for (const v of [...p.right.wrist, ...(p.left?.wrist ?? [])]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('hand model', () => {
  it('reads every handshape back as itself, from any orientation', () => {
    const r = noise(3);
    for (const name of SHAPE_NAMES) {
      const n = norm([r(), r(), r()]);
      const lm = placeHand(localHand(HANDSHAPES[name]), { f: orthoTo(norm([r(), r(), r()]), n), n }, [0.1, -0.2, -0.4], false);
      expect(classifyShape(shapeFeatures(lm))[0]!.shape, name).toBe(name);
    }
  });
});

describe('English → ASL gloss', () => {
  it('drops articles and "be", and keeps known signs', () => expect(gl('I am a student and the dog is happy')).toBe('ME DOG HAPPY'));
  it('does not sign "it" as a person', () => expect(gl('Is it hot?')).toBe('HOT'));
  it('moves question words to the end and furrows the brows', () => {
    expect(gl('What is your name?')).toBe('YOUR NAME WHAT');
    expect(gl('Where is the bathroom?')).toBe('BATHROOM WHERE');
    expect(en.toSigns('Where is the bathroom?', ASL).face.brows).toBe(-1);
  });
  it('raises the brows for yes/no questions', () => expect(en.toSigns('Are you deaf?', ASL).face.brows).toBe(1));
  it('puts time first', () => expect(gl('I will go to school tomorrow')).toBe('TOMORROW ME WILL GO SCHOOL'));
  it('marks negation with a headshake', () => {
    const t = en.toSigns("I don't understand", ASL);
    expect(t.signs.map((s) => s.gloss)).toEqual(['ME', 'NOT', 'UNDERSTAND']);
    expect(t.face.headshake).toBe(true);
    expect(t.negated).toContain(1);
  });
  it('marks past tense with FINISH when no time sign says when', () => {
    expect(gl('I ate')).toBe('ME EAT FINISH');
    expect(gl('Yesterday I ate')).toBe('YESTERDAY ME EAT');
  });
  it('uses set phrases and lemmas, and reports words with no sign', () => {
    expect(gl('Nice to meet you')).toBe('NICE MEET YOU');
    expect(gl('I love you')).toBe('I-LOVE-YOU');
    expect(gl('my friends')).toBe('MY FRIEND IX-A');   // a person is placed in space (grammar.test.ts)
    expect(en.toSigns('My name is Jordan', ASL).missing).toEqual(['jordan']);
  });
});

describe('ASL gloss → English', () => {
  it('reads common patterns back as English', () => {
    expect(en.fromGlosses(['YOUR', 'NAME', 'WHAT'])).toBe('What is your name?');
    expect(en.fromGlosses(['YOU', 'WANT', 'WHAT'])).toBe('What do you want?');
    expect(en.fromGlosses(['ME', 'NOT', 'UNDERSTAND'])).toBe("I don't understand.");
    expect(en.fromGlosses(['HELLO'])).toBe('Hello.');
    expect(en.fromGlosses(['ME', 'EAT', 'FINISH'])).toBe('I eat already.');
    expect(en.fromGlosses(['TOMORROW', 'ME', 'GO', 'SCHOOL'])).toBe('Tomorrow I go school.');
  });
});

// The recognizer, end to end: the avatar signs, a virtual camera films it (with tracking noise), the
// recognizer reads it. This proves the pipeline and that the signs are distinguishable from each other; it
// does NOT measure accuracy on real people, which needs real signers on camera.
describe('recognizer (synthetic camera)', () => {
  it('recognizes every sign on its own', () => {
    const missed: string[] = [];
    for (const s of RECOGNIZED) {
      const r = roundTrip([s], RECOGNIZED, { jitter: 0.01 });
      if (r.length !== 1 || r[0]!.best?.gloss !== s.gloss) missed.push(`${s.gloss}→${r.map((x) => x.best?.gloss ?? '?').join(',')}`);
    }
    expect(missed).toEqual([]);
  }, 60000);

  it('reads continuous sentences with no pauses between signs', () => {
    for (const g of [['YOUR', 'NAME', 'WHAT'], ['ME', 'LEARN', 'SIGN'], ['TOMORROW', 'ME', 'GO', 'SCHOOL'], ['HELLO', 'NICE', 'MEET', 'YOU'], ['BATHROOM', 'WHERE']]) {
      const got = roundTrip(g.map((x) => signByGloss(x)!), RECOGNIZED, { jitter: 0.01, gap: 0 }).map((x) => x.best?.gloss ?? '?');
      expect(got).toEqual(g);
    }
  }, 60000);

  it('copes with slower signing and a differently sized signer', () => {
    let ok = 0;
    for (const s of RECOGNIZED) {
      const a = roundTrip([s], RECOGNIZED, { jitter: 0.01, tempo: 0.7 });
      const b = roundTrip([s], RECOGNIZED, { jitter: 0.01, space: 0.9 });
      ok += Number(a.length === 1 && a[0]!.best?.gloss === s.gloss) + Number(b.length === 1 && b[0]!.best?.gloss === s.gloss);
    }
    expect(ok / (2 * RECOGNIZED.length)).toBeGreaterThan(0.95);
  }, 120000);

  it('says little when the hands just move around', () => {
    const r = noise(5);
    let outs = 0;
    for (let k = 0; k < 20; k++) {
      const shape = localHand(HANDSHAPES[SHAPE_NAMES[Math.floor(((r() + 1) / 2) * SHAPE_NAMES.length) % SHAPE_NAMES.length]!]);
      const pts = Array.from({ length: 5 }, () => [r() * 0.5, r() * 0.6 - 0.1, -0.4] as const);
      const rec = new Recognizer(RECOGNIZED);
      for (let t = 0; t < 4; t += 1 / 30) {
        const i = Math.min(3, Math.floor(t)), f = t - i, a = pts[i]!, b = pts[i + 1]!;
        const n = norm([0.3, 0.2, -1]);
        const lm = placeHand(shape, { f: orthoTo([0.1, 1, 0], n), n }, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, -0.4], false);
        outs += (rec.push(toBody(toCamera(t, lm, null))!) ?? []).filter((o) => o.best).length;
      }
      outs += (rec.flush() ?? []).filter((o) => o.best).length;
    }
    expect(outs).toBeLessThanOrEqual(6);   // about one false sign per 13 s of random movement
  }, 60000);

  it('handles a left-handed signer when told to', () => {
    const s = signByGloss('THANK-YOU')!;
    const tl = timeline([s]);
    const rec = new Recognizer(RECOGNIZED);
    const out: string[] = [];
    for (let t = 0; t <= tl.total + 0.3; t += 1 / 30) {
      const f = frameAt(tl, t);
      // Mirror the whole signer: their left hand now leads.
      const m = (l: typeof f.right) => l.map((p) => [-p[0], p[1], p[2]] as const) as unknown as typeof f.right;
      const seen = (l: typeof f.right) => l[0]![1] > -0.9;
      // Mirrored, the avatar's right hand is a physical left hand: pass it as the camera's left hand.
      const cam = toCamera(t, seen(f.left) ? m(f.left) : null, seen(f.right) ? m(f.right) : null);
      for (const o of rec.push(toBody(cam, true)!) ?? []) if (o.best) out.push(o.best.gloss);
    }
    for (const o of rec.flush() ?? []) if (o.best) out.push(o.best.gloss);
    expect(out).toEqual(['THANK-YOU']);
  });
});
