import { setupExtension } from './extension.js';

// Pi loads this native extension factory; no OpenCode runtime is involved.
export default function remindi(pi) {
  setupExtension(pi);
}
