#!/usr/bin/env node
/**
 * Enforces domain boundaries (see plan / CONTRIBUTING-AGENTS.md):
 *  1. A domain may import only from the domains listed in ALLOW (plus itself).
 *  2. Imports into another FEATURE domain must go through its public index (`@/model`, not `@/model/store`).
 *     contracts/* and lib/* sub-paths are fine.
 *  3. Pure domains must not import UI/framework packages listed in FORBIDDEN_PKGS.
 * Files directly under src/ (main.tsx) are the composition root and may import anything.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = join(ROOT, 'src');

const SHARED = ['contracts', 'lib'];
const ALLOW = {
  contracts: ['contracts'],
  lib: ['contracts', 'lib'],
  styles: [],
  model: SHARED,
  generators: SHARED,
  plan: SHARED,
  canvas: SHARED,
  build: SHARED,
  panels: [...SHARED, 'canvas'],
  app: [...SHARED, 'model', 'generators', 'plan', 'canvas', 'build', 'panels', 'styles'],
};
const OPEN_SUBPATHS = new Set(['contracts', 'lib', 'styles']);
const FORBIDDEN_PKGS = {
  contracts: ['react', 'react-dom', 'zustand', 'zundo'],
  lib: ['react', 'react-dom', 'zustand', 'zundo'],
  generators: ['react', 'react-dom', 'zustand', 'zundo'],
  plan: ['react', 'react-dom', 'zustand', 'zundo'],
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

const domainOf = (abs) => {
  const parts = relative(SRC, abs).split(sep);
  return parts.length === 1 ? null : parts[0];
};

const errors = [];
for (const file of walk(SRC)) {
  const from = domainOf(file);
  if (from === null) continue; // composition root
  const isTest = /\.test\.tsx?$/.test(file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    let target;
    if (spec.startsWith('@/')) target = join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) target = resolve(dirname(file), spec);
    else {
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!isTest && FORBIDDEN_PKGS[from]?.includes(pkg)) errors.push(`${rel(file)}: '${from}' must not import package '${pkg}'`);
      continue;
    }
    const rp = relative(SRC, target).split(sep);
    if (rp[0] === '..') { errors.push(`${rel(file)}: import escapes src: '${spec}'`); continue; }
    const to = rp[0];
    if (to === from) continue;
    if (!(ALLOW[from] ?? []).includes(to)) {
      errors.push(`${rel(file)}: '${from}' may not import from '${to}' ('${spec}')`);
      continue;
    }
    const deep = rp.length > 1 && !(rp.length === 2 && /^index(\.tsx?)?$/.test(rp[1]));
    if (deep && !OPEN_SUBPATHS.has(to)) errors.push(`${rel(file)}: import '${to}' via its public index, not '${spec}'`);
  }
}

function rel(p) { return relative(ROOT, p).split(sep).join('/'); }

if (errors.length) {
  console.error(`Boundary violations (${errors.length}):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log('boundaries ok');
