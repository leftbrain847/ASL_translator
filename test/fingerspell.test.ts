import { describe, expect, it } from 'vitest';
import { ALPHABET, fingerspell, spelledGloss } from '../src/asl/fingerspell';
import { HANDSHAPES } from '../src/asl/hand';
import { evaluate, frameAt, timeline } from '../src/asl/motion';
import { SHAPE_LABEL, signParts } from '../src/asl/parts';
import { faceShown, faceStep } from '../src/client/avatar';
import { ASL, SPOKEN } from '../src/lang';

const en = SPOKEN[0]!;
const tr = (text: string) => en.toSigns(text, ASL);

describe('manual alphabet', () => {
  it('has a known handshape for every letter and digit', () => {
    for (const ch of 'abcdefghijklmnopqrstuvwxyz0123456789') {
      const L = ALPHABET[ch];
      expect(L, ch).toBeDefined();
      expect(HANDSHAPES[L!.shape], ch).toBeDefined();
      expect(SHAPE_LABEL[L!.shape], ch).toMatch(/\S/);
    }
  });
  it('J and Z trace their letter; the rest are held', () => {
    const [j] = fingerspell('j'), [z] = fingerspell('z'), [a] = fingerspell('a');
    expect(j!.dom.path).toBe('arc');
    expect(z!.dom.path).toBe('zigzag');
    expect(a!.dom.path).toBeUndefined();
    const z0 = evaluate(z!, 0).right.wrist, z1 = evaluate(z!, 1).right.wrist;
    expect(Math.hypot(z1[0] - z0[0], z1[1] - z0[1])).toBeGreaterThan(0.1);
  });
  it('slides a doubled letter out a little', () => {
    const [, , l1, l2] = fingerspell('hello');
    expect(l1!.dom.to).toBeUndefined();
    expect(l2!.dom.to?.move).toBe('out');
  });
  it('every letter makes a finite pose and readable chips', () => {
    for (const s of fingerspell('abcdefghijklmnopqrstuvwxyz0123456789')) {
      for (const u of [0, 0.5, 1]) for (const v of evaluate(s, u).right.wrist) expect(Number.isFinite(v), s.gloss).toBe(true);
      for (const v of Object.values(signParts(s))) expect(v).toMatch(/\S/);
    }
  });
  it('glosses a spelled word with dashes', () => expect(spelledGloss('Jordan')).toBe('J-O-R-D-A-N'));
});

describe('spelling words with no sign', () => {
  it('spells unknown words instead of skipping them', () => {
    const t = tr('My name is Jordan');
    expect(t.spelled).toEqual(['jordan']);
    expect(t.missing).toEqual([]);
    expect(t.signs.map((s) => s.gloss)).toEqual(['MY', 'NAME', 'FS-J', 'FS-O', 'FS-R', 'FS-D', 'FS-A', 'FS-N']);
    expect(t.tokens.find((k) => k.words === 'jordan')?.gloss).toBe('J-O-R-D-A-N');
  });
  it('spells numbers that have no sign, digit by digit', () => expect(tr('25').signs.map((s) => s.gloss)).toEqual(['FS-2', 'FS-5']));
  it('places a name in space like a person, but not when it is what someone is called', () => {
    const g = tr('Jordan helps me.').signs.map((s) => s.gloss);
    expect(g.slice(6)).toEqual(['IX-A', '3aHELP1']);
    expect(tr('My name is Jordan').signs.some((s) => s.gloss.startsWith('IX-'))).toBe(false);
  });
  it('spreads grammar spans over every letter of a spelled word', () => {
    const t = tr('Where is Jordan?');
    expect(t.marks).toEqual([{ from: 0, to: 7, brows: -1, kind: 'wh' }]);   // J-O-R-D-A-N IX-A WHERE
    const n = tr("I don't like Jordan");
    expect(n.negated).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);   // DON'T-LIKE J-O-R-D-A-N IX-A
  });
  it('spells quickly: letters of one word take a fraction of a sign each', () => {
    const tl = timeline(fingerspell('jordan'));
    const signing = tl.signs[5]!.end - tl.signs[0]!.start;
    expect(signing / 6).toBeLessThan(0.5);   // a held sign alone takes 0.7 s
  });
});

describe('grammar face', () => {
  const face = (brows: number, shake = false) => ({ brows, yaw: 0, tilt: 0, shake });
  it('shows only for grammar on the face', () => {
    expect(faceShown(face(0))).toBe(false);
    expect(faceShown(face(1))).toBe(true);
    expect(faceShown(face(-1))).toBe(true);
    expect(faceShown(face(0, true))).toBe(true);
  });
  it('fades in and out rather than popping', () => {
    const half = faceStep(0, true, 80);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
    expect(faceStep(1, false, 1000)).toBe(0);
  });
  it('a plain statement never shows the face; a question shows it while signing', () => {
    const plain = tr('I like coffee');
    const tlP = timeline(plain.signs, plain.face, plain.negated, 0, plain.marks);
    for (let t = 0; t < tlP.total; t += 0.05) expect(faceShown(frameAt(tlP, t).face)).toBe(false);
    const q = tr('Where is Jordan?');
    const tlQ = timeline(q.signs, q.face, q.negated, 0, q.marks);
    const mid = (tlQ.signs[2]!.start + tlQ.signs[2]!.end) / 2;
    expect(frameAt(tlQ, mid).face.brows).toBe(-1);
    expect(faceShown(frameAt(tlQ, 0).face)).toBe(false);
  });
});
