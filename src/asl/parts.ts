/**
 * A sign's parts in plain words (Hand, Where, Move, Palm), read straight from its lexicon entry. The UI shows
 * these as chips under the stage, so the same entry that drives the drawing also explains it.
 */
import type { BaseDir, Dir, Loc } from './body';
import type { ShapeName } from './hand';
import type { Path, SignDef } from './sign';

/** Handshape names as a learner would say them. Every shape must have one (the type enforces it). */
export const SHAPE_LABEL: Record<ShapeName, string> = {
  B: 'flat B', OB: 'open B', '5': 'open 5', '4': '4', A: 'A fist', S: 'S fist', T: 'T', '10': 'thumb up',
  '1': 'index', L: 'L', X: 'hooked X', V: 'V', U: 'U', '3': '3', W: 'W', Y: 'Y', I: 'pinky I', ILY: 'I-love-you',
  C: 'C', O: 'O', flatO: 'flat O', bentB: 'bent B', claw: 'claw', F: 'F', open8: 'open 8', '8': '8', H: 'H',
  N3: 'open 3', NC: 'snapped 3',
};

/** Places as a learner would say them. */
export const LOC_LABEL: Record<Loc, string> = {
  topHead: 'top of head', forehead: 'forehead', temple: 'temple', eye: 'eye', nose: 'nose', mouth: 'mouth',
  chin: 'chin', cheek: 'cheek', jaw: 'jaw', ear: 'ear', neck: 'neck', shoulder: 'shoulder', chest: 'chest',
  chestSide: 'side of chest', stomach: 'stomach', hip: 'hip', neutral: 'in front', neutralLow: 'in front, low',
  neutralHigh: 'in front, high', forward: 'out front', faceFront: 'before the face', headSide: 'beside the head',
  side: 'to the side', locusA: 'place A (right)', locusB: 'place B (left)', locusC: 'place C (ahead)',
  meNear: 'near me', youFar: 'toward you', basePalm: 'other palm', baseBack: 'back of other hand', baseTip: 'other fingertips',
  baseWrist: 'other wrist', baseHand: 'other hand',
};

const MOVE_DIR: Record<BaseDir, string> = { up: 'up', down: 'down', fwd: 'forward', back: 'back', out: 'out', in: 'in' };
const PALM_DIR: Record<BaseDir, string> = { up: 'up', down: 'down', fwd: 'forward', back: 'to body', out: 'outward', in: 'inward' };
/** Paths that are a movement in their own right (a line or arc is described by where it goes instead). */
const PATH_LABEL: Partial<Record<Path, string>> = {
  circle: 'circle', tap: 'tap', shake: 'shake', nod: 'nod', wiggle: 'wiggle', wave: 'wave', brush: 'brush',
};

const dirWords = (d: Dir, words: Record<BaseDir, string>): string => d.split('+').map((p) => words[p as BaseDir]).join(' & ');

export interface SignParts { hand: string; where: string; move: string; palm: string }

export function signParts(s: SignDef): SignParts {
  const d = s.dom;
  const to = d.to;
  const goes = to?.move ? dirWords(to.move, MOVE_DIR) : to?.loc ? `to ${LOC_LABEL[to.loc]}` : '';
  const path = d.path ? PATH_LABEL[d.path] ?? '' : '';
  const reps = d.reps && d.reps > 1 && path ? ` ×${d.reps}` : '';
  const change = !goes && !path && (to?.shape || to?.palm) ? 'change shape' : '';
  const move = [path + reps, goes].filter(Boolean).join(' ') || change || 'hold';
  const two = s.two === 'mirror' ? ', both hands' : s.two === 'alternate' ? ', hands alternate' : '';
  return { hand: SHAPE_LABEL[d.shape] + (to?.shape && to.shape !== d.shape ? ` → ${SHAPE_LABEL[to.shape]}` : ''), where: LOC_LABEL[d.loc], move: move + two, palm: dirWords(d.palm, PALM_DIR) };
}
