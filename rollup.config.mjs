import typescript from "@rollup/plugin-typescript";
import copy from "rollup-plugin-copy";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

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

// Custom plugin to copy HTML files to dist
function copyHtml() {
  return {
    name: "copy-html",
    writeBundle() {
      mkdirSync("dist", { recursive: true });
      const html = readFileSync("src/pages/index.html", "utf-8");
      writeFileSync(join("dist", "index.html"), html);
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
