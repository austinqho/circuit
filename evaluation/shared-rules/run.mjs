import {createLibraryExperimentChecks} from '../../authoring/library-program-experiments.mjs';
import {EXPERIMENTS} from './experiments.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import { CASES, DOMAINS } from './cases.mjs';
import { checkCase } from './check-case.mjs';
import { readLibraryImplementation } from '../../authoring/library-implementation.mjs';
import { createLibraryProgramBank, instrumentLibraryPrograms } from '../../analysis/index.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const repository = path.join(directory, 'fixtures');
const hashFile = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
export const frozenFiles = [
  'analysis/library-execution-context.mjs', 'analysis/library-host-events.mjs', 'analysis/library-react-effect-host.mjs',
  'authoring/library-program-intrinsics.mjs',
  'analysis/library-program.mjs', 'analysis/library-boundary.mjs', 'analysis/library-program-bank.mjs',
  'analysis/library-program-integration.mjs', 'authoring/library-implementation.mjs', 'authoring/library-export-getter.mjs',
  'analysis/library-owned-reference.mjs', 'analysis/library-owned-value.mjs', 'authoring/library-program-catalog.mjs',
  'authoring/library-program-verifier.mjs', 'authoring/library-program-experiments.mjs', 'evaluation/shared-rules/experiments.mjs',
  'authoring/library-program-resolver.mjs', 'authoring/library-program-compatibility.mjs', 'authoring/library-program-normalize.mjs',
  'analysis/library-program-syntax.mjs',
  'authoring/library-program-author.mjs', 'authoring/library-program-format.mjs',
  'evaluation/shared-rules/cases.mjs', 'evaluation/shared-rules/check-case.mjs',
  'evaluation/shared-rules/run.mjs', 'evaluation/shared-rules/children-traversal-check.mjs', 'evaluation/shared-rules/children-traversal-scope.mjs',
];
const freeze = () => ({ schema: 'producttrace.shared-rule-freeze.v1',
  files: Object.fromEntries(frozenFiles.map(file => [file, hashFile(file)])),
  cases: CASES.map(spec => {
    const implementation = readLibraryImplementation({ repository, ...spec });
    return { id: spec.id, implementation_sha256: implementation.sha256, source_status: implementation.context.source_status,
      source_reason: implementation.context.source_reason, specifier: spec.specifier, exportName: spec.exportName, scope: DOMAINS[spec.profile] };
  }) });

