import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import ts from 'typescript';
import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {analyzeReact,createReactRuntimeIntegration} from '../../analysis/index.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{
    encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({builds,installed_source_attested:true,prop_precedence_verified:true,unknown_spread_abstained:true},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),React=require('react'),Server=require('react-dom/server');assert.equal(React.version,'18.3.1');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'boundary-props-'));
  const cases=[
    {name:'positional-children',jsx:`<React.Fragment children={<button id="wrong" onClick={()=>bad()}/>}><button id="right" onClick={()=>good()}/></React.Fragment>`,visible:'right',controls:1},
    {name:'last-children-prop',jsx:`<React.Fragment children={<button id="wrong" onClick={()=>bad()}/>} children={<button id="right" onClick={()=>good()}/>}/>`,visible:'right',controls:1},
    {name:'explicit-after-spread',jsx:`<React.Fragment {...unknown} children={<button id="right" onClick={()=>good()}/>}/>`,visible:'right',controls:1},
    {name:'unknown-final-spread',jsx:`<React.Fragment children={<button id="wrong" onClick={()=>bad()}/>} {...unknown}/>`,visible:'actual-spread',controls:0},
    {name:'whitespace-uncertain',jsx:`<React.Fragment children={<button id="wrong" onClick={()=>bad()}/>}> </React.Fragment>`,visible:null,controls:0},
    {name:'last-fallback-prop',jsx:`<React.Suspense fallback={<button id="wrong" onClick={()=>bad()}/>} {...unknown} fallback={<button id="right" onClick={()=>good()}/>}><Pending/></React.Suspense>`,visible:'right',controls:1},
  ];
  try {
    fs.mkdirSync(path.join(temporary,'node_modules'));fs.mkdirSync(path.join(temporary,'src'));
    const pkg={name:'boundary-props',private:true,dependencies:{react:'18.3.1','react-dom':'18.3.1'}},lock=JSON.parse(fs.readFileSync(path.join(repository,'package-lock.json')));
    fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify(pkg));fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:pkg.name,lockfileVersion:3,packages:{'':pkg,
      'node_modules/react':lock.packages['node_modules/react'],'node_modules/react-dom':lock.packages['node_modules/react-dom']}}));
    for(const name of ['react','react-dom'])fs.symlinkSync(path.join(repository,'node_modules',name),path.join(temporary,'node_modules',name));
    const rows=[];
    for(const sample of cases) {
      const source=`import * as React from 'react';function Pending(){throw new Promise(()=>{});}export function App({unknown}){return ${sample.jsx};}`;
      fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);const map=analyzeReact({repository:temporary}),integration=createReactRuntimeIntegration(map);
      assert.ok(map.react_semantics.every(row=>row.package_verification_sha256));assert.equal(map.controls.length,sample.controls,sample.name);
      assert.ok(map.controls.every(control=>map.nodes.find(row=>row.id===control.source_node_id).text.includes('id="right"')),sample.name);
      if(sample.controls===0)assert.ok(map.diagnostics.some(row=>['boundary_input_spread_unresolved','boundary_children_whitespace_unresolved'].includes(row.code)));
      const transformed=integration.instrumentSource('src/App.tsx',source);assert.deepEqual(transformed.diagnostics,[]);
      const compile=code=>ts.transpileModule(code.replace("import * as React from 'react';",'').replace('export function App','function App'),{
        compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
      const records=[],runtime={...integration.createApiRuntime({onObservation:row=>records.push(row)}),callback:(_key,value)=>value};
      const Original=new Function('React',compile(source)+';return App;')(React),Observed=new Function('React','globalThis',compile(transformed.code)+';return App;')(React,{__productTraceReactLifecycle:runtime});
      const props={unknown:{children:React.createElement('button',{id:'actual-spread'},'Spread')}};
      const before=Server.renderToStaticMarkup(React.createElement(Original,props)),after=Server.renderToStaticMarkup(React.createElement(Observed,props));
      const ids=markup=>[...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
      assert.deepEqual(ids(before),sample.visible?[sample.visible]:[],sample.name);assert.deepEqual(ids(after),ids(before),sample.name);
      assert.ok(records.length>0 && records.every(row=>integration.joinApi(row).status==='resolved'));
      rows.push({name:sample.name,visible_ids:ids(after),source_controls:map.controls.length,render_parity:true,element_observations:records.length});
    }
    console.log(JSON.stringify({build:process.env.NODE_ENV,rows}));
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
