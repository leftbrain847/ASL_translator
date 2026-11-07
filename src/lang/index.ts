/** The language registry. To add a language, write a pack and list it here. */
import { LEXICON, signByGloss } from '../asl/lexicon';
import { english, setLexiconWords } from './en';
import type { SignLanguage, SpokenLanguage } from './types';

export const ASL: SignLanguage = { code: 'ase', label: 'ASL', lexicon: LEXICON, bySign: signByGloss };
setLexiconWords(LEXICON);

export const SPOKEN: readonly SpokenLanguage[] = [english];
export const SIGNED: readonly SignLanguage[] = [ASL];
export type { SignLanguage, SpokenLanguage, Translation, Token } from './types';
