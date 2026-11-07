/**
 * The app's server-side module. The translator runs entirely in the browser (speech, avatar, camera
 * tracking and recognition are all on-device), so the Worker has nothing to keep: no runs, rooms or scores.
 * This module exists because every app registers one with the shared host, which still serves the page
 * behind Access on the friends host.
 */
import type { GameModule } from '@app-builder/host';
import config from '../app.config.json';

export const app: GameModule<Record<string, never>, null, never, null> = {
  id: config.id,
  defaultConfig: {},
  limits: { tickHz: 0, snapshotHz: 0, minPlayers: 1, maxPlayers: 1, maxMsgBytes: 256, maxInputsPerSec: 1 },
  parseInput: () => null,
  init: () => null,
  onInput: () => undefined,
  viewFor: () => null,
  isOver: () => true,
};
