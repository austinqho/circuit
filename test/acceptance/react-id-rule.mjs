import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactId} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],
    {encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({api:'react/useId/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),{JSDOM}=require('jsdom');
  const dom=new JSDOM('<div id="one"></div><div id="two"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;
  const React=require('react'),DOM=require('react-dom'),Client=require('react-dom/client'),Server=require('react-dom/server');
  assert.equal(React.version,'18.3.1');assert.equal(require('react-dom/package.json').version,'18.3.1');
  const rule=getReactBehavior({surface:'react',exportName:'useId',version:React.version}).execution;
  const cases=[];let last=[];
  function App(){last=[];for(let i=0;i<35;i++)last.push(React.useId());return React.createElement('output',null,last.join(','));}
  let counter=0;
  for(const [rootIndex,prefix] of ['','product-'].entries()) {
    const root=Client.createRoot(document.getElementById(rootIndex?'two':'one'),{identifierPrefix:prefix});
    let previous=null;
    for(const key of ['first','first','second']) {
      DOM.flushSync(()=>root.render(React.createElement(App,{key})));
      last.forEach((value,index)=>{
        const owner=`${rootIndex}:${key}:${index}`,prior=previous?.key===key?{owner,value:previous.values[index]}:null;
        cases.push({input:{owner,prefix,clientCounter:counter,previous:prior},value});if(!prior)counter++;
      });previous={key,values:last.slice()};
    }
    DOM.flushSync(()=>root.unmount());
  }
  for(const prefix of ['','server-']) {
    const markup=Server.renderToString(React.createElement(App),{identifierPrefix:prefix});assert.match(markup,/output/);
    last.forEach((value,index)=>cases.push({input:{owner:`server:${index}`,environment:'server',prefix,treeId:'0',localIndex:index},value}));
  }
  const check=program=>{assert.equal(validateReactExecutionRule(program).valid,true);for(const row of cases){const prediction=planReactId(program,row.input);assert.equal(prediction.status,'planned');assert.equal(prediction.value,row.value);}};
  check(rule);let rejected=0;for(const mutation of [{retain_on_update:false},{client_marker:'R'},{server_marker:'r'},{local_marker:'h'},{separator:'_'},{radix:16}]){assert.throws(()=>check({...rule,...mutation}));rejected++;}
  assert.equal(planReactId(rule,{owner:'missing-counter'}).reason,'id_client_counter_required');
  assert.equal(planReactId(rule,{owner:'missing-tree',environment:'hydrate'}).reason,'id_tree_position_required');
  console.log(JSON.stringify({build:process.env.NODE_ENV,cases:cases.length,incorrect_programs_rejected:rejected,
    allocation_retention_remount:true,multiple_roots_and_prefixes:true,base32_local_ids:true,server_tree_position:true,unknown_positions_rejected:true}));dom.window.close();
}