export async function integrationCheck(spec, implementation, program, installedRepository = repository) {
  const scope = DOMAINS[spec.profile];
  if(spec.experiment){
    const result=await createLibraryExperimentChecks({repository:installedRepository,scope,makeExperiments:EXPERIMENTS[spec.experiment]}).integration({implementation,program});
    return {...result,passed:result.status==='passed'};
  }
  const bank = createLibraryProgramBank({ check: ({ implementation, program }) => checkCase(spec, implementation, program) });
  const admission = await bank.admit({ implementation, program, scope });
  if (admission.status !== 'admitted') return { passed: false, reason: admission.reason };
  const importText = spec.exportName === 'default' ? `import target from '${spec.specifier}';`
    : `import { ${spec.exportName.split('.')[0]} as target } from '${spec.specifier}';`;
  const arity = spec.profile === 'reference' ? '' : ['element_predicate', 'render_descriptor', 'scheduled_callback', 'retained_callback','negated_callback','constant_value'].includes(spec.profile) ? 'a' : 'a,b';
  const source = spec.profile.startsWith('react_children_') ? `${importText}\nexport function run(a,b,c){return target.${spec.exportName.split('.')[1]}(a,b,c)}` : spec.profile==='column_helper' ? `${importText}\nexport function run(a,b){const helper=target();return [helper.accessor(a,b),helper.display(b),helper.group(b)]}` : `${importText}\nexport function run(a,b) { return target(${arity}); }`;
  const integrated = instrumentLibraryPrograms({ source, file: `${spec.id}.ts`, bank });
  if (integrated.bindings.length !== 1 || integrated.frontiers.length) return { passed: false, reason: 'source_adapter_binding' };
  // Resolve the actual installed namespace, including its real interop and
  // forwarding exports. A hand-built object could hide import-path failures.
  const library = createRequire(path.join(installedRepository,'package.json'))(spec.specifier);
  const exports = {}, sandbox = { exports, require: () => library, [integrated.runtimeKey]: integrated.runtime };
  const code = ts.transpileModule(integrated.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, sandbox);
  let callbacks = 0;
  function callback(_value, _ref) { callbacks++; return _value; }
  let result;
  if(spec.profile.startsWith('react_children_')) {
    const element=library.createElement('span',null,'leaf'),seen=[],receiver={surface:'children'};
    const result=exports.run([element,[null,'text'],2n],function(value,index){callbacks++;seen.push([value,index,this])},receiver);
    const count=library.version.startsWith('19.')?4:3;
    if(spec.profile==='react_children_count'){if(result!==count||callbacks!==0)return {passed:false,reason:'children_count_result_or_unexpected_callback'};}
    else if(callbacks!==count||seen[0][0]!==element||seen[1][0]!==null||seen[2][0]!=='text'||count===4&&seen[3][0]!==2n||seen.some((row,index)=>row[1]!==index||row[2]!==receiver))return {passed:false,reason:'children_callback_path'};
  } else if(spec.profile==='column_helper') {
    const column={id:'source-column'};result=exports.run(callback,column);
    if(result[0].accessorFn!==callback||result[1]!==column||result[2]!==column||callbacks!==0)return {passed:false,reason:'column_helper_method_or_reference_path'};
    const evidence=integrated.runtime.checkpoint().flatMap(row=>row.evidence||[]).filter(row=>row.kind==='returned_method_invocation');
    if(evidence.length!==3||evidence.some(row=>!row.invocation_source?.file))return {passed:false,reason:'column_helper_method_source_evidence'};
  } else if (spec.profile === 'boolean_or_callback') {
    const value={exact:'query decision'};result=exports.run(callback,[value]);
    if(result!==value||callbacks!==1||exports.run(false,[])!==false)return {passed:false,reason:'query_callback_decision_path'};
  } else if (spec.profile === 'tree_traversal') {
    const leaf = { id: 'source-leaf' }, tree = [{ id: 'source-parent', children: [leaf] }];
    result = exports.run(tree, function (node) { callbacks++; return node.children; });
    if (callbacks !== 2 || result.length !== 2 || result[0] !== tree[0] || result[1] !== leaf)
      return { passed: false, reason: 'tree_source_callback_or_result_mismatch' };
  } else if (spec.profile === 'element_predicate') {
    result = exports.run({ $$typeof: Symbol.for('react.element') });
    exports.run({ $$typeof: Symbol.for('react.transitional.element') });
  } else result = exports.run(callback, spec.profile === 'memo_descriptor' ? callback
    : spec.profile === 'memoized_callback' ? undefined : { input: 'independent integration value' });
  // A descriptor rule must remain useful to the real consumer. Wrapping these
  // references would change React's identity comparisons even if bodies agree.
  if (spec.profile === 'render_descriptor' && result.render !== callback) return { passed: false, reason: 'render_callback_identity_changed' };
  if (spec.profile === 'memo_descriptor' && (result.type !== callback || result.compare !== callback))
    return { passed: false, reason: 'memo_callback_identity_changed' };
  if (scope.observationMode === 'references' && callbacks !== 0) return { passed: false, reason: 'unexpected_descriptor_callback_execution' };
  if(spec.profile==='constant_value'){
    if(result()!==callback||result('ignored')!==callback||callbacks!==0)return {passed:false,reason:'constant_value_identity_or_unexpected_invocation'};
    const references=integrated.runtime.checkpoint().flatMap(row=>row.evidence).filter(row=>row.kind==='returned_input_function_reference');
    if(references.length!==2||references.some(row=>row.input_origins.length!==1||row.input_origins[0].path[0]!==0))return {passed:false,reason:'constant_value_reference_origin'};
  }
  if(spec.profile==='negated_callback'){
    if(result(0)!==true||result('truthy')!==false||result(null)!==true||callbacks!==3)return {passed:false,reason:'negated_callback_result_or_count'};
  }
  if (['partial_callback', 'retained_callback', 'memoized_callback'].includes(spec.profile)) { result('first'); result('second'); result('second'); }
  if (spec.profile === 'partial_callback') {
    const marker={late:'source path'};
    const late=exports.run(function(value,done){callbacks++;return done(value)},marker);
    let inner=0;
    if(late(value=>{inner++;return value})!==marker || inner!==1) return {passed:false,reason:'late_callback_source_integration'};
    const chain=integrated.runtime.checkpoint().flatMap(row=>row.evidence).filter(row=>row.parent_ordinal===0);
    if(chain.length!==1) return {passed:false,reason:'late_callback_parent_evidence'};
    const later=exports.run(function(value,done){callbacks++;queueMicrotask(()=>done(value))},marker);
    let asyncValue;later(value=>{asyncValue=value});
    await new Promise(resolve=>queueMicrotask(resolve));
    if(asyncValue!==marker) return {passed:false,reason:'async_descendant_value'};
    const deferred=integrated.runtime.checkpoint().flatMap(row=>row.evidence).filter(row=>row.parent_relation==='async_continuation');
    if(deferred.length!==1||deferred[0].parent_ordinal!==0) return {passed:false,reason:'async_descendant_occurrence'};
  }
  await new Promise(resolve => setTimeout(resolve, 5));
  const reports = integrated.runtime.checkpoint();
  return { passed: reports.length === 1 && reports.every(row => row.status === 'observed_agreement'),
    callbacks, bindings: integrated.bindings, reports };
}

