#!/usr/bin/env node
import { openSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [pidPath, logPath, directory, command, ...args] = process.argv.slice(2);
if (!pidPath || !logPath || !directory || !command) {
  throw new Error('usage: m1-live-detach.mjs PID LOG CWD COMMAND [ARG ...]');
}
const log = openSync(logPath, 'a');
const child = spawn(command, args, {
  cwd: directory,
  detached: true,
  env: process.env,
  stdio: ['ignore', log, log],
});
writeFileSync(pidPath, `${child.pid}\n`);
child.unref();
