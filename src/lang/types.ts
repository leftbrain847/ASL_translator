/** Language packs. The app ships English and ASL; another spoken or sign language is a new pack, not new code. */
import type { Face, Mark, SignDef } from '../asl/sign';

export interface Token {
  /** The words this token came from, as typed or heard. */
  words: string;
  /** The sign it became, or null when the lexicon has no sign for it yet. */
  gloss: string | null;
}

export interface Translation {
  tokens: Token[];
  /** The signs to perform, in sign-language order. */
  signs: SignDef[];
  face: Face;
  /** Indices into `signs` made with a headshake (negation). */
  negated: number[];
  /** Facial grammar spans: questions, topics, conditionals, rhetorical questions. */
  marks: Mark[];
  /** Words with no sign and nothing to spell. */
  missing: string[];
  /** Words with no sign, fingerspelled instead. */
  spelled: string[];
}

/** A spoken/written language: turns its text into a sign language's order, and recognized signs back into text. */
export interface SpokenLanguage {
  code: string;
  label: string;
  /** BCP 47 tag for speech recognition and speech synthesis. */
  speechLang: string;
  toSigns(text: string, signs: SignLanguage): Translation;
  fromGlosses(glosses: readonly string[]): string;
}

export interface SignLanguage {
  code: string;
  label: string;
  lexicon: readonly SignDef[];
  /** The subset the camera recognizer knows. */
  recognized: readonly SignDef[];
  bySign(gloss: string): SignDef | undefined;
}
