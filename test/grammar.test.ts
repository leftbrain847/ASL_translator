import { describe, expect, it } from 'vitest';
import { LEXICON, RECOGNIZED } from '../src/asl/lexicon';
import { evaluate, frameAt, signDuration, timeline } from '../src/asl/motion';
import { signParts } from '../src/asl/parts';
import { ASL, SPOKEN } from '../src/lang';

const en = SPOKEN[0]!;
const tr = (text: string) => en.toSigns(text, ASL);
const gl = (text: string) => tr(text).signs.map((s) => s.gloss).join(' ');

describe('topics and conditionals', () => {
  it('fronts a marked topic with raised brows over it', () => {
    const t = tr('As for my mother, she is deaf.');
    expect(t.signs.map((s) => s.gloss)).toEqual(['MY', 'MOTHER', 'IX-A', 'IX-A', 'DEAF']);
    expect(t.marks).toContainEqual({ from: 0, to: 2, brows: 1, kind: 'topic' });
  });
  it('treats a short fronted phrase before a comma as a topic', () => {
    const t = tr('Coffee, I like it.');
    expect(t.signs.map((s) => s.gloss)).toEqual(['COFFEE', 'ME', 'LIKE']);
    expect(t.marks[0]).toEqual({ from: 0, to: 0, brows: 1, kind: 'topic' });
  });
  it('signs a condition first with IF and raised brows, then the result', () => {
    const t = tr('If you are tired, go home.');
    expect(t.signs.map((s) => s.gloss)).toEqual(['IF', 'YOU', 'TIRED', 'GO', 'HOME']);
    expect(t.marks).toEqual([{ from: 0, to: 2, brows: 1, kind: 'cond' }]);
  });
  it('keeps a question face on the result of a condition only', () => {
    const t = tr('Suppose it is cold, will you come?');
    expect(t.signs[0]!.gloss).toBe('SUPPOSE');
    expect(t.marks.map((m) => m.kind)).toEqual(['cond', 'yn']);
  });
});

describe('questions', () => {
  it('furrows for a WH-question and raises for yes/no, across the whole question', () => {
    expect(tr('Where is the bathroom?').marks).toEqual([{ from: 0, to: 1, brows: -1, kind: 'wh' }]);
    expect(tr('Are you deaf?').marks).toEqual([{ from: 0, to: 1, brows: 1, kind: 'yn' }]);
  });
  it('signs a question the signer answers as rhetorical: raised brows, WH word last, then the answer', () => {
    const t = tr('Why am I tired? I work at night.');
    expect(t.signs.slice(0, 3).map((s) => s.gloss)).toEqual(['ME', 'TIRED', 'WHY']);
    expect(t.marks[0]).toEqual({ from: 0, to: 2, brows: 1, kind: 'rhet' });
    expect(t.face.brows).toBe(0);
  });
});

describe('signing space', () => {
  it('places a person, points to them once, and points back for pronouns across sentences', () => {
    const t = tr('My father is a doctor. He likes coffee.');
    expect(t.signs.map((s) => s.gloss)).toEqual(['MY', 'FATHER', 'IX-A', 'DOCTOR', 'IX-B', 'IX-B', 'LIKE', 'COFFEE']);
    expect(t.signs[2]!.dom.to?.loc).toBe('locusA');
  });
  it('gives the next person the next place', () => {
    const g = gl('My mother and my father');
    expect(g).toBe('MY MOTHER IX-A MY FATHER IX-B');
  });
});

describe('directional verbs', () => {
  it('moves from me to you and absorbs the pronouns', () => {
    const t = tr('I give you a book.');
    expect(t.signs.map((s) => s.gloss)).toEqual(['1GIVE2', 'BOOK']);
    expect(t.signs[0]!.dom.to?.loc).toBe('youFar');
  });
  it('moves from a placed person to me', () => {
    const g = gl('My mother is here. She helps me.');
    expect(g).toContain('3aHELP1');
    expect(g).not.toMatch(/IX-A 3aHELP1 ME/);
  });
  it('reads an imperative toward me as from you', () => expect(gl('Help me')).toBe('2HELP1'));
  it('keeps the citation form when nobody is named', () => expect(gl('I want to help')).toBe('ME WANT HELP'));
});

