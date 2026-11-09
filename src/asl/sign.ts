/** How a sign is written down: ASL's parameters (handshape, location, palm orientation, movement). */
import type { Dir, Loc } from './body';
import type { Contact, ShapeName } from './hand';

export type Path = 'hold' | 'line' | 'arc' | 'circle' | 'tap' | 'shake' | 'nod' | 'wiggle' | 'wave' | 'brush' | 'zigzag';

export interface HandSpec {
  shape: ShapeName;
  /** Which way the palm faces. */
  palm: Dir;
  /** Which way the fingers point (for a fist: the way the knuckles point). */
  fingers: Dir;
  loc: Loc;
  /** The part of the hand placed at `loc`; defaults by handshape. */
  contact?: Contact;
}

export interface DomSpec extends HandSpec {
  path?: Path;
  /** Repetitions (taps, circles, shakes, back-and-forth). */
  reps?: number;
  /** Where the movement ends: a new place, or a direction and distance, and any change of handshape or palm. */
  to?: { shape?: ShapeName; palm?: Dir; fingers?: Dir; loc?: Loc; move?: Dir; dist?: number; contact?: Contact };
  /** Tap away-direction, shake axis, arc bulge or circle plane normal. */
  axis?: Dir;
  /** Size of the tap, shake, arc bulge or circle radius (body units). */
  size?: number;
}

export interface BaseSpec extends HandSpec {
  /** The base hand travels with the dominant hand (HELP lifts both). */
  follow?: boolean;
}

/** Facial grammar a sentence can carry. */
export interface Face {
  /** -1 furrowed (WH-question) … 0 neutral … 1 raised (yes/no question, topic). */
  brows: number;
  /** Negation: the head shakes through the sign(s). */
  headshake: boolean;
}

export interface SignDef {
  /** ASL gloss, written in capitals by convention. */
  gloss: string;
  /** English words and phrases this sign translates (first = the one used when speaking it back). */
  en: readonly string[];
  dom: DomSpec;
  /** mirror: both hands do it; alternate: both, out of step; base: the other hand holds still as a base. */
  two?: 'mirror' | 'alternate' | 'base';
  base?: BaseSpec;
  /** A short description of how it is made, shown under the avatar. */
  how: string;
  /** The camera recognizer also knows this sign (see lexicon.ts RECOGNIZED). */
  recognize?: boolean;
  /** A fingerspelled letter: the word it belongs to and its position (fingerspell.ts). */
  spell?: { word: string; i: number };
  /** Seconds this sign takes, overriding the usual timing (letters are quick). */
  dur?: number;
  /** Reduplication added by grammar: plural (repeated along a line), continuous (circling) or habitual. */
  redup?: { kind: 'plural' | 'continuous' | 'habitual'; n: number };
}

/** A span of facial grammar over signs `from`..`to` (inclusive indices into the signs). */
export interface Mark {
  from: number;
  to: number;
  /** -1 furrowed, 1 raised. */
  brows: number;
  kind: 'yn' | 'wh' | 'rhet' | 'topic' | 'cond';
}