async function main() {
  const mode = process.argv[2] || 'offline';
  if (mode === 'freeze' || mode === 'freeze-extension' || mode === 'freeze-extension-2') {
    const target = path.join(directory, mode === 'freeze' ? 'frozen.json' : mode === 'freeze-extension' ? 'frozen-extension-1.json' : 'frozen-extension-2.json');
    if (fs.existsSync(target)) throw new Error('frozen_cases_already_exist');
    fs.writeFileSync(target, JSON.stringify(freeze(), null, 2) + '\n');
    console.log('Frozen', CASES.length, 'cases');
    return;
  }
  if (mode !== 'offline') throw new Error('Use offline or freeze; paid authoring has a separate targeted runner.');
  const { PROGRAMS, p, lit } = await import('./programs.mjs');
  const rows = [];
  for (const spec of CASES) {
    const implementation = readLibraryImplementation({ repository, ...spec });
    const program = PROGRAMS[spec.calibration];
    const positive = await checkCase(spec, implementation, program);
    const wrongResult = await checkCase(spec, implementation, p(lit('deliberately-wrong-result')));
    const wrongFormat = await checkCase(spec, implementation, { ...program, invented: true });
    const integration = await integrationCheck(spec, implementation, program);
    rows.push({ id: spec.id, positive, negatives: { wrong_result: wrongResult.status, wrong_format: wrongFormat.status }, integration });
    console.log(spec.id, positive.status, `negative=${wrongResult.status}/${wrongFormat.status}`, `integration=${integration.passed}`);
  }
  // These swaps must fail even though the API names and most of the program
  // remain identical. This is why a new version needs its own evidence.
  const versionNegatives = [];
  for (const [id, wrong] of [['react18-isValidElement', 'isValid19'], ['react19-isValidElement', 'isValid18'], ['async2-apply', 'apply'], ['async3-apply', 'apply2']]) {
    const spec = CASES.find(row => row.id === id);
    const check = await checkCase(spec, readLibraryImplementation({ repository, ...spec }), PROGRAMS[wrong]);
    versionNegatives.push({ id, status: check.status, reason: check.reason });
  }
  const memoSpec = CASES.find(row => row.id === 'memoize-one');
  const memoImplementation = readLibraryImplementation({ repository, ...memoSpec });
  const wrongEquality = structuredClone(PROGRAMS.memoize);
  const replaceEquality = node => {
    if (!node || typeof node !== 'object') return;
    if (node.op === 'equal') node.op = 'same';
    for (const value of Object.values(node)) replaceEquality(value);
  };
  replaceEquality(wrongEquality);
  for (const [name, wrong] of [['always_cache', PROGRAMS.once], ['always_invoke', PROGRAMS.apply], ['wrong_equality', wrongEquality]]) {
    const check = await checkCase(memoSpec, memoImplementation, wrong);
    versionNegatives.push({ id: `memoize-one:${name}`, status: check.status, reason: check.reason });
  }
  const treeSpec = CASES.find(row => row.id === 'table8new-flattenBy');
  const treeImplementation = readLibraryImplementation({ repository, ...treeSpec });
  for (const [name, presence] of [['visit_holes', true], ['skip_every_node', false]]) {
    const wrong = structuredClone(PROGRAMS.flattenTree);
    const replace = node => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (value?.op === 'has_own') node[key] = { op: 'literal', value: presence };
        else replace(value);
      }
    };
    replace(wrong);
    const check = await checkCase(treeSpec, treeImplementation, wrong);
    versionNegatives.push({ id: `tree-traversal:${name}`, status: check.status, reason: check.reason });
  }
  const querySpec=CASES.find(row=>row.id==='query5-shouldThrowError');
  const queryImplementation=readLibraryImplementation({repository,...querySpec});
  for(const mode of ['not_spread','uncoerced_value','coerced_callback_result']) {
    const wrong=structuredClone(PROGRAMS.booleanOrCallback);
    if(mode==='not_spread')wrong.body.then.args={op:'array',items:[{op:'arg',index:1}]};
    if(mode==='uncoerced_value')wrong.body.else={op:'arg',index:0};
    if(mode==='coerced_callback_result')wrong.body.then={op:'not',value:{op:'not',value:wrong.body.then}};
    const check=await checkCase(querySpec,queryImplementation,wrong);
    versionNegatives.push({id:`query-decision:${mode}`,status:check.status,reason:check.reason});
  }
  for(const spec of CASES.filter(row=>row.profile==='column_helper')) {
    const implementation=readLibraryImplementation({repository,...spec});
    const wrongs=[structuredClone(PROGRAMS.columnHelper),structuredClone(PROGRAMS.columnHelper),structuredClone(PROGRAMS.columnHelper)];
    wrongs[0].body.entries.accessor.body.body.steps[1].key={op:'literal',value:'accessorKey'};
    wrongs[1].body.entries.display.body={op:'object',entries:{}};
    wrongs[2].body.entries.group.body={op:'undefined'};
    for(const [index,wrong] of wrongs.entries()) {const check=await checkCase(spec,implementation,wrong);versionNegatives.push({id:`${spec.id}:mutation:${index}`,status:check.status,reason:check.reason});}
  }
  const negateSpec=CASES.find(row=>row.profile==='negated_callback');
  const negateImplementation=readLibraryImplementation({repository,...negateSpec});
  for(const mode of ['no_negation','wrong_receiver','dropped_arguments','twice']){
    const wrong=structuredClone(PROGRAMS.negate),body=wrong.body.then.body.body,invocation=body.value;
    if(mode==='no_negation')wrong.body.then.body.body=invocation;
    if(mode==='wrong_receiver')invocation.receiver={op:'undefined'};
    if(mode==='dropped_arguments')invocation.args={op:'array',items:[]};
    if(mode==='twice')wrong.body.then.body.body={op:'sequence',steps:[structuredClone(invocation),body]};
    const check=await checkCase(negateSpec,negateImplementation,wrong);versionNegatives.push({id:`negate:${mode}`,status:check.status,reason:check.reason});
  }
  const constantSpec=CASES.find(row=>row.profile==='constant_value'),constantImplementation=readLibraryImplementation({repository,...constantSpec});
  for(const [name,wrong] of [['return_latest_argument',p({op:'fn',this_mode:'strict',body:{op:'arg',index:0}})],['return_value_immediately',p({op:'arg',index:0})],['replace_function_value',p({op:'fn',this_mode:'strict',body:{op:'undefined'}})]]){
    const check=await checkCase(constantSpec,constantImplementation,wrong);versionNegatives.push({id:`constant:${name}`,status:check.status,reason:check.reason});
  }
  const castSpec=CASES.find(row=>row.id==='lodash417-castArray'),castImplementation=readLibraryImplementation({repository,...castSpec});
  const missingVsUndefined=structuredClone(PROGRAMS.castArray);missingVsUndefined.body.test={op:'same',left:{op:'arg',index:0},right:{op:'undefined'}};
  const wrapsArrays=structuredClone(PROGRAMS.castArray);wrapsArrays.body.else.test={op:'literal',value:false};
  for(const [name,wrong] of [['missing_vs_undefined',missingVsUndefined],['wraps_existing_array',wrapsArrays]]){
    const check=await checkCase(castSpec,castImplementation,wrong);versionNegatives.push({id:`castArray:${name}`,status:check.status,reason:check.reason});
  }
  const passed = rows.every(row => row.positive.status === 'passed' && row.integration.passed
    && Object.values(row.negatives).every(status => status === 'rejected'))
    && versionNegatives.every(row => row.status === 'rejected');
  const report = { schema: 'producttrace.shared-rule-local.v1', passed, engine: freeze().files,
    cases: rows, version_negatives: versionNegatives, model_calls: 0, model_spend_usd: 0 };
  fs.writeFileSync(path.join(directory, 'offline-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed, cases: rows.length, version_negatives: versionNegatives }));
  if (!passed) process.exitCode = 1;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();
