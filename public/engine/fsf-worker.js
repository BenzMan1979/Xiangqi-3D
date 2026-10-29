/*
 * Thin UCI pipe around the Fairy-Stockfish WebAssembly build in ./vendor (GPL-3.0, see
 * vendor/Copying.txt). Runs as a classic worker because the Emscripten output loads itself with
 * importScripts and starts its search threads from this worker's own location.
 *
 *   page -> worker:  { type: 'init' } | { type: 'uci', cmd: string }
 *   worker -> page:  { type: 'ready' } | { type: 'line', line: string } | { type: 'error', message: string }
 */
importScripts('./vendor/stockfish.js');

let engine = null;
const pending = [];

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    Stockfish()
      .then((sf) => {
        engine = sf;
        sf.addMessageListener((line) => postMessage({ type: 'line', line }));
        postMessage({ type: 'ready' });
        for (const cmd of pending.splice(0)) sf.postMessage(cmd);
      })
      .catch((err) => postMessage({ type: 'error', message: String((err && err.message) || err) }));
  } else if (msg.type === 'uci') {
    if (engine) engine.postMessage(msg.cmd);
    else pending.push(msg.cmd);
  }
};
