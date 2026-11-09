import { describe, expect, it } from 'vitest';
import { LEXICON } from '../src/asl/lexicon';
import { signParts } from '../src/asl/parts';
import { ghostAt, scaleHand, trail, type Past } from '../src/client/avatar';
import type { Landmarks } from '../src/asl/hand';

describe('sign parts (Hand / Where / Move / Palm chips)', () => {
  it('every sign in the lexicon has all four parts', () => {
    for (const s of LEXICON) {
      const p = signParts(s);
      for (const [k, v] of Object.entries(p)) expect(v, `${s.gloss} ${k}`).toMatch(/\S/);
    }
  });
  it('reads HELLO the way the design shows it', () => {
    const hello = LEXICON.find((s) => s.gloss === 'HELLO')!;
    expect(signParts(hello)).toEqual({ hand: 'flat B', where: 'temple', move: 'out', palm: 'forward' });
  });
  it('names repeated movements, places moved to, and both-hand signs', () => {
    const by = (g: string) => signParts(LEXICON.find((s) => s.gloss === g)!);
    expect(by('PLEASE').move).toBe('circle ×2');
    expect(by('THANK-YOU').move).toBe('to in front');
    expect(by('MEET').move).toBe('to in front, both hands');
  });
});

describe('stage motion helpers', () => {
  const lm = (x: number): Landmarks => Array.from({ length: 21 }, () => [x, 0, 0]) as unknown as Landmarks;
  const hist: Past[] = [0, 100, 200, 300, 400].map((at) => ({ at, lm: lm(at), up: true }));
  it('ghosts come from the frame nearest the asked-for time, and only once history reaches back that far', () => {
    expect(ghostAt(hist, 400, 160)?.at).toBe(200);
    expect(ghostAt(hist, 400, 320)?.at).toBe(100);
    expect(ghostAt(hist, 400, 900)).toBeNull();
  });
  it('the trail is the palm path over the window, oldest first', () => {
    expect(trail(hist, 400, 250).map((p) => p[0])).toEqual([200, 300, 400]);
  });
  it('the drawn hand is scaled about its wrist', () => {
    const hand = Array.from({ length: 21 }, (_, i) => [1 + i, 2, 0]) as unknown as Landmarks;
    const big = scaleHand(hand, 2);
    expect(big[0]).toEqual([1, 2, 0]);
    expect(big[9]).toEqual([19, 2, 0]);
  });
});
