import { Plugin } from '@opencode/plugin';
import { setupBridge } from './adapter.js';

export default Plugin.define({ id: 'phrk-remindi', setup: setupBridge });
