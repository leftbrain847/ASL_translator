/**
 * English ⇄ ASL gloss. Not word-for-word: ASL drops articles and "be", puts time first, puts question words
 * last, marks questions on the face (raised brows for yes/no, furrowed for WH) and negation with a headshake.
 * These are the common textbook rules for simple sentences; real ASL grammar (classifiers, space, verb
 * agreement) is far richer.
 */
import type { SignDef } from '../asl/sign';
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
  ['i do not know', ['ME', 'KNOW', 'NOT']],
  ["i don't know", ['ME', 'KNOW', 'NOT']],
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
    const isQuestion = raw.endsWith('?') || QUESTION_START.test(raw) || WH_START.test(raw);
    let clean = raw.replace(/[^a-z0-9' ]+/g, ' ');
    for (const [rx, rep] of CONTRACTIONS) clean = clean.replace(rx, rep);
    const words = clean.split(/\s+/).filter(Boolean);

    const tokens: Token[] = [];
    let past = false;
    for (let i = 0; i < words.length;) {
      // A set phrase, else the longest lexicon phrase (up to 3 words), else one word.
      const phrase = PHRASES.find(([p]) => words.slice(i, i + p.split(' ').length).join(' ') === p);
      if (phrase) {
        phrase[1].forEach((g, k) => tokens.push({ words: k === 0 ? phrase[0] : '', gloss: g }));
        i += phrase[0].split(' ').length;
        continue;
      }
      let matched = false;
      for (let n = 3; n >= 1 && !matched; n--) {
        const w = words.slice(i, i + n).join(' ');
        if (n > words.length - i) continue;
        const g = index.get(w) ?? (n === 1 ? lemmas(w).map((l) => index!.get(l)).find(Boolean) : undefined);
        if (g) {
          if (n === 1 && (PAST_IRREGULAR.has(w) || (w.endsWith('ed') && !NOT_PAST.has(w)))) past = true;
          tokens.push({ words: w, gloss: g });
          i += n;
          matched = true;
        }
      }
      if (matched) continue;
      const w = words[i]!;
      if (!DROP.has(w)) tokens.push({ words: w, gloss: null });
      i++;
    }

    // Reorder: time signs first, question words last.
    const glossed = tokens.filter((t) => t.gloss);
    let order = glossed.map((t) => t.gloss!);
    const times = order.filter((g) => TIME.has(g));
    const whs = isQuestion ? order.filter((g) => WH.has(g)) : [];
    order = [...times, ...order.filter((g) => !TIME.has(g) && !whs.includes(g)), ...whs];
    if (past && !times.length && !order.includes('FINISH') && order.length > 1) order.push('FINISH');
    // Drop immediate repeats (e.g. "my name is" + "name").
    order = order.filter((g, i) => g !== order[i - 1]);

    const signs = order.map((g) => lang.bySign(g)).filter((s): s is SignDef => !!s);
    const negated: number[] = [];
    signs.forEach((s, i) => {
      if (s.gloss === 'NOT' || s.gloss === 'CANT') negated.push(...[i - 1, i, i + 1].filter((k) => k >= 0 && k < signs.length));
    });
    const hasWh = whs.length > 0;
    return {
      tokens,
      signs,
      face: { brows: isQuestion ? (hasWh ? -1 : 1) : 0, headshake: negated.length > 0 },
      negated: [...new Set(negated)],
      missing: tokens.filter((t) => !t.gloss).map((t) => t.words),
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
  'REMEMBER', 'FORGET', 'MEET', 'WAIT', 'STOP']);

/** First English word of each sign, filled from the lexicon by `setLexiconWords`. */
const SIGN_WORD = new Map<string, string>();
export function setLexiconWords(lexicon: readonly SignDef[]): void {
  for (const s of lexicon) SIGN_WORD.set(s.gloss, s.en[0]!);
}
