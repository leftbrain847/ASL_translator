/**
 * This app's Worker: register the one app module, then hand everything to the
 * shared host (Access check, routing, rooms, solo replay). Nothing else goes here.
 */
import { register, worker } from '@app-builder/host';
import config from '../app.config.json';
import { app } from '../src/app';

register([app as never], { host: config.host });

export { GameRoom, SoloRun } from '@app-builder/host';
export default worker;
