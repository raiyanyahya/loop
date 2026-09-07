#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => process.exit(typeof code === 'number' ? code : 0),
  (err) => {
    process.stderr.write(`\n  loop: ${err && err.message ? err.message : err}\n\n`);
    if (process.env.LOOP_DEBUG) console.error(err);
    process.exit(1);
  },
);