describe('plurals and aspect', () => {
  it('repeats a plural noun along a line, but not after a number', () => {
    const t = tr('I read books');
    const book = t.signs.find((s) => s.gloss === 'BOOK')!;
    expect(book.redup).toEqual({ kind: 'plural', n: 3 });
    expect(tr('two books').signs.find((s) => s.gloss === 'BOOK')!.redup).toBeUndefined();
  });
  it('marks continuous and habitual aspect on the verb and drops the cue words', () => {
    const c = tr('I keep working');
    expect(c.signs.map((s) => s.gloss)).toEqual(['ME', 'WORK']);
    expect(c.signs[1]!.redup?.kind).toBe('continuous');
    expect(tr('I always drink coffee').signs.find((s) => s.gloss === 'DRINK')!.redup?.kind).toBe('habitual');
  });
  it('a reduplicated sign takes longer and moves between repetitions', () => {
    const book = tr('books').signs[0]!;
    const plain = LEXICON.find((s) => s.gloss === 'BOOK')!;
    expect(signDuration(book)).toBeGreaterThan(signDuration(plain) * 2);
    const a = evaluate(book, 0.1).right.wrist, b = evaluate(book, 0.9).right.wrist;
    expect(Math.abs(a[0] - b[0])).toBeGreaterThan(0.15);
  });
});

describe('negation', () => {
  it('uses a verb’s own negative form when it has one', () => {
    const t = tr("I don't know");
    expect(t.signs.map((s) => s.gloss)).toEqual(['ME', "DON'T-KNOW"]);
    expect(t.negated).toEqual([1]);
  });
  it('shakes the head from NOT to the end of the clause, not over the subject', () => {
    const t = tr("I don't understand");
    expect(t.negated).toEqual([1, 2]);
  });
});

describe('time line', () => {
  it('moves a time unit forward for the future and back for the past, and puts it first', () => {
    expect(gl('I will go to school next week')).toBe('NEXT-WEEK ME WILL GO SCHOOL');
    const last = tr('last week').signs[0]!;
    expect(last.gloss).toBe('LAST-WEEK');
    expect(last.dom.to?.move).toBe('back+up');
  });
});

describe('the face follows the marks in time', () => {
  it('raises the brows only during the topic', () => {
    const t = tr('Coffee, I like it.');
    const tl = timeline(t.signs, t.face, t.negated, 0, t.marks);
    const mid = (i: number) => (tl.signs[i]!.start + tl.signs[i]!.end) / 2;
    expect(frameAt(tl, mid(0)).face.brows).toBe(1);
    expect(frameAt(tl, mid(2)).face.brows).toBe(0);
  });
});

describe('every grammatical form still makes a drawable sign', () => {
  it('all generated signs have finite poses and chips', () => {
    for (const text of ['I give you a book.', 'My mother helps me.', 'I keep working', 'I read books', "I don't like coffee", 'last week', 'If you are tired, go home.']) {
      for (const s of tr(text).signs) {
        for (const u of [0, 0.3, 0.7, 1]) for (const v of evaluate(s, u).right.wrist) expect(Number.isFinite(v), `${s.gloss}`).toBe(true);
        for (const v of Object.values(signParts(s))) expect(v).toMatch(/\S/);
      }
    }
  });
});

describe('recognizer subset', () => {
  it('covers every sign marked recognize, and grammar forms are avatar-only', () => {
    expect(RECOGNIZED.length).toBe(LEXICON.filter((s) => s.recognize).length);
    expect(RECOGNIZED.length).toBeGreaterThanOrEqual(131);
    expect(RECOGNIZED.find((s) => s.gloss === 'IF')).toBeUndefined();
    expect(ASL.recognized).toBe(RECOGNIZED);
  });
});
