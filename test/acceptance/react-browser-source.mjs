import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {analyzeReact,REACT_PACKAGE_ATTESTATIONS} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'react-browser-source-'));
try{
 const dependencies={react:'18.3.1','react-dom':'18.3.1'},manifest={name:'browser-source-check',private:true,dependencies};
 fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(manifest));
 const lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json'))),packages={'':manifest};
 for(const name of Object.keys(dependencies)){
  packages['node_modules/'+name]=lock.packages['node_modules/'+name];
  const contract=REACT_PACKAGE_ATTESTATIONS.find(row=>row.package===name);
  for(const file of Object.keys(contract.verification.installations[0].files)){
   const target=path.join(temporary,'node_modules',name,file);fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.copyFileSync(path.join(repository,'node_modules',name,file),target);
  }
 }
 fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:manifest.name,lockfileVersion:3,packages}));
 fs.writeFileSync(path.join(temporary,'App.tsx'),"import * as React from 'react';import * as DOM from 'react-dom';function App(){const cb=React.useCallback(()=>DOM.findDOMNode(null),[]);return <button onClick={cb}/>;}");
 const run=()=>analyzeReact({repository:temporary}),baseline=run();assert.ok(baseline.react_semantics.some(row=>row.export==='useCallback'));assert.ok(baseline.react_semantics.some(row=>row.export==='findDOMNode'));
 const tested=[];
 for(const name of Object.keys(dependencies))for(const variant of ['development','production.min',...(name==='react-dom'?['profiling.min']:[])]){
  const relative=`node_modules/${name}/umd/${name}.${variant}.js`,file=path.join(temporary,relative),original=fs.readFileSync(file);
  fs.appendFileSync(file,'\n// deliberately changed browser distribution\n');const changed=run();
  assert.ok(changed.react_backlog.some(row=>row.surface===name&&row.reason==='installed_dependency_source_mismatch'),JSON.stringify(changed.react_backlog));
  assert.equal(changed.react_semantics.some(row=>row.surface===name),false);fs.writeFileSync(file,original);tested.push(relative);
 }
 assert.equal(run().react_semantics.length,baseline.react_semantics.length);
 console.log(JSON.stringify({schema:'producttrace.react-browser-source-acceptance.v1',react:'18.3.1',attested_files:REACT_PACKAGE_ATTESTATIONS.reduce((n,row)=>n+Object.keys(row.verification.installations[0].files).length,0),
  tampered_browser_files_rejected:tested,restored_source_admitted:true},null,2));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
