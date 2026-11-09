/**
 * ASL grammar rules beyond word order, as config plus small pure sign builders. en.ts decides where a rule
 * applies; these functions only build the inflected forms:
 *
 * - referents: people talked about get a place in signing space (a locus), set up with an index point after
 *   their first mention and pointed back to by pronouns
 * - directional verbs move from the subject's place to the object's (1GIVE2: "I give you")
 * - reduplication marks plurals and aspect (continuous, habitual)
 * - negation is incorporated into some verbs (DON'T-KNOW) and carried by a headshake over the predicate
 * - time words move along the time line (forward = future, back = past)
 * - topics, conditionals and rhetorical questions are marked on the face (see Mark in sign.ts)
 *
 * These are the common textbook patterns; a fluent signer has not reviewed them.
 */
import type { Dir, Loc } from '../asl/body';
import type { BaseSpec, SignDef } from '../asl/sign';

export const GRAMMAR = {
  /** Places in signing space, given out in this order to the people a passage mentions. */
  loci: ['locusA', 'locusB', 'locusC'] as const satisfies readonly Loc[],
  /** Signs for people: they get a locus. Names spelled out count too. */
  referents: new Set(['MOTHER', 'FATHER', 'FRIEND', 'TEACHER', 'DOCTOR', 'BABY', 'BOY', 'GIRL', 'MAN', 'WOMAN', 'PERSON', 'FAMILY']),
  /** Point to a referent's locus right after its first mention. */
  indexAfterReferent: true,
  /** Verbs that move between the subject's and the object's places. */
  directional: new Set(['GIVE', 'HELP', 'ASK', 'TELL', 'SHOW', 'SEND', 'PAY']),
  /** Where "me" and "you" are for a directional verb. */
  me: 'meNear' as Loc,
  you: 'youFar' as Loc,
  /** Nouns whose plural is made by repeating the sign along a line. */
  pluralRedup: new Set(['BOOK', 'HOME', 'SCHOOL', 'PHONE']),
  /** Signs that already say how many (no plural reduplication after them). */
  quantifiers: new Set(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'MANY', 'ALL', 'HOW-MANY']),
  /** How many times a reduplicated sign is made. */
  redupN: 3,
  /** Words that mark an ongoing action (continuous aspect); dropped once the verb carries it. */
  continuousCues: ['keep', 'keeps', 'kept', 'keeping', 'continue', 'continues', 'continued'],
  /** Words and phrases that mark a regular action (habitual aspect). */
  habitualCues: ['all the time', 'over and over', 'every day', 'always', 'constantly', 'continually', 'regularly'],
  /** Verbs with their own negative form: the palm turns as the hand moves out. */
  negIncorporated: {
    KNOW: { gloss: "DON'T-KNOW", palm: 'fwd' as Dir },
    WANT: { gloss: "DON'T-WANT", palm: 'down' as Dir },
    LIKE: { gloss: "DON'T-LIKE", palm: 'down' as Dir },
  } as Record<string, { gloss: string; palm: Dir }>,
  /** Signs that negate the rest of their clause (headshake from here to the end). */
  negators: new Set(['NOT', 'CANT']),
  /** "next week", "last week": time units that can move along the time line. */
  timeUnits: { week: 'WEEK', weeks: 'WEEK', day: 'DAY', days: 'DAY' } as Record<string, string>,
  timeShift: { next: 'fwd', coming: 'fwd', last: 'back', past: 'back', previous: 'back' } as Record<string, 'fwd' | 'back'>,
  /** "If …, …" / "Suppose …, …": the condition is signed with raised brows. */
  conditional: /^(if|suppose|supposing|imagine)\s+(.+?)(?:\s*,\s*|\s+then\s+)(?:then\s+)?(.+)$/,
  /** "As for X, …": X is a topic (raised brows), then the comment. */
  topic: /^(?:as for|about|regarding|speaking of)\s+(.+?)\s*,\s*(.+)$/,
  /** "Coffee, I like it": a short fronted noun phrase before a comma is a topic. */
  frontedTopic: /^([a-z' ]{2,30}?)\s*,\s*(.+)$/,
  frontedTopicMaxWords: 3,
};

export type Locus = (typeof GRAMMAR.loci)[number];

const TAG: Partial<Record<Loc, string>> = { meNear: '1', youFar: '2', locusA: '3a', locusB: '3b', locusC: '3c' };
const POINT: Record<Locus, Dir> = { locusA: 'out+fwd', locusB: 'in+fwd', locusC: 'fwd' };
const LETTER: Record<Locus, string> = { locusA: 'A', locusB: 'B', locusC: 'C' };

/** An index point to a locus (IX-A), built from the lexicon's pointing sign. A plural referent sweeps. */
export function pointTo(ix: SignDef, locus: Locus, plural = false, word = 'there'): SignDef {
  const s: SignDef = {
    ...ix, gloss: `IX-${LETTER[locus]}`, recognize: false, en: [word],
    how: plural ? 'Index sweeps across the place set up for them.' : 'Index points to the place set up for that person.',
    dom: { ...ix.dom, fingers: POINT[locus], loc: 'neutral', path: undefined, reps: undefined, to: { loc: locus } },
  };
  return plural ? withRedup(s, 'plural') : s;
}

const DEFAULT_BASE: BaseSpec = { shape: 'B', palm: 'up', fingers: 'fwd+in', loc: 'neutral', contact: 'palm' };

/** A directional verb from one place to another (1GIVE2 = "I give you"). */
export function directed(verb: SignDef, from: Loc, to: Loc): SignDef {
  const d = verb.dom;
  const toSpec = { ...d.to, loc: to, move: undefined, dist: undefined };
  const gloss = `${TAG[from] ?? ''}${verb.gloss}${TAG[to] ?? ''}`;
  const how = `${verb.how} Moves from ${TAG[from] === '1' ? 'the signer' : TAG[from] === '2' ? 'you' : 'their place'} to ${TAG[to] === '1' ? 'the signer' : TAG[to] === '2' ? 'you' : 'their place'}.`;
  // From the signer, the sign starts where it always does (TELL from the chin); from elsewhere it starts there.
  const fromMe = from === GRAMMAR.me;
  if (verb.two === 'base') {
    // the base hand moves to the start place; the dominant hand starts on it and travels to the end place
    return { ...verb, gloss, how, recognize: false, base: { ...(verb.base ?? DEFAULT_BASE), ...(fromMe ? {} : { loc: from }) }, dom: { ...d, to: toSpec } };
  }
  return { ...verb, gloss, how, recognize: false, dom: { ...d, loc: fromMe ? d.loc : from, to: toSpec } };
}

/** A verb's own negative form (DON'T-KNOW): the hand moves out as the palm turns. */
export function negIncorporate(verb: SignDef): SignDef | null {
  const n = GRAMMAR.negIncorporated[verb.gloss];
  if (!n) return null;
  return {
    ...verb, gloss: n.gloss, recognize: false, en: [`don't ${verb.en[0]}`], how: `${verb.how} Then the hand twists out, palm ${n.palm === 'fwd' ? 'forward' : 'down'}: not.`,
    dom: { ...verb.dom, path: 'line', reps: 1, to: { ...verb.dom.to, loc: undefined, move: 'out+fwd', dist: 0.22, palm: n.palm } },
  };
}

/** A time sign moved along the time line: forward is the future, back the past (NEXT-WEEK, LAST-WEEK). */
export function onTimeLine(unit: SignDef, dir: 'fwd' | 'back'): SignDef {
  return {
    ...unit, gloss: `${dir === 'fwd' ? 'NEXT' : 'LAST'}-${unit.gloss}`, recognize: false,
    en: [`${dir === 'fwd' ? 'next' : 'last'} ${unit.en[0]}`],
    how: `${unit.how} It arcs ${dir === 'fwd' ? 'forward: the future' : 'back: the past'}.`,
    dom: { ...unit.dom, path: 'arc', axis: 'up', size: 0.06, to: { ...unit.dom.to, loc: undefined, move: dir === 'fwd' ? 'fwd+up' : 'back+up', dist: 0.25 } },
  };
}

/** A sign made several times: plural, continuous or habitual. */
export function withRedup(s: SignDef, kind: 'plural' | 'continuous' | 'habitual'): SignDef {
  return { ...s, recognize: false, redup: { kind, n: GRAMMAR.redupN } };
}
