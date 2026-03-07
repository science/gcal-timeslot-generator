#!/usr/bin/env node
/**
 * Deploy script: creates a new Apps Script version and updates the
 * existing web-app deployment to point at it.
 *
 * Usage:
 *   node scripts/deploy.js              # version description from package.json
 *   node scripts/deploy.js "my message" # custom description
 */
const { execSync } = require("child_process");
const { version } = require("../package.json");

const run = (cmd) => execSync(cmd, { encoding: "utf-8" }).trim();

// 0. Abort if working tree is dirty — version hash would not match deployed code
const status = run("git status --porcelain");
if (status) {
  console.error("ERROR: Uncommitted changes detected. Commit first so the version hash matches the deployed code.");
  console.error(status);
  process.exit(1);
}

// 1. Find the non-HEAD deployment ID
const depOutput = run("npx @google/clasp deployments");
const match = depOutput.match(/^- (AKfycb\S+) @\d+/m);
if (!match) {
  console.error("No versioned deployment found. Create one first with: npx @google/clasp deploy");
  process.exit(1);
}
const deploymentId = match[1];

// 2. Build description
const desc = process.argv[2] || `v${version}`;

// 3. Create a new version
const verOutput = run(`npx @google/clasp version "${desc}"`);
const verMatch = verOutput.match(/Created version (\d+)/);
if (!verMatch) {
  console.error("Failed to create version:", verOutput);
  process.exit(1);
}
const versionNum = verMatch[1];

// 4. Update the deployment
run(`npx @google/clasp deploy -i ${deploymentId} -V ${versionNum} -d "${desc}"`);

console.log(`Deployed ${desc} (version ${versionNum})`);
