import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readGitHash(): string {
  try {
    return execSync("git describe --always --dirty", { encoding: "utf-8" }).trim();
  } catch {
    return "dev";
  }
}

function readGitDate(): string {
  try {
    return execSync("git log -1 --format=%ci", { encoding: "utf-8" }).trim().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const pkgVersion = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")).version;

export default defineConfig(({ mode }) => ({
  root: "src/web",
  // Load .env.local (and friends) from the project root, not src/web/.
  // Vite defaults envDir to root, which would force us to put .env files
  // alongside index.html. The project-root convention is more standard.
  envDir: __dirname,
  // GitHub Pages serves the site under /<repo>/. For a root-domain deploy,
  // set VITE_BASE_PATH=/ at build time.
  base: process.env.VITE_BASE_PATH ?? "/gcal-timeslot-generator/",
  publicDir: false,
  define: {
    __GIT_HASH__: JSON.stringify(readGitHash()),
    __GIT_DATE__: JSON.stringify(readGitDate()),
    __PKG_VERSION__: JSON.stringify(pkgVersion),
  },
  server: {
    // Bind to 0.0.0.0 so the host OS can reach the VM dev server.
    host: "0.0.0.0",
    port: 5173,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  build: {
    outDir: resolve(__dirname, "dist-web"),
    emptyOutDir: true,
    sourcemap: mode !== "production",
    target: "es2020",
  },
}));
