#!/usr/bin/env node
/*
  Check that versions listed in each package's LICENSE file (preferring artifacts over source)
  match the resolved versions in pnpm-lock.yaml (i.e., what pnpm would install).
  If any mismatch is found, exit 1.

  The script will first try to read LICENSE files from artifacts/ directory (LICENSE-{packageName}),
  and fallback to source LICENSE files if artifacts are not available.
*/

const fs = require("fs");
const path = require("path");

/**
 * Read a UTF-8 text file if it exists; otherwise return null.
 * @param {string} filePath
 * @returns {string|null}
 */
function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return null;
    throw err;
  }
}

/**
 * Parse a LICENSE file content to extract { [packageName]: version }.
 * The parser expects repeated blocks like:
 *
 *   <name>\n
 *   repository: <url>\n
 *   version: <x.y.z>\n
 *   license: <...>\n
 *   ...license text...
 *   =============================
 *
 * We split by the separator and, per block, find the line before `repository:` as the package name,
 * and the first `version:` line after that as the version.
 *
 * @param {string} licenseText
 * @returns {Record<string, string>}
 */
function parseLicenseVersions(licenseText) {
  const result = {};
  if (!licenseText) return result;

  const blocks = licenseText.split(/\n=+\n/g); // split by lines of ====
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let repoIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().startsWith("repository:")) {
        repoIdx = i;
        break;
      }
    }
    if (repoIdx === -1) continue; // not a package block

    // Find the closest previous non-empty line as the package name
    let name = null;
    for (let i = repoIdx - 1; i >= 0; i--) {
      const candidate = lines[i].trim();
      if (candidate.length === 0) continue;
      // Exclude generic headings
      if (candidate.match(/^licen[cs]es?\b/i)) continue;
      if (candidate.match(/^mit license/i)) continue;
      if (candidate.match(/^the mit license/i)) continue;
      if (candidate.includes(":")) continue;
      name = candidate;
      break;
    }
    if (!name) continue;

    // Find the first version: line after repoIdx
    let version = null;
    for (let i = repoIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.toLowerCase().startsWith("version:")) {
        version = line.split(":").slice(1).join(":").trim();
        break;
      }
    }
    if (version) {
      result[name] = version;
    }
  }

  return result;
}

/**
 * Find all package directories under ./packages that contain package.json, LICENSE, and pnpm-lock.yaml.
 * @param {string} rootDir
 * @returns {string[]}
 */
function findPackageDirs(rootDir) {
  const packagesRoot = path.join(rootDir, "packages");
  let entries = [];
  try {
    entries = fs.readdirSync(packagesRoot, { withFileTypes: true });
  } catch (err) {
    console.error(`Cannot read packages directory: ${packagesRoot}`);
    throw err;
  }

  const dirs = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(packagesRoot, ent.name);
    const pkgJson = path.join(dir, "package.json");
    const license = path.join(dir, "LICENSE");
    const pnpmLock = path.join(dir, "pnpm-lock.yaml");
    if (fs.existsSync(pkgJson) && fs.existsSync(license) && fs.existsSync(pnpmLock)) {
      dirs.push(dir);
    }
  }
  return dirs;
}

/**
 * Normalize a version string for comparison purposes.
 * - Strips surrounding quotes
 * - Drops any pnpm peer suffix like "1.2.3(peer@1.0.0)"
 * - Removes leading npm: qualifier
 * @param {string|null|undefined} version
 * @returns {string|null}
 */
function normalizeVersion(version) {
  if (!version) return null;
  let v = String(version).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (v.startsWith("npm:")) {
    v = v.slice(4);
  }
  const parenIdx = v.indexOf("(");
  if (parenIdx !== -1) {
    v = v.slice(0, parenIdx);
  }
  return v.trim();
}

// Keys that contain dependency version listings inside the importers section.
const DEPENDENCY_SECTION_KEYS = new Set(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]);

/**
 * @typedef {Object} ImporterSectionState
 * @property {string|null} currentImporter
 * @property {boolean} collectingDeps
 * @property {string|null} currentDep
 */

