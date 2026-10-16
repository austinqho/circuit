import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';

const installedRepository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const installedRequire=createRequire(path.join(installedRepository,'package.json'));
const React=installedRequire('react');
const ServerNode=installedRequire('react-dom/server');
const ServerBrowser=installedRequire('react-dom/server.browser');
const {PassThrough}=await import('node:stream');
assert.equal(React.version,'18.3.1');assert.equal(ServerNode.version,'18.3.1');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'producttrace-react-server-api-'));
const source=`import * as React from 'react';
import * as Server from 'react-dom/server';
import {PassThrough} from 'node:stream';
export async function runServerApis(){
  const version=Server.version;
  const element=React.createElement('b',null,'server');
  const string=Server.renderToString(element);
  const staticMarkup=Server.renderToStaticMarkup(element);
  let nodeStream='';for await(const chunk of Server.renderToNodeStream(element))nodeStream+=chunk;
  let staticNodeStream='';for await(const chunk of Server.renderToStaticNodeStream(element))staticNodeStream+=chunk;
  let pipeable;const pipeableText=await new Promise((resolve,reject)=>{
    const destination=new PassThrough();let text='';destination.on('data',chunk=>text+=chunk);
    destination.on('end',()=>resolve(text));destination.on('error',reject);
    pipeable=Server.renderToPipeableStream(element,{onShellReady(){pipeable.pipe(destination)},onShellError:reject,onError:reject});
  });
  const readable=await Server.renderToReadableStream(element);await readable.allReady;
  const readableText=await new Response(readable).text();
  return {version,string,staticMarkup,nodeStream,staticNodeStream,pipeableText,readableText};
}`;

try{
  fs.mkdirSync(path.join(temporary,'src'));
  fs.writeFileSync(path.join(temporary,'src/server.tsx'),source);
  fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify({name:'react-server-api-runtime-probe',private:true,
    dependencies:{react:'18.3.1','react-dom':'18.3.1'}}));
  const lock=JSON.parse(fs.readFileSync(path.join(installedRepository,'package-lock.json'),'utf8'));
  fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:'react-server-api-runtime-probe',lockfileVersion:3,
    packages:{'':{name:'react-server-api-runtime-probe',dependencies:{react:'18.3.1','react-dom':'18.3.1'}},
      'node_modules/react':lock.packages['node_modules/react'],
      'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
  fs.mkdirSync(path.join(temporary,'node_modules'));
  fs.symlinkSync(path.join(installedRepository,'node_modules/react'),path.join(temporary,'node_modules/react'));
  fs.symlinkSync(path.join(installedRepository,'node_modules/react-dom'),path.join(temporary,'node_modules/react-dom'));
  const map=analyzeReact({repository:temporary});
  const integration=createReactRuntimeIntegration(map);
  const transformed=integration.instrumentSource('src/server.tsx',source);
  assert.deepEqual(transformed.diagnostics.filter(row=>
    row.code!=='unsupported_react_api_observation_transform'),[]);
  const executable=transformed.code
    .replace("import * as React from 'react';",'const React=globalThis.__reactApi;')
    .replace("import * as Server from 'react-dom/server';",'const Server=globalThis.__serverApi;')
    .replace("import {PassThrough} from 'node:stream';",'const PassThrough=globalThis.__passThrough;')
    .replace('export async function','async function');
  const application=ts.transpileModule(executable,{compilerOptions:{target:ts.ScriptTarget.ES2022,
    module:ts.ModuleKind.None}}).outputText;
  const observations=[];
  globalThis.__reactApi=React;
  globalThis.__serverApi={...ServerNode,renderToReadableStream:ServerBrowser.renderToReadableStream};
  globalThis.__passThrough=PassThrough;
  globalThis.__productTraceReactLifecycle=integration.createApiRuntime({session:'server-api-fixture',
    onObservation:record=>observations.push(record)});
  try{
    const run=new Function(`${application};return runServerApis;`)();
    const result=await run();
    for(const value of Object.values(result))assert.equal(value==='18.3.1'||value==='<b>server</b>',true);
  }finally{
    delete globalThis.__reactApi;delete globalThis.__serverApi;delete globalThis.__passThrough;
    delete globalThis.__productTraceReactLifecycle;
  }
  assert.ok(observations.every(record=>['react_api','react_element','react_server'].includes(record.kind)));
  const descriptions=observations.filter(record=>record.kind==='react_element');
  assert.equal(descriptions.length,1);
  for(const record of descriptions)assert.equal(integration.joinElement(record).status,'resolved');
  // This older fixture passes an aliased native element, not a source-resolved
  // function component. Its server calls must keep the new component frontier.
  const serverObservations=observations.filter(record=>record.kind==='react_server');
  const serverOrigins=serverObservations.filter(record=>record.operation==='returned');
  const serverConsumers=serverObservations.filter(record=>record.operation!=='returned');
  assert.equal(serverOrigins.length,6);assert.equal(serverConsumers.length,0);
  for(const record of serverOrigins)assert.equal(integration.joinServer(record).reason,'server_root_component_unobserved');
  // The generic helper accepts streams as parameters, so source analysis cannot
  // prove which React call created them. It must remain uninstrumented rather
  // than producing a plausible cross-occurrence join.
  const apiObservations=observations.filter(record=>record.kind==='react_api');
  const joins=apiObservations.map(record=>integration.joinApi(record));
  assert.deepEqual(joins.filter(join=>join.status!=='resolved'),[]);
  const version=joins.find(join=>join.source.export==='version');
  assert.equal(version.runtime.export_value.value,'18.3.1');
  const read=observations.find(row=>row.export==='version');
  assert.equal(integration.joinApi({...read,export_value:{encoding:'primitive',value:'foreign'}}).reason,'literal_export_value_mismatch');
  const invocations={};for(const join of joins){const id=join.source.semantic_id;invocations[id]=(invocations[id]||0)+1;}
  console.log(JSON.stringify({react:React.version,installed_source_attested:true,literal_export_paths_verified:true,
    source_semantics:[...new Set(map.react_semantics.map(row=>row.semantic_id))].sort(),
    joined_api_invocations:Object.fromEntries(Object.entries(invocations).sort()),
    api_observations:apiObservations.length,server_component_frontiers:serverOrigins.length,
    server_consumer_frontiers:serverConsumers.length,element_descriptions:descriptions.length},null,2));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
