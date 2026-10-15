// Harness helpers for fixture processes started by per-repository sessions.
import net from 'node:net';

/** Refuse to start when a stale process still owns the port (it would answer for us). */
export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.connect({ port, host: '127.0.0.1' });
    probe.once('connect', () => { probe.destroy(); reject(new Error(`port ${port} is already in use; stop the stale process first`)); });
    probe.once('error', () => resolve());
  });
}

/** SIGTERM, wait for exit, then SIGKILL. */
export async function stopChild(child, graceMs = 3000) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = new Promise(resolve => setTimeout(resolve, graceMs, 'timeout'));
  if (await Promise.race([exited, timer]) === 'timeout') { child.kill('SIGKILL'); await exited; }
}
