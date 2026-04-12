import typescript from "@rollup/plugin-typescript";
import copy from "rollup-plugin-copy";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

const pkgVersion = JSON.parse(readFileSync("package.json", "utf-8")).version;

// Custom plugin to strip export/import keywords from the bundle
// Apps Script runs all .gs files in a shared global scope
function stripModuleSyntax() {
  return {
    name: "strip-module-syntax",
    renderChunk(code) {
      return code
        .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, "")  // export { foo, bar };
        .replace(/^export\s+/gm, "")                      // export function ...
        .replace(/^import\s+.*;\s*$/gm, "");
    },
  };
}

// Custom plugin to copy HTML files to dist and release
function copyHtml() {
  return {
    name: "copy-html",
    writeBundle() {
      mkdirSync("dist", { recursive: true });
      mkdirSync("release", { recursive: true });
      // dist/ is the live deploy target — embed the live commit hash so the
      // running web app shows exactly which commit it came from.
      const gitHash = execSync("git describe --always --dirty", { encoding: "utf-8" }).trim();
      const gitDate = execSync("git log -1 --format=%ci", { encoding: "utf-8" }).trim().slice(0, 10);
      const srcHtml = readFileSync("src/pages/index.html", "utf-8");
      const distHtml = srcHtml.replaceAll("__GIT_HASH__", gitHash).replace("__GIT_DATE__", gitDate);
      writeFileSync(join("dist", "index.html"), distHtml);
      // release/ is the static "non-developer install" copy. Stamp it with
      // the package.json version (stable across builds) and link to the
      // GitHub release page rather than a commit URL — using the live git
      // hash here would create a chicken-and-egg where committing release/
      // perpetually invalidates itself with a new commit-hash mismatch.
      const releaseHtml = srcHtml
        .replaceAll(
          /\<a href="https:\/\/github\.com\/[^"]*\/commit\/__GIT_HASH__"([^>]*)\>__GIT_HASH__\<\/a\>/g,
          `<a href="https://github.com/science/gcal-timeslot-generator/releases" $1>v${pkgVersion}</a>`,
        )
        .replace(" · __GIT_DATE__", "");
      const code = readFileSync("dist/Code.gs", "utf-8");
      const manifest = readFileSync("appsscript.json", "utf-8");
      writeFileSync(join("release", "Code.gs"), code);
      writeFileSync(join("release", "index.html"), releaseHtml);
      writeFileSync(join("release", "appsscript.json"), manifest);
    },
  };
}

export default {
  input: "src/server/Code.ts",
  output: {
    file: "dist/Code.gs",
    format: "es",
  },
  plugins: [
    typescript({
      tsconfig: "./tsconfig.json",
    }),
    stripModuleSyntax(),
    copy({
      targets: [
        { src: "appsscript.json", dest: "dist" },
      ],
    }),
    copyHtml(),
  ],
};
