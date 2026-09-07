#!/usr/bin/env node
// Cross-version, cross-platform test runner: lists test/*.test.js itself and hands the files to
// `node --test`. (Node 18 and 20 do not expand glob patterns in --test arguments; Windows shells do not either.)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join('test', f));
const extra = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test', ...extra, ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
