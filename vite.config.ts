import { defineConfig } from 'vite';

// The master engine runs on WebAssembly threads, which need SharedArrayBuffer and therefore a
// cross-origin isolated page. Hosts that cannot send these headers (GitHub Pages) get them from
// public/coi-serviceworker.min.js instead.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  server: { headers: isolation },
  preview: { headers: isolation },
});
