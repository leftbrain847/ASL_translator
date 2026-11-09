/**
 * English ⇄ ASL gloss. Not word-for-word: ASL drops articles and "be", puts time first, puts question words
 * last, marks questions on the face (raised brows for yes/no, furrowed for WH) and negation with a headshake.
 * On top of that (rules and config in grammar.ts): topics and conditionals with raised brows, rhetorical
 * questions, people placed in signing space and pointed back to, directional verbs, plural and aspect
 * reduplication, incorporated negation with a headshake over the predicate, and time-line inflection.
 * These are common textbook patterns; real ASL grammar (classifiers, role shift) is richer still.
 */
import type { Loc } from '../asl/body';
import type { Mark, SignDef } from '../asl/sign';
import { directed, GRAMMAR, negIncorporate, onTimeLine, pointTo, withRedup, type Locus } from './grammar';
import type { SignLanguage, SpokenLanguage, Token, Translation } from './types';

/** Words ASL leaves out. */
const DROP = new Set(['it', 'a', 'an', 'the', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'do', 'does', 'did',
  'um', 'uh', 'so', 'very', 'really', 'just', 'and', 'that', 'this', 'at', 'in', 'on', 'for', 'some', 'any']);

/** Whole phrases with a set ASL rendering (checked before single words). */
const PHRASES: readonly [string, string[]][] = [
  ['nice to meet you', ['NICE', 'MEET', 'YOU']],
  ['how are you', ['HOW', 'YOU']],
  ['see you later', ['SEE', 'YOU', 'LATER']],
  ['what is your name', ['YOUR', 'NAME', 'WHAT']],
  ['my name is', ['MY', 'NAME']],
  ['excuse me', ['EXCUSE', 'ME']],
  ['good morning', ['GOOD', 'MORNING']],
  ['good night', ['GOOD', 'NIGHT']],
  ['i do not know', ['ME', 'NOT', 'KNOW']],   // becomes ME DON'T-KNOW (grammar.ts)
  ["i don't know", ['ME', 'NOT', 'KNOW']],
];

const CONTRACTIONS: readonly [RegExp, string][] = [
  [/\bi'm\b/g, 'i am'], [/\byou're\b/g, 'you are'], [/\bwe're\b/g, 'we are'], [/\bthey're\b/g, 'they are'],
  [/\b(it|he|she|what|where|who|how|that)'s\b/g, '$1 is'], [/\bi'll\b/g, 'i will'], [/\byou'll\b/g, 'you will'],
  [/\bi've\b/g, 'i have'], [/\bi'd\b/g, 'i would'], [/\blet's\b/g, 'we'],
];

const WH = new Set(['WHAT', 'WHERE', 'WHO', 'WHEN', 'WHY', 'HOW', 'WHICH', 'HOW-MANY']);
const TIME = new Set(['NOW', 'TOMORROW', 'YESTERDAY', 'MORNING', 'NIGHT', 'WEEK']);
const QUESTION_START = /^(do|does|did|are|is|am|can|could|will|would|have|has|should|was|were)\b/;
const WH_START = /^(what|where|who|whom|when|why|how|which)\b/;
/** Words ending in -ed that are not past tense. */
const NOT_PAST = new Set(['need', 'feed', 'tired', 'bed', 'red', 'named', 'excited', 'interested', 'scared', 'married']);
const PAST_IRREGULAR = new Set(['went', 'ate', 'saw', 'came', 'drank', 'knew', 'thought', 'taught', 'forgot', 'heard', 'felt', 'met',
  'said', 'told', 'wrote', 'drove', 'slept', 'had', 'got', 'understood', 'gone', 'done', 'seen']);

/** Plain lemmatizer: enough to find "walked"→"walk", "dogs"→"dog", "running"→"run". */
function lemmas(w: string): string[] {
  const out: string[] = [];
  if (w.endsWith("'s")) out.push(w.slice(0, -2));
  if (w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) out.push(w.slice(0, -2));
  if (w.endsWith('s')) out.push(w.slice(0, -1));
  if (w.endsWith('ed')) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) out.push(w.slice(0, -3), w.slice(0, -3) + 'e', w.slice(0, -4));
  if (w.endsWith('ly')) out.push(w.slice(0, -2));
  return out.filter((x) => x.length > 1);
}

function indexFor(lang: SignLanguage): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of lang.lexicon) for (const e of s.en) if (!m.has(e)) m.set(e, s.gloss);
  return m;
}

