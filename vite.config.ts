import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

const ENGINE_FILES = ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"];
const enginePath = (name: string) =>
  createRequire(import.meta.url).resolve(`stockfish/bin/${name}`);

// The site serves Stockfish as two files next to the page; the page starts the engine as a
// same-origin worker (no blob: workers, which the CSP forbids).
function stockfishEngine(): Plugin {
  return {
    name: "stockfish-engine",
    generateBundle() {
      for (const name of ENGINE_FILES) {
        this.emitFile({
          type: "asset",
          fileName: `engine/${name}`,
          source: readFileSync(enginePath(name)),
        });
      }
    },
  };
}

/**
 * `vite build --mode web --outDir dist-web` builds the site served by server/.
 * `vite build --mode e2e --outDir dist-e2e` builds the same page without sign-in or server, on
 * the fake `window.claude` the e2e specs install; it is never released.
 */
export default defineConfig(({ mode }) => ({
  plugins: [stockfishEngine()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __E2E__: JSON.stringify(mode === "e2e"),
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
}));
