/**
 * Fingerspelling: the ASL manual alphabet and the number handshapes, for names and words with no sign yet.
 * Each letter is a quick held handshape by the dominant shoulder; J and Z trace their letter. A doubled letter
 * slides out a little. These are the standard alphabet shapes; a fluent signer has not reviewed the drawings.
 */
import type { Dir } from './body';
import type { ShapeName } from './hand';
import type { DomSpec, SignDef } from './sign';

export const SPELL = {
  /** Seconds per letter, and per moving letter (J, Z). */
  letter: 0.32,
  moving: 0.55,
  /** A doubled letter slides out this far. */
  doubleSlide: 0.06,
};

interface Letter { shape: ShapeName; palm: Dir; fingers: Dir; extra?: Partial<DomSpec> }
const up = (shape: ShapeName, palm: Dir = 'fwd'): Letter => ({ shape, palm, fingers: 'up' });

/** The manual alphabet, a to z, and digits 0 to 9. */
export const ALPHABET: Readonly<Record<string, Letter>> = {
  a: up('A'), b: up('B'), c: up('C', 'in'), d: up('D'), e: up('E'), f: up('F'),
  g: { shape: 'G', palm: 'back', fingers: 'in' }, h: { shape: 'H', palm: 'back', fingers: 'in' },
  i: up('I'), j: { shape: 'I', palm: 'fwd', fingers: 'up', extra: { path: 'arc', axis: 'in', size: 0.06, to: { move: 'down+in', dist: 0.1, palm: 'back' } } },
  k: up('K'), l: up('L'), m: up('M'), n: up('N'), o: up('O', 'in'),
  p: { shape: 'K', palm: 'in', fingers: 'down+fwd' }, q: { shape: 'G', palm: 'back', fingers: 'down' },
  r: up('R'), s: up('S'), t: up('T'), u: up('U'), v: up('V'), w: up('W'), x: up('X', 'in'), y: up('Y'),
  z: { shape: '1', palm: 'fwd', fingers: 'up', extra: { path: 'zigzag', size: 0.06 } },
  '0': up('O', 'in'), '1': up('1', 'back'), '2': up('V', 'back'), '3': up('3', 'back'), '4': up('4', 'back'),
  '5': up('5', 'back'), '6': up('W', 'back'), '7': up('7', 'back'), '8': up('8', 'back'), '9': up('F', 'back'),
};

/** One letter of a spelled word as a sign. */
export function letterSign(word: string, i: number): SignDef | null {
  const ch = word[i]!;
  const L = ALPHABET[ch];
  if (!L) return null;
  const moving = !!L.extra?.path;
  const doubled = i > 0 && word[i - 1] === ch && !moving;
  const dom: DomSpec = { shape: L.shape, palm: L.palm, fingers: L.fingers, loc: 'spell', contact: 'wrist', ...L.extra };
  if (doubled) Object.assign(dom, { to: { move: 'out', dist: SPELL.doubleSlide } });
  return {
    gloss: `FS-${ch.toUpperCase()}`, en: [ch], how: `Fingerspelled ${/\d/.test(ch) ? 'number' : 'letter'} ${ch.toUpperCase()}.`,
    dom, spell: { word, i }, dur: moving ? SPELL.moving : SPELL.letter,
  };
}

/** A word spelled out letter by letter (letters and digits only; anything else is skipped). */
export function fingerspell(word: string): SignDef[] {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  return Array.from(w, (_, i) => letterSign(w, i)).filter((s): s is SignDef => !!s);
}

/** How a spelled word is glossed: J-O-R-D-A-N. */
export const spelledGloss = (word: string): string => word.toUpperCase().replace(/[^A-Z0-9]/g, '').split('').join('-');
