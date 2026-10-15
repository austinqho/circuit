import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(process.argv[2] || '/tmp/producttrace-librechat-m1-cycle3e', 'package.json'));
const { chromium } = require('playwright');
const runtime = fs.readFileSync(path.join(root, 'src/runtime-attribution-browser.js'), 'utf8');
const received = [];
const server = http.createServer((req, res) => {
  if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<button id="burst">burst</button><script>document.querySelector("#burst").addEventListener("click",()=>{for(let i=0;i<3000;i++)window.__productTraceRuntime.emit({kind:"burst.row",index:i})})</script>'); return; }
  if (req.url !== '/capture' || req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  let body = ''; req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; });
  req.on('end', () => { try { const payload = JSON.parse(body); received.push(...(payload.rows || [])); res.writeHead(204); res.end(); } catch { res.writeHead(400); res.end(); } });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const host = `(() => {
  const q=[]; let busy=false; const nativeFetch=globalThis.fetch.bind(globalThis);
  const flush=async()=>{if(busy)return;busy=true;try{while(q.length){const b=[];let n=0;while(q.length&&b.length<64){const x=q.shift();const s=JSON.stringify(x).length;if(b.length&&n+s>32768)break;b.push(x);n+=s;}let ok=false;for(let i=0;i<4&&!ok;i++){try{ok=(await nativeFetch('/capture',{method:'POST',body:JSON.stringify({rows:b}),keepalive:true})).ok}catch{}if(!ok)await new Promise(r=>setTimeout(r,2**i*5));}if(!ok)throw Error('burst capture failed')}}finally{busy=false}};
  globalThis.__producttraceHostCapture=t=>{q.push(JSON.parse(t).row);void flush()}; globalThis.__burstQueue=()=>q.length;
})()`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('pageerror', error.message));
  await page.addInitScript({ content: `${host};\n${runtime}` });
  await page.goto(`${origin}/page`, { waitUntil: 'domcontentloaded' });
  const init = await page.evaluate(() => ({ url: location.href, runtime: !!globalThis.__productTraceRuntime, host: typeof globalThis.__producttraceHostCapture }));
  await page.locator('#burst').click();
  await page.waitForTimeout(1500);
  const queued = await page.evaluate(() => globalThis.__burstQueue());
  const seq = received.map(row => row.sequence).sort((a,b) => a-b);
  const gaps = []; for (let i=1;i<seq.length;i++) if (seq[i] !== seq[i-1]+1) gaps.push([seq[i-1]+1, seq[i]-1]);
  const result = { emitted: 3001, received: received.length, queued, gaps, init, pass: received.length >= 3001 && queued === 0 && gaps.length === 0 };
  console.log(JSON.stringify(result));
  if (!result.pass) process.exitCode = 1;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
