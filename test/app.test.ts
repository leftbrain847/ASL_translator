import { describe, expect, it } from 'vitest';
import { app } from '../src/app';

describe('server module', () => {
  it('registers under the app id and keeps no state (everything runs in the browser)', () => {
    expect(app.id).toBe('asl-translator');
    expect(app.solo).toBeUndefined();
    expect(app.isOver(null as never)).toBe(true);
  });
});
