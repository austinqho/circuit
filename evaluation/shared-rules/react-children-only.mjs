import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { readLibraryImplementation } from '../../authoring/library-implementation.mjs';
import { portableImplementation, programOverrides, admitCatalogProgram } from '../../authoring/library-program-catalog.mjs';
import { createLibraryProgramBank, programHash, resolveVersionedProgram } from '../../analysis/library-program-bank.mjs';
import { createLibraryBoundary } from '../../analysis/library-boundary.mjs';
import { instrumentLibraryPrograms } from '../../analysis/library-program-integration.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url)), repository = path.join(directory, 'fixtures');
const require = createRequire(path.join(repository, 'package.json'));
const scope = { callbackArguments: [], resultPaths: null, errorObservation: 'standard_error_without_stack', accessorObservation: 'opaque_descriptors',
  description: 'React.Children.only selects the exact element or throws its standard Error. Includes primitives, arrays, real elements, and own-data symbol tags. Non-read accessors such as React 19 debug stacks are opaque descriptor identities, never evaluated by the checker. Error type/message/properties are checked except stack; proxies, accessor reads, inherited tags and renderer ownership are outside this boundary.' };
const message = 'React.Children.only expected to receive a single React element child.';
const error = { op: 'throw', value: { op: 'make_error', name: 'Error', message: { op: 'literal', value: message } } };
const initial = JSON.parse(fs.readFileSync(path.resolve(directory, '../../authoring/banks/initial-library-programs.json')));
const predicate = initial.skeletons.find(row => row.package === 'react' && row.export_name === 'isValidElement');
const catalogPath = path.resolve(directory, '../../authoring/banks/react-children-programs.json');
const writing = process.argv.includes('--write-catalog');
let skeleton = writing ? null : JSON.parse(fs.readFileSync(catalogPath)).skeletons[0];
const reports = [];
for (const specifier of ['react18','react19']) {
  const implementation = readLibraryImplementation({ repository, specifier, exportName:'Children.only' });
  assert.equal(implementation.context.source_status, 'ready_for_scoped_proposal');
  assert(implementation.context.implementation.includes(message));
  const React = require(specifier), version = React.version;
  const realElement = React.createElement('button', null, 'actual child');
  const predicateProgram = resolveVersionedProgram(predicate, version).program;
  const program = {schema:predicateProgram.schema, body:{op:'if', test:predicateProgram.body, then:{op:'arg',index:0}, else:error}};
  async function check({ implementation, program }) {
    const boundary = createLibraryBoundary({producer:implementation.producer, program, ...scope});
    let debugReads = 0;
    const taggedWithOpaqueDebug = { $$typeof: realElement.$$typeof };
    Object.defineProperty(taggedWithOpaqueDebug, 'debug', { get() { debugReads++; throw new Error('must remain opaque'); } });
    const values = [realElement, React.createElement(React.Fragment, null, 'fragment'),
      taggedWithOpaqueDebug,
      undefined,null,true,false,0,-0,NaN,'text',[],[realElement],{},
      {$$typeof:Symbol.for('react.element')}, {$$typeof:Symbol.for('react.transitional.element')},
      {$$typeof:Symbol('react.element')}, {$$typeof:Symbol.for('react.memo')}];
    let returns=0, throws=0;
    for (const value of values) {
      if (React.isValidElement(value)) { assert.equal(boundary.invoke([value]),value); returns++; }
      else { assert.throws(()=>boundary.invoke([value]), caught=>Object.getPrototypeOf(caught)===Error.prototype && caught.message===message); throws++; }
    }
    assert.equal(debugReads, 0, 'neither the real library nor the replay may read unrelated accessors in this scope');
    const result=boundary.checkpoint();
    return {status:result.status==='observed_agreement'?'passed':'rejected', reason:result.failures[0]?.reason, report:result, returns, throws};
  }
  if (!skeleton) skeleton={schema:'producttrace.library-program-skeleton.v1',package:'react',export_name:'Children.only',scope,program,versions:[]};
  if (writing) {
    const source=portableImplementation(implementation.context);
    skeleton.versions.push({version,base_sha256:programHash(skeleton.program),overrides:programOverrides(skeleton.program,program),program_sha256:programHash(program),implementation_sha256:programHash(source),implementation:source,
      verification:{origin:'manual_composition_of_exact_source_and_existing_predicate',scope:scope.description}});
  }
  const bank=createLibraryProgramBank({check});
  const admitted = await admitCatalogProgram({skeleton,implementation,bank});
  assert.equal(admitted.status,'admitted',JSON.stringify(admitted));
  const mutations=[{...program,body:{op:'arg',index:0}},{...program,body:error},structuredClone(program),structuredClone(program)];
  mutations[2].body.else.value.name='TypeError'; mutations[3].body.else.value.message.value='wrong error message';
  for(const wrong of mutations) assert.equal((await check({implementation,program:wrong})).status,'rejected');
  const integration=instrumentLibraryPrograms({source:`import {Children as childTools} from '${specifier}'; export const selected=childTools.only(element); export function invalid(){ return childTools.only('text'); }`,file:'child-selection.ts',bank});
  assert.equal(integration.bindings.length,2);
  const exports={};
  vm.runInNewContext(ts.transpileModule(integration.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,element:realElement,require:()=>React,[integration.runtimeKey]:integration.runtime});
  assert.equal(exports.selected,realElement); assert.throws(()=>exports.invalid(),caught=>caught.message===message);
  const evidence=integration.runtime.checkpoint(); assert(evidence.every(row=>row.status==='observed_agreement'),JSON.stringify(evidence));
  reports.push({version,passed:true,wrong_rules_rejected:4,behavior:await check({implementation,program}),integration:evidence,implementation_source:implementation.context.implementation});
}
if(writing)fs.writeFileSync(catalogPath,JSON.stringify({schema:'producttrace.library-program-catalog.v1',skeletons:[skeleton]},null,2)+'\n');
const result={passed:true,origin:'manual_composition',model_requests:0,model_spend_usd:0,scope:scope.description,reports};
fs.writeFileSync(path.join(directory,'react-children-results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:true,versions:reports.map(row=>row.version),wrong_rules_rejected:8,model_requests:0}));
