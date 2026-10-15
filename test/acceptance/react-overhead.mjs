import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {brotliCompressSync,gzipSync} from 'node:zlib';
import {analyzeReact} from '../../analysis/index.mjs';
import {createReactLifecycleEvidenceSession} from '../../analysis/react-lifecycle-evidence.mjs';

const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const root=path.resolve(import.meta.dirname,'../..');
const beforeHeap=process.memoryUsage().heapUsed,started=performance.now();
const map=analyzeReact({repository});
const analysisMs=performance.now()-started,analysisHeap=Math.max(0,process.memoryUsage().heapUsed-beforeHeap);
const semantic=map.react_semantics.find(row=>row.export==='useEffect');
assert.ok(semantic,'LibreChat needs at least one admitted effect occurrence for the evidence benchmark');
const session=createReactLifecycleEvidenceSession(map);let sequence=0;
const event=(operation,index)=>({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
  observation_id:`benchmark-${++sequence}`,occurrence_id:`benchmark-occurrence-${sequence}`,
  map_fingerprint:map.fingerprint,source_call_id:semantic.call_id,semantic_id:semantic.semantic_id,
  owner_source_id:semantic.causal_bindings.owner_source_id,operation,root_id:'benchmark-root',
  instance_id:'benchmark-instance',mount_id:'benchmark-mount',render_id:`benchmark-render-${index}`,
  hook_slot_id:'benchmark-hook-0',
  evidence_ids:[`benchmark-evidence-${sequence}`]});
const iterations=10000,joinStarted=performance.now();
for(let index=0;index<iterations;index++){
  assert.equal(session.join(event('render_attempted',index)).status,'resolved');
  assert.equal(session.join(event('render_abandoned',index)).status,'resolved');
}
const joinMs=performance.now()-joinStarted;
const currentBytes=fs.statSync(path.join(root,'dist/producttrace-runtime.js')).size;
const currentSource=fs.readFileSync(path.join(root,'dist/producttrace-runtime.js'));
const baseSource=execFileSync('git',['show','origin/main:dist/producttrace-runtime.js'],{cwd:root});
const baseBytes=baseSource.length;
const gzipBytes=gzipSync(currentSource).length,baseGzipBytes=gzipSync(baseSource).length;
const brotliBytes=brotliCompressSync(currentSource).length;
const baseBrotliBytes=brotliCompressSync(baseSource).length;
assert.ok(currentBytes-baseBytes<40000,
  'React lifecycle recording unexpectedly added 40KB or more uncompressed');
assert.ok(gzipBytes-baseGzipBytes<10000,
  'React lifecycle recording unexpectedly added 10KB or more gzip-compressed');
console.log(JSON.stringify({schema:'producttrace.react-overhead.v1',revision:'45cc53c40b47645b887c3bb996168e06aaa83f4c',
  source_files:map.input.file_count,controls:map.controls.length,react_semantic_occurrences:map.react_semantics.length,
  full_repository_analysis_ms:Math.round(analysisMs),analysis_heap_delta_mb:Number((analysisHeap/1024/1024).toFixed(1)),
  lifecycle_join_operations:iterations*2,lifecycle_join_ms:Number(joinMs.toFixed(1)),
  lifecycle_joins_per_second:Math.round(iterations*2/(joinMs/1000)),runtime_bytes:currentBytes,
  base_runtime_bytes:baseBytes,runtime_byte_delta:currentBytes-baseBytes,
  runtime_gzip_bytes:gzipBytes,base_runtime_gzip_bytes:baseGzipBytes,
  runtime_gzip_byte_delta:gzipBytes-baseGzipBytes,
  runtime_brotli_bytes:brotliBytes,base_runtime_brotli_bytes:baseBrotliBytes,
  runtime_brotli_byte_delta:brotliBytes-baseBrotliBytes},null,2));
