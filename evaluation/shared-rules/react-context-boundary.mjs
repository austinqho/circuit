import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {readLibraryImplementation} from '../../authoring/library-implementation.mjs';
import {portableImplementation,programOverrides,admitCatalogProgram} from '../../authoring/library-program-catalog.mjs';
import {createLibraryProgramBank,programHash} from '../../analysis/library-program-bank.mjs';
import {createLibraryBoundary} from '../../analysis/library-boundary.mjs';
import {instrumentLibraryPrograms} from '../../analysis/library-program-integration.mjs';
import {createLibraryProgramVerifier} from '../../authoring/library-program-verifier.mjs';
import {reactContextProgram,reactContextScope} from './react-context-programs.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.resolve(directory,'../../authoring/banks/react-context-programs.json');
const writing = process.argv.includes('--write-catalog');
let skeleton = writing ? null : JSON.parse(fs.readFileSync(catalogPath)).skeletons[0];
const reports = [];
for (const major of ['18.2','18','19']) {
  const repository = path.join(directory,'react-runtime',major), require = createRequire(path.join(repository,'package.json'));
  const {JSDOM} = require('jsdom'), dom = new JSDOM('<main></main>',{url:'http://localhost/'});
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  const implementation = readLibraryImplementation({repository,specifier:'react',exportName:'createContext'});
  assert.equal(implementation.context.source_status,'ready_for_scoped_proposal',implementation.context.source_reason);
  const React = require('react'), {createRoot} = require('react-dom/client'), {flushSync} = require('react-dom');
  const version = React.version, scope = reactContextScope(version), program = reactContextProgram(version);
  const behavior = ({program,scope: candidateScope = scope}) => {
    if (JSON.stringify(candidateScope) !== JSON.stringify(scope)) return {status:'rejected',reason:'independent_context_scope_mismatch'};
    const boundary = createLibraryBoundary({producer:implementation.producer,program,...scope});
    const values = [undefined,null,false,true,0,-0,NaN,'default',{identity:'exact'},['array'],()=>{throw new Error('default is a value, not an initializer')}];
    const created = [];
    for (const value of values) {
      const context = boundary.invoke([value]); created.push(context);
      assert(Object.is(context._currentValue,value)); assert(Object.is(context._currentValue2,value));
      assert.equal(context.Consumer._context,context);
      if (version.startsWith('18.')) assert.equal(context.Provider._context,context); else assert.equal(context.Provider,context);
    }
    assert.equal(new Set(created).size,values.length);
    const result = boundary.checkpoint();
    return {status:result.status==='observed_agreement'?'passed':'rejected',reason:result.failures[0]?.reason,cases:values.length,report:result};
  };
  const integration = async ({program}) => {
    const probe = createLibraryProgramBank({check:()=>({status:'passed',reason:'isolated_integration_probe'})});
    assert.equal((await probe.admit({implementation,program,scope})).status,'admitted');
    const source = "import {createContext} from 'react'; export function make(value){return createContext(value)}";
    const transformed = instrumentLibraryPrograms({source,file:'context-path.ts',bank:probe});
    assert.equal(transformed.bindings.length,1); assert.equal(transformed.frontiers.length,0);
    const exports = {};
    vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports,require:()=>React,[transformed.runtimeKey]:transformed.runtime});
    const firstDefault = {surface:'chat-default'}, secondDefault = {surface:'scroll-default'};
    const first = exports.make(firstDefault), second = exports.make(secondDefault);
    assert.notEqual(first,second);
    const container = document.createElement('section'); document.querySelector('main').append(container);
    const root = createRoot(container), observed = [];
    function Read({context,label}) { const value = React.useContext(context); observed.push([label,value]); return React.createElement('span',null,label+':'+String(value?.surface)); }
    const tree = supplied => React.createElement(React.Fragment,null,
      React.createElement(first.Provider,{value:supplied},React.createElement(Read,{context:first,label:'chat'})),
      React.createElement(Read,{context:second,label:'scroll'}),
      React.createElement(first.Consumer,null,value=>React.createElement('b',null,'outside:'+value.surface)));
    const supplied = {surface:'chat-provider'};
    flushSync(()=>root.render(tree(supplied)));
    assert.deepEqual(observed,[['chat',supplied],['scroll',secondDefault]]);
    assert.equal(container.textContent,'chat:chat-providerscroll:scroll-defaultoutside:chat-default');
    observed.length=0;
    flushSync(()=>root.render(tree(undefined)));
    assert.deepEqual(observed,[['chat',undefined],['scroll',secondDefault]]);
    flushSync(()=>root.unmount()); container.remove();
    const evidence = transformed.runtime.checkpoint();
    const identities = evidence.flatMap(row=>row.evidence).filter(row=>row.kind==='result_identity');
    const roots = identities.filter(row=>row.result_path.length===0);
    assert.equal(roots.length,2); assert.notEqual(roots[0].value,roots[1].value);
    for (const root of roots) {
      const rows = identities.filter(row=>row.occurrence===root.occurrence);
      assert.equal(rows.find(row=>row.result_path.join('.')==='Consumer._context').value,root.value);
      const provider = rows.find(row=>row.result_path.join('.')===(version.startsWith('18.')?'Provider._context':'Provider'));
      assert.equal(provider.value,root.value);
    }
    return {status:evidence.every(row=>row.status==='observed_agreement')?'passed':'rejected',reason:evidence.flatMap(row=>row.failures||[])[0]?.reason,
      render_checks:4,evidence,scope:'Created contexts remain usable by the actual renderer; later renderer events are independently asserted, not emitted as creation-rule evidence.'};
  };
  if (!skeleton) skeleton={schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:'createContext',scope,program,versions:[]};
  if (writing) {
    const source=portableImplementation(implementation.context);
    skeleton.versions.push({version,scope,base_sha256:programHash(skeleton.program),overrides:programOverrides(skeleton.program,program),
      program_sha256:programHash(program),implementation_sha256:programHash(source),implementation:source,
      verification:{origin:'manual_exact_installed_source',scope:scope.description}});
  }
  const bank=createLibraryProgramBank({check:createLibraryProgramVerifier({scope,behavior,integration})});
  const admitted=await admitCatalogProgram({skeleton,implementation,bank});
  assert.equal(admitted.status,'admitted',JSON.stringify(admitted));
  const wrongs=[reactContextProgram(version.startsWith('18.')?'19.1.1':'18.3.1'),structuredClone(program),structuredClone(program)];
  wrongs[1].body.value.entries._currentValue={op:'literal',value:null};
  wrongs[2].body.body.steps[1].item.entries._context={op:'object',entries:{}};
  for (const wrong of wrongs) assert.equal(behavior({program:wrong}).status,'rejected');
  assert.equal(behavior({program,scope:{...scope,resultIdentityPaths:[]}}).reason,'independent_context_scope_mismatch');
  reports.push({version,passed:true,wrong_rules_rejected:wrongs.length,admission:admitted,implementation_source:implementation.context.implementation});
  dom.window.close();
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons:[skeleton]},null,2)+'\n');
fs.writeFileSync(path.join(directory,'react-context-results.json'),JSON.stringify({passed:true,model_requests:0,model_spend_usd:0,reports},null,2)+'\n');
console.log(JSON.stringify({passed:true,versions:reports.map(row=>row.version),wrong_rules_rejected:reports.length*3,actual_render_checks:reports.length*4,model_requests:0}));