/**
 * Process a single pnpm-lock line within the importers section to capture resolved versions.
 * @param {Object} params
 * @param {number} params.indent
 * @param {string} params.trimmed
 * @param {Map<string, Set<string>>} params.importerVersions
 * @param {ImporterSectionState} params.state
 * @returns {ImporterSectionState}
 */
function handleImportersSectionLine({ indent, trimmed, importerVersions, state }) {
  // Capture importer name when pnpm lists a top-level importer block.
  if (indent === 2 && trimmed.endsWith(":")) {
    state.currentImporter = trimmed.slice(0, -1);
    state.collectingDeps = false;
    state.currentDep = null;
    return state;
  }

  if (!state.currentImporter) {
    return state;
  }

  // Track only dependency-like subsections so we skip metadata.
  if (indent === 4 && trimmed.endsWith(":")) {
    const key = trimmed.slice(0, -1);
    state.collectingDeps = DEPENDENCY_SECTION_KEYS.has(key);
    state.currentDep = null;
    return state;
  }

  if (!state.collectingDeps) {
    return state;
  }

  if (indent === 6 && trimmed.endsWith(":")) {
    state.currentDep = trimmed.slice(0, -1);
    return state;
  }

  if (state.currentDep && indent >= 8 && trimmed.startsWith("version:")) {
    const rawVersion = trimmed.slice("version:".length).trim();
    const version = normalizeVersion(rawVersion);
    if (version) {
      if (!importerVersions.has(state.currentDep)) {
        importerVersions.set(state.currentDep, new Set());
      }
      importerVersions.get(state.currentDep).add(version);
    }
    state.currentDep = null;
    return state;
  }

  if (indent <= 6) {
    // Reset when indentation climbs back up the tree.
    state.currentDep = null;
  }

  return state;
}

/**
 * Process a single pnpm-lock line within the packages section to capture resolved versions.
 * @param {Object} params
 * @param {number} params.indent
 * @param {string} params.trimmed
 * @param {Map<string, Set<string>>} params.packageVersions
 * @returns {void}
 */
