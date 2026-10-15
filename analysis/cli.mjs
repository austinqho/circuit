#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { analyzeReact } from './index.mjs';

const usage = `Usage: producttrace-analyze [repository] [options]

Build a source-only React map. No application code or browser is executed.
The map reports possibilities and unresolved cases, not observed outcomes.

  --include PATH     Analyze a selected relative file/directory (repeatable)
  --out FILE         Write JSON to FILE; default is stdout
  --max-files N      Bound analyzed file count (default 5000)
  --max-bytes N      Bound total source bytes (default 20971520)
  --strict          Exit 2 if any unresolved diagnostics remain
  --help            Show this help
`;

function parse(args) {
  const options = { repository: process.cwd() };
  let out;
  let strict = false;
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--strict') { strict = true; continue; }
    if (['--include', '--out', '--max-files', '--max-bytes'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new TypeError(`Missing value for ${arg}`);
      if (arg === '--include') (options.include ??= []).push(value);
      else if (arg === '--out') out = value;
      else options[arg === '--max-files' ? 'maxFiles' : 'maxBytes'] = Number(value);
    } else if (arg.startsWith('-')) throw new TypeError(`Unknown option: ${arg}`);
    else if (positional) throw new TypeError('Only one repository may be supplied');
    else { options.repository = path.resolve(arg); positional = true; }
  }
  return { options, out, strict };
}

try {
  const args = parse(process.argv.slice(2));
  if (args.help) process.stdout.write(usage);
  else {
    const result = analyzeReact(args.options);
    const json = JSON.stringify(result, null, 2) + '\n';
    if (args.out) fs.writeFileSync(path.resolve(args.out), json, { flag: 'wx' });
    else process.stdout.write(json);
    if (args.strict && result.diagnostics.length) process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`producttrace-analyze: ${error.message}\n`);
  process.exitCode = 1;
}