const INDEX_CACHE = new WeakMap<SignLanguage, Map<string, string>>();

export const english: SpokenLanguage = {
  code: 'en',
  label: 'English',
  speechLang: 'en-US',

  toSigns(text: string, lang: SignLanguage): Translation {
    let index = INDEX_CACHE.get(lang);
    if (!index) INDEX_CACHE.set(lang, (index = indexFor(lang)));
    const raw = text.toLowerCase().replace(/[’‘]/g, "'").trim();
    const sentences = raw.split(/(?<=[?.!])\s+/).map((x) => x.trim()).filter(Boolean);
    const ctx: Ctx = { lang, index, loci: new Map(), next: 0, last: null };
    const out: Part = { tokens: [], entries: [], marks: [], negated: [] };
    let yn = false, wh = false;
    sentences.forEach((sen, si) => {
      const kind = questionKind(sen);
      // A WH-question answered by the signer in the next sentence is rhetorical: raised brows, not furrowed.
      const rhet = kind === 'wh' && si < sentences.length - 1 && !questionKind(sentences[si + 1]!);
      const k: QKind = rhet ? 'rhet' : kind;
      if (k === 'yn') yn = true;
      if (k === 'wh') wh = true;
      append(out, sentence(sen, ctx, k));
    });
    const signs = out.entries.map((e) => e.sign);
    const marks = out.marks.filter((m) => m.from <= m.to && m.to < signs.length);
    return {
      tokens: out.tokens,
      signs,
      face: { brows: wh ? -1 : yn ? 1 : 0, headshake: out.negated.length > 0 },
      negated: out.negated,
      marks,
      missing: out.tokens.filter((t) => !t.gloss).map((t) => t.words),
    };
  },

  fromGlosses(glosses: readonly string[]): string {
    if (!glosses.length) return '';
    const g = [...glosses];
    // The subject is the first sign after any time signs ("TOMORROW ME GO" → "tomorrow I go").
    const subject = g.findIndex((x) => !TIME.has(x));
    const word = (x: string, i: number): string => {
      switch (x) {
        case 'ME': return i === subject || i === 0 ? 'I' : 'me';
        case 'HE-SHE': return i === subject || i === 0 ? 'they' : 'them';
        case 'I-LOVE-YOU': return 'I love you';
        case 'THANK-YOU': return 'thank you';
        case 'CANT': return "can't";
        case 'NOT': return 'not';
        case 'HOW-MANY': return 'how many';
        case 'NOW': return 'now';
        default: return SIGN_WORD.get(x) ?? x.toLowerCase().replace(/-/g, ' ');
      }
    };
    const last = g[g.length - 1]!;
    let text: string;
    if (WH.has(last) && g.length > 1) {
      const rest = g.slice(0, -1).map((x, i) => word(x, i + 1)).join(' ');
      const verb = g.slice(0, -1).some((x) => VERBS.has(x));
      text = `${word(last, 0)} ${verb ? 'do' : 'is'} ${rest}?`;
    } else {
      let words = g.map((x, i) => word(x, i));
      if (g.length > 1 && last === 'FINISH') words = [...words.slice(0, -1), 'already'];
      text = words.join(' ').replace(/\bnot (\w+)/, (_m, v: string) => `don't ${v}`).replace(/\bI (\w+) not\b/, "I don't $1");
      text += '.';
    }
    text = text.replace(/\bI\b/g, 'I');
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
};

/** Signs that act as verbs, for "what do you want?" vs "what is your name?". */
const VERBS = new Set(['WANT', 'NEED', 'LIKE', 'LOVE', 'KNOW', 'THINK', 'UNDERSTAND', 'LEARN', 'TEACH', 'SEE', 'HEAR', 'FEEL', 'HELP',
  'GO', 'COME', 'EAT', 'DRINK', 'WORK', 'PLAY', 'READ', 'WRITE', 'SIGN', 'TALK', 'ASK', 'DRIVE', 'SLEEP', 'HAVE', 'LIVE', 'TRY', 'PRACTICE',
  'REMEMBER', 'FORGET', 'MEET', 'WAIT', 'STOP', 'GIVE', 'TELL', 'SHOW', 'SEND', 'PAY']);

/** First English word of each sign, filled from the lexicon by `setLexiconWords`. */
const SIGN_WORD = new Map<string, string>();
export function setLexiconWords(lexicon: readonly SignDef[]): void {
  for (const s of lexicon) SIGN_WORD.set(s.gloss, s.en[0]!);
}

// ---------------------------------------------------------------- sentence structure

type QKind = 'yn' | 'wh' | 'rhet' | null;

interface Entry {
  sign: SignDef;
  /** The words it came from ('' for signs grammar added). */
  words: string;
  /** The place in signing space this sign stands for (people, ME, YOU). */
  locus?: Loc;
  /** A pronoun (or ME/YOU) that a directional verb can absorb. */
  pron?: boolean;
  /** A plural noun ("books"). */
  plural?: boolean;
  drop?: boolean;
}

interface Part { tokens: Token[]; entries: Entry[]; marks: Mark[]; negated: number[] }

interface Ctx {
  lang: SignLanguage;
  index: Map<string, string>;
  /** Referent gloss (or spelled name) → its locus, kept across the sentences of one passage. */
  loci: Map<string, Locus>;
  next: number;
  last: Locus | null;
}

function questionKind(sen: string): QKind {
  const s = sen.trim();
  const q = s.endsWith('?') || QUESTION_START.test(s) || WH_START.test(s);
  if (!q) return null;
  return WH_START.test(s) || /\b(what|where|who|whom|when|why|how|which)\b/.test(s) ? 'wh' : 'yn';
}

function append(out: Part, p: Part): void {
  const off = out.entries.length;
  out.tokens.push(...p.tokens);
  out.entries.push(...p.entries);
  out.marks.push(...p.marks.map((m) => ({ ...m, from: m.from + off, to: m.to + off })));
  out.negated.push(...p.negated.map((i) => i + off));
}

const span = (p: Part, brows: number, kind: Mark['kind']): Mark[] => (p.entries.length ? [{ from: 0, to: p.entries.length - 1, brows, kind }] : []);

/** A sentence: an optional condition or topic (raised brows), then the main clause (with its question face). */
function sentence(sen: string, ctx: Ctx, kind: QKind): Part {
  const s = sen.replace(/[?.!]+$/, '').trim();
  const qMark = (p: Part): Mark[] => (kind ? span(p, kind === 'wh' ? -1 : 1, kind) : []);
  const cond = GRAMMAR.conditional.exec(s);
  if (cond) {
    const word = cond[1]!;
    const lead = ctx.lang.bySign(word === 'if' ? 'IF' : 'SUPPOSE');
    const a = clause(cond[2]!, ctx, null);
    if (lead) a.entries.unshift({ sign: lead, words: word }), shift(a, 1);
    a.marks = span(a, 1, 'cond');
    const b = clause(cond[3]!, ctx, kind);
    b.marks.push(...qMark(b));
    const out: Part = { tokens: [], entries: [], marks: [], negated: [] };
    append(out, a);
    append(out, b);
    return out;
  }
  const top = GRAMMAR.topic.exec(s) ?? frontedTopic(s, ctx);
  if (top) {
    const a = clause(top[1]!, ctx, null);
    a.marks = span(a, 1, 'topic');
    a.negated = [];
    const b = clause(top[2]!, ctx, kind);
    b.marks.push(...qMark(b));
    const out: Part = { tokens: [], entries: [], marks: [], negated: [] };
    append(out, a);
    append(out, b);
    return out;
  }
  const p = clause(s, ctx, kind);
  p.marks.push(...qMark(p));
  return p;
}

/** Shift a part's indices after inserting n entries at its front. */
function shift(p: Part, n: number): void {
  p.marks = p.marks.map((m) => ({ ...m, from: m.from + n, to: m.to + n }));
  p.negated = p.negated.map((i) => i + n);
}

/** "Coffee, I like it": a short phrase of known non-verb signs before a comma is a topic. */
function frontedTopic(s: string, ctx: Ctx): RegExpExecArray | null {
  const m = GRAMMAR.frontedTopic.exec(s);
  if (!m) return null;
  const words = m[1]!.trim().split(/\s+/).filter((w) => !DROP.has(w));
  if (!words.length || words.length > GRAMMAR.frontedTopicMaxWords) return null;
  const glosses = words.map((w) => ctx.index.get(w) ?? lemmas(w).map((l) => ctx.index.get(l)).find(Boolean));
  if (glosses.some((g) => !g || VERBS.has(g) || WH.has(g) || g === 'ME' || g === 'YOU' || GRAMMAR.negators.has(g))) return null;
  return m;
}

function locusFor(ctx: Ctx, key: string): { locus: Locus; fresh: boolean } {
  const had = ctx.loci.get(key);
  if (had) return { locus: had, fresh: false };
  const locus = GRAMMAR.loci[ctx.next % GRAMMAR.loci.length]!;
  ctx.next++;
  ctx.loci.set(key, locus);
  return { locus, fresh: true };
}

/** One clause: words → signs in ASL order, with the grammar rules applied. */
function clause(text: string, ctx: Ctx, kind: QKind): Part {
  const { lang, index } = ctx;
  let clean = ` ${text.replace(/[^a-z0-9' ]+/g, ' ')} `;
  for (const [rx, rep] of CONTRACTIONS) clean = clean.replace(rx, rep);
  // Aspect cues are dropped once the verb carries them.
  let aspect: 'continuous' | 'habitual' | null = null;
  for (const c of GRAMMAR.habitualCues) if (clean.includes(` ${c} `)) { aspect = 'habitual'; clean = clean.replace(` ${c} `, ' '); }
  const words = clean.split(/\s+/).filter(Boolean).filter((w) => {
    if (GRAMMAR.continuousCues.includes(w)) { aspect = 'continuous'; return false; }
    return true;
  });

  const tokens: Token[] = [];
  const entries: Entry[] = [];
  let past = false;
  const push = (sign: SignDef | undefined, w: string, gloss: string) => {
    tokens.push({ words: w, gloss });
    if (sign) entries.push({ sign, words: w });
  };
  for (let i = 0; i < words.length;) {
    // "next week", "last week": the unit moves along the time line.
    const dir = GRAMMAR.timeShift[words[i]!];
    const unit = dir && words[i + 1] ? GRAMMAR.timeUnits[words[i + 1]!] : undefined;
    const unitSign = unit ? lang.bySign(unit) : undefined;
    if (dir && unitSign) {
      const s = onTimeLine(unitSign, dir);
      push(s, `${words[i]} ${words[i + 1]}`, s.gloss);
      i += 2;
      continue;
    }
    // A set phrase, else the longest lexicon phrase (up to 3 words), else one word.
    const phrase = PHRASES.find(([p]) => words.slice(i, i + p.split(' ').length).join(' ') === p);
    if (phrase) {
      phrase[1].forEach((g, k) => push(lang.bySign(g), k === 0 ? phrase[0] : '', g));
      i += phrase[0].split(' ').length;
      continue;
    }
    let matched = false;
    for (let n = 3; n >= 1 && !matched; n--) {
      if (n > words.length - i) continue;
      const w = words.slice(i, i + n).join(' ');
      const g = index.get(w) ?? (n === 1 ? lemmas(w).map((l) => index.get(l)).find(Boolean) : undefined);
      if (g) {
        if (n === 1 && (PAST_IRREGULAR.has(w) || (w.endsWith('ed') && !NOT_PAST.has(w)))) past = true;
        const sign = lang.bySign(g);
        push(sign, w, g);
        const e = entries[entries.length - 1];
        // a plural noun: the word isn't the sign's own form and ends in -s
        if (e && n === 1 && sign && w.endsWith('s') && !w.endsWith('ss') && sign.en[0] !== w &&
          (sign.en.includes(w.slice(0, -1)) || sign.en.includes(w.slice(0, -2)) || sign.en.includes(w.slice(0, -3) + 'y'))) e.plural = true;
        i += n;
        matched = true;
      }
    }
    if (matched) continue;
    const w = words[i]!;
    if (!DROP.has(w)) tokens.push({ words: w, gloss: null });
    i++;
  }

  // Order: time signs first, question words last (for a rhetorical question too), FINISH for an unplaced past.
  const isTime = (e: Entry) => TIME.has(e.sign.gloss) || /^(NEXT|LAST)-/.test(e.sign.gloss);
  const whs = kind === 'wh' || kind === 'rhet' ? entries.filter((e) => WH.has(e.sign.gloss)) : [];
  const times = entries.filter(isTime);
  let order = [...times, ...entries.filter((e) => !isTime(e) && !whs.includes(e)), ...whs];
  if (past && !times.length && !order.some((e) => e.sign.gloss === 'FINISH') && order.length > 1) {
    const fin = lang.bySign('FINISH');
    if (fin) order.push({ sign: fin, words: '' });
  }
  order = order.filter((e, i) => e.sign.gloss !== order[i - 1]?.sign.gloss);

  // People in space: a referent gets a locus (pointed to after its first mention); pronouns point back.
  const ix = lang.bySign('HE-SHE');
  const placed: Entry[] = [];
  for (let i = 0; i < order.length; i++) {
    const e = order[i]!;
    const g = e.sign.gloss;
    const plural = !!e.plural;
    const prev = placed[placed.length - 1];
    if (plural && GRAMMAR.pluralRedup.has(g) && !(prev && GRAMMAR.quantifiers.has(prev.sign.gloss))) e.sign = withRedup(e.sign, 'plural');
    if (GRAMMAR.referents.has(g) && ix) {
      const { locus, fresh } = locusFor(ctx, g);
      ctx.last = locus;
      e.locus = locus;
      placed.push(e);
      if (fresh && GRAMMAR.indexAfterReferent) placed.push({ sign: pointTo(ix, locus, plural), words: '', locus });
      continue;
    }
    if (g === 'HE-SHE' && ix) {
      const locus = ctx.last ?? locusFor(ctx, `pron${ctx.next}`).locus;
      ctx.last = locus;
      placed.push({ ...e, sign: pointTo(ix, locus, e.words === 'they' || e.words === 'them', e.words || 'they'), locus, pron: true });
      continue;
    }
    if (g === 'ME') { placed.push({ ...e, locus: GRAMMAR.me, pron: true }); continue; }
    if (g === 'YOU') { placed.push({ ...e, locus: GRAMMAR.you, pron: true }); continue; }
    placed.push(e);
  }

  // Directional verbs move from the subject's place to the object's and absorb pronoun subjects and objects.
  placed.forEach((v, i) => {
    if (!GRAMMAR.directional.has(v.sign.gloss)) return;
    let subj: Entry | undefined, obj: Entry | undefined;
    // look only within the verb's own stretch: stop at another verb
    const isVerb = (e: Entry) => VERBS.has(e.sign.gloss);
    for (let j = i - 1; j >= 0 && !subj && !isVerb(placed[j]!); j--) if (placed[j]!.locus) subj = placed[j];
    for (let j = i + 1; j < placed.length && !obj && !isVerb(placed[j]!); j++) if (placed[j]!.locus) obj = placed[j];
    // "I help" with nobody helped stays in citation form
    if (!obj && (!subj || subj.locus === GRAMMAR.me)) return;
    const from = subj?.locus ?? (obj?.locus === GRAMMAR.me ? GRAMMAR.you : GRAMMAR.me);
    const to = obj?.locus ?? (from === GRAMMAR.you ? GRAMMAR.me : GRAMMAR.you);
    if (from === to) return;
    v.sign = directed(v.sign, from, to);
    if (subj?.pron) subj.drop = true;
    if (obj?.pron) obj.drop = true;
  });
  let kept = placed.filter((e) => !e.drop);

  // Negation: NOT + KNOW/WANT/LIKE becomes the verb's own negative; the headshake runs to the end of the clause.
  for (let i = 0; i < kept.length - 1; i++) {
    if (kept[i]!.sign.gloss !== 'NOT') continue;
    const inc = negIncorporate(kept[i + 1]!.sign);
    if (inc) kept = [...kept.slice(0, i), { ...kept[i + 1]!, sign: inc }, ...kept.slice(i + 2)];
  }
  const negAt = kept.findIndex((e) => GRAMMAR.negators.has(e.sign.gloss) || e.sign.gloss.startsWith("DON'T-"));
  const lastPred = kept.length - 1 - (kept.length && WH.has(kept[kept.length - 1]!.sign.gloss) ? 1 : 0);
  const negated = negAt >= 0 ? Array.from({ length: Math.max(1, lastPred - negAt + 1) }, (_, k) => negAt + k) : [];

  // Aspect: the first verb is repeated (circling for continuous, plain for habitual).
  if (aspect) {
    const base = (g: string) => g.replace(/^(1|2|3[abc])(?=[A-Z])|(?<=[A-Z])(1|2|3[abc])$/g, '');
    const v = kept.find((e) => VERBS.has(base(e.sign.gloss)) || GRAMMAR.directional.has(base(e.sign.gloss)));
    if (v) v.sign = withRedup(v.sign, aspect);
  }
  return { tokens, entries: kept, marks: [], negated };
}