function handlePackagesSectionLine({ indent, trimmed, packageVersions }) {
  if (indent !== 2 || !trimmed.endsWith(":")) {
    return;
  }

  let key = trimmed.slice(0, -1);
  key = key.replace(/^['"]|['"]$/g, "");
  const atIndex = key.lastIndexOf("@");
  if (atIndex <= 0) {
    return;
  }

  // Split the locator into name and version segments.
  const name = key.slice(0, atIndex);
  const rawVersion = key.slice(atIndex + 1);
  const version = normalizeVersion(rawVersion);
  if (!name || !version) {
    return;
  }

  if (!packageVersions.has(name)) {
    packageVersions.set(name, new Set());
  }
  packageVersions.get(name).add(version);
}

/**
 * Parse pnpm-lock.yaml content to extract dependency versions.
 * We record direct importer dependencies as well as versions listed in the packages section.
 * @param {string} lockText
 * @returns {{ importerVersions: Map<string, Set<string>>, packageVersions: Map<string, Set<string>> }}
 */
function parsePnpmLock(lockText) {
  const importerVersions = new Map();
  const packageVersions = new Map();
  if (!lockText) return { importerVersions, packageVersions };

  const lines = lockText.split(/\r?\n/);
  let section = null;
  let importerState = { currentImporter: null, collectingDeps: false, currentDep: null };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const indent = line.search(/\S/);

    if (indent === 0 && trimmed.endsWith(":")) {
      section = trimmed.slice(0, -1);
      importerState = { currentImporter: null, collectingDeps: false, currentDep: null };
      continue;
    }

    if (section === "importers") {
      importerState = handleImportersSectionLine({
        indent,
        trimmed,
        importerVersions,
        state: importerState,
      });
      continue;
    }

    if (section === "packages") {
      handlePackagesSectionLine({ indent, trimmed, packageVersions });
    }
  }

  return { importerVersions, packageVersions };
}

/**
 * Resolve installed versions from a parsed pnpm-lock.yaml object for a given dependency name.
 * @param {{ importerVersions: Map<string, Set<string>>, packageVersions: Map<string, Set<string>> }} lockData
 * @param {string} depName
 * @returns {string[]}
 */
function getInstalledVersionsFromPnpmLock(lockData, depName) {
  if (!lockData) return [];
  const versions = new Set();
  const directSet = lockData.importerVersions.get(depName);
  if (directSet) {
    for (const d of directSet) {
      const normalizedDirect = normalizeVersion(d);
      if (normalizedDirect) versions.add(normalizedDirect);
    }
  }
  const pkgVersions = lockData.packageVersions.get(depName);
  if (pkgVersions) {
    for (const v of pkgVersions) {
      const normalized = normalizeVersion(v);
      if (normalized) versions.add(normalized);
    }
  }
  return Array.from(versions);
}

/**
 * Get installed versions for the dependency based on the pnpm lock file data.
 * @param {{ kind: 'pnpm', data: any }|null} lockInfo
 * @param {string} depName
 * @returns {string[]}
 */
function getInstalledVersions(lockInfo, depName) {
  if (!lockInfo) return [];
  if (lockInfo.kind === "pnpm") {
    return getInstalledVersionsFromPnpmLock(lockInfo.data, depName);
  }
  return [];
}

function main() {
  const root = process.cwd();
  const packageDirs = findPackageDirs(root);
  const mismatches = [];

  for (const pkgDir of packageDirs) {
    const relPkgDir = path.relative(root, pkgDir);
    const packageName = path.basename(pkgDir);
    const lockYamlPath = path.join(pkgDir, "pnpm-lock.yaml");

    // Try to read LICENSE from artifacts first, fallback to source LICENSE
    const artifactLicensePath = path.join(root, "artifacts", `LICENSE-${packageName}`);
    const sourceLicensePath = path.join(pkgDir, "LICENSE");

    let licenseText = readTextIfExists(artifactLicensePath);
    if (!licenseText) {
      console.log(`[INFO] LICENSE artifact not found for ${packageName}, using source LICENSE`);
      licenseText = readTextIfExists(sourceLicensePath);
    } else {
      console.log(`[INFO] Using LICENSE artifact for ${packageName}`);
    }

    if (!licenseText) {
      console.warn(`[WARN] Missing LICENSE in ${relPkgDir} (both artifact and source)`);
      continue;
    }
    const licenseVersions = parseLicenseVersions(licenseText);

    const lockInfo = (() => {
      const lockYamlText = readTextIfExists(lockYamlPath);
      if (lockYamlText) {
        return { kind: "pnpm", data: parsePnpmLock(lockYamlText) };
      }

      console.warn(`[WARN] Missing pnpm-lock.yaml in ${relPkgDir}; skipping.`);
      return null;
    })();

    if (!lockInfo) {
      continue;
    }

    const names = Object.keys(licenseVersions);
    if (names.length === 0) {
      console.log(`[INFO] No version entries found in LICENSE for ${packageName}`);
      continue;
    }

    for (const depName of names) {
      const expected = licenseVersions[depName];
      const installedVersions = getInstalledVersions(lockInfo, depName);
      if (installedVersions.length === 0) {
        mismatches.push({ pkgDir: relPkgDir, depName, expected, installed: "not found" });
        continue;
      }
      if (installedVersions.includes(expected)) {
        console.log(`[OK] ${packageName}: ${depName}@${expected} matches LICENSE`);
      } else {
        mismatches.push({ pkgDir: relPkgDir, depName, expected, installed: installedVersions.join(", ") });
      }
    }
  }

  if (mismatches.length > 0) {
    console.error("\nVersion mismatches found between LICENSE artifacts and installed dependencies:");
    for (const m of mismatches) {
      console.error(`- ${m.pkgDir}: ${m.depName} LICENSE=${m.expected} installed=${m.installed}`);
    }
    process.exit(1);
  }

  console.log("\nAll LICENSE artifact versions match installed dependency versions.");
}

main();
