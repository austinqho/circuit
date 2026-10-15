#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const dist = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 3081);
const backend = new URL(process.env.PRODUCTTRACE_BACKEND_ORIGIN || 'http://localhost:3080');
const viewer = process.env.PRODUCTTRACE_VIEWER_ORIGIN || 'http://127.0.0.1:8123';
const capture = new URL('/api/demo/runtime-attribution', viewer);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };

const captureBootstrap = `<script>(function(){
  const nativeFetch=globalThis.fetch.bind(globalThis), endpoint='/__producttrace_capture';
  const pageId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);let critical=[],detail=[],criticalScheduled=false,detailScheduled=false,criticalInflight=false,detailInflight=false;
  const bodyFor=rows=>JSON.stringify({page_id:pageId,rows});
  const isCritical=row=>row.kind==='dom.action'||row.kind==='network.request'||row.kind==='dom.mutation';
  const takeBatch=queue=>{const rows=[];let bytes=0;while(rows.length<128&&rows.length<queue.length){const row=queue[rows.length],size=JSON.stringify(row).length;if(rows.length&&bytes+size>48000)break;rows.push(row);bytes+=size}return rows};
  const flushCritical=()=>{criticalScheduled=false;if(criticalInflight||!critical.length)return;criticalInflight=true;const rows=critical.slice(0,1);nativeFetch(endpoint,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:bodyFor(rows),keepalive:true}).then(response=>{if(response.ok)critical.splice(0,rows.length)}).catch(()=>{}).finally(()=>{criticalInflight=false;if(critical.length)setTimeout(flushCritical,0)});};
  const flushDetail=()=>{detailScheduled=false;if(detailInflight||!detail.length)return;detailInflight=true;const rows=takeBatch(detail);nativeFetch(endpoint,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:bodyFor(rows),keepalive:true}).then(response=>{if(response.ok)detail.splice(0,rows.length)}).catch(()=>{}).finally(()=>{detailInflight=false;if(detail.length)setTimeout(flushDetail,0)});};
  globalThis.__producttraceHostCapture=packet=>{try{const parsed=typeof packet==='string'?JSON.parse(packet):packet;const row=parsed&&parsed.channel==='runtime-attribution'?parsed.row:parsed;if(!row||row.internal===true||row.transport_internal===true)return;if(isCritical(row)){critical.push(row);if(!criticalScheduled&&!criticalInflight){criticalScheduled=true;flushCritical()}}else{detail.push(row);if(!detailScheduled&&!detailInflight){detailScheduled=true;queueMicrotask(flushDetail)}}}catch{}};
  globalThis.__producttraceCaptureState=()=>({critical:critical.length,detail:detail.length,critical_inflight:criticalInflight,detail_inflight:detailInflight});
  addEventListener('pagehide',()=>{for(const queue of [critical,detail]){let offset=0;while(offset<queue.length){const rows=[],start=offset;let bytes=0;while(offset<queue.length&&rows.length<128){const row=queue[offset],size=JSON.stringify(row).length;if(rows.length&&bytes+size>48000)break;rows.push(row);bytes+=size;offset+=1}if(offset===start)break;const body=JSON.stringify({page_id:pageId,pagehide:true,rows});try{navigator.sendBeacon(endpoint,new Blob([body],{type:'text/plain;charset=UTF-8'}))}catch{}}}});
})();</script>`;

function proxy(req, res, origin = backend, pathname = req.url) {
  const target = new URL(pathname, origin);
  const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, response => {
    res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
  });
  upstream.on('error', error => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(error.message); });
  req.pipe(upstream);
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/__producttrace_capture') return proxy(req, res, capture, capture.pathname);
  if (url.pathname.startsWith('/api/')) return proxy(req, res);
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//u, '');
  let file = path.resolve(dist, relative);
  if ((!file.startsWith(`${dist}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) && req.method === 'GET' && !path.extname(url.pathname)) file = path.join(dist, 'index.html');
  if (!file.startsWith(`${dist}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  if (path.basename(file) === 'index.html') {
    const html = fs.readFileSync(file, 'utf8').replace('<head>', `<head>${captureBootstrap}`);
    res.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-store' }); return res.end(html);
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`instrumented LibreChat on http://127.0.0.1:${port}/`));
