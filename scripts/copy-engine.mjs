// Copies the third-party engine files from node_modules into public/, where Vite serves them as
// static assets (they must stay separate files: the WASM engine spawns its own workers by URL).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const copy = (from, to) => {
  const src = join(root, 'node_modules', from);
  if (!existsSync(src)) {
    console.warn(`copy-engine: ${from} not found, skipping (run npm install)`);
    return;
  }
  mkdirSync(dirname(join(root, to)), { recursive: true });
  cpSync(src, join(root, to));
};

// Fairy-Stockfish (GPL-3.0), plays xiangqi; the "master" difficulty.
for (const file of ['stockfish.js', 'stockfish.wasm', 'stockfish.worker.js', 'Copying.txt', 'AUTHORS']) {
  copy(`fairy-stockfish-nnue.wasm/${file}`, `public/engine/vendor/${file}`);
}
// Cross-origin isolation for hosts that cannot send COOP/COEP headers (GitHub Pages).
copy('coi-serviceworker/coi-serviceworker.min.js', 'public/coi-serviceworker.min.js');
