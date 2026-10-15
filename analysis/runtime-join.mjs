import {createReactPredicateUseObserver,checkReactPredicateUse} from './react-predicate-use.mjs';
import {checkReactProfilerRecord,createReactProfilerObserver} from './react-profiler-runtime.mjs';
import {checkReactStrictReplay} from './react-strict-replay.mjs';
import {createReactClassUpdateEvidenceSession} from './react-class-update-evidence.mjs';
import {checkReactIdCommit} from './react-id-commit.mjs';
import {checkReactBoundaryCommit} from './react-boundary-commit.mjs';
import {createReactClassObserver} from './react-class-runtime.mjs';
import {createReactClassEvidenceSession} from './react-class-evidence.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createReactHostObserver} from './react-host-runtime.mjs';
import {createReactHostEvidenceSession} from './react-host-evidence.mjs';
import {createReactServerObserver} from './react-server-runtime.mjs';
import {createReactServerEvidenceSession} from './react-server-evidence.mjs';
import {createReactRootObserver} from './react-root-runtime.mjs';
import {createReactRootEvidenceSession,checkReactRootCommit,checkReactRootRecovery} from './react-root-evidence.mjs';
import {createReactElementObserver} from './react-element-runtime.mjs';
import {createReactElementEvidenceSession} from './react-element-evidence.mjs';
import {checkReactLazyCommit} from './react-lazy-commit.mjs';
import {checkReactChildrenEvidence} from './react-children-evidence.mjs';
import {createReactPortalObserver} from './react-portal-runtime.mjs';
import {createReactPortalEvidenceSession} from './react-portal-evidence.mjs';
import {checkReactPortalCommit} from './react-portal-commit.mjs';
import {readReactBoundaryValue} from './react-boundary-runtime.mjs';
import { createReactLifecycleEvidenceSession } from './react-lifecycle-evidence.mjs';
import { validateReactExecutionRule, predictLiteralExport, planDebugValue } from './react-execution-rule.mjs';
import {createReactScopeObserver} from './react-scope-runtime.mjs';
import {checkReactScopeEvidence,checkReactPredicateEvidence} from './react-scope-evidence.mjs';
import {createReactRefObserver} from './react-ref-runtime.mjs';
import {createReactRefEvidenceSession} from './react-ref-evidence.mjs';
import {createReactContextObserver} from './react-context-runtime.mjs';
import { configureRequestCall } from './request-call-transform.mjs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const SCHEMA = 'producttrace.react-runtime-integration.v1';
const JOIN_SCHEMA = 'producttrace.react-runtime-join.v1';
const TOKEN_PREFIX = 'producttrace.source-scenario.v1:';
const RUNTIME_EVENTS = new Set(['click', 'copy', 'cut', 'paste', 'submit', 'change', 'keydown']);
const stable = value => JSON.stringify(value, Object.keys(value).sort());

function requireMap(map) {
  if (!map || map.schema !== 'producttrace.react-map.v1' || typeof map.fingerprint !== 'string'
      || !Array.isArray(map.controls) || !Array.isArray(map.scenarios)
      || !Array.isArray(map.placements) || !Array.isArray(map.components)
      || !Array.isArray(map.nodes) || !Array.isArray(map.edges) || !Array.isArray(map.files)
      || !Array.isArray(map.react_server_consumers)
      || !Array.isArray(map.library_contracts) || !Array.isArray(map.library_backlog)
      || !Array.isArray(map.diagnostics)) {
    throw new TypeError('Expected a producttrace.react-map.v1 source map');
  }
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function groupByScenario(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (typeof row.scenario_id !== 'string') continue;
    const values = grouped.get(row.scenario_id) || [];
    values.push(row);
    grouped.set(row.scenario_id, values);
  }
  return grouped;
}

function sourceOwner(control, placementById, componentById) {
  let placement = placementById.get(control.placement_id);
  if (!placement) return null;
  const first = componentById.get(placement.component_id) || null;
  if (placement.parent_id) placement = placementById.get(placement.parent_id);
  return componentById.get(placement?.component_id) || first;
}

function selectorFor(control, owner) {
  if (!owner?.name || control.status !== 'resolved') return null;
  return { event: control.event, component: owner.name, sourceControl: control.id };
}

function token(map, control, scenario) {
  return `${TOKEN_PREFIX}${map.fingerprint}:${control.id}:${scenario.id}`;
}

function directlyForwardsArbitraryProps(component, controlSource, nodeById) {
  const functionSource = component && nodeById.get(component.id);
  if (functionSource?.kind !== 'function' || controlSource?.kind !== 'jsx'
      || functionSource.file !== controlSource.file
      || controlSource.start < functionSource.start || controlSource.end > functionSource.end) return false;
  const prefix = 'const __producttrace_component = ';
  let fn = null;
  const visit = node => {
    if (fn) return;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) fn = node;
    else ts.forEachChild(node, visit);
  };
  const parsed = ts.createSourceFile('__producttrace_forwarding.tsx', `${prefix}${functionSource.text};`,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  visit(parsed);
  if (!fn) {
    visit(ts.createSourceFile('__producttrace_forwarding.tsx', functionSource.text,
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  }
  if (!fn || fn.parameters.length === 0) return false;
  const first = fn.parameters[0].name;
  let forwardedName = null;
  if (ts.isIdentifier(first)) forwardedName = first.text;
  else if (ts.isObjectBindingPattern(first)) {
    const rest = first.elements.find(element => element.dotDotDotToken && ts.isIdentifier(element.name));
    if (rest) forwardedName = rest.name.text;
  }
  if (!forwardedName) return false;

  const jsx = ts.createSourceFile('__producttrace_host.tsx', `const __producttrace_host = (${controlSource.text});`,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let host = null;
  const findHost = node => {
    if (host) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) host = node;
    else ts.forEachChild(node, findHost);
  };
  findHost(jsx);
  if (!host) return false;
  const opening = ts.isJsxElement(host) ? host.openingElement : host;
  return opening.attributes.properties.some(attribute => ts.isJsxSpreadAttribute(attribute)
    && ts.isIdentifier(attribute.expression) && attribute.expression.text === forwardedName);
}

/**
 * Compile event-specific source stamps into browser bindings and an onRecord joiner.
 * Dynamic labels, source text, timing, and function names are never selectors.
 */
function profilerCallbackShape(text){
  const source=ts.createSourceFile('callback.tsx','('+text+')',ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const fn=source.statements[0]?.expression?.expression;
  if(!fn||!ts.isArrowFunction(fn)&&!ts.isFunctionExpression(fn)||fn.asteriskToken
    ||fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)
    ||fn.parameters.some(p=>!ts.isIdentifier(p.name)||p.name.text==='arguments'||p.initializer||p.dotDotDotToken)
    ||new Set(fn.parameters.map(p=>p.name.text)).size!==fn.parameters.length)return null;
  let unsafe=false;
  const parameterNames=new Set(fn.parameters.map(p=>p.name.text));
  const visit=node=>{
    if(ts.isWithStatement(node)||ts.isAwaitExpression(node)||ts.isYieldExpression(node)
      ||ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='eval'
      ||(ts.isVariableDeclaration(node)||ts.isFunctionDeclaration(node))&&node.name&&ts.isIdentifier(node.name)
        &&(node.name.text==='arguments'||parameterNames.has(node.name.text)))unsafe=true;
    ts.forEachChild(node,visit);
  };visit(fn.body);if(unsafe)return null;
  if(ts.isArrowFunction(fn)&&ts.isBlock(fn.body)&&fn.body.statements.some(statement=>
    ts.isExpressionStatement(statement)&&ts.isStringLiteral(statement.expression)&&statement.expression.text==='use strict'))return null;
  return {arrow:ts.isArrowFunction(fn),parameters:fn.parameters.map(p=>p.name.text),
    parenthesized:source.text.slice(fn.getStart(source),fn.parameters.pos).trimEnd().endsWith('('),
    trailing_comma:fn.parameters.hasTrailingComma===true,parameter_end:fn.parameters.end-1,name:fn.name?.text||'onRender'};
}

export function createReactRuntimeIntegration(map, options = {}) {
  requireMap(map);
  if (options.onJoin !== undefined && typeof options.onJoin !== 'function') {
    throw new TypeError('onJoin must be a function');
  }
  if (options.requestBridge !== undefined && typeof options.requestBridge !== 'boolean') {
    throw new TypeError('requestBridge must be a boolean');
  }
  const placementById = new Map(map.placements.map(placement => [placement.id, placement]));
  const componentById = new Map(map.components.map(component => [component.id, component]));
  const nodeById = new Map(map.nodes.map(node => [node.id, node]));
  const fileHashByPath = new Map(map.files.map(file => [file.path, file.sha256]));
  const lifecycleEntries = [];
  const predicateFrames=new Set();
  const lifecycleFrontiers = [];
  const lifecycleTransforms = [];
  const lifecycleEntryKeys = new Set();
  const scopeTaggedSources=new Set(),sharedRetainedBodies=new Set();
  const lifecycleKey = entry => `react-lifecycle:${createHash('sha256')
    .update(JSON.stringify(entry)).digest('hex').slice(0, 20)}`;
  const addLifecycleEntry = (entry, transform = null) => {
    const key = lifecycleKey(entry);
    if (!lifecycleEntryKeys.has(key)) {
      lifecycleEntryKeys.add(key);
      lifecycleEntries.push({ key, ...entry });
    }
    if (transform && !lifecycleTransforms.some(row=>row.key===key && row.transform===transform.transform && row.node_id===transform.node_id)) lifecycleTransforms.push({ key, ...transform });
    return key;
  };
  const lifecycleSource = source => ({
    source_call_id: source.call_id,
    semantic_id: source.semantic_id,
    semantic_application_id: source.id,
    owner_source_id: source.causal_bindings?.owner_source_id || null,
    hook_owned: source.behavior?.owner?.includes('hook ordinal') === true,
    package_verification_sha256: source.package_verification_sha256,
  });
  const hookSourcesByOwner = new Map();
  for (const source of map.react_semantics || []) {
    const callSource = nodeById.get(source.call_id);
    if (!callSource || source.version !== '18.3.1' || !source.package_verification_sha256) continue;
    const sourceMeta = lifecycleSource(source);
    const apiObservationKind = source.usage_kind === 'jsx_boundary'?'api_boundary':source.usage_kind === 'value_read' ? 'api_value' : 'api_call';
    const scopeRule=source.behavior?.execution;
    if(scopeRule?.kind==='class_component'&&callSource.kind==='class'){
      const mapping=source.causal_bindings?.class_mapping;
      if(!validateReactExecutionRule(scopeRule).valid||!mapping){lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'class_render_source_unsupported'});continue;}
      const classKey=addLifecycleEntry({kind:'class_render',...sourceMeta,class_rule:scopeRule,class_mapping:mapping},{transform:'class_render',node_id:source.call_id,file:callSource.file});
      for(const protocol of map.react_protocols||[]){
        if(protocol.producer_call_id!==source.call_id||!validateReactExecutionRule(protocol.member_rule).valid)continue;
        const call=nodeById.get(protocol.member_call_id),locations=call&&scopeCallLocations(call.text);
        if(!call||!locations){lifecycleFrontiers.push({source_call_id:protocol.member_call_id,reason:'class_update_arguments_unsupported'});continue;}
        const callbacks=protocol.callback_bindings.flatMap(row=>{const match=/arguments\.(\d+)/.exec(row.slot);return match&&row.source_id&&row.body?[{index:Number(match[1]),source_id:row.source_id,body:row.body,edge_id:map.edges.find(edge=>edge.from===call.id&&edge.to===row.source_id&&edge.class_update_member===protocol.member&&edge.relation==='callback_forward')?.id||null}]:[];});
        for(const row of protocol.callback_bindings)if(row.callback_candidate&&!row.body)lifecycleFrontiers.push({source_call_id:protocol.member_call_id,reason:row.source_id?'class_update_callback_body_unsupported':'class_update_callback_source_unresolved'});
        addLifecycleEntry({kind:'class_update',...sourceMeta,source_call_id:call.id,class_key:classKey,class_source_id:source.call_id,class_update_rule:protocol.member_rule,class_update_callbacks:callbacks,
          class_update_argument_count:locations.length,class_update_callee_end:protocol.callee_end},{transform:'class_update',node_id:call.id,file:call.file});
      }
      continue;
    }
    const boundary=validateReactExecutionRule(scopeRule).valid && scopeRule.kind==='boundary_type';
    if(apiObservationKind==='api_boundary' && !boundary) {
      lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'jsx_boundary_rule_unavailable'});continue;
    }
    const childrenRule=validateReactExecutionRule(scopeRule).valid && scopeRule.kind==='children_collection' && ['map','forEach','count','toArray','only'].includes(source.causal_bindings?.member);
    const debugValue=validateReactExecutionRule(scopeRule).valid && scopeRule.kind==='debug_value';
    const element=validateReactExecutionRule(scopeRule).valid && ['element_construction','element_clone','element_factory','lazy_component'].includes(scopeRule.kind);
    const portal=validateReactExecutionRule(scopeRule).valid && scopeRule.kind==='portal_description';
    const hostRule=validateReactExecutionRule(scopeRule).valid&&['host_lookup','legacy_unmount','legacy_render'].includes(scopeRule.kind);
    const serverRule=validateReactExecutionRule(scopeRule).valid&&['server_string','legacy_server_stream','readable_server_stream','pipeable_server_stream'].includes(scopeRule.kind);
    const rootRule=validateReactExecutionRule(scopeRule).valid&&scopeRule.kind==='dom_root';
    const rootRecoveryCandidates=rootRule?source.causal_bindings?.root_recovery_callbacks||[]:[];
    const rootRecovery=rootRecoveryCandidates.length===1&&!source.causal_bindings?.root_recovery_callback_frontier?rootRecoveryCandidates[0]:null;
    const scope=validateReactExecutionRule(scopeRule).valid && ['synchronous_scope','test_scope'].includes(scopeRule.kind);
    const predicate=validateReactExecutionRule(scopeRule).valid && scopeRule.kind==='element_predicate';
    const refCell=validateReactExecutionRule(scopeRule).valid && scopeRule.kind==='ref_cell';
    const scopeLocations=scope || predicate || refCell || portal || childrenRule || element || rootRule || serverRule || hostRule?scopeCallLocations(callSource.text):null;
    const scopeCallback=scope || childrenRule?source.causal_bindings?.callbacks?.find(row=>row.slot===`arguments.${scopeRule.callback_argument}`):null;
    if(scope && !scopeLocations)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'scope_argument_evaluation_unsupported'});
    if(predicate && !scopeLocations)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'predicate_argument_evaluation_unsupported'});
    if(predicate&&source.causal_bindings.predicate_conditions?.length&&!source.causal_bindings.predicate_frame)
      lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'predicate_containing_body_unobserved'});
    if(childrenRule && !scopeLocations)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'children_argument_evaluation_unsupported'});
    if(element && !scopeLocations)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'element_argument_evaluation_unsupported'});
    if(portal && !scopeLocations)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'portal_argument_evaluation_unsupported'});
    if(refCell && !scopeLocations)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'ref_argument_evaluation_unsupported'});

    if(hostRule&&!scopeLocations)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'host_argument_evaluation_unsupported'});
    if(serverRule&&!scopeLocations)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'server_argument_evaluation_unsupported'});
    if(serverRule&&!source.causal_bindings.server_component)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'server_root_component_source_unresolved'});
    if(serverRule&&source.causal_bindings.server_component){
      const component=source.causal_bindings.server_component,target=nodeById.get(component.source_id);
      if(target&&!lifecycleTransforms.some(row=>row.transform==='server_component'&&row.node_id===target.id))
        addLifecycleEntry({kind:'server_component',...sourceMeta,server_component:component},{transform:'server_component',node_id:target.id,file:target.file});
    }
    const apiEntryKey=addLifecycleEntry({ kind: apiObservationKind, ...sourceMeta, surface: source.surface,
      ...(predicate&&scopeLocations&&source.causal_bindings.predicate_frame?{predicate_frame_name:source.causal_bindings.predicate_frame.name}:{}),
      export: source.export, disposition: source.disposition,
      ...(debugValue?{debug_value_rule:scopeRule}:{}),
      ...(childrenRule && scopeLocations?{children_rule:scopeRule,children_member:source.causal_bindings.member,scope_input_indices:scopeLocations.map((_,index)=>index),scope_callback_source_id:scopeCallback?.resolution==='inline_source'?scopeCallback.source_id:null,scope_captures:scopeCallback?.captures||[]}:{}),
      ...(hostRule?{host_rule:scopeRule,host_argument_count:scopeLocations?.length??null}:{}),
      ...(serverRule?{server_rule:scopeRule,server_component:source.causal_bindings.server_component||null,server_argument_count:scopeLocations?.length??null}:{}),
      ...(rootRule?{root_rule:scopeRule,root_recovery_source_id:rootRecovery?.source_id||null,
        root_recovery_candidates:rootRecoveryCandidates}:{}),
      ...(element?{element_rule:scopeRule,element_property_inputs:source.causal_bindings?.element_property_inputs||[],
        ...(scopeRule.kind==='lazy_component'?{lazy_loader_source_id:source.causal_bindings?.callbacks?.find(row=>row.slot===`arguments.${scopeRule.loader_argument}`&&row.resolution==='inline_source')?.source_id||null}:{} )}:{}),
      ...(portal?{portal_rule:scopeRule}:{}),
      ...(boundary?{boundary_rule:scopeRule,element_source_id:source.element_source_id||null,element_is_jsx_child:source.element_is_jsx_child===true}:{}),
      ...(scope && scopeLocations?{scope_rule:scopeRule,scope_input_indices:scopeLocations.map((_,index)=>index).filter(index=>[scopeRule.callback_argument,...scopeRule.callback_arguments].includes(index)),
        scope_callback_source_id:scopeCallback?.resolution==='inline_source'?scopeCallback.source_id:null,
        scope_callback_candidates:source.causal_bindings.scope_callbacks||[],
        scope_argument_path_incomplete:source.causal_bindings.scope_callback_frontier===true,
        scope_captures:scopeCallback?.resolution==='inline_source'?scopeCallback.captures||[]:[]}:{}),
      ...(validateReactExecutionRule(source.behavior?.execution).valid && source.behavior.execution.kind==='literal_export'
        ?{literal_export_rule:source.behavior.execution}:{} ),
      ...(validateReactExecutionRule(source.behavior?.execution).valid && source.behavior.execution.kind==='element_predicate'
        ?{predicate_rule:source.behavior.execution,predicate_conditions:source.causal_bindings.predicate_conditions||[],
          predicate_input_indices:scopeLocations?.map((_,index)=>index)??null}:{} ),
      ...(refCell?{ref_rule:scopeRule,ref_input_indices:scopeLocations?.map((_,index)=>index)??null}:{} ) },
    { transform:hostRule&&scopeLocations?'host_call':serverRule&&scopeLocations?'server_call':rootRule&&scopeLocations?'root_call':element && scopeLocations?'element_call':portal && scopeLocations?'portal_call':refCell && scopeLocations?'ref_call':(scope || predicate || childrenRule) && scopeLocations?'scope_call':apiObservationKind, node_id: apiObservationKind==='api_boundary'?source.element_source_id:source.call_id, file: callSource.file });
    if(rootRule){
      const inputId=source.causal_bindings?.inputs?.[`options.${scopeRule.recoverable_error_option}`],target=nodeById.get(inputId);
      if(rootRecovery&&target)lifecycleTransforms.push({key:apiEntryKey,transform:'root_recovery_source',node_id:target.id,file:target.file,
        handler_source_id:rootRecovery.source_id});
      else if(inputId)lifecycleFrontiers.push({source_call_id:source.call_id,source_access_id:inputId,
        reason:'root_recovery_callback_source_unresolved'});
    }
    if(predicate&&scopeLocations&&source.causal_bindings.predicate_frame){
      const frame=source.causal_bindings.predicate_frame,owner=nodeById.get(frame.owner_source_id);
      if(owner&&!predicateFrames.has(owner.id)){
        predicateFrames.add(owner.id);
        addLifecycleEntry({kind:'predicate_frame',...sourceMeta,predicate_frame_name:frame.name},
          {transform:'predicate_frame',node_id:owner.id,file:owner.file});
      }
      for(const condition of source.causal_bindings.predicate_conditions||[]){
        const target=nodeById.get(condition.condition_id);if(!target)continue;
        addLifecycleEntry({kind:'predicate_use',...sourceMeta,predicate_frame_name:frame.name,
          predicate_origin_key:apiEntryKey,condition_source_id:condition.condition_id,inverted:condition.inverted},
          {transform:'predicate_use',node_id:target.id,file:target.file});
      }
    }
    if(boundary&&scopeRule.profiler&&apiObservationKind==='api_boundary'){
      const callback=source.causal_bindings?.callbacks?.find(row=>row.slot==='props.onRender');
      const target=nodeById.get(callback?.source_id),shape=target&&profilerCallbackShape(target.text);
      if(callback?.resolution==='inline_source'&&shape)
        addLifecycleEntry({kind:'profiler_callback',...sourceMeta,callback_source_id:target.id,profiler_shape:shape},
          {transform:'profiler_callback',node_id:target.id,file:target.file});
      else lifecycleFrontiers.push({source_call_id:source.call_id,reason:'profiler_callback_body_source_unsupported'});
    }
    if(rootRule)for(const protocol of map.react_protocols||[]){
      if(protocol.producer_call_id!==source.call_id||!['render','unmount'].includes(protocol.member))continue;
      const target=nodeById.get(protocol.member_call_id),callee=target&&/^([A-Za-z_$][\w$]*)(?:\.(render|unmount)|\[['"](render|unmount)['"]\])/u.exec(target.text);
      if(!target||!callee||!scopeCallLocations(target.text)){lifecycleFrontiers.push({source_call_id:source.call_id,source_access_id:protocol.member_call_id,reason:'root_method_source_unresolved'});continue;}
      addLifecycleEntry({kind:'api_call',...sourceMeta,source_call_id:target.id,surface:source.surface,export:source.export,disposition:source.disposition,
        root_rule:scopeRule,root_producer_call_id:source.call_id,root_method:protocol.member,root_receiver_length:callee[1].length,root_callee_length:callee[0].length},
        {transform:'root_call',node_id:target.id,file:target.file});
    }
    if(element && scopeRule.kind==='element_factory')for(const protocol of map.react_protocols||[]){
      if(protocol.member!=='factory'||protocol.producer_call_id!==source.call_id)continue;
      const target=nodeById.get(protocol.member_call_id),callee=nodeById.get(protocol.callee_source_id);
      if(!target||!callee||!scopeCallLocations(target.text)||!/^[A-Za-z_$][\w$]*$/u.test(callee.text)){
        lifecycleFrontiers.push({source_call_id:source.call_id,source_access_id:protocol.member_call_id,reason:'element_factory_call_unresolved'});continue;
      }
      addLifecycleEntry({kind:'api_call',...sourceMeta,source_call_id:target.id,surface:source.surface,export:source.export,disposition:source.disposition,
        element_rule:scopeRule,element_property_inputs:protocol.element_property_inputs||[],
        factory_producer_call_id:source.call_id,factory_callee_length:callee.text.length},
        {transform:'element_call',node_id:target.id,file:target.file});
    }
    if(refCell)for(const access of source.causal_bindings.ref_accesses||[]) {
      const target=nodeById.get(access.source_id);if(!target)continue;
      if(access.frontier){lifecycleFrontiers.push({source_call_id:source.call_id,source_access_id:access.source_id,semantic_id:source.semantic_id,reason:access.frontier});continue;}
      addLifecycleEntry({kind:'ref_access',...sourceMeta,surface:source.surface,export:source.export,
        ref_property:scopeRule.property,ref_access:access,ref_callback_candidates:source.causal_bindings.ref_callbacks||[]},
        {transform:'ref_access',node_id:target.id,file:target.file,access});
    }
    for(const callback of [...(scope && scopeLocations?source.causal_bindings.scope_callbacks||[]:[]),
      ...(refCell?source.causal_bindings.ref_callbacks||[]:[])]) {
      if(scopeTaggedSources.has(callback.source_id))continue;
      const target=nodeById.get(callback.source_id);if(!target)continue;
      scopeTaggedSources.add(callback.source_id);
      addLifecycleEntry({kind:'callback_source_tag',...sourceMeta,callback_source_id:callback.source_id},
        {transform:'callback_source_tag',node_id:target.id,file:target.file,handler_source_id:callback.source_id,captures:callback.captures});
    }
    if (sourceMeta.hook_owned && sourceMeta.owner_source_id) {
      const values = hookSourcesByOwner.get(sourceMeta.owner_source_id) || [];
      values.push({ source, callSource });
      hookSourcesByOwner.set(sourceMeta.owner_source_id, values);
    }
    if (source.export === 'createContext' && source.causal_bindings?.context_id) {
      const contextLocations=scopeCallLocations(callSource.text);
      if(!contextLocations)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'context_argument_evaluation_unsupported'});
      addLifecycleEntry({ kind: 'context_create', ...sourceMeta,
        context_id: source.causal_bindings.context_id,
        ...(contextLocations && scopeRule?.kind==='context_binding' && validateReactExecutionRule(scopeRule).valid?{context_rule:scopeRule}:{}) },
      { transform: 'context_create', node_id: source.call_id, file: callSource.file });
    }
    if (source.export === 'useContext' && source.causal_bindings?.context_id) {
      addLifecycleEntry({ kind: 'context_read', ...sourceMeta,
        context_id: source.causal_bindings.context_id,
        context_result_binding_id:source.causal_bindings.context_result_binding_id || null },
      { transform: 'context_read', node_id: source.call_id,
        input_node_id: source.causal_bindings?.inputs?.['arguments.0'], file: callSource.file });
    }
    const executionRule=source.behavior?.execution;
    const imperativeHandle=executionRule?.kind==='imperative_handle' && validateReactExecutionRule(executionRule).valid;
    if(validateReactExecutionRule(executionRule).valid && executionRule.kind==='id_allocation') {
      addLifecycleEntry({kind:'id_result',...sourceMeta},{transform:'id_result',node_id:source.call_id,file:callSource.file});
      for(const use of source.causal_bindings.id_property_reads || []) {
        const read=nodeById.get(use.read_id);
        if(read){
          const metadata={kind:'id_use',...sourceMeta,id_read_source_id:use.read_id,id_property:use.property,
            element_source_id:use.element_source_id,element_is_jsx_child:use.element_is_jsx_child===true};
          addLifecycleEntry(metadata,{transform:'id_use',node_id:use.read_id,file:read.file});
          const element=nodeById.get(use.element_source_id);
          if(element)addLifecycleEntry(metadata,{transform:'id_element',node_id:element.id,file:element.file});
        }
      }
    }
    if(validateReactExecutionRule(executionRule).valid && executionRule.kind==='component_wrapper') {
      const callback=source.causal_bindings.wrapper_render,target=nodeById.get(callback?.source_id);
      if(callback && target) {
        const metadata={...sourceMeta,execution_rule:executionRule,callback_source_id:callback.source_id};
        addLifecycleEntry({kind:'wrapper_return',...metadata},{transform:'wrapper_return',node_id:source.call_id,file:callSource.file});
        addLifecycleEntry({kind:'wrapper_callback',...metadata,owner_source_id:callback.source_id,self_name:callback.self_name},
          {transform:'wrapper_callback',node_id:callback.source_id,file:target.file});
      } else lifecycleFrontiers.push({source_call_id:source.call_id,reason:'wrapper_callback_source_shape_unsupported'});
    }
    if(validateReactExecutionRule(executionRule).valid && executionRule.kind==='deferred_value') {
      const locations=scopeCallLocations(callSource.text),input=locations?.[executionRule.value_argument];
      if(input) {
        addLifecycleEntry({kind:'deferred_result',...sourceMeta,execution_rule:executionRule},{transform:'deferred_result',node_id:source.call_id,file:callSource.file,input});
        for(const use of source.causal_bindings.deferred_reads||[]) {
          const read=nodeById.get(use.read_id);if(read)addLifecycleEntry({kind:'deferred_use',...sourceMeta,read_source_id:use.read_id},
            {transform:'deferred_use',node_id:read.id,file:read.file});
        }
      } else lifecycleFrontiers.push({source_call_id:source.call_id,reason:'deferred_argument_evaluation_unsupported'});
    }
    if(validateReactExecutionRule(executionRule).valid && executionRule.kind==='transition_hook') {
      addLifecycleEntry({kind:'transition_result',...sourceMeta,execution_rule:executionRule},{transform:'transition_result',node_id:source.call_id,file:callSource.file});
      for(const read of source.causal_bindings.pending_branch_reads||[]) {
        const target=nodeById.get(read.read_id);if(target)addLifecycleEntry({kind:'transition_pending_use',...sourceMeta,read_source_id:read.read_id},
          {transform:'transition_pending_use',node_id:target.id,file:target.file});
      }
      const calls=new Map();
      for(const protocol of map.react_protocols || [])if(protocol.producer_call_id===source.call_id && protocol.member==='startTransition') {
        const rows=calls.get(protocol.member_call_id)||[];rows.push(protocol);calls.set(protocol.member_call_id,rows);
      }
      for(const [callId,rows] of calls) {
        const call=nodeById.get(callId),locations=call && scopeCallLocations(call.text);
        const callee=call && /^([A-Za-z_$][\w$]*)\s*\(/u.exec(call.text);
        const candidates=[...new Map(rows.flatMap(row=>row.scope_callbacks||[]).map(row=>[row.source_id,row])).values()];
        const argument=locations?.[executionRule.start_rule.callback_argument];
        const inline=argument && candidates.find(row=>{const fn=nodeById.get(row.source_id);return fn?.start===call.start+argument.start && fn.end===call.start+argument.end;});
        // Candidate tags preserve the original function object and captures.
        // A candidate is never selected merely because it is the only name found.
        if(!locations || !callee){lifecycleFrontiers.push({source_call_id:source.call_id,source_access_id:callId,reason:'transition_start_source_unsupported'});continue;}
        addLifecycleEntry({kind:'api_call',...sourceMeta,surface:source.surface,export:source.export,disposition:source.disposition,
          transition_hook_call_id:source.call_id,transition_start_source_id:callId,transition_callee_length:callee[1].length,
          scope_rule:executionRule.start_rule,scope_input_indices:locations.map((_,i)=>i).filter(i=>i===executionRule.start_rule.callback_argument),
          scope_callback_source_id:inline?.source_id||null,scope_callback_candidates:candidates,scope_captures:inline?.captures||[],scope_argument_path_incomplete:rows.some(row=>row.scope_callback_frontier)},
          {transform:'scope_call',node_id:callId,file:call.file});
        for(const callback of candidates) {
          if(scopeTaggedSources.has(callback.source_id))continue;
          const target=nodeById.get(callback.source_id);if(!target)continue;scopeTaggedSources.add(callback.source_id);
          addLifecycleEntry({kind:'callback_source_tag',...sourceMeta,callback_source_id:callback.source_id},
            {transform:'callback_source_tag',node_id:target.id,file:target.file,handler_source_id:callback.source_id,captures:callback.captures});
        }
      }
    }
    const memoValue=validateReactExecutionRule(executionRule).valid && executionRule.kind==='memo_value';
    const stateQueue=validateReactExecutionRule(executionRule).valid && executionRule.kind==='state_queue';
    if(memoValue) addLifecycleEntry({kind:'memo_result',...sourceMeta,
      result_callbacks:source.causal_bindings.result_callbacks || []},
      {transform:'memo_result',node_id:source.call_id,file:callSource.file});
    for(const callback of source.causal_bindings.result_callbacks || []) {
      const target=nodeById.get(callback.source_id);
      if(target)addLifecycleEntry({kind:'callback_source_tag',...sourceMeta},
        {transform:'callback_source_tag',node_id:callback.source_id,file:target.file,
          handler_source_id:callback.source_id,captures:callback.captures || []});
    }
    if(stateQueue) {
      addLifecycleEntry({kind:'state_result',...sourceMeta,execution_rule:executionRule},
        {transform:'state_result',node_id:source.call_id,file:callSource.file});
      for(const update of map.edges.filter(edge=>edge.relation==='state_write' && edge.hook_call_id===source.call_id)) {
        const callee=nodeById.get(update.callee_source_id);
        if(!callee)continue;
        addLifecycleEntry({kind:'state_dispatch',...sourceMeta,execution_rule:executionRule,
          update_call_id:update.from,updater_source_id:update.updater_source_id||null,
          updater_source_candidates:update.updater_source_candidates||[],
          reducer_source_id:source.causal_bindings.callbacks.find(row=>row.slot==='arguments.0'
            && ['inline_source','local_immutable_callback','shared_source_callback'].includes(row.resolution))?.source_id||null,
          captures:update.updater_captures||[]},
          {transform:'state_dispatch',node_id:callee.id,file:callee.file});
        const updater=nodeById.get(update.updater_source_id);
        if(updater)addLifecycleEntry({kind:'callback_source_tag',...sourceMeta,update_call_id:update.from},
          {transform:'callback_source_tag',node_id:updater.id,file:updater.file,
            handler_source_id:updater.id,captures:update.updater_captures||[]});
        for(const candidate of update.updater_source_candidates||[]) {
          const target=nodeById.get(candidate.source_id);if(!target)continue;
          addLifecycleEntry({kind:'callback_source_tag',...sourceMeta,update_call_id:update.from},
            {transform:'callback_source_tag',node_id:target.id,file:target.file,
              handler_source_id:target.id,captures:candidate.captures||[]});
        }
      }
    }
    // DevTools may retain or invoke the original formatter. Until inspection
    // has its own observation path, do not replace it with a render callback.
    if(debugValue)lifecycleFrontiers.push({source_call_id:source.call_id,semantic_id:source.semantic_id,reason:'debug_inspection_dispatcher_unobserved'});
    const callbacks = debugValue || element&&scopeRule.kind==='lazy_component' || (scope || childrenRule) && scopeLocations?[]:source.causal_bindings?.callbacks || [];
    for (const callback of callbacks) {
      if(memoValue&&callback.dynamic_source){
        const candidates=callback.candidates||[],keys=[];
        for(const candidate of candidates){
          const target=nodeById.get(candidate.source_id);if(!target)continue;
          keys.push(addLifecycleEntry({kind:'callback',...sourceMeta,hook_source_call_id:source.call_id,
            callback_slot:callback.slot,callback_source_id:candidate.source_id,phase:callback.phase,
            observes_memo_value:true,callback_source_proven:true,captures:candidate.captures||[],
            result_callbacks:source.causal_bindings.result_callbacks||[],memo_callback_candidates:candidates}));
          if(!scopeTaggedSources.has(candidate.source_id)){
            scopeTaggedSources.add(candidate.source_id);
            addLifecycleEntry({kind:'callback_source_tag',...sourceMeta,callback_source_id:candidate.source_id},
              {transform:'callback_source_tag',node_id:target.id,file:target.file,handler_source_id:candidate.source_id,captures:candidate.captures||[]});
          }
        }
        const input=nodeById.get(source.causal_bindings.inputs[callback.slot]);
        if(input)addLifecycleEntry({kind:'dynamic_memo',...sourceMeta,memo_callback_candidates:candidates,memo_callback_keys:keys},
          {transform:'dynamic_memo',node_id:input.id,file:input.file});
        if(callback.source_frontier)lifecycleFrontiers.push({source_call_id:source.call_id,reason:'memo_calculator_alternatives_incomplete'});
        continue;
      }
      if (imperativeHandle && callback.slot!==`arguments.${executionRule.factory_argument}`) continue;
      if (callback.slot==='cleanup' && callback.source_id && callback.context_reads?.length
          && executionRule?.kind==='commit_effect' && validateReactExecutionRule(executionRule).valid) {
        const cleanupSource=nodeById.get(callback.source_id);
        if (cleanupSource) addLifecycleEntry({kind:'context_cleanup',...sourceMeta,
          callback_slot:'cleanup',callback_source_id:callback.source_id,context_reads:callback.context_reads},
        {transform:'context_cleanup',node_id:callback.source_id,file:cleanupSource.file});
      }
      if (!/^arguments\.\d+(?: if (?:function|provided))?$/u.test(callback.slot || '') || !callback.source_id) continue;
      const stateReducer=stateQueue && executionRule.update_mode==='reducer'
        && callback.slot===`arguments.${executionRule.reducer_argument}`;
      if(executionRule?.kind==='state_queue' && callback.resolution!=='inline_source' && !stateReducer)continue;
      const inputNodeId = source.causal_bindings?.inputs?.[callback.slot.replace(/ if .*$/, '')];
      const inputSource = nodeById.get(inputNodeId);
      if (!inputSource) continue;
      const cleanup = callbacks.find(candidate => candidate !== callback
        && (candidate.slot === 'cleanup' || /unsubscribe/u.test(candidate.slot || '')));
      const rule = source.behavior?.execution;
      const retainedBindings = (map.react_semantics || []).flatMap(row => row.causal_bindings?.callbacks || [])
        .filter(row => row.retained === true && row.source_id === callback.source_id);
      const sharedBody=callback.shared_body || callback.named_body && {...callback.named_body,kind:'named'};
      const sharedRetained=callback.retained && sharedBody && validateReactExecutionRule(rule).valid
        && rule.kind==='retained_callback' && (retainedBindings.length>1 || ['shared_named_callback','shared_source_callback'].includes(callback.resolution));
      if(sharedRetained) {
        addLifecycleEntry({kind:'shared_retained_result',...sourceMeta,callback_slot:callback.slot,callback_source_id:callback.source_id},
          {transform:'shared_retained_result',node_id:source.call_id,file:callSource.file});
        if(!sharedRetainedBodies.has(callback.source_id)) {
          sharedRetainedBodies.add(callback.source_id);
          const body=nodeById.get(sharedBody.source_id);
          addLifecycleEntry({kind:'shared_retained_body',callback_source_id:callback.source_id,self_name:sharedBody.self_name||null,body_kind:sharedBody.kind,captures:callback.captures||[]},
            {transform:sharedBody.kind==='factory'?'shared_retained_factory':'shared_retained_body',node_id:body.id,file:body.file});
        }
        continue;
      }
      const retainedInline = retainedBindings.length === 1 && validateReactExecutionRule(rule).valid
        && rule.kind === 'retained_callback' && callback.slot === `arguments.${rule.callback_argument}`
        && ['inline_source','local_immutable_callback'].includes(callback.resolution);
      if (callback.retained && !retainedInline) lifecycleFrontiers.push({
        source_call_id:source.call_id, semantic_id:source.semantic_id,
        reason:retainedBindings.length > 1 ? 'shared_callback_hook_ownership_ambiguous'
          : !validateReactExecutionRule(rule).valid ? 'executable_rule_missing_or_invalid'
          : 'retained_callback_source_shape_unsupported',
      });
      const callbackTransform = retainedInline ? 'retained_callback'
        : callback.retained === true ? 'callback_tag' : 'callback';
      if (retainedInline) addLifecycleEntry({ kind: 'retained_result', ...sourceMeta,
        callback_slot: callback.slot, callback_source_id: callback.source_id },
      { transform: 'retained_result', node_id: source.call_id, file: callSource.file });
      addLifecycleEntry({ kind: callbackTransform,
        ...sourceMeta, hook_source_call_id: source.call_id,
        callback_slot: callback.slot, callback_source_id: callback.source_id,
        phase: ['commit_effect','imperative_handle'].includes(rule?.kind) && validateReactExecutionRule(rule).valid
          ? `${rule.phase} commit` : callback.phase || null,
        result_callbacks:source.causal_bindings.result_callbacks || [],
        observes_state_reducer:stateReducer,
        observes_state_initializer:stateQueue && callback.slot===`arguments.${executionRule.initializer_argument} ${executionRule.initializer_mode==='if_function'?'if function':'if provided'}`,
        callback_source_proven:!stateReducer
          || ['inline_source','local_immutable_callback','shared_source_callback'].includes(callback.resolution),
        observes_memo_value:memoValue && callback.slot === `arguments.${executionRule.callback_argument}`,
        observes_imperative_handle:imperativeHandle,
        observes_effect_outcome:validateReactExecutionRule(rule).valid && rule.kind==='commit_effect',
        external_store_role:validateReactExecutionRule(rule).valid && rule.kind==='external_store'
          ? callback.slot===`arguments.${rule.subscribe_argument}`?'subscribe'
            :callback.slot===`arguments.${rule.snapshot_argument}`?'snapshot'
              :callback.slot===`arguments.${rule.server_snapshot_argument}`?'server_snapshot':null:null,
        captures: callback.captures || [],
        context_reads:retainedInline || callback.resolution==='inline_source' ? callback.context_reads || [] : [],
        ...(cleanup?.source_id ? { cleanup_slot: cleanup.slot,
          cleanup_source_id: cleanup.source_id, cleanup_phase: cleanup.phase || null,
          cleanup_captures: cleanup.captures || [] } : {}) },
      { transform: callbackTransform,
        node_id: retainedInline ? callback.source_id : inputNodeId, file: inputSource.file });
    }
  }
  for (const entry of lifecycleEntries) {
    if (!entry.cleanup_source_id) continue;
    const cleanups=lifecycleEntries.filter(candidate=>candidate.kind==='context_cleanup'
      && candidate.source_call_id===entry.source_call_id && candidate.callback_slot===entry.cleanup_slot
      && candidate.callback_source_id===entry.cleanup_source_id);
    if (cleanups.length===1) entry.cleanup_manifest_key=cleanups[0].key;
  }
  for (const [ownerSourceId, sources] of hookSourcesByOwner) {
    if (!componentById.has(ownerSourceId)) continue;
    const ownerSource = nodeById.get(ownerSourceId);
    if (!ownerSource) continue;
    const anchor = sources.sort((left, right) => left.callSource.start - right.callSource.start)[0].source;
    addLifecycleEntry({ kind: 'component_render', ...lifecycleSource(anchor),
      hook_source_call_id: anchor.call_id, component_source_id: ownerSourceId },
    { transform: 'component_render', node_id: ownerSourceId, file: ownerSource.file });
  }
  for(const entry of lifecycleEntries.filter(row=>row.kind==='wrapper_callback')) {
    if(lifecycleEntries.some(row=>row.kind==='component_render' && row.owner_source_id===entry.owner_source_id))continue;
    const owner=nodeById.get(entry.owner_source_id);
    addLifecycleEntry({...Object.fromEntries(Object.entries(entry).filter(([key])=>key!=='key')),kind:'component_render',component_source_id:entry.owner_source_id},
      {transform:'component_render',node_id:owner.id,file:owner.file});
  }
  for(const consumer of map.react_server_consumers||[]){
    const source=nodeById.get(consumer.source_id);
    if(!source)continue;
    const metadata={kind:'server_consumer',server_consumer_id:consumer.id,
      server_consumer_kind:consumer.kind,server_consumer_source_id:consumer.source_id,
      ...(consumer.event?{server_consumer_event:consumer.event}:{} )};
    addLifecycleEntry(metadata,{transform:`server_consumer_${consumer.kind}`,node_id:consumer.source_id,
      file:source.file,consumer});
  }
  for (const protocol of map.react_protocols || []) {
    if (!['Provider', 'Consumer'].includes(protocol.member) || !protocol.context_id) continue;
    const source = map.react_semantics.find(row => row.id === protocol.semantic_application_id
      && row.call_id === protocol.producer_call_id && row.semantic_id === protocol.semantic_id);
    const protocolSource = nodeById.get(protocol.member_call_id);
    if (!source || !protocolSource) continue;
    const base = { ...lifecycleSource(source), context_id: protocol.context_id,
      protocol_member: protocol.member, source_member_call_id: protocol.member_call_id,
      protocol_application_id: protocol.id };
    if (protocol.member === 'Provider') {
      addLifecycleEntry({ kind: 'context_provider', ...base },
        { transform: 'context_provider', node_id: protocol.member_call_id, file: protocolSource.file });
      continue;
    }
    const binding = protocol.callback_bindings?.find(value => value.slot === 'props.children');
    if (!binding?.source_id) continue;
    addLifecycleEntry({ kind: 'context_consumer_callback', ...base,
      callback_slot: 'props.children', callback_source_id: binding.source_id,
      callback_resolution: binding.resolution || 'exact_source_function', phase: 'render attempt' },
    { transform: 'context_consumer_callback', node_id: protocol.member_call_id,
      file: protocolSource.file });
  }
  // A native JSX site is shared by every mounted instance. Unless the input was
  // complete and the analyzer reported no source gap, uniqueness is unproven.
  // unsupported_submission describes browser behavior after the placement and
  // therefore does not weaken placement enumeration.
  const nativeHostUniquenessUnproven = map.input?.complete !== true
    || map.diagnostics.some(diagnostic => diagnostic.code !== 'unsupported_submission');
  const scenariosByControl = new Map();
  for (const scenario of map.scenarios) {
    const values = scenariosByControl.get(scenario.control_id) || [];
    values.push(scenario);
    scenariosByControl.set(scenario.control_id, values);
  }
  // Class bodies may run synchronously inside any mapped native callback. Retain
  // the actual callback receipt; its dynamic extent does not prove update causality.
  const observesClassRenders=lifecycleEntries.some(entry=>entry.class_rule);
  const observesExternalStores=lifecycleEntries.some(entry=>entry.external_store_role);
  const refAccessScenarios=new Set(lifecycleEntries.flatMap(entry=>entry.ref_access?.scenario_ids||[]));
  for (const control of map.controls) {
    const memoEdges=map.edges.filter(edge=>edge.relation==='react_callback_value'
      && edge.react_semantic_id==='react/useMemo/18.3.1'
      && control.handler_ids.includes(edge.to));
    const sharedEdges=map.edges.filter(edge=>edge.relation==='event_handler' && edge.from===control.id
      && edge.react_semantic_id==='react/useCallback/18.3.1'
      && lifecycleEntries.some(entry=>entry.kind==='shared_retained_result' && entry.source_call_id===edge.producer_call_id));
    const hasRefPath=(scenariosByControl.get(control.id)||[]).some(scenario=>refAccessScenarios.has(scenario.id));
    const hasHostPath=(scenariosByControl.get(control.id)||[]).some(scenario=>scenario.handler_ids.some(id=>{const handler=nodeById.get(id);return handler&&lifecycleEntries.some(entry=>{const call=entry.host_rule&&nodeById.get(entry.source_call_id);return call&&call.file===handler.file&&call.start>=handler.start&&call.end<=handler.end;});}));
    if (control.callback_selection !== 'runtime_required' && !memoEdges.length && !sharedEdges.length && !hasRefPath && !hasHostPath && !observesExternalStores && !observesClassRenders) continue;
    const source = nodeById.get(control.source_node_id);
    if (!source) continue;
    const scenarios = scenariosByControl.get(control.id) || [];
    const scenarioOptions = scenarios.flatMap(scenario => scenario.handler_ids.length === 1 ? [{
      scenario_id: scenario.id,
      handler_source_id: scenario.handler_ids[0],
      conditions: scenario.conditions,
      retained_producer_call_ids:[...new Set(sharedEdges.filter(edge=>edge.scenario_id===scenario.id).map(edge=>edge.producer_call_id))],
      memo_producer_call_ids:[...new Set(memoEdges.filter(edge=>edge.scenario_id===scenario.id).map(edge=>edge.from))],
    }] : []);
    const key = addLifecycleEntry({ kind: 'event_callback', control_id: control.id,
      binding_id: control.binding_id, event: control.event, scenario_options: scenarioOptions },
    { transform: 'event_callback', node_id: control.source_node_id, file: source.file,
      event: control.event });
    for (const option of scenarioOptions) {
      const handlerSource = nodeById.get(option.handler_source_id);
      if (handlerSource) lifecycleTransforms.push({ key, transform: 'callback_source_tag',
        node_id: option.handler_source_id, file: handlerSource.file,
        handler_source_id: option.handler_source_id });
    }
  }
  const lifecycleEntryByKey = new Map(lifecycleEntries.map(entry => [entry.key, entry]));
  const predicateEdgesByCall=new Map(),predicateCallsByCondition=new Map();
  for(const entry of lifecycleEntries.filter(row=>row.predicate_rule))for(const condition of entry.predicate_conditions)
    predicateCallsByCondition.set(condition.condition_id,{call_id:entry.source_call_id,inverted:condition.inverted});
  for(const edge of map.edges)for(const condition of edge.conditions||[]) {
    const source=predicateCallsByCondition.get(condition.node_id);if(!source)continue;
    const rows=predicateEdgesByCall.get(source.call_id)||[];rows.push({edge,condition,inverted:source.inverted});predicateEdgesByCall.set(source.call_id,rows);
  }
  const scopeForwardEdges=new Map();
  const scopeCallScenarios=new Map();
  for(const edge of map.edges.filter(row=>row.relation==='call_site' && row.scenario_id)) {
    const values=scopeCallScenarios.get(edge.to)||new Set();values.add(edge.scenario_id);scopeCallScenarios.set(edge.to,values);
  }
  for(const edge of map.edges.filter(row=>row.relation==='callback_forward')) {
    const key=`${edge.from}\0${edge.callback_source_id||edge.to}`,rows=scopeForwardEdges.get(key)||[];rows.push(edge);scopeForwardEdges.set(key,rows);
  }
  // Real repositories can produce thousands of scenarios. Index the reader's
  // output once instead of rescanning the complete graph for every control.
  const edgesByScenario = groupByScenario(map.edges);
  const libraryContractsByScenario = groupByScenario(map.library_contracts);
  const libraryBacklogByScenario = groupByScenario(map.library_backlog);
  const sourcePathByScenario = new Map(map.scenarios.map(scenario => {
    const scenarioEdges = edgesByScenario.get(scenario.id) || [];
    const libraryContracts = libraryContractsByScenario.get(scenario.id) || [];
    const libraryBacklog = libraryBacklogByScenario.get(scenario.id) || [];
    // The contract describes the package call, while its library_effect edge
    // carries the source branch that reached it. Keep both so downstream route
    // matching cannot mistake mutually exclusive requests for one certainty.
    const outboundRequests = libraryContracts.filter(row => row.effect?.kind === 'http_request').flatMap(contract => {
      const effectEdge = scenarioEdges.find(edge => edge.relation === 'library_effect'
        && edge.contract_id === contract.contract_id && edge.from === contract.invocation_call_id
        && edge.effect?.kind === 'http_request');
      return effectEdge ? [{
        contract_application_id: contract.id,
        contract_id: contract.contract_id,
        invocation_call_id: contract.invocation_call_id,
        placement_id: contract.placement_id,
        package: contract.package,
        version: contract.version,
        package_verification_sha256: contract.package_verification_sha256,
        effect: contract.effect,
        conditions: effectEdge.conditions,
        evidence_ids: effectEdge.evidence_ids,
      }] : [];
    });
    // This remains source evidence selected by one runtime occurrence. A
    // network observation must separately confirm that any request was sent.
    return [scenario.id, {
      scenario_edges: scenarioEdges,
      library_contracts: libraryContracts,
      library_backlog: libraryBacklog,
      outbound_requests: outboundRequests,
    }];
  }));

  const proposed = [];
  const diagnostics = [];
  for (const control of map.controls) {
    const scenarios = scenariosByControl.get(control.id) || [];
    const placement = placementById.get(control.placement_id);
    const owner = sourceOwner(control, placementById, componentById);
    const selector = selectorFor(control, owner);
    if (selector) {
      selector.sourceControl = `${map.fingerprint}:${control.id}`;
      // The generated source-control stamp is already unique to this exact
      // analyzed placement. Production minifiers may erase component names,
      // so retaining the component as a second runtime predicate would reject
      // a correctly stamped control without adding identity evidence.
      delete selector.component;
    }
    if (control.status !== 'resolved') {
      diagnostics.push({ code: 'unresolved_source_control', control_id: control.id,
        message: 'The source handler is unresolved, so no runtime binding was generated.' });
    } else if (!RUNTIME_EVENTS.has(control.event)) {
      diagnostics.push({ code: 'unsupported_runtime_event', control_id: control.id, event: control.event,
        message: 'The browser listener does not capture this source event, so no runtime binding was generated.' });
    } else if (scenarios.length !== 1) {
      diagnostics.push({ code: 'ambiguous_source_scenario', control_id: control.id,
        message: 'The source control does not have exactly one scenario.' });
    } else if (!selector) {
      diagnostics.push({ code: 'missing_runtime_owner', control_id: control.id,
        message: 'A resolved source control needs a named owning component before it can join runtime evidence.' });
    } else {
      proposed.push({ control, scenario: scenarios[0], placement, owner, selector });
    }
  }

  const bySelector = new Map();
  for (const candidate of proposed) {
    const key = stable(candidate.selector);
    const values = bySelector.get(key) || [];
    values.push(candidate);
    bySelector.set(key, values);
  }

  const accepted = [];
  for (const values of bySelector.values()) {
    if (values.length === 1) accepted.push(values[0]);
    else for (const candidate of values) diagnostics.push({
      code: 'ambiguous_runtime_selector', control_id: candidate.control.id,
      competing_control_ids: values.filter(value => value !== candidate).map(value => value.control.id),
      message: 'This exact runtime selector identifies more than one source control, so none were admitted.',
    });
  }

  const compiledCandidates = accepted.map(candidate => {
    const action = token(map, candidate.control, candidate.scenario);
    const placementSource = nodeById.get(candidate.placement.source_node_id);
    const controlSource = nodeById.get(candidate.control.source_node_id);
    const bindingSource = nodeById.get(candidate.control.binding_id);
    const bindingCameFromPlacement = placementSource?.kind === 'jsx' && bindingSource
      && bindingSource.file === placementSource.file
      && bindingSource.start >= placementSource.start && bindingSource.end <= placementSource.end;
    const forwardsArbitraryProps = bindingCameFromPlacement
      && directlyForwardsArbitraryProps(componentById.get(candidate.placement.component_id), controlSource, nodeById);
    const source = forwardsArbitraryProps ? placementSource
      : ['jsx', 'call'].includes(controlSource?.kind) ? controlSource : null;
    const placementComponentSource = nodeById.get(candidate.placement.component_id);
    const handlerOwnedByComponent = placementComponentSource?.kind === 'function'
      && candidate.scenario.handler_ids.length > 0
      && candidate.scenario.handler_ids.every(handlerId => {
        const handlerSource = nodeById.get(handlerId);
        const lexicalHandler=handlerSource && handlerSource.file === placementComponentSource.file
          && handlerSource.start >= placementComponentSource.start && handlerSource.end <= placementComponentSource.end;
        // A module-level callback still belongs to this source control when an
        // exact local hook selects it. The function's declaration location is
        // not the hook owner's location; keep the producer edge in this proof.
        const localRetainedProducer=map.edges.some(edge=>edge.relation==='event_handler'
          && edge.from===candidate.control.id && edge.to===handlerId && edge.scenario_id===candidate.scenario.id
          && lifecycleEntries.some(entry=>entry.kind==='shared_retained_result'
            && entry.source_call_id===edge.producer_call_id && entry.callback_source_id===handlerId
            && entry.owner_source_id===placementComponentSource.id));
        return lexicalHandler || localRetainedProducer;
      });
    const elementEntry = controlSource?.kind === 'call'
      ? lifecycleEntries.find(entry => entry.kind === 'api_call' && entry.source_call_id === controlSource.id && entry.element_rule)
      : null;
    const elementConstruction = elementEntry?.element_rule?.kind === 'element_factory'
      ? elementEntry.element_rule.construction : elementEntry?.element_rule;
    const stampConfigArgument = ['element_construction','element_clone'].includes(elementConstruction?.kind)
      ? elementConstruction.config_argument - (elementEntry?.factory_producer_call_id ? 1 : 0) : null;
    return {
      action,
      selector: candidate.selector,
      control_id: candidate.control.id,
      scenario_id: candidate.scenario.id,
      placement_id: candidate.placement.id,
      native_source_node_id: candidate.control.source_node_id,
      handler_ids: [...candidate.scenario.handler_ids],
      conditions: candidate.scenario.conditions.map(condition => ({ ...condition })),
      path: sourcePathByScenario.get(candidate.scenario.id),
      owner: candidate.owner ? { id: candidate.owner.id, name: candidate.owner.name, file: candidate.owner.file } : null,
      stamp_mode: forwardsArbitraryProps ? 'forwarded_placement'
        : controlSource?.kind === 'call' ? 'create_element' : 'native_host',
      stamp_config_argument: stampConfigArgument,
      handler_owned_by_component: handlerOwnedByComponent,
      source: source ? { node_id: source.id, kind: source.kind, file: source.file, start: source.start, end: source.end,
        text: source.text, file_sha256: fileHashByPath.get(source.file) || null } : null,
    };
  });
  const byStampTarget = new Map();
  const controlsByNativeTarget = new Map();
  for (const control of map.controls) {
    const key = stable({ node_id: control.source_node_id, event: control.event });
    const values = controlsByNativeTarget.get(key) || [];
    values.push(control);
    controlsByNativeTarget.set(key, values);
  }
  for (const candidate of compiledCandidates) {
    if (!candidate.source) {
      diagnostics.push({ code: 'unsupported_stamp_target', control_id: candidate.control_id,
        message: 'No exact JSX or createElement occurrence can carry this source-control stamp.' });
      continue;
    }
    if (candidate.stamp_mode === 'native_host') {
      if (nativeHostUniquenessUnproven && !candidate.handler_owned_by_component) {
        diagnostics.push({ code: 'unresolved_render_topology', control_id: candidate.control_id,
          message: 'The source map is incomplete or contains an unresolved source frontier, so native-host uniqueness is not proven.' });
        continue;
      }
      const nativeControls = controlsByNativeTarget.get(stable({ node_id: candidate.native_source_node_id,
        event: candidate.selector.event })) || [];
      if (nativeControls.length !== 1) {
        diagnostics.push({ code: 'ambiguous_source_stamp', control_id: candidate.control_id,
          competing_control_ids: nativeControls.filter(control => control.id !== candidate.control_id).map(control => control.id),
          message: 'One native JSX element and event represent multiple source occurrences, so no runtime stamp was generated.' });
        continue;
      }
    }
    const key = stable({ file: candidate.source.file, node_id: candidate.source.node_id, event: candidate.selector.event });
    const values = byStampTarget.get(key) || [];
    values.push(candidate);
    byStampTarget.set(key, values);
  }
  const candidates = [];
  for (const values of byStampTarget.values()) {
    if (values.length === 1) candidates.push(values[0]);
    else for (const candidate of values) diagnostics.push({
      code: 'ambiguous_source_stamp', control_id: candidate.control_id,
      competing_control_ids: values.filter(value => value !== candidate).map(value => value.control_id),
      message: 'One JSX element and event represent multiple source occurrences, so no runtime stamp was generated.',
    });
  }
  const candidateByAction = new Map(candidates.map(candidate => [candidate.action, candidate]));
  const actions = candidates.map(candidate => ({ ...candidate.selector, action: candidate.action }));
  const requestBridgeCandidates = options.requestBridge ? candidates.filter(candidate =>
    candidate.path.outbound_requests.length > 0) : [];
  const requestBridgeManifest = {
    schema: 'producttrace.browser-request-bridge-manifest.v1',
    map_fingerprint: map.fingerprint,
    actions: requestBridgeCandidates.map(candidate => ({
      action: candidate.action,
      event: candidate.selector.event,
      source_control: candidate.selector.sourceControl,
      requests: candidate.path.outbound_requests.map(request => ({
        contract_application_id: request.contract_application_id,
        invocation_call_id: request.invocation_call_id,
        method: request.effect.method,
      })),
    })),
  };

  function openingInsertion(exact) {
    const prefix = 'const __producttrace_element = (';
    const parsed = ts.createSourceFile('__producttrace_stamp.tsx', `${prefix}${exact});`,
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let jsx = null;
    const visit = node => {
      if (jsx) return;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) jsx = node;
      else ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (!jsx || jsx.getStart(parsed) !== prefix.length) return null;
    const opening = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
    const end = opening.getEnd() - prefix.length;
    const insertion = end - (ts.isJsxSelfClosingElement(jsx) ? 2 : 1);
    return insertion >= 0 ? { insertion, opening: exact.slice(0, end) } : null;
  }

  function createElementConfigInsertion(exact, configArgument) {
    const prefix = 'const __producttrace_element = (';
    const parsed = ts.createSourceFile('__producttrace_stamp.tsx', `${prefix}${exact});`,
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const expression = parsed.statements[0]?.declarationList?.declarations[0]?.initializer?.expression;
    if (!expression || !ts.isCallExpression(expression) || expression.getStart(parsed) !== prefix.length
        || expression.arguments.some(argument => ts.isSpreadElement(argument))) return null;
    if (!Number.isSafeInteger(configArgument) || configArgument < 0) return null;
    const config = expression.arguments[configArgument];
    if (!config || !ts.isObjectLiteralExpression(config)
        || config.properties.some(property => ts.isSpreadAssignment(property))) return null;
    const names = new Set();
    for (const property of config.properties) {
      if (!property.name || ts.isComputedPropertyName(property.name)) return null;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
        || ts.isNumericLiteral(property.name) ? property.name.text : null;
      if (name === null) return null;
      names.add(name);
    }
    return { insertion: config.getStart(parsed) - prefix.length + 1, names };
  }

  function handlerExpression(exact, event) {
    const prefix = 'const __producttrace_element = (';
    const parsed = ts.createSourceFile('__producttrace_handler.tsx', `${prefix}${exact});`,
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let jsx = null;
    const visit = node => {
      if (jsx) return;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) jsx = node;
      else ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (!jsx || jsx.getStart(parsed) !== prefix.length) return null;
    const opening = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
    const expectedName = `on${event[0].toUpperCase()}${event.slice(1)}`;
    const attributes = opening.attributes.properties.filter(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.text === expectedName);
    if (attributes.length !== 1) return null;
    const initializer = attributes[0].initializer;
    if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return null;
    const start = initializer.expression.getStart(parsed) - prefix.length;
    const end = initializer.expression.getEnd() - prefix.length;
    return start >= 0 && end >= start ? { start, end, text: exact.slice(start, end) } : null;
  }

  const lifecycleGlobal = 'globalThis.__productTraceReactLifecycle';
  const lifecycleWrap = (key, method) => `${lifecycleGlobal}.${method}(${JSON.stringify(key)}, `;

  function componentRenderLocations(file, source, sourceNode) {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
      /\.tsx?$/u.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
    let fn = null;
    const visit = current => {
      if (fn) return;
      if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isFunctionDeclaration(current))
          && current.getStart(parsed) === sourceNode.start && current.getEnd() === sourceNode.end) {
        fn = current;
        return;
      }
      ts.forEachChild(current, visit);
    };
    visit(parsed);
    if (!fn?.body) return null;
    const inferredName = (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) && !fn.name)
      && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : null;
    const firstParameter=fn.parameters[0]?.name;
    const propsExpression=firstParameter&&ts.isIdentifier(firstParameter)?firstParameter.text:ts.isArrowFunction(fn)?'undefined':'arguments[0]';
    if (!ts.isBlock(fn.body)) return { inferredName, propsExpression, expression: { start: fn.body.getStart(parsed), end: fn.body.getEnd() } };
    let insertion = fn.body.getStart(parsed) + 1;
    for (const statement of fn.body.statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
      insertion = statement.getEnd();
    }
    return { insertion, inferredName, propsExpression, body_end:fn.body.getEnd()-1 };
  }

  function callbackSourceTagLocations(file, source, sourceNode) {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
      /\.tsx?$/u.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
    let fn = null;
    const visit = current => {
      if (fn) return;
      if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)
          || ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current))
          && current.getStart(parsed) === sourceNode.start && current.getEnd() === sourceNode.end) {
        fn = current;
        return;
      }
      ts.forEachChild(current, visit);
    };
    visit(parsed);
    if (!fn || !fn.body) return null;
    if (ts.isFunctionDeclaration(fn) && fn.name) {
      const parent=fn.parent;
      if(!ts.isSourceFile(parent) && !ts.isBlock(parent))return null;
      let insertion=ts.isSourceFile(parent)?0:parent.getStart(parsed)+1;
      for(const statement of parent.statements) {
        if(!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression))break;
        insertion=statement.getEnd();
      }
      return { declaration: { insertion, name: fn.name.text } };
    }
    if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
      const parent=fn.parent;
      const inferredName=(!ts.isFunctionExpression(fn) || !fn.name)
        && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))
        && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) ? parent.name.text : null;
      return { expression: { start: fn.getStart(parsed), end: fn.getEnd() }, inferredName };
    }
    return null;
  }

  function consumerCallbackLocation(exact) {
    const prefix = 'const __producttrace_consumer = (';
    const parsed = ts.createSourceFile('__producttrace_consumer.tsx', `${prefix}${exact});`,
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let jsx = null;
    const visit = current => {
      if (jsx) return;
      if (ts.isJsxElement(current)) jsx = current;
      else ts.forEachChild(current, visit);
    };
    visit(parsed);
    if (!jsx || jsx.getStart(parsed) !== prefix.length) return null;
    const children = jsx.children.filter(child => !ts.isJsxText(child) || child.text.trim());
    if (children.length !== 1 || !ts.isJsxExpression(children[0]) || !children[0].expression) return null;
    return {
      start: children[0].expression.getStart(parsed) - prefix.length,
      end: children[0].expression.getEnd() - prefix.length,
    };
  }

  function isCallExpressionSource(exact) {
    const prefix = 'const __producttrace_call = (';
    const parsed = ts.createSourceFile('__producttrace_call.tsx', `${prefix}${exact});`,
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found = false;
    const visit = current => {
      if (found) return;
      if (ts.isCallExpression(current) && current.getStart(parsed) === prefix.length
          && current.getEnd() === prefix.length + exact.length) {
        found = true;
        return;
      }
      ts.forEachChild(current, visit);
    };
    visit(parsed);
    return found;
  }

  function scopeCallLocations(text) {
    const prefix='const __scope=(';
    const parsed=ts.createSourceFile('scope.tsx',prefix+text+');',ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const expression=parsed.statements[0]?.declarationList?.declarations[0]?.initializer?.expression;
    if(!expression || !ts.isCallExpression(expression))return null;
    let unsupported=false;
    const visit=node=>{if(ts.isFunctionLike(node))return;if(ts.isAwaitExpression(node) || ts.isYieldExpression(node)
      || ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text==='eval')unsupported=true;ts.forEachChild(node,visit);};
    visit(expression);
    if(unsupported || expression.arguments.some(node=>ts.isSpreadElement(node)))return null;
    return expression.arguments.map(node=>({start:node.getStart(parsed)-prefix.length,end:node.getEnd()-prefix.length}));
  }

  function instrumentSource(file, source, { stampsOnly = false } = {}) {
    if (typeof file !== 'string' || typeof source !== 'string') throw new TypeError('instrumentSource expects a relative file and source text');
    const expectedHash = fileHashByPath.get(file);
    const actualHash = createHash('sha256').update(source).digest('hex');
    if (!expectedHash || actualHash !== expectedHash) {
      return { code: source, applied: [], diagnostics: [{ code: 'source_snapshot_mismatch', file,
        message: 'The source file does not match the analyzed snapshot; no source stamps were added.' }] };
    }
    const targets = new Map();
    for (const candidate of candidates) {
      if (candidate.source?.file !== file) continue;
      const key = candidate.source.node_id;
      const values = targets.get(key) || { source: candidate.source,
        stamp_config_argument: candidate.stamp_config_argument, stamps: [] };
      values.stamps.push({ event: candidate.selector.event, control_id: candidate.control_id });
      targets.set(key, values);
    }
    const applied = [];
    const localDiagnostics = [];
    const edits = [];
    for (const transform of (stampsOnly ? [] : lifecycleTransforms)) {
      if (transform.file !== file) continue;
      const sourceNode = nodeById.get(transform.node_id);
      const entry = lifecycleEntryByKey.get(transform.key);
      if (!sourceNode || !entry || source.slice(sourceNode.start, sourceNode.end) !== sourceNode.text) {
        localDiagnostics.push({ code: 'react_lifecycle_source_node_mismatch', file,
          node_id: transform.node_id,
          message: 'The attested React lifecycle source occurrence no longer matches the analyzed offsets.' });
        continue;
      }
      if(transform.transform==='predicate_frame'){
        const locations=componentRenderLocations(file,source,sourceNode);
        if(locations?.insertion===undefined){localDiagnostics.push({code:'predicate_frame_body_unsupported',file,node_id:sourceNode.id});continue;}
        edits.push({start:locations.insertion,end:locations.insertion,text:`;const ${entry.predicate_frame_name}=${lifecycleGlobal}.predicateFrame();`,
          kind:transform.transform,node_id:sourceNode.id});
      }else if(transform.transform==='predicate_use'){
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'predicateUse')+entry.predicate_frame_name+', ',
          insertion_order:0,kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')',insertion_order:3,kind:transform.transform,node_id:sourceNode.id});
      }else if(transform.transform==='scope_call') {
        const locations=scopeCallLocations(sourceNode.text);
        if(!locations){localDiagnostics.push({code:'scope_argument_evaluation_unsupported',file,node_id:transform.node_id});continue;}
        edits.push({start:sourceNode.start,end:sourceNode.start,text:(entry.predicate_frame_name?lifecycleWrap(transform.key,'predicateCall')+entry.predicate_frame_name+', ':lifecycleWrap(transform.key,'scopeCall'))+'() => ('+(entry.transition_hook_call_id?lifecycleWrap(transform.key,'scopeTarget'):''),insertion_order:-1,kind:'react_scope_call',node_id:transform.node_id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:'))',insertion_order:4,kind:'react_scope_call',node_id:transform.node_id});
        if(entry.transition_hook_call_id) {
          edits.push({start:sourceNode.start+entry.transition_callee_length,end:sourceNode.start+entry.transition_callee_length,text:')',kind:'transition_target',node_id:transform.node_id});
        }
        for(const [index,location] of locations.entries()) {
          if(!(entry.scope_input_indices||entry.predicate_input_indices).includes(index))continue;
          const readers=(entry.scope_captures||[]).flatMap(capture=>{
            const read=nodeById.get(capture.read_id);return read && /^[A-Za-z_$][\w$]*$/u.test(read.text)?[`[${JSON.stringify(capture.binding_id)},()=>${read.text}]`]:[];
          });
          edits.push({start:sourceNode.start+location.start,end:sourceNode.start+location.start,
            text:lifecycleWrap(transform.key,'scopeArgument')+index+', ',insertion_order:1,kind:'react_scope_argument',node_id:transform.node_id});
          edits.push({start:sourceNode.start+location.end,end:sourceNode.start+location.end,
            text:index===(entry.scope_rule||entry.children_rule)?.callback_argument?`,()=>[${readers.join(',')}])`:')',kind:'react_scope_argument',node_id:transform.node_id});
        }
      } else if(transform.transform==='class_render') {
        const mapping=entry.class_mapping;
        edits.push({start:sourceNode.end,end:sourceNode.end,text:`;${lifecycleGlobal}.classRegister(${JSON.stringify(transform.key)},${mapping.name},${mapping.namespace}.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentOwner);`,kind:'react_class_registration',node_id:sourceNode.id});
        edits.push({start:mapping.body_start,end:mapping.body_start,text:`return ${lifecycleGlobal}.classRender(${JSON.stringify(transform.key)},this,()=>{`,insertion_order:10,kind:'react_class_render',node_id:sourceNode.id});
        edits.push({start:mapping.body_end,end:mapping.body_end,text:'});',insertion_order:-2,kind:'react_class_render',node_id:sourceNode.id});
        for(const read of mapping.reads){const site=nodeById.get(read.source_id);
          edits.push({start:site.start,end:site.start,text:`${lifecycleGlobal}.classRead(${JSON.stringify(transform.key)},${JSON.stringify(read.source_id)},${JSON.stringify(read.field)},`,kind:'react_class_read',node_id:site.id});
          edits.push({start:site.end,end:site.end,text:')',kind:'react_class_read',node_id:site.id});}
      } else if(transform.transform==='class_update') {
        const locations=scopeCallLocations(sourceNode.text),key=JSON.stringify(transform.key);
        edits.push({start:sourceNode.start,end:sourceNode.start,text:`${lifecycleGlobal}.classUpdateCall(${key},this,()=>(${lifecycleGlobal}.classUpdateMethod(${key},this,`,insertion_order:-1,kind:'react_class_update',node_id:sourceNode.id});
        edits.push({start:entry.class_update_callee_end,end:entry.class_update_callee_end,text:')',kind:'react_class_update',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:'))',insertion_order:4,kind:'react_class_update',node_id:sourceNode.id});
        for(const [index,location] of locations.entries()){
          const start=sourceNode.start+location.start,end=sourceNode.start+location.end;
          edits.push({start,end:start,text:`${lifecycleGlobal}.classUpdateArgument(${key},${index},`,insertion_order:1,kind:'react_class_update_argument',node_id:sourceNode.id});
          edits.push({start:end,end,text:')',kind:'react_class_update_argument',node_id:sourceNode.id});
          const callback=entry.class_update_callbacks.find(row=>row.index===index);if(!callback)continue;
          let observer='__ptObserveClassUpdate';while(source.includes(observer))observer+='_';
          edits.push({start,end:start,text:`${lifecycleGlobal}.classUpdateCallback(${key},${index},(${observer})=>(`,kind:'react_class_update_callback',node_id:callback.source_id});
          edits.push({start:end,end,text:'))',insertion_order:1,kind:'react_class_update_callback',node_id:callback.source_id});
          const body=callback.body,args=body.kind==='function'?'arguments':`[${body.parameters.join(',')}]`;
          edits.push({start:body.start,end:body.start,text:`${body.block?'return ':''}${observer}(this,${args},()=>${body.block?'{':'('}`,insertion_order:10,kind:'react_class_update_body',node_id:callback.source_id});
          edits.push({start:body.end,end:body.end,text:body.block?'});':'))',insertion_order:body.block?-2:2,kind:'react_class_update_body',node_id:callback.source_id});
        }
      } else if(transform.transform==='host_call') {
        // A lookup can be the first statement or entire expression of a retained
        // callback. Keep its call wrapper inside the body probe and close it
        // before the enclosing callback factory/source tag at a shared offset.
        const locations=scopeCallLocations(sourceNode.text);
        if(!locations){localDiagnostics.push({code:'host_argument_evaluation_unsupported',file,node_id:sourceNode.id});continue;}
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'apiResult')+lifecycleWrap(transform.key,'hostCall')+'() => (',insertion_order:-1,kind:'react_host_call',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')))',insertion_order:4,kind:'react_host_call',node_id:sourceNode.id});
        for(const [index,location] of locations.entries()){
          edits.push({start:sourceNode.start+location.start,end:sourceNode.start+location.start,text:lifecycleWrap(transform.key,'hostArgument')+index+', ',insertion_order:1,kind:'react_host_argument',node_id:sourceNode.id});
          edits.push({start:sourceNode.start+location.end,end:sourceNode.start+location.end,text:')',kind:'react_host_argument',node_id:sourceNode.id});
        }
      } else if(transform.transform==='server_component') {
        const location=componentRenderLocations(file,source,sourceNode);
        if(location?.insertion===undefined){localDiagnostics.push({code:'server_component_body_unsupported',file,node_id:sourceNode.id});continue;}
        edits.push({start:location.insertion,end:location.insertion,text:`${lifecycleGlobal}.serverComponent(${JSON.stringify(entry.server_component.source_id)},${entry.server_component.self_name},arguments);`,kind:'react_server_component',node_id:sourceNode.id});
      } else if(transform.transform==='server_call') {
        const locations=scopeCallLocations(sourceNode.text);
        if(!locations){localDiagnostics.push({code:'server_argument_evaluation_unsupported',file,node_id:sourceNode.id});continue;}
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'apiResult')+lifecycleWrap(transform.key,'serverCall')+'() => (',kind:'react_server_call',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')))',kind:'react_server_call',node_id:sourceNode.id});
        for(const [index,location] of locations.entries()){
          edits.push({start:sourceNode.start+location.start,end:sourceNode.start+location.start,text:lifecycleWrap(transform.key,'serverArgument')+index+', ',insertion_order:1,kind:'react_server_argument',node_id:sourceNode.id});
          edits.push({start:sourceNode.start+location.end,end:sourceNode.start+location.end,text:')',kind:'react_server_argument',node_id:sourceNode.id});
        }
      } else if(transform.transform==='server_consumer_pipe') {
        const receiver=nodeById.get(transform.consumer.receiver_id),destination=nodeById.get(transform.consumer.destination_id);
        if(!receiver||!destination){localDiagnostics.push({code:'server_pipe_consumer_source_unresolved',file,node_id:sourceNode.id});continue;}
        let resource='__ptServerResource',target='__ptServerDestination';
        while(source.includes(resource))resource+='_';while(source.includes(target))target+='_';
        edits.push({start:sourceNode.start,end:sourceNode.end,
          text:`${lifecycleGlobal}.serverPipe(${JSON.stringify(transform.key)},${receiver.text},${destination.text},(${resource},${target})=>${resource}.pipe(${target}))`,
          kind:'react_server_pipe',node_id:sourceNode.id});
      } else if(transform.transform==='server_consumer_event') {
        const receiver=nodeById.get(transform.consumer.receiver_id),callback=transform.consumer.callback;
        if(!receiver||!callback){localDiagnostics.push({code:'server_event_consumer_source_unresolved',file,node_id:sourceNode.id});continue;}
        const observation=`${lifecycleGlobal}.serverEvent(${JSON.stringify(transform.key)},${receiver.text},${JSON.stringify(transform.consumer.event)})`;
        if(callback.block)edits.push({start:callback.start,end:callback.start,text:`${observation};`,kind:'react_server_event',node_id:sourceNode.id});
        else{
          edits.push({start:callback.start,end:callback.start,text:`(${observation},`,kind:'react_server_event',node_id:sourceNode.id});
          edits.push({start:callback.end,end:callback.end,text:')',kind:'react_server_event',node_id:sourceNode.id});
        }
      } else if(transform.transform==='server_consumer_async_iteration') {
        const resource=nodeById.get(transform.consumer.resource_id);
        if(!resource){localDiagnostics.push({code:'server_async_iteration_source_unresolved',file,node_id:sourceNode.id});continue;}
        let error='__ptServerConsumerError';while(source.includes(error))error+='_';
        edits.push({start:sourceNode.start,end:sourceNode.start,text:'try{',kind:'react_server_async_iteration',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,
          text:`;${lifecycleGlobal}.serverIteration(${JSON.stringify(transform.key)},${resource.text},'completed');}catch(${error}){${lifecycleGlobal}.serverIteration(${JSON.stringify(transform.key)},${resource.text},'consumer_failed');throw ${error};}`,
          kind:'react_server_async_iteration',node_id:sourceNode.id});
      } else if(transform.transform==='server_consumer_await_binding') {
        const promise=nodeById.get(transform.consumer.promise_id);
        if(!promise){localDiagnostics.push({code:'server_await_binding_source_unresolved',file,node_id:sourceNode.id});continue;}
        edits.push({start:sourceNode.end,end:sourceNode.end,
          text:`;${lifecycleGlobal}.serverPromiseFulfilled(${JSON.stringify(transform.key)},${promise.text},${transform.consumer.binding});`,
          kind:'react_server_promise_fulfilled',node_id:sourceNode.id});
      } else if(transform.transform==='root_call') {
        const locations=scopeCallLocations(sourceNode.text);
        if(!locations){localDiagnostics.push({code:'root_argument_evaluation_unsupported',file,node_id:sourceNode.id});continue;}
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'apiResult')+lifecycleWrap(transform.key,'rootCall')+'() => ('+(entry.root_method?lifecycleWrap(transform.key,'rootMethod'):''),insertion_order:-1,kind:'react_root_call',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')))',insertion_order:4,kind:'react_root_call',node_id:sourceNode.id});
        if(entry.root_method)edits.push({start:sourceNode.start+entry.root_receiver_length,end:sourceNode.start+entry.root_callee_length,text:', '+JSON.stringify(entry.root_method)+')',kind:'react_root_method',node_id:sourceNode.id});
        for(const [index,location] of locations.entries()){
          edits.push({start:sourceNode.start+location.start,end:sourceNode.start+location.start,text:lifecycleWrap(transform.key,'rootArgument')+index+', ',insertion_order:1,kind:'react_root_argument',node_id:sourceNode.id});
          edits.push({start:sourceNode.start+location.end,end:sourceNode.start+location.end,text:')',kind:'react_root_argument',node_id:sourceNode.id});
        }
      } else if(transform.transform==='root_recovery_source') {
        edits.push({start:sourceNode.start,end:sourceNode.start,
          text:lifecycleWrap(transform.key,'rootRecovery')+JSON.stringify(transform.handler_source_id)+', ',
          kind:'react_root_recovery_source',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')',kind:'react_root_recovery_source',node_id:sourceNode.id});
      } else if(transform.transform==='element_call') {
        const locations=scopeCallLocations(sourceNode.text);
        if(!locations){localDiagnostics.push({code:'element_argument_evaluation_unsupported',file,node_id:sourceNode.id});continue;}
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'apiResult')+lifecycleWrap(transform.key,'elementCall')+'() => ('+(entry.factory_producer_call_id?lifecycleWrap(transform.key,'elementTarget'):''),kind:'react_element_call',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')))',kind:'react_element_call',node_id:sourceNode.id});
        if(entry.factory_producer_call_id)edits.push({start:sourceNode.start+entry.factory_callee_length,end:sourceNode.start+entry.factory_callee_length,text:')',kind:'react_factory_target',node_id:sourceNode.id});
        for(const [index,location] of locations.entries()) {
          edits.push({start:sourceNode.start+location.start,end:sourceNode.start+location.start,text:lifecycleWrap(transform.key,'elementArgument')+index+', ',insertion_order:1,kind:'react_element_argument',node_id:sourceNode.id});
          edits.push({start:sourceNode.start+location.end,end:sourceNode.start+location.end,text:')',kind:'react_element_argument',node_id:sourceNode.id});
        }
      } else if(transform.transform==='portal_call') {
        const locations=scopeCallLocations(sourceNode.text);
        if(!locations){localDiagnostics.push({code:'portal_argument_evaluation_unsupported',file,node_id:sourceNode.id});continue;}
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'apiResult')+lifecycleWrap(transform.key,'portalCall')+'() => (',kind:'react_portal_call',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')))',kind:'react_portal_call',node_id:sourceNode.id});
        for(const [index,location] of locations.entries()) {
          edits.push({start:sourceNode.start+location.start,end:sourceNode.start+location.start,text:lifecycleWrap(transform.key,'portalArgument')+index+', ',kind:'react_portal_argument',node_id:sourceNode.id});
          edits.push({start:sourceNode.start+location.end,end:sourceNode.start+location.end,text:')',kind:'react_portal_argument',node_id:sourceNode.id});
        }
      } else if (transform.transform === 'ref_call') {
        const locations=scopeCallLocations(sourceNode.text);
        if(!locations){localDiagnostics.push({code:'ref_argument_evaluation_unsupported',file,node_id:sourceNode.id});continue;}
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'apiResult')+lifecycleWrap(transform.key,'refCall')+'() => (',kind:'react_ref_call',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')))',kind:'react_ref_call',node_id:sourceNode.id});
        for(const [index,location] of locations.entries()) {
          edits.push({start:sourceNode.start+location.start,end:sourceNode.start+location.start,text:lifecycleWrap(transform.key,'refArgument')+index+', ',kind:'react_ref_argument',node_id:sourceNode.id});
          edits.push({start:sourceNode.start+location.end,end:sourceNode.start+location.end,text:')',kind:'react_ref_argument',node_id:sourceNode.id});
        }
      } else if (transform.transform === 'ref_access') {
        const access=transform.access,receiver=nodeById.get(access.receiver_id),value=nodeById.get(access.value_id);
        if(!receiver || access.mode==='write' && !value)continue;
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,access.mode==='write'?'refWrite':access.mode==='invoke'?'refMethod':'refRead'),kind:'react_ref_access',node_id:sourceNode.id});
        edits.push({start:receiver.end,end:access.mode==='write'?value.start:sourceNode.end,text:access.mode==='write'?', ':')',kind:'react_ref_access',node_id:sourceNode.id});
        if(access.mode==='write')edits.push({start:sourceNode.end,end:sourceNode.end,text:')',kind:'react_ref_access',node_id:sourceNode.id});
      } else if (transform.transform === 'api_call') {
        if (!isCallExpressionSource(sourceNode.text)) {
          localDiagnostics.push({ code: 'unsupported_react_api_observation_transform', file,
            node_id: transform.node_id,
            message: 'The React semantic occurrence is not a call expression and cannot emit a generic invocation observation.' });
          continue;
        }
        edits.push({ start: sourceNode.start, end: sourceNode.start,
          text: lifecycleWrap(transform.key, 'apiResult'), kind: 'react_api_call',
          node_id: transform.node_id });
        edits.push({ start: sourceNode.end, end: sourceNode.end, text: ')',
          kind: 'react_api_call', node_id: transform.node_id });
      } else if(transform.transform==='wrapper_return') {
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'wrapperReturn'),kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')',kind:transform.transform,node_id:sourceNode.id});
      } else if(transform.transform==='profiler_callback') {
        const location=componentRenderLocations(file,source,sourceNode),shape=entry.profiler_shape;
        if(!location||!shape){localDiagnostics.push({code:'profiler_callback_body_unsupported',file,node_id:sourceNode.id});continue;}
        let observer='__ptProfilerBody',rest='__ptProfilerRest';while(source.includes(observer))observer+='_';while(source.includes(rest))rest+='_';
        const args=shape.arrow?`[${shape.parameters.length?shape.parameters.join(',')+',':''}...${rest}]`:'arguments';
        if(shape.arrow)edits.push({start:sourceNode.start+shape.parameter_end,end:sourceNode.start+shape.parameter_end,
          text:`${shape.parameters.length&&!shape.trailing_comma?',':''}...${rest}${shape.parenthesized?'':')'}`,kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.start,end:sourceNode.start,text:`${lifecycleGlobal}.profilerDefine(${JSON.stringify(transform.key)},(${observer})=>(${shape.arrow&&!shape.parenthesized?'(':''}`,kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:`),${JSON.stringify(shape.name)})`,insertion_order:1,kind:transform.transform,node_id:sourceNode.id});
        if(location.insertion!==undefined){
          edits.push({start:location.insertion,end:location.insertion,text:`;return ${observer}(${args},()=>{`,insertion_order:10,kind:transform.transform,node_id:sourceNode.id});
          edits.push({start:location.body_end,end:location.body_end,text:'});',insertion_order:-2,kind:transform.transform,node_id:sourceNode.id});
        }else{
          edits.push({start:location.expression.start,end:location.expression.start,text:`${observer}(${args},()=> (`,kind:transform.transform,node_id:sourceNode.id});
          edits.push({start:location.expression.end,end:location.expression.end,text:'))',insertion_order:2,kind:transform.transform,node_id:sourceNode.id});
        }
      } else if(transform.transform==='wrapper_callback') {
        const location=componentRenderLocations(file,source,sourceNode);
        if(location?.insertion===undefined){localDiagnostics.push({code:'wrapper_callback_body_unsupported',file,node_id:sourceNode.id});continue;}
        edits.push({start:location.insertion,end:location.insertion,text:`;return globalThis.__productTraceReactLifecycle.wrapperCallback(${JSON.stringify(transform.key)},${entry.self_name},arguments,()=>{`,insertion_order:10,kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:location.body_end,end:location.body_end,text:'});',insertion_order:-2,kind:transform.transform,node_id:sourceNode.id});
      } else if(transform.transform==='transition_pending_use') {
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'transitionPendingUse'),kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')',kind:transform.transform,node_id:sourceNode.id});
      } else if(transform.transform==='deferred_result' || transform.transform==='deferred_use') {
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,transform.transform==='deferred_result'?'deferredResult':'deferredUse'),kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')',kind:transform.transform,node_id:sourceNode.id});
        if(transform.input){edits.push({start:sourceNode.start+transform.input.start,end:sourceNode.start+transform.input.start,text:lifecycleWrap(transform.key,'deferredInput'),kind:'deferred_input',node_id:sourceNode.id});
          edits.push({start:sourceNode.start+transform.input.end,end:sourceNode.start+transform.input.end,text:')',kind:'deferred_input',node_id:sourceNode.id});}
      } else if(transform.transform==='id_element') {
        const peers=lifecycleTransforms.filter(row=>row.transform==='id_element'&&row.node_id===transform.node_id);
        if(peers[0]!==transform)continue;
        edits.push({start:sourceNode.start,end:sourceNode.start,boundary_order:0,text:(entry.element_is_jsx_child?'{':'')+lifecycleGlobal+'.idElement('+JSON.stringify(peers.map(row=>row.key))+', ',kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,boundary_order:1,text:')'+(entry.element_is_jsx_child?'}':''),kind:transform.transform,node_id:sourceNode.id});
      } else if (transform.transform==='id_result'  || transform.transform==='id_use' || transform.transform==='transition_result') {
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,transform.transform==='id_result'?'idResult':transform.transform==='transition_result'?'transitionResult':'idUse'),kind:transform.transform,node_id:transform.node_id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')',kind:transform.transform,node_id:transform.node_id});
      } else if (transform.transform === 'state_result' || transform.transform === 'state_dispatch') {
        edits.push({start:sourceNode.start,end:sourceNode.start,
          text:lifecycleWrap(transform.key,transform.transform==='state_result'?'stateResult':'stateDispatch'),
          kind:`react_${transform.transform}`,node_id:transform.node_id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')',kind:`react_${transform.transform}`,node_id:transform.node_id});
      } else if(transform.transform==='api_boundary') {
        edits.push({start:sourceNode.start,end:sourceNode.start,boundary_order:0,text:(entry.element_is_jsx_child?'{':'')+lifecycleWrap(transform.key,'boundaryResult'),kind:'react_boundary',node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,boundary_order:1,text:')'+(entry.element_is_jsx_child?'}':''),kind:'react_boundary',node_id:sourceNode.id});
      } else if (transform.transform === 'api_value') {
        edits.push({ start: sourceNode.start, end: sourceNode.start,
          text: lifecycleWrap(transform.key, 'apiValue'), kind: 'react_api_value',
          node_id: transform.node_id });
        edits.push({ start: sourceNode.end, end: sourceNode.end, text: ')',
          kind: 'react_api_value', node_id: transform.node_id });
      } else if (transform.transform === 'component_render') {
        const locations = componentRenderLocations(file, source, sourceNode);
        if (!locations) {
          localDiagnostics.push({ code: 'unsupported_react_component_render_instrumentation', file,
            node_id: transform.node_id,
            message: 'The lifecycle owner is not an instrumentable function body.' });
          continue;
        }
        const call = `${lifecycleGlobal}.component(${JSON.stringify(transform.key)},${locations.propsExpression});`;
        if (locations.insertion !== undefined) {
          // Establish the owner before an enclosing wrapper outcome scope runs.
          const wrappedBody=lifecycleEntries.some(row=>row.kind==='wrapper_callback' && row.callback_source_id===sourceNode.id);
          edits.push({ start: locations.insertion, end: locations.insertion, text: call,insertion_order:wrappedBody?20:0,
            kind: 'react_component_render', node_id: transform.node_id });
        } else {
          edits.push({ start: locations.expression.start, end: locations.expression.start,
            text: `(${lifecycleGlobal}.component(${JSON.stringify(transform.key)},${locations.propsExpression}), `,
            kind: 'react_component_render', node_id: transform.node_id });
          edits.push({ start: locations.expression.end, end: locations.expression.end, text: ')',
            kind: 'react_component_render', node_id: transform.node_id });
        }
      } else if(transform.transform==='shared_retained_result') {
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'sharedRetainedResult'),kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')',kind:transform.transform,node_id:sourceNode.id});
      } else if(transform.transform==='shared_retained_body') {
        const location=componentRenderLocations(file,source,sourceNode);
        if(location?.insertion===undefined){localDiagnostics.push({code:'shared_retained_body_unsupported',file,node_id:sourceNode.id});continue;}
        const captures=(entry.captures||[]).flatMap(capture=>{
          const read=nodeById.get(capture.read_id);return read && /^[A-Za-z_$][\w$]*$/u.test(read.text)?[`[${JSON.stringify(capture.binding_id)},()=>${read.text}]`]:[];
        });
        edits.push({start:location.insertion,end:location.insertion,
          text:`globalThis.__productTraceReactLifecycle.sharedRetainedBody(${JSON.stringify(transform.key)},${entry.self_name},arguments,[${captures.join(',')}]);`,kind:transform.transform,node_id:sourceNode.id});
      } else if(transform.transform==='shared_retained_factory') {
        const location=componentRenderLocations(file,source,sourceNode);
        if(!location){localDiagnostics.push({code:'shared_retained_factory_unsupported',file,node_id:sourceNode.id});continue;}
        let observer='__ptObserveShared';while(source.includes(observer))observer+='_';
        const captures=(entry.captures||[]).flatMap(capture=>{const read=nodeById.get(capture.read_id);
          return read && /^[A-Za-z_$][\w$]*$/u.test(read.text)?[`[${JSON.stringify(capture.binding_id)},()=>${read.text}]`]:[];});
        const observe=`${observer}([${captures.join(',')}])`;
        // The factory is an arrow so it preserves the original arrow's lexical
        // this, arguments, super and new.target. It returns the original function.
        edits.push({start:sourceNode.start,end:sourceNode.start,text:`${lifecycleGlobal}.sharedRetainedDefine(${JSON.stringify(transform.key)},(${observer})=>(`,kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:`),${JSON.stringify(location.inferredName)})`,insertion_order:1,kind:transform.transform,node_id:sourceNode.id});
        if(location.insertion!==undefined)edits.push({start:location.insertion,end:location.insertion,text:observe+';',kind:transform.transform,node_id:sourceNode.id});
        else {
          edits.push({start:location.expression.start,end:location.expression.start,text:'('+observe+',',kind:transform.transform,node_id:sourceNode.id});
          edits.push({start:location.expression.end,end:location.expression.end,text:')',insertion_order:2,kind:transform.transform,node_id:sourceNode.id});
        }
      } else if (transform.transform === 'retained_result' || transform.transform === 'memo_result') {
        edits.push({ start: sourceNode.start, end: sourceNode.start,
          text: lifecycleWrap(transform.key, transform.transform === 'memo_result' ? 'memoResult' : 'retainedResult'), kind: `react_${transform.transform}`,
          node_id: transform.node_id });
        edits.push({ start: sourceNode.end, end: sourceNode.end, text: ')',
          kind: 'react_retained_result', node_id: transform.node_id });
      } else if (transform.transform === 'retained_callback') {
        const locations = componentRenderLocations(file, source, sourceNode);
        if (!locations) {
          localDiagnostics.push({ code: 'unsupported_retained_callback_body', file,
            node_id: transform.node_id, message: 'Cannot observe the retained callback body without replacing its identity.' });
          continue;
        }
        // Instrument the original body, not a wrapper around the function passed
        // to React: useCallback must still return the exact input function.
        let observer = '__ptObserveRetained';
        while (source.includes(observer)) observer += '_';
        const captures = (entry.captures || []).flatMap(capture => {
          const read = nodeById.get(capture.read_id);
          return read && /^[A-Za-z_$][\w$]*$/u.test(read.text)
            ? [`[${JSON.stringify(capture.binding_id)}, () => ${read.text}]`] : [];
        });
        const observe = `${observer}([${captures.join(',')}])`;
        const contextReadClosings = [];
        for (const read of entry.context_reads || []) {
          const site = nodeById.get(read.read_id);
          if (!site || site.file !== file || site.start < sourceNode.start || site.end > sourceNode.end) continue;
          edits.push({start:site.start,end:site.start,
            text:`${read.shorthand ? site.text + ': ' : ''}(${observer}.contextValue(${JSON.stringify(read.read_id)}, `,
            kind:'react_context_value_use',node_id:read.read_id});
          contextReadClosings.push({start:site.end,end:site.end,text:'))',kind:'react_context_value_use',node_id:read.read_id});
        }
        edits.push({ start: sourceNode.start, end: sourceNode.start,
          text: `${lifecycleGlobal}.defineCallback(${JSON.stringify(transform.key)}, (${observer}) => (`,
          kind: 'react_retained_callback', node_id: transform.node_id });
        edits.push({ start: sourceNode.end, end: sourceNode.end, text: `), ${JSON.stringify(locations.inferredName)})`,insertion_order:1,
          kind: 'react_retained_callback', node_id: transform.node_id });
        if (locations.insertion !== undefined) {
          edits.push({ start: locations.insertion, end: locations.insertion, text: `${observe};`,
            kind: 'react_retained_callback', node_id: transform.node_id });
        } else {
          edits.push({ start: locations.expression.start, end: locations.expression.start, text: `(${observe}, `,
            kind: 'react_retained_callback', node_id: transform.node_id });
          edits.push({ start: locations.expression.end, end: locations.expression.end, text: ')',insertion_order:2,
            kind: 'react_retained_callback', node_id: transform.node_id });
        }
        // Insert inner closings last at a shared end offset. A concise arrow's
        // value read, body, and factory can all end at the same source position.
        edits.push(...contextReadClosings.map(edit=>({...edit,insertion_order:3})));
      } else if(transform.transform==='dynamic_memo'){
        edits.push({start:sourceNode.start,end:sourceNode.start,text:lifecycleWrap(transform.key,'dynamicMemo'),kind:transform.transform,node_id:sourceNode.id});
        edits.push({start:sourceNode.end,end:sourceNode.end,text:')',kind:transform.transform,node_id:sourceNode.id});
      } else if (['callback','callback_tag','context_cleanup'].includes(transform.transform)) {
        const method = transform.transform === 'callback' ? 'callback' : 'tagCallback';
        if (transform.transform!=='context_cleanup') edits.push({ start: sourceNode.start, end: sourceNode.start,
          text: lifecycleWrap(transform.key, method), kind: `react_${transform.transform}`,
          node_id: transform.node_id });
        const readers = (entry.captures || []).flatMap(capture => {
          const read = nodeById.get(capture.read_id);
          return read && /^[A-Za-z_$][\w$]*$/u.test(read.text)
            ? [`[${JSON.stringify(capture.binding_id)}, () => ${read.text}]`] : [];
        });
        if (transform.transform!=='context_cleanup') edits.push({ start: sourceNode.end, end: sourceNode.end,
          text: transform.transform === 'callback' ? `, () => [${readers.join(',')}])` : ')',
          kind: `react_${transform.transform}`, node_id: transform.node_id });
        for (const read of entry.context_reads || []) {
          const site=nodeById.get(read.read_id);
          if (!site || site.file!==file || site.start<sourceNode.start || site.end>sourceNode.end) continue;
          edits.push({start:site.start,end:site.start,
            text:`${read.shorthand?site.text+': ':''}(${lifecycleGlobal}.contextValue(${JSON.stringify(transform.key)}, ${JSON.stringify(read.read_id)}, `,
            kind:'react_context_value_use',node_id:read.read_id});
          edits.push({start:site.end,end:site.end,text:'))',kind:'react_context_value_use',node_id:read.read_id});
        }
      } else if (transform.transform === 'context_create') {
        const locations=entry.context_rule?scopeCallLocations(sourceNode.text):null;
        edits.push({ start: sourceNode.start, end: sourceNode.start,
          text: lifecycleWrap(transform.key, 'registerContext')+(locations?lifecycleWrap(transform.key,'contextCall')+'()=>(' : ''), kind: 'react_context_create',
          node_id: transform.node_id });
        edits.push({ start: sourceNode.end, end: sourceNode.end, text: locations?')))':')',
          kind: 'react_context_create', node_id: transform.node_id });
        if(locations)for(const [index,location] of locations.entries()) {
          edits.push({start:sourceNode.start+location.start,end:sourceNode.start+location.start,
            text:lifecycleWrap(transform.key,'contextArgument')+index+', ',kind:'react_context_argument',node_id:sourceNode.id});
          edits.push({start:sourceNode.start+location.end,end:sourceNode.start+location.end,text:')',kind:'react_context_argument',node_id:sourceNode.id});
        }
      } else if (transform.transform === 'context_read') {
        const inputNode = nodeById.get(transform.input_node_id);
        if (!inputNode || inputNode.file !== file || inputNode.start < sourceNode.start
            || inputNode.end > sourceNode.end) {
          localDiagnostics.push({ code: 'unsupported_react_context_read_instrumentation', file,
            node_id: transform.node_id,
            message: 'The exact context argument source occurrence is unavailable.' });
          continue;
        }
        edits.push({ start: sourceNode.start, end: sourceNode.start,
          text: lifecycleWrap(transform.key, 'contextResult'), kind: 'react_context_read',
          node_id: transform.node_id });
        edits.push({ start: sourceNode.end, end: sourceNode.end, text: ')',
          kind: 'react_context_read', node_id: transform.node_id });
        edits.push({ start: inputNode.start, end: inputNode.start,
          text: lifecycleWrap(transform.key, 'contextInput'), kind: 'react_context_read',
          node_id: transform.node_id });
        edits.push({ start: inputNode.end, end: inputNode.end, text: ')',
          kind: 'react_context_read', node_id: transform.node_id });
      } else if (transform.transform === 'context_provider') {
        const opening = openingInsertion(sourceNode.text);
        if (!opening) {
          localDiagnostics.push({ code: 'unsupported_react_context_provider_instrumentation', file,
            node_id: transform.node_id,
            message: 'The context Provider source occurrence is not stampable JSX.' });
          continue;
        }
        const insert = sourceNode.start + opening.insertion;
        edits.push({ start: insert, end: insert,
          text: ` __producttraceProvider=${JSON.stringify(transform.key)}`,
          kind: 'react_context_provider', node_id: transform.node_id });
      } else if (transform.transform === 'context_consumer_callback') {
        const location = consumerCallbackLocation(sourceNode.text);
        if (!location) {
          localDiagnostics.push({ code: 'unsupported_react_context_consumer_instrumentation', file,
            node_id: transform.node_id,
            message: 'The context Consumer source occurrence has no singular callback expression.' });
          continue;
        }
        edits.push({ start: sourceNode.start + location.start, end: sourceNode.start + location.start,
          text: lifecycleWrap(transform.key, 'callback'), kind: 'react_context_consumer_callback',
          node_id: transform.node_id });
        edits.push({ start: sourceNode.start + location.end, end: sourceNode.start + location.end,
          text: ')', kind: 'react_context_consumer_callback', node_id: transform.node_id });
      } else if (transform.transform === 'event_callback') {
        const location = handlerExpression(sourceNode.text, transform.event);
        if (!location) {
          localDiagnostics.push({ code: 'unsupported_react_event_callback_instrumentation', file,
            node_id: transform.node_id,
            message: 'The runtime-selected React event callback has no singular JSX expression.' });
          continue;
        }
        edits.push({ start: sourceNode.start + location.start, end: sourceNode.start + location.start,
          text: lifecycleWrap(transform.key, 'eventCallback'), kind: 'react_event_callback',
          node_id: transform.node_id });
        edits.push({ start: sourceNode.start + location.end, end: sourceNode.start + location.end,
          text: ')', kind: 'react_event_callback', node_id: transform.node_id });
      } else if (transform.transform === 'callback_source_tag') {
        const locations = callbackSourceTagLocations(file, source, sourceNode);
        if (!locations) {
          localDiagnostics.push({ code: 'unsupported_react_callback_source_tag', file,
            node_id: transform.node_id,
            message: 'The dynamic callback candidate cannot be tagged without changing its source semantics.' });
          continue;
        }
        const readers=(transform.captures || []).flatMap(capture=>{
          const read=nodeById.get(capture.read_id);
          return read && /^[A-Za-z_$][\w$]*$/u.test(read.text)?[`[${JSON.stringify(capture.binding_id)}, () => ${read.text}]`]:[];
        });
        const captureArgument=`, ${transform.captures ? `() => [${readers.join(',')}]` : 'null'}, ${JSON.stringify(locations.inferredName || null)}`;
        if (locations.declaration) {
          edits.push({ start: locations.declaration.insertion, end: locations.declaration.insertion,
            text: `;${lifecycleGlobal}.tagSource(${JSON.stringify(transform.handler_source_id)}, ${locations.declaration.name}${captureArgument});`,
            kind: 'react_callback_source_tag', node_id: transform.node_id });
        } else {
          edits.push({ start: locations.expression.start, end: locations.expression.start,
            text: `${lifecycleGlobal}.tagSource(${JSON.stringify(transform.handler_source_id)}, `,
            kind: 'react_callback_source_tag', node_id: transform.node_id });
          edits.push({ start: locations.expression.end, end: locations.expression.end, text: `${captureArgument})`,
            kind: 'react_callback_source_tag', node_id: transform.node_id });
        }
      }
      applied.push({ file, node_id: transform.node_id, event: 'react_lifecycle', control_id: null,
        transform: `react_${transform.transform}` });
    }
    const ordered = [...targets.values()].sort((left, right) => right.source.start - left.source.start);
    for (const target of ordered) {
      const exact = source.slice(target.source.start, target.source.end);
      if (exact !== target.source.text) {
        localDiagnostics.push({ code: 'source_node_mismatch', file, node_id: target.source.node_id,
          message: 'The source node no longer matches the analyzed offsets; no stamps were added to it.' });
        continue;
      }
      const opening = target.source.kind === 'call' ? null : openingInsertion(exact);
      const config = target.source.kind === 'call'
        ? createElementConfigInsertion(exact, target.stamp_config_argument) : null;
      if (!opening && !config) {
        localDiagnostics.push({ code: 'unsupported_stamp_target', file, node_id: target.source.node_id,
          message: 'The selected source node is not stampable JSX or a createElement call with an explicit object-literal config.' });
        continue;
      }
      const attributes = [];
      for (const stamp of target.stamps.sort((a, b) => a.event.localeCompare(b.event))) {
        const attribute = `data-producttrace-control-${stamp.event}`;
        if (opening ? new RegExp(`\\b${attribute}\\s*=`).test(opening.opening) : config.names.has(attribute)) {
          localDiagnostics.push({ code: 'existing_source_stamp', file, node_id: target.source.node_id,
            message: `The source element already defines ${attribute}; it was not replaced.` });
          continue;
        }
        const candidate = candidates.find(value => value.control_id === stamp.control_id);
        attributes.push(opening ? ` ${attribute}="${candidate.selector.sourceControl}"`
          : `${JSON.stringify(attribute)}:${JSON.stringify(candidate.selector.sourceControl)},`);
        applied.push({ file, node_id: target.source.node_id, event: stamp.event,
          control_id: stamp.control_id, transform: 'source_stamp' });
      }
      if (attributes.length) {
        const insert = target.source.start + (opening?.insertion ?? config.insertion);
        edits.push({ start: insert, end: insert, text: attributes.join(''), kind: 'source_stamp',
          node_id: target.source.node_id });
      }
    }

    if (options.requestBridge && !stampsOnly) {
      for (const candidate of requestBridgeCandidates) {
        if (candidate.source?.file !== file) continue;
        const exact = source.slice(candidate.source.start, candidate.source.end);
        const expression = handlerExpression(exact, candidate.selector.event);
        if (!expression) {
          localDiagnostics.push({ code: 'unsupported_request_bridge_handler', file,
            node_id: candidate.source.node_id,
            message: 'The exact JSX event expression could not be wrapped for request-context propagation.' });
          continue;
        }
        const metadata = JSON.stringify({ action: candidate.action,
          requests: candidate.path.outbound_requests.map(request => ({
            contract_application_id: request.contract_application_id,
            method: request.effect.method,
          })) });
        const original = expression.text;
        const replacement = `(globalThis.__productTraceRequestBridge ? (...__productTraceArgs) => globalThis.__productTraceRequestBridge.begin(${metadata}, () => (${original})(...__productTraceArgs)) : (${original}))`;
        edits.push({ start: candidate.source.start + expression.start,
          end: candidate.source.start + expression.end, text: replacement,
          kind: 'request_bridge_handler', node_id: candidate.source.node_id });
        applied.push({ file, node_id: candidate.source.node_id, event: candidate.selector.event,
          control_id: candidate.control_id, transform: 'request_bridge_handler' });
      }

      const requestTargets = new Map();
      for (const candidate of requestBridgeCandidates) for (const request of candidate.path.outbound_requests) {
        const sourceNode = nodeById.get(request.invocation_call_id);
        if (!sourceNode || sourceNode.file !== file) continue;
        const values = requestTargets.get(sourceNode.id) || { sourceNode, requests: [] };
        values.requests.push({ action: candidate.action,
          contract_application_id: request.contract_application_id,
          method: request.effect.method });
        requestTargets.set(sourceNode.id, values);
      }
      for (const { sourceNode, requests } of requestTargets.values()) {
        const original = source.slice(sourceNode.start, sourceNode.end);
        if (original !== sourceNode.text) {
          localDiagnostics.push({ code: 'source_node_mismatch', file, node_id: sourceNode.id,
            message: 'The outbound request call no longer matches the analyzed offsets; it was not wrapped.' });
          continue;
        }
        const uniqueRequests = [...new Map(requests.map(request => [
          `${request.action}\0${request.contract_application_id}`, request,
        ])).values()];
        const metadata = JSON.stringify({ requests: uniqueRequests });
        const configured = configureRequestCall(original, uniqueRequests);
        const replacement = `(globalThis.__productTraceRequestBridge ? globalThis.__productTraceRequestBridge.request(${metadata}, () => (${configured})) : (${original}))`;
        edits.push({ start: sourceNode.start, end: sourceNode.end, text: replacement,
          kind: 'request_bridge_request', node_id: sourceNode.id });
        applied.push({ file, node_id: sourceNode.id, event: 'request', control_id: null,
          transform: 'request_bridge_request' });
      }
    }

    const replacements = edits.filter(edit => edit.end > edit.start).sort((left, right) =>
      left.start - right.start || right.end - left.end);
    const rejected = new Set();
    for (let index = 0; index < replacements.length; index++) {
      for (let other = index + 1; other < replacements.length
        && replacements[other].start < replacements[index].end; other++) {
        rejected.add(replacements[index]);
        rejected.add(replacements[other]);
      }
    }
    for (const edit of rejected) localDiagnostics.push({ code: 'overlapping_request_bridge_transform',
      file, node_id: edit.node_id,
      message: 'Nested handler and request call transforms overlap, so neither was applied.' });
    const acceptedEdits = edits.filter(edit => !rejected.has(edit)).sort((left, right) =>
      right.start - left.start || right.end - left.end
      // At adjacent JSX siblings, applying the next opening first leaves the
      // previous closing before it after both insertions at the same offset.
      || (Number.isInteger(left.boundary_order) && Number.isInteger(right.boundary_order)?left.boundary_order-right.boundary_order:0)
      // Shared source tags wrap the factory, while concise-body closings go
      // inside it. Insertion order is reversed in the resulting source text.
      || (left.insertion_order||0)-(right.insertion_order||0));
    let code = source;
    for (const edit of acceptedEdits) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
    const rejectedNodeIds = new Set([...rejected].map(edit => edit.node_id));
    return { code, applied: applied.filter(row => !rejectedNodeIds.has(row.node_id)),
      diagnostics: localDiagnostics };
  }

  function join(record) {
    if (!record) return null;
    const workflow = record.kind === 'workflow_event' && record.schema === 'producttrace.workflow-event.v1';
    const rawAction = record.kind === 'action';
    if (!workflow && !rawAction) return null;
    const checkpoint = workflow ? record.properties?.checkpoint : record;
    if (!checkpoint) return null;
    const occurrence = workflow
      ? (typeof record.event_id === 'string' && record.event_id && typeof record.workflow_id === 'string' && record.workflow_id
        ? { event_id: record.event_id, workflow_id: record.workflow_id, session: record.session_id || null, seq: null } : null)
      : (typeof record.session === 'string' && record.session && Number.isSafeInteger(record.seq)
        ? { event_id: `${record.session}:action:${record.seq}`, workflow_id: null, session: record.session, seq: record.seq } : null);
    const evidenceIds = workflow ? checkpoint.evidence?.ids : [];
    const reactIdentity = workflow ? checkpoint.react_identity : record.react_identity;
    const reactLifecycleIdentity = workflow ? checkpoint.react_lifecycle_identity
      : record.react_lifecycle_identity;
    const actionOccurrenceId = workflow
      ? (typeof checkpoint.action_occurrence_id === 'string' && checkpoint.action_occurrence_id
        ? checkpoint.action_occurrence_id : null)
      : occurrence?.event_id || null;
    if (!occurrence) {
      return { schema: JOIN_SCHEMA, status: 'unresolved', reason: 'missing_runtime_occurrence',
        map_fingerprint: map.fingerprint,
        runtime: { event_id: null, action_occurrence_id: actionOccurrenceId,
          workflow_id: record.workflow_id || null, session: record.session || record.session_id || null,
          seq: Number.isSafeInteger(record.seq) ? record.seq : null, evidence_ids: Array.isArray(evidenceIds) ? evidenceIds : [] }, source: null };
    }
    if (workflow && (!Array.isArray(evidenceIds) || evidenceIds.length === 0 || evidenceIds.some(id => typeof id !== 'string' || !id))) {
      return { schema: JOIN_SCHEMA, status: 'unresolved', reason: 'missing_runtime_evidence',
        map_fingerprint: map.fingerprint, runtime: { ...occurrence, action_occurrence_id: actionOccurrenceId, evidence_ids: [] }, source: null };
    }
    if (reactIdentity != null && !(reactIdentity && reactIdentity.runtime_observed === true
        && reactIdentity.basis === 'react-devtools-commit.v1'
        && ['root_id','instance_id','mount_id','commit_id'].every(key =>
          typeof reactIdentity[key] === 'string' && reactIdentity[key].length > 0)
        && reactIdentity.render_observed === false && reactIdentity.render_id === null)) {
      return { schema: JOIN_SCHEMA, status: 'unresolved', reason: 'invalid_react_runtime_identity',
        map_fingerprint: map.fingerprint,
        runtime: { ...occurrence, action_occurrence_id: actionOccurrenceId,
          evidence_ids: workflow ? evidenceIds : [], react_identity: null }, source: null };
    }
    const lifecycleSource = reactLifecycleIdentity && map.react_semantics.find(source =>
      source.call_id === reactLifecycleIdentity.source_call_id
      && source.semantic_id === reactLifecycleIdentity.semantic_id
      && (source.causal_bindings?.owner_source_id || source.causal_bindings?.wrapper_render?.source_id || null)
        === (reactLifecycleIdentity.owner_source_id || null));
    if (reactLifecycleIdentity != null && !(lifecycleSource
        && reactLifecycleIdentity.runtime_observed === true
        && reactLifecycleIdentity.basis === 'react-lifecycle-render.v1'
        && reactLifecycleIdentity.status === 'committed'
        && ['session','root_id','instance_id','mount_id','render_id'].every(key =>
          typeof reactLifecycleIdentity[key] === 'string' && reactLifecycleIdentity[key].length > 0)
        && (occurrence.session == null || occurrence.session === reactLifecycleIdentity.session))) {
      return { schema: JOIN_SCHEMA, status: 'unresolved', reason: 'invalid_react_lifecycle_identity',
        map_fingerprint: map.fingerprint,
        runtime: { ...occurrence, action_occurrence_id: actionOccurrenceId,
          evidence_ids: workflow ? evidenceIds : [], react_identity: reactIdentity ? copy(reactIdentity) : null,
          react_lifecycle_identity: null }, source: null };
    }
    const action = workflow ? checkpoint.source_action : checkpoint.action;
    const candidate = typeof action === 'string' ? candidateByAction.get(action) : null;
    if (!candidate) {
      return {
        schema: JOIN_SCHEMA,
        status: 'unresolved',
        reason: typeof action === 'string' ? 'unknown_source_action' : 'missing_source_action',
        map_fingerprint: map.fingerprint,
        runtime: { ...occurrence, action_occurrence_id: actionOccurrenceId, evidence_ids: workflow ? evidenceIds : [] },
        source: null,
      };
    }
    const observedSourceControl = workflow
      ? (checkpoint.source_control || checkpoint.control?.source_control)
      : record.target?.source_control;
    if (observedSourceControl !== candidate.selector.sourceControl) {
      return {
        schema: JOIN_SCHEMA, status: 'unresolved', reason: 'runtime_source_control_mismatch',
        map_fingerprint: map.fingerprint,
        runtime: { ...occurrence, action_occurrence_id: actionOccurrenceId, evidence_ids: workflow ? evidenceIds : [] }, source: null,
      };
    }
    const runtimeEvent = workflow ? checkpoint.trigger?.event : record.event;
    if (runtimeEvent !== candidate.selector.event) {
      return {
        schema: JOIN_SCHEMA, status: 'unresolved', reason: 'runtime_event_mismatch',
        map_fingerprint: map.fingerprint,
        runtime: { ...occurrence, action_occurrence_id: actionOccurrenceId, evidence_ids: workflow ? evidenceIds : [] }, source: null,
      };
    }
    const boundaryRefs=workflow?checkpoint.react_boundaries:record.react_boundaries;
    const boundarySelections=candidate.conditions.filter(condition=>condition.react_boundary_input).map(condition=>{
      const matches=(Array.isArray(boundaryRefs)?boundaryRefs:[]).flatMap(reference=>{
        const proof=observedBoundaryCommits.get(reference?.observation_id);
        return proof&&proof.runtime.session===occurrence.session&&proof.source.source_call_id===condition.source_call_id
          &&proof.source.semantic_id===condition.semantic_id&&reactIdentity
          &&reference.root_id===reactIdentity.root_id&&reference.commit_id===reactIdentity.commit_id
          &&proof.runtime.renderer.root_id===reference.root_id&&proof.runtime.renderer.commit_id===reference.commit_id?[{reference,proof}]:[];
      });
      const match=matches.length===1?matches[0]:null;
      const proven=match&&match.proof.runtime.selection.selection===condition.react_boundary_input;
      return {condition_id:condition.node_id,source_call_id:condition.source_call_id,input:condition.react_boundary_input,
        status:proven?'resolved':'unresolved',reason:proven?null:matches.length>1?'boundary_ancestry_ambiguous':match?'boundary_selection_disagrees':'boundary_commit_ancestry_required',
        observation_id:proven?match.reference.observation_id:null,claim:proven?'observed_clicked_boundary_input':null};
    });
    const portalRefs=workflow?checkpoint.react_portals:record.react_portals;
    const portalSelections=candidate.conditions.filter(condition=>Number.isSafeInteger(condition.react_portal_input)).map(condition=>{
      const matches=(Array.isArray(portalRefs)?portalRefs:[]).flatMap(reference=>{
        const proof=observedPortalCommits.get(reference?.observation_id);
        return proof&&proof.runtime.session===occurrence.session&&proof.source.source_call_id===condition.node_id
          &&reactIdentity&&reference.root_id===reactIdentity.root_id&&reference.commit_id===reactIdentity.commit_id
          &&proof.runtime.renderer.root_id===reference.root_id&&proof.runtime.renderer.commit_id===reference.commit_id?[{reference,proof}]:[];
      });
      const match=matches.length===1?matches[0]:null;
      return {condition_id:condition.node_id,input:condition.react_portal_input,status:match?'resolved':'unresolved',
        reason:match?null:matches.length>1?'portal_ancestry_ambiguous':'portal_commit_ancestry_required',
        observation_id:match?match.reference.observation_id:null,claim:match?'observed_clicked_portal_child':null};
    });
    return {
      schema: JOIN_SCHEMA,
      status: 'resolved',
      reason: null,
      map_fingerprint: map.fingerprint,
      runtime: { ...occurrence, action_occurrence_id: actionOccurrenceId,
        evidence_ids: workflow ? evidenceIds : [], react_identity: reactIdentity ? copy(reactIdentity) : null,
        react_lifecycle_identity: reactLifecycleIdentity ? copy(reactLifecycleIdentity) : null,
        boundary_selections:boundarySelections,portal_selections:portalSelections,
        remaining_conditions:candidate.conditions.filter(condition=>
          !boundarySelections.some(proof=>proof.status==='resolved'&&proof.condition_id===condition.node_id&&proof.source_call_id===condition.source_call_id&&proof.input===condition.react_boundary_input)
          &&!portalSelections.some(proof=>proof.status==='resolved'&&proof.condition_id===condition.node_id&&proof.input===condition.react_portal_input)).map(copy) },
      source: {
        control_id: candidate.control_id,
        scenario_id: candidate.scenario_id,
        placement_id: candidate.placement_id,
        handler_ids: [...candidate.handler_ids],
        conditions: candidate.conditions.map(condition => ({ ...condition })),
        path: copy(candidate.path),
        owner: candidate.owner ? { ...candidate.owner } : null,
        node: candidate.source ? { node_id: candidate.source.node_id, file: candidate.source.file,
          start: candidate.source.start, end: candidate.source.end, file_sha256: candidate.source.file_sha256 } : null,
      },
      evidence: { basis: 'instrumented_source_control', selector: { ...candidate.selector }, source_action: action },
    };
  }

  const lifecycleSession = createReactLifecycleEvidenceSession(map,{wrapperEntries:lifecycleEntries,resolveCallbackSource:id=>callbackOrigins.get(id)});
  const stateRequestsByScope=new Map(),stateCommitsByRequest=new Map();
  const refSession=createReactRefEvidenceSession({fingerprint:map.fingerprint,entries:lifecycleEntries});
  const refCallbacks=new Map();
  const handleValueOrigins=new Map();
  const storeNotificationActions=new Map(),transitionResults=new Map();
  const joinRef=record=>{
    const joined=refSession.join(record);if(joined.status!=='resolved')return joined;
    const action=record.action,callback=action?refCallbacks.get(action.callback_observation_id):null;
    const observed=action?observedActions.get(action.action_occurrence_id):null,entry=lifecycleEntryByKey.get(record.manifest_key);
    const linked=callback && observed && !observed.conflicting && callback.action_occurrence_id===action.action_occurrence_id
      && callback.scenario_id===action.scenario_id && observed.scenario_id===action.scenario_id
      && observed.control_id===action.control_id && entry.ref_access?.scenario_ids.includes(action.scenario_id);
    joined.runtime.action_link=linked?{status:'resolved',...copy(action)}:{status:action?'unresolved':'not_applicable',reason:action?'ref_action_path_unproven':null};
    if(record.operation==='read' && record.outcome==='returned' && ['object','function'].includes(record.value.kind)
        && record.value_identity_scope==='react-value.v1') {
      const origins=handleValueOrigins.get(`${record.session}\0${record.value.identity}`)||[];
      const origin=origins.length===1?origins[0]:null;
      joined.runtime.handle_provenance=origin && origin.runtime.handle_factory.value_kind===record.value.kind
        ?{status:'resolved',claim:'same_observed_handle_object',factory_observation_id:origin.observation_id,
          invocation_id:origin.runtime.handle_factory.invocation_id,source_call_id:origin.source.call_id,
          instance_id:origin.runtime.instance_id,render_id:origin.runtime.render_id,value_identity:record.value.identity,
          ref_assignment_proven:false}
        :{status:'unresolved',reason:!origins.length?'handle_result_unobserved':origins.length>1?'handle_result_origin_ambiguous':'handle_result_kind_mismatch'};
    }
    if(record.operation==='invoke') {
      const target=record.callback,origin=target?callbackOrigins.get(target.source_observation_id):null;
      if(!target)joined.runtime.callback_path={status:'unresolved',reason:'ref_callable_source_unobserved'};
      else if(record.callee?.kind!=='function' || !origin || origin.session!==record.session
        || origin.source_id!==target.source_id || origin.callback_identity_id!==target.callback_identity_id
        || !entry.ref_callback_candidates.some(row=>row.source_id===target.source_id))
        return {...joined,status:'unresolved',reason:'ref_callable_origin_required',runtime_observed:false,source:null,runtime:null};
      else joined.runtime.callback_path={status:'resolved',...copy(target),
        source_edge_ids:map.edges.filter(edge=>edge.ref_access_id===entry.ref_access.source_id && edge.to===target.source_id && (!linked || edge.scenario_id===action.scenario_id)).map(edge=>edge.id),
        claim:'observed_call_target',body_execution_proven:false};
    }
    return joined;
  };
  const predicateCalls=new Map(),predicateUses=new Set(),predicateScopes=new Set();
  function joinPredicateUse(record){
    const result=checkReactPredicateUse(record,predicateCalls.get(`${record?.session}\0${record?.source_frame_id}\0${record?.source_call_id}`),
      {fingerprint:map.fingerprint,entry:lifecycleEntryByKey.get(record?.manifest_key)});
    if(result.status==='resolved'){
      if(predicateUses.has(record.observation_id))return {schema:result.schema,status:'unresolved',reason:'duplicate_predicate_use',runtime_observed:false};
      predicateUses.add(record.observation_id);
    }
    return result;
  }
  const memoCallbackObservations = new Map();
  const hosts=createReactHostEvidenceSession({fingerprint:map.fingerprint,entries:lifecycleEntries,resolveAction:action=>{
    const callback=refCallbacks.get(action.callback_observation_id),observed=observedActions.get(action.action_occurrence_id);
    return callback&&callback.action_occurrence_id===action.action_occurrence_id&&observed&&!observed.conflicting
      ?{...action,scenario_id:callback.scenario_id,control_id:observed.control_id}:null;
  }});
  const classes=createReactClassEvidenceSession({fingerprint:map.fingerprint,entries:lifecycleEntries,resolveAction:action=>{
    const callback=refCallbacks.get(action.callback_observation_id),observed=observedActions.get(action.action_occurrence_id);
    return callback&&callback.action_occurrence_id===action.action_occurrence_id&&observed&&!observed.conflicting?{...action,scenario_id:callback.scenario_id,control_id:observed.control_id}:null;
  }});
  const classUpdates=createReactClassUpdateEvidenceSession({fingerprint:map.fingerprint,entries:lifecycleEntries,resolveInstance:classes.resolveInstance,resolveAction:action=>{
    const callback=refCallbacks.get(action.callback_observation_id),observed=observedActions.get(action.action_occurrence_id);
    return callback&&callback.action_occurrence_id===action.action_occurrence_id&&observed&&!observed.conflicting?{...action,scenario_id:callback.scenario_id,control_id:observed.control_id}:null;
  }});
  const servers=createReactServerEvidenceSession({fingerprint:map.fingerprint,entries:lifecycleEntries});
  const observedBoundaries=new Map(),observedBoundaryCommits=new Map();
  const profilerStarts=new Map(),profilerEnds=new Map(),profilerCommits=new Set();
  function joinProfiler(record){
    const result=checkReactProfilerRecord(record,{fingerprint:map.fingerprint,entry:lifecycleEntryByKey.get(record?.manifest_key),
      callbackEntry:lifecycleEntryByKey.get(record?.callback_manifest_key),start:profilerStarts.get(record?.invocation_id),
      end:profilerEnds.get(record?.invocation_id),boundary:observedBoundaryCommits.get(record?.boundary_observation_id)});
    if(result.status==='resolved'){
      const cache=record.operation==='callback_started'?profilerStarts:record.operation==='callback_finished'?profilerEnds:profilerCommits;
      const key=record.operation==='callback_started'?record.observation_id:record.invocation_id;
      if(cache.has(key))return {status:'unresolved',reason:'profiler_duplicate_occurrence',runtime_observed:false};
      if(cache instanceof Set)cache.add(key);else cache.set(key,copy(record));
    }
    return result;
  }
  const strictReplays=new Map(),strictReplayEnds=new Set();
  function joinStrictReplay(record){
    const result=checkReactStrictReplay(record,{fingerprint:map.fingerprint,entry:lifecycleEntryByKey.get(record?.manifest_key),
      origin:observedBoundaries.get(record?.origin_observation_id),start:strictReplays.get(record?.replay_id)});
    if(result.status==='resolved'){
      if(strictReplays.has(record.observation_id))return {schema:result.schema,status:'unresolved',reason:'duplicate_strict_replay',runtime_observed:false};
      if(record.operation==='finished'){if(strictReplayEnds.has(record.replay_id))return {schema:result.schema,status:'unresolved',reason:'duplicate_strict_replay_end',runtime_observed:false};strictReplayEnds.add(record.replay_id);}
      strictReplays.set(record.observation_id,copy(result));
    }
    return result;
  }
  function joinBoundaryCommit(record){
    const result=checkReactBoundaryCommit(record,observedBoundaries.get(record?.origin_observation_id),lifecycleEntryByKey.get(record?.manifest_key),{fingerprint:map.fingerprint,resolvePrevious:id=>observedBoundaryCommits.get(id)});
    if(result.status==='resolved'){
      if(observedBoundaryCommits.has(record.observation_id))return {schema:result.schema,status:'unresolved',reason:'duplicate_boundary_commit',runtime_observed:false};
      observedBoundaryCommits.set(record.observation_id,copy(result));
    }
    return result;
  }
  const observedIdUses=new Map(),observedIdCommits=new Set();
  function joinIdCommit(record){
    const owner=record?.owner,ownerKnown=owner&&sharedCommittedOwners.get([record.session,owner.root_id,owner.instance_id,owner.mount_id].join('\0'))===owner.render_id;
    const result=checkReactIdCommit(record,observedIdUses.get(record?.use_observation_id),{fingerprint:map.fingerprint,ownerKnown});
    if(result.status==='resolved'){
      if(observedIdCommits.has(record.observation_id))return {schema:result.schema,status:'unresolved',reason:'duplicate_id_commit',runtime_observed:false};
      observedIdCommits.add(record.observation_id);
    }
    return result;
  }
  const observedRootCleanups=new Map();
  const roots=createReactRootEvidenceSession({fingerprint:map.fingerprint,entries:lifecycleEntries,resolveCleanup:id=>observedRootCleanups.get(id)});
  const observedRootOperations=new Map(),observedRootOperationJoins=new Map(),observedRootCommits=new Set();
  function joinRoot(record){
    const result=roots.join(record);
    if(result.status==='resolved'){observedRootOperations.set(record.observation_id,copy(record));observedRootOperationJoins.set(record.observation_id,copy(result));}
    return result;
  }
  function joinRootCommit(record){
    const result=checkReactRootCommit(record,observedRootOperations.get(record?.origin_observation_id),observedRootOperationJoins.get(record?.origin_observation_id),
      lifecycleEntryByKey.get(record?.manifest_key),{fingerprint:map.fingerprint});
    if(result.status==='resolved'){
      if(observedRootCommits.has(record.observation_id))return {schema:result.schema,status:'unresolved',reason:'duplicate_root_commit',runtime_observed:false};
      observedRootCommits.add(record.observation_id);
    }
    return result;
  }
  function joinRootRecovery(record){
    return checkReactRootRecovery(record,observedRootOperations.get(record?.origin_observation_id),observedRootOperationJoins.get(record?.origin_observation_id),
      lifecycleEntryByKey.get(record?.manifest_key),{fingerprint:map.fingerprint});
  }
  const elements=createReactElementEvidenceSession({fingerprint:map.fingerprint,entries:lifecycleEntries,rendererKnown:record=>{
    const owner=record.renderer;if(!owner||typeof owner.render_id!=='string')return false;
    return sharedCommittedOwners.get([record.session,owner.root_id,owner.instance_id,owner.mount_id].join('\0'))===owner.render_id;
  }});
  const observedElementJoins=new Map(),observedLazyCommits=new Set();
  function joinElement(record){
    const result=elements.join(record);
    if(result.status==='resolved'&&!observedElementJoins.has(record.observation_id))observedElementJoins.set(record.observation_id,copy(result));
    return result;
  }
  function joinLazyCommit(record){
    const result=checkReactLazyCommit(record,{fingerprint:map.fingerprint,entry:lifecycleEntryByKey.get(record?.manifest_key),
      allocation:observedElementJoins.get(record?.allocation_observation_id),loader:observedElementJoins.get(record?.loader_observation_id),
      settlement:observedElementJoins.get(record?.settlement_observation_id),fallback:observedBoundaryCommits.get(record?.fallback_boundary_commit_observation_id),
      reveal:observedBoundaryCommits.get(record?.reveal_boundary_commit_observation_id)});
    if(result.status==='resolved'){
      if(observedLazyCommits.has(record.observation_id))return {schema:result.schema,status:'unresolved',reason:'duplicate_lazy_commit',runtime_observed:false};
      observedLazyCommits.add(record.observation_id);
    }
    return result;
  }
  const portals=createReactPortalEvidenceSession({fingerprint:map.fingerprint,entries:lifecycleEntries});
  const observedPortals=new Map(),observedPortalCommits=new Map();
  function joinPortalCommit(record){
    const result=checkReactPortalCommit(record,observedPortals.get(record?.origin_observation_id),lifecycleEntryByKey.get(record?.manifest_key),
      {fingerprint:map.fingerprint,resolveCommit:id=>observedPortalCommits.get(id)});
    if(result.status==='resolved'){
      if(observedPortalCommits.has(record.observation_id))return {schema:result.schema,status:'unresolved',reason:'duplicate_portal_commit',runtime_observed:false};
      observedPortalCommits.set(record.observation_id,copy(result));
    }
    return result;
  }
  const observedActions=new Map();
  const sharedSelections=new Map(),sharedBodies=new Set(),sharedCommittedOwners=new Map();
  const sharedMountKey=record=>[record.session,record.root_id,record.instance_id,record.mount_id].join('\0');
  function joinSharedCallback(record) {
    const fail=reason=>({schema:'producttrace.react-shared-callback-join.v1',status:'unresolved',reason,
      observation_id:record?.observation_id,runtime_observed:false,source:null,runtime:null});
    const scoped=value=>typeof value==='string' && value.startsWith(record.session+':') && value!==record.session+':';
    if(record?.schema!=='producttrace.react-shared-callback.v1' || record.kind!=='react_shared_callback'
      || record.runtime_observed!==true || typeof record.session!=='string' || !record.session
      || record.map_fingerprint!==map.fingerprint || !scoped(record.observation_id)
      || record.occurrence_id!==record.observation_id+':occurrence' || !Array.isArray(record.evidence_ids)
      || !record.evidence_ids.every(scoped) || !record.evidence_ids.includes(record.observation_id)
      || !scoped(record.callback_identity_id))return fail('invalid_shared_callback_observation');
    const entry=lifecycleEntryByKey.get(record.manifest_key);
    if(entry?.kind!=='shared_retained_body' || entry.callback_source_id!==record.callback_source_id)
      return fail('shared_callback_body_source_mismatch');
    const validValue=value=>value && (value.encoding==='redacted' && value.value===null
      || value.encoding==='opaque_identity' && scoped(value.value)
      || value.encoding==='primitive' && (value.value===null || ['string','boolean'].includes(typeof value.value) || typeof value.value==='number' && Number.isFinite(value.value)));
    if(!(entry.body_kind==='factory' && record.arguments===null && record.arguments_observed===false)
      && !(entry.body_kind!=='factory' && record.arguments_observed===true && Array.isArray(record.arguments)
        && record.arguments.every(arg=>arg && scoped(arg.value_id) && validValue(arg.value)))
      || !Array.isArray(record.captured_values) || record.captured_values.some(row=>!row)
      || JSON.stringify(record.captured_values.map(row=>row.binding_id).sort())!==JSON.stringify(entry.captures.map(row=>row.binding_id).sort())
      || !record.captured_values.every(value=>validValue(value)
        && entry.captures.some(capture=>capture.binding_id===value.binding_id)))return fail('shared_callback_values_invalid');
    if(sharedBodies.has(record.observation_id))return fail('duplicate_shared_callback_body');
    const selection=sharedSelections.get(record.selection_observation_id),action=record.action;
    const callback=action && refCallbacks.get(action.callback_observation_id),observed=action && observedActions.get(action.action_occurrence_id);
    const owner=observed?.react_lifecycle_identity;
    if(!selection || selection.record.session!==record.session || !owner || observed.conflicting
      || !callback || callback.action_occurrence_id!==action.action_occurrence_id
      || callback.scenario_id!==observed.scenario_id || !scoped(action.action_occurrence_id)
      || callback.callee_identity_id!==record.callback_identity_id
      || selection.record.callback_identity_id!==record.callback_identity_id
      || selection.record.callback_source_id!==record.callback_source_id
      || !callback.retained_producer_call_ids?.includes(selection.record.source_call_id)
      || callback.handler_source_id!==record.callback_source_id
      || !['session','root_id','instance_id','mount_id','render_id'].every(field=>selection.record[field]===owner[field])
      || sharedCommittedOwners.get(sharedMountKey(selection.record))!==selection.record.render_id)
      return fail('shared_callback_owner_unproven');
    if(record.reason!=null)return fail('shared_callback_probe_unresolved');
    sharedBodies.add(record.observation_id);
    return {schema:'producttrace.react-shared-callback-join.v1',status:'resolved',reason:null,
      observation_id:record.observation_id,runtime_observed:true,
      source:{callback_source_id:entry.callback_source_id,source_call_id:selection.record.source_call_id,scenario_id:observed.scenario_id},
      runtime:{claim:'observed_selected_callback_body',body_execution_proven:true,direct_renderer_dispatch_proven:false,
        callback_completion_proven:false,creation_render_proven:false,selection:copy(selection.result.runtime),
        action:copy(action),arguments:copy(record.arguments),arguments_observed:record.arguments_observed,captured_values:copy(record.captured_values)}};
  }

  const callbackOrigins=new Map(),callbackSourceByIdentity=new Map();
  const scopeSources=new Map(lifecycleEntries.flatMap(entry=>[...(entry.scope_callback_candidates||[]),...(entry.ref_callback_candidates||[]),...(entry.memo_callback_candidates||[])].map(row=>[row.source_id,row])));
  function joinCallbackSource(record) {
    const fail=reason=>({schema:'producttrace.react-callback-source-join.v1',status:'unresolved',reason,runtime_observed:false,source:null,runtime:null});
    if(record?.schema!=='producttrace.react-callback-source.v1' || record.kind!=='react_callback_source'
      || record.runtime_observed!==true)return fail('invalid_callback_source_observation');
    if(record.map_fingerprint!==map.fingerprint)return fail('map_fingerprint_mismatch');
    if(!scopeSources.has(record.source_id))return fail('callback_source_not_indexed');
    if(typeof record.session!=='string' || !record.session || typeof record.callback_identity_id!=='string'
      || !record.callback_identity_id.startsWith(record.session+':') || typeof record.observation_id!=='string'
      || !record.observation_id.startsWith(record.session+':') || record.occurrence_id!==record.observation_id+':occurrence'
      || !Array.isArray(record.evidence_ids) || !record.evidence_ids.includes(record.observation_id))return fail('callback_source_identity_required');
    const previous=callbackOrigins.get(record.observation_id),source=callbackSourceByIdentity.get(record.callback_identity_id);
    if(previous && (previous.source_id!==record.source_id || previous.callback_identity_id!==record.callback_identity_id)
      || source && source!==record.source_id)return fail('callback_source_identity_conflict');
    callbackOrigins.set(record.observation_id,{source_id:record.source_id,callback_identity_id:record.callback_identity_id,session:record.session});
    callbackSourceByIdentity.set(record.callback_identity_id,record.source_id);
    return {schema:'producttrace.react-callback-source-join.v1',status:'resolved',reason:null,runtime_observed:true,
      source:{source_id:record.source_id},runtime:{observation_id:record.observation_id,callback_identity_id:record.callback_identity_id}};
  }

  function lifecycleBoundaryProof(record){
    const boundary=record?.suspense_boundary;
    if(!['render_attempted','render_committed','render_abandoned'].includes(record?.operation)||boundary===undefined)return null;
    const fail=reason=>({status:'rejected',reason});
    if(boundary?.status==='unresolved'){
      if(!['boundary_input_origin_limit','suspense_render_origin_unresolved','suspense_render_ancestry_incomplete','suspense_render_identity_unresolved'].includes(boundary.reason))
        return fail('suspense_render_frontier_invalid');
      return {status:'unresolved',reason:boundary.reason,claim:'suspense_render_source_unresolved'};
    }
    if(boundary?.status!=='source_resolved')return fail('suspense_render_boundary_status_required');
    const entry=lifecycleEntryByKey.get(boundary.manifest_key),origin=observedBoundaries.get(boundary.origin_observation_id);
    if(entry?.semantic_id!=='react/Suspense/18.3.1'||entry.source_call_id!==boundary.source_call_id
      ||entry.semantic_id!==boundary.semantic_id||origin?.session!==record.session
      ||origin?.manifest_key!==boundary.manifest_key||origin?.source_call_id!==boundary.source_call_id
      ||origin?.semantic_id!==boundary.semantic_id||origin?.boundary_input?.identity!==boundary.input_identity
      ||boundary.renderer!==null&&(!['root_id','instance_id','mount_id'].every(key=>typeof boundary.renderer?.[key]==='string'&&boundary.renderer[key])
        ||boundary.renderer.root_id!==record.root_id))
      return fail('suspense_render_origin_required');
    const retainedFields=[boundary.retained_commit_observation_id,boundary.retained_origin_observation_id,boundary.retained_selection];
    const retainedPresent=retainedFields.every(value=>value!=null),retainedAbsent=retainedFields.every(value=>value==null);
    if(!retainedPresent&&!retainedAbsent)return fail('suspense_retained_commit_pair_required');
    let retained=null;
    if(retainedPresent){
      if(!boundary.renderer)return fail('suspense_retained_commit_required');
      const prior=observedBoundaryCommits.get(boundary.retained_commit_observation_id);
      if(prior?.status!=='resolved'||prior.runtime.session!==record.session
        ||prior.runtime.origin_observation_id!==boundary.retained_origin_observation_id
        ||prior.runtime.origin_observation_id===boundary.origin_observation_id
        ||prior.runtime.selection.selection!==boundary.retained_selection
        ||!['root_id','instance_id','mount_id'].every(key=>prior.runtime.renderer[key]===boundary.renderer[key]))
        return fail('suspense_retained_commit_required');
      retained={status:'resolved',claim:'observed_previous_commit_on_same_suspense_mount',
        commit_observation_id:boundary.retained_commit_observation_id,
        origin_observation_id:boundary.retained_origin_observation_id,selection:boundary.retained_selection};
    }
    if(boundary.commit_observation_id==null||boundary.selection==null){
      if(boundary.commit_observation_id!==null||boundary.selection!==null)return fail('suspense_render_commit_pair_required');
      return {status:'source_resolved',claim:'observed_render_under_exact_suspense_source',
        origin_observation_id:boundary.origin_observation_id,input_identity:boundary.input_identity,
        renderer:boundary.renderer?copy(boundary.renderer):null,
        boundary_mount_status:boundary.renderer?'observed':'unobserved',commit_status:'unobserved',selection:null,retained_commit:retained};
    }
    if(!boundary.renderer)return fail('suspense_render_commit_required');
    const commit=observedBoundaryCommits.get(boundary.commit_observation_id);
    if(commit?.status!=='resolved'||commit.runtime.session!==record.session
      ||commit.runtime.origin_observation_id!==boundary.origin_observation_id
      ||commit.runtime.input_identity!==boundary.input_identity
      ||!['root_id','instance_id','mount_id'].every(key=>commit.runtime.renderer[key]===boundary.renderer[key])
      ||commit.runtime.selection.selection!==boundary.selection)
      return fail('suspense_render_commit_required');
    if(record.operation==='render_committed'&&boundary.selection!=='children')
      return fail('committed_render_requires_visible_boundary_children');
    return {status:'resolved',claim:'observed_render_under_exact_suspense_commit',
      origin_observation_id:boundary.origin_observation_id,input_identity:boundary.input_identity,
      commit_observation_id:boundary.commit_observation_id,selection:boundary.selection,
      renderer:copy(boundary.renderer),retained_commit:retained,
      outcome:record.operation==='render_abandoned'?'attempt_abandoned_after_boundary_commit'
        :record.operation==='render_committed'?'render_committed_with_boundary_children':'render_attempt_observed_after_boundary_commit'};
  }
  function joinLifecycle(record) {
    const boundaryProof=lifecycleBoundaryProof(record);
    if(boundaryProof?.status==='rejected')return {schema:'producttrace.react-lifecycle-join.v1',status:'unresolved',
      reason:boundaryProof.reason,claim:'runtime_observation_rejected',runtime_observed:false,map_fingerprint:map.fingerprint,
      observation_id:record?.observation_id||null,source:null,runtime:null};
    const result=lifecycleSession.join(record);
    if(result.status==='resolved'&&boundaryProof)result.runtime.suspense_boundary=copy(boundaryProof);
    if(result.status==='resolved' && record.operation==='state_requested')for(const sourceScope of record.source_scopes||[]) {
      const key=`${record.session}\0${sourceScope.scope_id}`,rows=stateRequestsByScope.get(key)||[];
      rows.push({request_id:record.request_id,request_observation_id:record.observation_id,
        callback_invocation_id:sourceScope.callback_invocation_id,scheduling:sourceScope.scheduling,
        action_occurrence_id:record.action_occurrence_id||null,seq:record.seq});
      stateRequestsByScope.set(key,rows);
    }
    if(result.status==='resolved' && record.operation==='state_committed')for(const update of record.committed_updates||[]) {
      stateCommitsByRequest.set(`${record.session}\0${update.request_id}`,{
        request_id:update.request_id,commit_observation_id:record.observation_id,
        render_id:record.render_id,state_identity_id:record.state_identity_id,
        value:copy(record.value),selection_basis:record.selection_basis,seq:record.seq,
      });
    }
    if(result.status==='resolved'&&record.strict_replay_id){
      const scope=strictReplays.get(record.strict_replay_id),owner=scope?.runtime?.owner;
      const matches=scope?.runtime.operation==='started'&&scope.runtime.session===record.session
        &&['render_attempted','render_committed','render_abandoned'].includes(record.operation)
        &&['root_id','instance_id','mount_id'].every(key=>record[key]===owner?.[key]);
      result.runtime.development_replay=matches?{status:'resolved',claim:'owner_render_observed_in_strict_replay',
        replay_id:record.strict_replay_id,boundary_source_call_id:scope.source.source_call_id,effect_rehearsal_proven:false}
        :{status:'unresolved',reason:'strict_replay_owner_scope_required'};
    }
    if(result.status==='resolved'&&record.operation==='id_used')observedIdUses.set(record.observation_id,copy(result));
    if(result.status==='resolved'&&record.operation==='cleanup_invoked'&&record.root_operation_id)observedRootCleanups.set(record.observation_id,copy(record));
    if(result.status==='resolved' && record.operation==='shared_callback_selected') {
      const entry=lifecycleEntries.find(entry=>entry.kind==='shared_retained_result'
        && entry.source_call_id===record.source_call_id && entry.callback_source_id===record.callback_source_id);
      if(entry)sharedSelections.set(record.observation_id,{record:copy(record),result:copy(result)});
    }
    if(result.status==='resolved' && record.operation==='render_committed')sharedCommittedOwners.set(sharedMountKey(record),record.render_id);
    if(result.status==='resolved' && record.operation==='unmounted')sharedCommittedOwners.delete(sharedMountKey(record));
    if(result.status==='resolved' && record.operation==='transition_result')transitionResults.set(record.observation_id,{record:copy(record),result:copy(result)});
    if(result.status==='resolved' && record.operation==='store_listener_invoked') {
      const action=record.action,callback=action?refCallbacks.get(action.callback_observation_id):null;
      const observed=action?observedActions.get(action.action_occurrence_id):null;
      const linked=callback && observed && !observed.conflicting
        && action.action_occurrence_id.startsWith(`${record.session}:`)
        && callback.action_occurrence_id===action.action_occurrence_id && callback.scenario_id===action.scenario_id
        && observed.scenario_id===action.scenario_id && observed.control_id===action.control_id;
      const proof=linked?{status:'resolved',claim:'synchronous_dom_callback_scope',...copy(action)}
        :{status:action?'unresolved':'not_applicable',reason:action?'store_action_callback_unproven':null};
      result.runtime.external_store.action_link=proof;storeNotificationActions.set(record.invocation_id,proof);
    }
    if(result.status==='resolved' && record.operation==='store_snapshot_observed' && record.notification_invocation_id)
      result.runtime.external_store.action_link=copy(storeNotificationActions.get(record.notification_invocation_id)
        || {status:'unresolved',reason:'store_notification_action_unobserved'});
    if(result.status==='resolved' && record.operation==='handle_produced') {
      const key=`${record.session}\0${record.value_id}`,origins=handleValueOrigins.get(key)||[];
      origins.push(copy(result));handleValueOrigins.set(key,origins);
    }
    if(result.status==='resolved' && record.operation==='memo_callback_invoked') {
      memoCallbackObservations.set(record.observation_id,result);
    }
    return result;
  }

  function joinCallback(record) {
    const unresolved = reason => ({
      schema: 'producttrace.react-callback-join.v1', status: 'unresolved', reason,
      map_fingerprint: map.fingerprint,
      observation_id: typeof record?.observation_id === 'string' ? record.observation_id : null,
      runtime_observed: Boolean(record?.runtime_observed), source: null,
    });
    if (!record || record.schema !== 'producttrace.react-callback-observation.v1'
        || record.kind !== 'react_callback') return unresolved('invalid_callback_observation_schema');
    if (record.map_fingerprint !== map.fingerprint) return unresolved('map_fingerprint_mismatch');
    if (typeof record.observation_id !== 'string' || !record.observation_id
        || typeof record.occurrence_id !== 'string' || !record.occurrence_id
        || !Array.isArray(record.evidence_ids) || record.evidence_ids.length === 0
        || record.evidence_ids.some(value => typeof value !== 'string' || !value)
        || record.runtime_observed !== true) return unresolved('runtime_callback_evidence_required');
    const entry = lifecycleEntries.find(value => value.kind === 'event_callback'
      && value.control_id === record.control_id && value.binding_id === record.binding_id
      && value.event === record.event);
    if (!entry) return unresolved('callback_binding_occurrence_mismatch');
    const expectedCandidates = entry.scenario_options.map(option => option.handler_source_id);
    if (!Array.isArray(record.candidate_source_ids)
        || JSON.stringify(record.candidate_source_ids) !== JSON.stringify(expectedCandidates)) {
      return unresolved('callback_candidate_set_mismatch');
    }
    if (record.status !== 'resolved') return unresolved(record.reason || 'runtime_callback_source_unidentified');
    if (typeof record.action_occurrence_id !== 'string' || !record.action_occurrence_id) {
      return unresolved('callback_action_occurrence_required');
    }
    const matches = entry.scenario_options.filter(option => option.handler_source_id === record.selected_source_id
      && option.scenario_id === record.selected_scenario_id);
    if (matches.length !== 1) return unresolved('callback_source_scenario_mismatch');
    const scenario = map.scenarios.find(value => value.id === matches[0].scenario_id
      && value.control_id === entry.control_id);
    if (!scenario) return unresolved('callback_source_scenario_mismatch');
    if(matches[0].retained_producer_call_ids?.length && (typeof record.session!=='string' || !record.session
      || typeof record.callee_identity_id!=='string' || !record.callee_identity_id.startsWith(record.session+':')
      || record.callee_identity_id===record.session+':'))return unresolved('callback_callee_identity_required');
    let memo=null;
    if(matches[0].memo_producer_call_ids?.length) {
      memo=memoCallbackObservations.get(record.memo_observation_id);
      if(!memo || !matches[0].memo_producer_call_ids.includes(memo.source.call_id)
        || memo.runtime.callback_source_id!==record.selected_source_id
        || memo.runtime.action_occurrence_id!==record.action_occurrence_id) {
        return unresolved('memo_callback_runtime_lineage_required');
      }
    }
    return {
      schema: 'producttrace.react-callback-join.v1', status: 'resolved', reason: null,
      map_fingerprint: map.fingerprint, observation_id: record.observation_id,
      runtime_observed: true,
      source: { control_id: entry.control_id, binding_id: entry.binding_id,
        handler_source_id: matches[0].handler_source_id, scenario_id: matches[0].scenario_id,
        conditions: copy(matches[0].conditions), claim: 'source_contract', runtime_observed: false },
      runtime: { occurrence_id: record.occurrence_id,
        action_occurrence_id: record.action_occurrence_id,
        callee_identity_id:record.callee_identity_id || null,
        retained_producer_call_ids:copy(matches[0].retained_producer_call_ids || []),
        evidence_ids: [...record.evidence_ids],
        ...(memo ? {memo_callback:copy(memo)} : {}),
        react_identity: record.react_identity ? copy(record.react_identity) : null },
    };
  }

  function joinApi(record) {
    const unresolved = reason => ({
      schema: 'producttrace.react-api-join.v1', status: 'unresolved', reason,
      map_fingerprint: map.fingerprint,
      observation_id: typeof record?.observation_id === 'string' ? record.observation_id : null,
      runtime_observed: false, source: null, runtime: null,
    });
    if (!record || record.schema !== 'producttrace.react-api-observation.v1'
        || record.kind !== 'react_api') return unresolved('invalid_api_observation_schema');
    if (record.map_fingerprint !== map.fingerprint) return unresolved('map_fingerprint_mismatch');
    if (typeof record.observation_id !== 'string' || !record.observation_id
        || typeof record.occurrence_id !== 'string' || !record.occurrence_id
        || !Array.isArray(record.evidence_ids) || record.evidence_ids.length === 0
        || record.evidence_ids.some(value => typeof value !== 'string' || !value)
        || !record.evidence_ids.includes(record.observation_id)
        || record.occurrence_id !== `${record.observation_id}:occurrence`
        || typeof record.result_kind !== 'string' || !record.result_kind
        || record.runtime_observed !== true || !['invoked','read','threw','element_created'].includes(record.operation)) {
      return unresolved('runtime_api_evidence_required');
    }
    const entry = lifecycleEntryByKey.get(record.manifest_key);
    if (!entry || !['api_call','api_value','api_boundary'].includes(entry.kind)
        || record.operation !== (entry.kind==='api_boundary'?'element_created':entry.kind === 'api_call' ? 'invoked' : 'read') && !((entry.scope_rule || entry.predicate_rule || entry.children_rule) && record.operation==='threw')
        || entry.source_call_id !== record.source_call_id
        || entry.semantic_id !== record.semantic_id
        || entry.surface !== record.surface || entry.export !== record.export) {
      return unresolved('api_source_occurrence_mismatch');
    }
    let childrenProof=null;
    if(entry.children_rule){
      childrenProof=checkReactChildrenEvidence(entry,record);if(childrenProof.status!=='resolved')return unresolved(childrenProof.reason);
      const actionId=record.scope.action_occurrence_id,action=actionId?observedActions.get(actionId):null;
      const linked=action && !action.conflicting && scopeCallScenarios.get(entry.source_call_id)?.has(action.scenario_id);
      childrenProof.action_link=linked?{status:'resolved',action_occurrence_id:actionId,control_id:action.control_id,scenario_id:action.scenario_id}
        :{status:actionId?'unresolved':'not_applicable',reason:actionId?'children_action_path_unproven':null};
      childrenProof.observed_callback_edges=record.scope.callbacks.map(row=>({from:entry.source_call_id,to:row.source_id,invocation_id:row.invocation_id,runtime_observed:true,
        source_paths:copy(scopeForwardEdges.get(`${entry.source_call_id}\0${row.source_id}`)||[])}));
    }
    let debugValueProof=null;
    if(entry.debug_value_rule) {
      if(!validateReactExecutionRule(entry.debug_value_rule).valid)return unresolved('debug_value_rule_invalid');
      debugValueProof={claim:'observed_api_return_with_conditional_debug_semantics',observed_result_kind:record.result_kind,
        standard_renderer:planDebugValue(entry.debug_value_rule,{build:'development',dispatcher:'standard_renderer'}),
        production:planDebugValue(entry.debug_value_rule,{build:'production'}),
        selected_execution_context:null,formatter_execution_proven:false,
        frontier:'debug_build_and_dispatcher_unobserved'};
    }
    let boundaryProof=null;
    if(entry.boundary_rule) {
      const actual=record.boundary_value,rule=entry.boundary_rule;
      const usage=entry.kind==='api_boundary'?'element_created':'read';
      if(entry.kind==='api_call' || !actual || actual.reason || actual.usage!==usage
        || actual.value_type!==rule.value_type || actual.marker!==rule.marker
        || usage==='element_created' && (actual.element_marker!==rule.element_marker || record.result_kind!=='object')
        || usage==='read' && record.result_kind!==rule.value_type)return unresolved('boundary_value_mismatch');
      boundaryProof={claim:usage==='element_created'?'observed_boundary_element_description':'observed_boundary_type_value',
        source_element_id:entry.element_source_id,marker:actual.marker,renderer_execution_proven:false,
        callbacks_executed_proven:false,host_commit_proven:false};
    }
    let scopeProof=null;
    if(entry.scope_rule) {
      let transitionOrigin=null;
      if(entry.transition_hook_call_id) {
        const target=record.scope?.transition_target,origin=transitionResults.get(target?.observation_id);
        if(!origin || target.session!==record.session || origin.record.session!==record.session
          || origin.record.source_call_id!==entry.transition_hook_call_id || target.source_call_id!==entry.transition_hook_call_id
          || origin.record.start_identity_id!==target.start_identity_id)return unresolved('transition_start_origin_unobserved');
        transitionOrigin={observation_id:target.observation_id,start_identity_id:target.start_identity_id,
          root_id:origin.record.root_id,instance_id:origin.record.instance_id,mount_id:origin.record.mount_id,
          hook_slot_id:origin.record.hook_slot_id,render_id:origin.record.render_id,mount_liveness_proven:false,update_commit_attribution_proven:false};
      }
      scopeProof=checkReactScopeEvidence(entry.scope_rule,record.scope,{sourceId:entry.scope_callback_source_id,sourceIds:[...new Set([entry.scope_callback_source_id,...entry.scope_callback_candidates.map(row=>row.source_id)].filter(Boolean))],inputIndices:entry.scope_input_indices});
      if(scopeProof.status!=='resolved')return unresolved(scopeProof.reason);
      // These identities are minted by one recording. A changed envelope must
      // not carry another session's callback, values, or click into this join.
      const scoped=id=>typeof record.session==='string' && record.session.length>0 && typeof id==='string'
        && id.startsWith(record.session+':') && id.length>record.session.length+1;
      const values=[...Object.values(record.scope.inputs),record.scope.result,
        ...record.scope.callbacks.flatMap(row=>[...row.arguments,row.result])];
      const occurrenceIds=[record.observation_id,...record.evidence_ids,record.scope.scope_id,
        ...[record.scope.parent_scope_id,record.scope.action_occurrence_id].filter(value=>value!=null),
        ...record.scope.callbacks.flatMap(row=>[row.invocation_id,...[row.callback_identity_id,row.source_observation_id].filter(value=>value!=null)]),
        ...values.map(value=>value.identity)];
      if(!occurrenceIds.every(scoped))return unresolved('scope_session_identity_mismatch');
      const descriptions=new Map();
      for(const value of values){
        const previous=descriptions.get(value.identity);
        if(previous && ['kind','encoding','value','truthy'].some(key=>!Object.is(previous[key],value[key])))return unresolved('scope_value_identity_conflict');
        descriptions.set(value.identity,value);
      }
      if(record.operation!==(record.scope.outcome==='threw'?'threw':'invoked') || record.result_kind!==record.scope.result.kind)return unresolved('scope_api_result_mismatch');
      const selected=record.scope.callbacks[0];
      if(selected && selected.source_id!==entry.scope_callback_source_id) {
        const origin=callbackOrigins.get(selected.source_observation_id);
        if(!origin || origin.session!==record.session || origin.source_id!==selected.source_id
          || origin.callback_identity_id!==selected.callback_identity_id
          || selected.callback_identity_id!==record.scope.inputs[entry.scope_rule.callback_argument].identity)return unresolved('scope_callback_origin_required');
      }
      if(transitionOrigin)scopeProof.transition_origin=transitionOrigin;
      scopeProof.argument_branch=entry.scope_argument_path_incomplete?'unproven':'source_candidates';
      scopeProof.observed_callback_edge=selected?{from:entry.transition_start_source_id||entry.source_call_id,to:selected.source_id,
        invocation_id:selected.invocation_id,source_observation_id:selected.source_observation_id||null,runtime_observed:true}:null;
      const actionId=record.scope.action_occurrence_id,action=actionId?observedActions.get(actionId):null;
      const linked=action && !action.conflicting && scopeCallScenarios.get(entry.transition_start_source_id||entry.source_call_id)?.has(action.scenario_id);
      scopeProof.action_link=linked?{status:'resolved',action_occurrence_id:actionId,control_id:action.control_id,scenario_id:action.scenario_id,react_identity:action.react_identity}
        :{status:actionId?'unresolved':'not_applicable',reason:actionId?(action?'scope_action_path_unproven':'scope_action_observation_required'):null};
      const callbackInvocations=new Set(record.scope.callbacks.map(callback=>callback.invocation_id));
      const scopeRequests=(stateRequestsByScope.get(`${record.session}\0${record.scope.scope_id}`)||[]).filter(request=>
        callbackInvocations.has(request.callback_invocation_id)
        && request.scheduling===scopeProof.scheduling.kind
        && request.action_occurrence_id===(record.scope.action_occurrence_id||null)
        && Number.isSafeInteger(request.seq) && Number.isSafeInteger(record.seq) && request.seq<record.seq);
      const committed=scopeRequests.flatMap(request=>{
        const commit=stateCommitsByRequest.get(`${record.session}\0${request.request_id}`);
        if(!commit || !Number.isSafeInteger(commit.seq) || commit.seq<=request.seq)return [];
        return [{...commit,request_observation_id:request.request_observation_id,
          callback_invocation_id:request.callback_invocation_id,
          timing:commit.seq<record.seq?'before_scope_return':'after_scope_return'}];
      });
      scopeProof.scheduling={...scopeProof.scheduling,
        claim:committed.length?'observed_scoped_state_commit':'conditional_source_contract',
        state_requests_observed:scopeRequests.length,
        commit_observed:committed.length>0,
        committed_state_updates:committed,
        priority_effect_proven:false};
      if(transitionOrigin)transitionOrigin.update_commit_attribution_proven=committed.length>0;
      const allowed=new Set((entry.scope_callback_candidates.find(row=>row.source_id===selected?.source_id)?.captures||entry.scope_captures).map(row=>row.binding_id));
      if(record.scope.callbacks.some(row=>!Array.isArray(row.captured_values) || row.captured_values.some(value=>!value || !allowed.has(value.binding_id)
        || !['primitive','redacted'].includes(value.encoding) || (value.encoding==='redacted'?value.value!==null
          :value.value!==null && !(['string','boolean'].includes(typeof value.value) || typeof value.value==='number' && Number.isFinite(value.value))))))return unresolved('scope_capture_binding_mismatch');
    }
    if(entry.literal_export_rule) {
      const expected=predictLiteralExport(entry.literal_export_rule,{build:record.export_build});
      if(expected.status!=='predicted')return unresolved(expected.reason);
      if(record.result_kind!=='string' || record.export_value?.encoding!=='primitive'
        || record.export_value.value!==expected.value)return unresolved('literal_export_value_mismatch');
    }
    let predicateProof=null;
    if(entry.predicate_rule) {
      let callProof=null;
      if(record.scope || record.operation==='threw') {
        callProof=checkReactPredicateEvidence(entry.predicate_rule,record.scope,{inputIndices:entry.predicate_input_indices||[]});
        if(callProof.status!=='resolved')return unresolved(callProof.reason);
        if(record.operation!==(callProof.outcome==='threw'?'threw':'invoked') || record.result_kind!==record.scope.result.kind)return unresolved('predicate_call_outcome_mismatch');
      }
      const threw=callProof?.outcome==='threw';
      if(!threw && (record.result_kind!=='boolean' || record.predicate_result?.encoding!=='primitive'
        || typeof record.predicate_result.value!=='boolean' || callProof && callProof.value!==record.predicate_result.value))return unresolved('predicate_boolean_result_required');
      const branch=threw?null:record.predicate_result.value?'truthy':'falsy';
      // Only discharge the condition supplied by this exact call expression.
      // Other guards remain obligations; a selected edge is not a target call.
      const candidates=(threw?[]:predicateEdgesByCall.get(entry.source_call_id)||[]).filter(row=>row.condition.branch===(row.inverted?(branch==='truthy'?'falsy':'truthy'):branch))
        .map(({edge,condition,inverted})=>({...copy(edge),predicate_condition:{...copy(condition),inverted},
          remaining_conditions:copy(edge.conditions.filter(other=>other.node_id!==condition.node_id)),
          claim:'source_path_selected_by_observed_result',target_execution_observed:false}));
      predicateProof={outcome:threw?'threw':'returned',...(threw?{exception:copy(callProof.exception)}:{value:record.predicate_result.value}),
        ...(callProof?{call:copy(record.scope),marker_read_required:callProof.marker_read_required,marker_read_separately_observed:false}:{}),
        branch,condition_call_id:entry.source_call_id,
        candidates,frontier:threw?'predicate_property_read_origin_unobserved':candidates.length?null:'predicate_result_consumer_unresolved',
        input_property_effects:'ordinary_get_may_invoke_user_code',target_execution_observed:false};
    }
    return {
      schema: 'producttrace.react-api-join.v1', status: 'resolved', reason: null,
      map_fingerprint: map.fingerprint, observation_id: record.observation_id,
      runtime_observed: true,
      source: { semantic_application_id: entry.semantic_application_id,
        source_call_id: entry.source_call_id, semantic_id: entry.semantic_id,
        surface: entry.surface, export: entry.export, disposition: entry.disposition,
        ...(scopeProof?{callback_paths:copy(scopeForwardEdges.get(`${entry.transition_start_source_id||entry.source_call_id}\0${record.scope.callbacks[0]?.source_id||entry.scope_callback_source_id}`)||[])}:{}),
        claim: 'source_contract', runtime_observed: false },
      runtime: { occurrence_id: record.occurrence_id, operation: record.operation,
        session: record.session || null, seq: Number.isSafeInteger(record.seq) ? record.seq : null,
        evidence_ids: [...record.evidence_ids], result_kind: record.result_kind || 'unknown',
        ...(scopeProof?{scope:copy(record.scope),scope_proof:scopeProof}:{}),
        ...(predicateProof?{predicate_proof:predicateProof}:{}),
        ...(boundaryProof?{boundary_proof:boundaryProof}:{}),
        ...(debugValueProof?{debug_value_proof:debugValueProof}:{}),
        ...(childrenProof?{children_proof:childrenProof}:{}),
        ...(entry.literal_export_rule?{export_value:copy(record.export_value),export_build:record.export_build||null}:{}),
        react_lifecycle_identity: record.react_lifecycle_identity ? copy(record.react_lifecycle_identity) : null },
    };
  }

  function createApiRuntime(runtimeOptions = {}) {
    const session = typeof runtimeOptions.session === 'string' && runtimeOptions.session
      ? runtimeOptions.session : `react-api-${Date.now().toString(36)}`;
    const onObservation = typeof runtimeOptions.onObservation === 'function'
      ? runtimeOptions.onObservation : () => {};
    let sequence = 0, scopeSequence = 0;
    const valueObjects=new WeakMap();
    const objectIdentity=value=>{let id=valueObjects.get(value);if(!id){id=`${session}:value:${++scopeSequence}`;valueObjects.set(value,id);}return id;};
    const observe = (key, value, expectedKind, operation, scope=null) => {
      const entry = lifecycleEntryByKey.get(key);
      if (!entry || entry.kind !== expectedKind) return value;
      const seq = ++sequence;
      const observationId = `${session}:react-api:${seq}`;
      onObservation({ schema: 'producttrace.react-api-observation.v1', kind: 'react_api',
        map_fingerprint: map.fingerprint, manifest_key: key,
        observation_id: observationId, occurrence_id: `${observationId}:occurrence`,
        evidence_ids: [observationId], source_call_id: entry.source_call_id,
        semantic_id: entry.semantic_id, surface: entry.surface, export: entry.export,
        operation,...(scope?{scope}:{}), result_kind: scope?scope.result.kind:value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
        ...(entry.literal_export_rule?{export_build:process.env.NODE_ENV==='production'?'production':'development',export_value:typeof value==='string'?{encoding:'primitive',value}:{encoding:'redacted',value:null}}:{}),
        ...(entry.predicate_rule && operation!=='threw'?{predicate_result:typeof value==='boolean'?{encoding:'primitive',value}:{encoding:'redacted',value:null}}:{}),
        ...(entry.boundary_rule?{boundary_value:readReactBoundaryValue(entry.boundary_rule,value,operation)}:{}),
        runtime_observed: true, session, seq, react_lifecycle_identity: null });
      return value;
    };
    const scopes=createReactScopeObserver({entry:key=>lifecycleEntryByKey.get(key),enabled:()=>true,
      context:()=>session,observeOrigin:record=>onObservation({schema:'producttrace.react-callback-source.v1',kind:'react_callback_source',
        runtime_observed:true,map_fingerprint:map.fingerprint,session,occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record}),
      id:kind=>`${session}:${kind}:${++scopeSequence}`,encode:value=>value===null || ['string','boolean'].includes(typeof value) || typeof value==='number' && Number.isFinite(value)
        ?{encoding:'primitive',value}:{encoding:'redacted',value:null},
      captures:readers=>typeof readers==='function'?readers().map(([binding_id,read])=>({binding_id,encoding:'redacted',value:null})):[],
      observe:(key,value,operation,scope)=>observe(key,value,'api_call',operation,scope)});
    const classRuntime=createReactClassObserver({entry:key=>lifecycleEntryByKey.get(key),enabled:()=>true,context:()=>session,
      observeUpdate:record=>{const entry=lifecycleEntryByKey.get(record.manifest_key);onObservation({schema:'producttrace.react-class-update-observation.v1',kind:'react_class_update',map_fingerprint:map.fingerprint,
        source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,session,seq:++sequence,runtime_observed:true,occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});},
      id:kind=>`${session}:${kind}:${++scopeSequence}`,encode:value=>value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value)
        ?{encoding:'primitive',value}:{encoding:'redacted',value:null},observe:record=>{const entry=lifecycleEntryByKey.get(record.manifest_key);
        onObservation({schema:'producttrace.react-class-observation.v1',kind:'react_class',map_fingerprint:map.fingerprint,
          source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,session,seq:++sequence,runtime_observed:true,
          occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});}});
    const hostRuntime=createReactHostObserver({entry:key=>lifecycleEntryByKey.get(key),enabled:()=>true,context:()=>session,
      id:kind=>`${session}:${kind}:${++scopeSequence}`,encode:value=>value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value)
        ?{encoding:'primitive',value}:{encoding:'redacted',value:null},inspect:value=>value==null?{evidence:{kind:'nullish'}}:null,
      observe:record=>{const entry=lifecycleEntryByKey.get(record.manifest_key);
        onObservation({schema:'producttrace.react-host-observation.v1',kind:'react_host',map_fingerprint:map.fingerprint,
          source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,session,seq:++sequence,runtime_observed:true,
          occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});}});
    const serverContext=new AsyncLocalStorage();
    const serverRuntime=createReactServerObserver({asyncContextBasis:'node-async-local-storage.v1',runInContext:(frame,run)=>serverContext.run(frame,run),currentContext:()=>serverContext.getStore(),entry:key=>lifecycleEntryByKey.get(key),enabled:()=>true,context:()=>session,
      id:kind=>`${session}:${kind}:${++scopeSequence}`,encode:value=>value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value)
        ?{encoding:'primitive',value}:{encoding:'redacted',value:null},observe:record=>{const entry=lifecycleEntryByKey.get(record.manifest_key);
        onObservation({schema:'producttrace.react-server-observation.v1',kind:'react_server',map_fingerprint:map.fingerprint,
          source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,session,seq:++sequence,runtime_observed:true,
          occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});}});
    const rootRuntime=createReactRootObserver({entry:key=>lifecycleEntryByKey.get(key),enabled:()=>true,context:()=>session,
      id:kind=>`${session}:${kind}:${++scopeSequence}`,encode:value=>value===null || ['string','boolean'].includes(typeof value) || typeof value==='number' && Number.isFinite(value)
        ?{encoding:'primitive',value}:{encoding:'redacted',value:null},observe:record=>{const entry=lifecycleEntryByKey.get(record.manifest_key);
        onObservation({schema:'producttrace.react-root-observation.v1',kind:'react_root',map_fingerprint:map.fingerprint,
          source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,session,seq:++sequence,runtime_observed:true,
          occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});},observeCommit:record=>{const entry=lifecycleEntryByKey.get(record.manifest_key);
        onObservation({schema:'producttrace.react-root-commit.v1',kind:'react_root_commit',map_fingerprint:map.fingerprint,
          source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,session,seq:++sequence,runtime_observed:true,
          occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});},observeRecovery:record=>{const entry=lifecycleEntryByKey.get(record.manifest_key);
        onObservation({schema:'producttrace.react-root-recovery.v1',kind:'react_root_recovery',map_fingerprint:map.fingerprint,
          source_call_id:entry?.source_call_id||record.source_call_id,semantic_id:entry?.semantic_id||record.semantic_id,session,seq:++sequence,runtime_observed:true,
          occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});}});
    const elementRuntime=createReactElementObserver({entry:key=>lifecycleEntryByKey.get(key),enabled:()=>true,context:()=>session,objectIdentity,
      id:kind=>`${session}:${kind}:${++scopeSequence}`,encode:value=>value===null || ['string','boolean'].includes(typeof value) || typeof value==='number' && Number.isFinite(value)
        ?{encoding:'primitive',value}:{encoding:'redacted',value:null},observe:record=>{const entry=lifecycleEntryByKey.get(record.manifest_key);
        onObservation({schema:'producttrace.react-element-observation.v1',kind:'react_element',map_fingerprint:map.fingerprint,
          source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,session,seq:++sequence,runtime_observed:true,
          build:process.env.NODE_ENV==='production'?'production':'development',
          occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});}});
    const portalRuntime=createReactPortalObserver({entry:key=>lifecycleEntryByKey.get(key),enabled:()=>true,
      id:kind=>`${session}:${kind}:${++scopeSequence}`,encode:value=>value===null || ['string','boolean'].includes(typeof value) || typeof value==='number' && Number.isFinite(value)
        ?{encoding:'primitive',value}:{encoding:'redacted',value:null},observe:record=>{const entry=lifecycleEntryByKey.get(record.manifest_key);
        onObservation({schema:'producttrace.react-portal-observation.v1',kind:'react_portal',map_fingerprint:map.fingerprint,
          source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,session,seq:++sequence,runtime_observed:true,
          occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});}});
    const refs=createReactRefObserver({entry:key=>lifecycleEntryByKey.get(key),enabled:()=>true,context:()=>session,objectIdentity,
      describeSource:scopes.describeSource,
      id:kind=>`${session}:${kind}:${++scopeSequence}`,encode:value=>value===null || ['string','boolean'].includes(typeof value) || typeof value==='number' && Number.isFinite(value)
        ?{encoding:'primitive',value}:{encoding:'redacted',value:null},observe:record=>{
        const entry=lifecycleEntryByKey.get(record.manifest_key);
        onObservation({schema:'producttrace.react-ref-observation.v1',kind:'react_ref',runtime_observed:true,
          map_fingerprint:map.fingerprint,session,seq:++sequence,source_call_id:entry.source_call_id,
          source_access_id:entry.ref_access?.source_id||null,semantic_id:entry.semantic_id,surface:entry.surface,export:entry.export,
          build:process.env.NODE_ENV==='production'?'production':'development',occurrence_id:record.observation_id+':occurrence',
          evidence_ids:[record.observation_id],...record});}});
    const contexts=createReactContextObserver({entry:key=>lifecycleEntryByKey.get(key),enabled:()=>true,context:()=>session,
      id:kind=>`${session}:${kind}:${++scopeSequence}`,encode:value=>value===null || ['string','boolean'].includes(typeof value) || typeof value==='number' && Number.isFinite(value)
        ?{encoding:'primitive',value}:{encoding:'redacted',value:null},observe:record=>{
        const entry=lifecycleEntryByKey.get(record.manifest_key);onObservation({schema:'producttrace.react-context-origin.v1',kind:'react_context_origin',
          map_fingerprint:map.fingerprint,source_call_id:entry.source_call_id,source_context_id:entry.context_id,semantic_id:entry.semantic_id,
          session,seq:++sequence,runtime_observed:true,occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record});}});
    const profilerIdentities=new WeakMap();
    const profilerIdentity=value=>{if(!profilerIdentities.has(value))profilerIdentities.set(value,`${session}:profiler-value:${++scopeSequence}`);return profilerIdentities.get(value);};
    const profilerRuntime=createReactProfilerObserver({context:()=>session,enabled:()=>true,id:kind=>`${session}:${kind}:${++scopeSequence}`,
      identity:profilerIdentity,value:value=>value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value)
        ?{encoding:'primitive',value}:typeof value==='object'||typeof value==='function'?{encoding:'identity',value:profilerIdentity(value)}:{encoding:'redacted',value:null},
      observe:record=>onObservation({schema:'producttrace.react-profiler.v1',kind:'react_profiler',runtime_observed:true,session,
        map_fingerprint:map.fingerprint,occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id],...record})});
    const predicates=createReactPredicateUseObserver({context:()=>session,enabled:()=>true,
      entry:key=>lifecycleEntryByKey.get(key),scopeCall:scopes.scopeCall,id:kind=>`${session}:${kind}:${++scopeSequence}`,
      observe:record=>onObservation({...record,session,map_fingerprint:map.fingerprint,
        occurrence_id:record.observation_id+':occurrence',evidence_ids:[record.observation_id]})});
    return { ...predicates,...classRuntime,...hostRuntime,...serverRuntime,...rootRuntime,...scopes,...refs,...contexts,...elementRuntime,...portalRuntime,registerContext:(key,value)=>value,schema: 'producttrace.react-api-runtime.v1', session,
      profilerDefine:(key,factory,name)=>{
        const entry=lifecycleEntryByKey.get(key);
        if(entry?.kind==='profiler_callback')return profilerRuntime.define(entry,factory,name);
        const fn=factory((args,body)=>body());if(name&&!fn.name)Object.defineProperty(fn,'name',{value:name,configurable:true});return fn;
      },
      boundaryResult:(key,value)=>observe(key,value,'api_boundary','element_created'),
      apiResult: (key, value) => observe(key, value, 'api_call', 'invoked'),
      apiValue: (key, value) => observe(key, value, 'api_value', 'read') };
  }

  function joinFrontier(record) {
    const entry=lifecycleEntryByKey.get(record?.manifest_key);
    const valid=record?.schema==='producttrace.react-frontier.v1' && record.kind==='react_frontier'
      && record.runtime_observed===true && record.map_fingerprint===map.fingerprint
      && entry?.kind==='context_consumer_callback' && entry.source_call_id===record.source_call_id
      && entry.callback_source_id===record.callback_source_id && record.reason==='consumer_render_owner_unobserved'
      && record.operation==='callback_invoked' && typeof record.session==='string' && record.session.length>0
      && typeof record.observation_id==='string' && record.observation_id.startsWith(record.session+':')
      && record.occurrence_id===record.observation_id+':occurrence' && Array.isArray(record.evidence_ids)
      && record.evidence_ids.includes(record.observation_id);
    return {schema:'producttrace.react-frontier-join.v1',status:'unresolved',
      reason:valid?record.reason:'invalid_react_frontier',runtime_observed:Boolean(valid),
      source:valid?{source_call_id:entry.source_call_id,callback_source_id:entry.callback_source_id}:null,
      runtime:valid?{observation_id:record.observation_id,operation:record.operation,owner_proven:false}:null};
  }

  function onRecord(record) {
    const result = record?.kind==='react_predicate_use'?joinPredicateUse(record):record?.kind==='react_profiler'?joinProfiler(record):record?.kind==='react_strict_replay'?joinStrictReplay(record):record?.kind==='react_boundary_commit'?joinBoundaryCommit(record):record?.kind==='react_lazy_commit'?joinLazyCommit(record):record?.kind==='react_portal_commit'?joinPortalCommit(record):record?.kind==='react_root_commit'?joinRootCommit(record):record?.kind==='react_root_recovery'?joinRootRecovery(record):record?.kind==='react_id_commit'?joinIdCommit(record):record?.kind==='react_class_update'?classUpdates.join(record):record?.kind==='react_class'?classes.join(record):record?.kind==='react_host'?hosts.join(record):record?.kind==='react_server'?servers.join(record):record?.kind==='react_root'?joinRoot(record):['react_element','react_descriptor_commit'].includes(record?.kind)?joinElement(record):record?.kind==='react_portal'?portals.join(record):record?.kind==='react_shared_callback'?joinSharedCallback(record):record?.kind==='react_wrapper'?lifecycleSession.joinWrapper(record):record?.kind==='react_context_origin'?lifecycleSession.joinContextOrigin(record):record?.kind==='react_frontier'?joinFrontier(record):record?.kind==='react_ref'?joinRef(record):record?.kind==='react_callback_source'?joinCallbackSource(record):record?.kind==='react_lifecycle' ? joinLifecycle(record)
      : record?.kind==='react_callback' ? joinCallback(record)
      : record?.kind==='react_api' ? joinApi(record) : join(record);
    if(record?.kind==='react_api'&&result?.status==='resolved'&&result.runtime.predicate_proof?.call){
      const call=result.runtime.predicate_proof.call,scopeKey=`${record.session}\0${call.scope_id}`;
      const key=`${record.session}\0${call.source_frame_id}\0${record.source_call_id}`;
      predicateCalls.set(key,predicateScopes.has(scopeKey)?null:copy(result));predicateScopes.add(scopeKey);
    }
    if(record?.kind==='react_api'&&record.operation==='element_created'&&result?.status==='resolved'&&record.boundary_input)observedBoundaries.set(record.observation_id,copy(record));
    if(record?.kind==='react_portal'&&result?.status==='resolved')observedPortals.set(record.observation_id,copy(record));
    if(result?.schema==='producttrace.react-callback-join.v1' && result.status==='resolved')refCallbacks.set(record.observation_id,
      {action_occurrence_id:record.action_occurrence_id,scenario_id:result.source.scenario_id,
        callee_identity_id:record.callee_identity_id,handler_source_id:result.source.handler_source_id,
        retained_producer_call_ids:result.runtime.retained_producer_call_ids});
    if(result?.schema===JOIN_SCHEMA && result.status==='resolved' && result.runtime.action_occurrence_id) {
      const id=result.runtime.action_occurrence_id,previous=observedActions.get(id);
      observedActions.set(id,{control_id:result.source.control_id,scenario_id:result.source.scenario_id,
        react_identity:result.runtime.react_identity||null,react_lifecycle_identity:result.runtime.react_lifecycle_identity||null,conflicting:Boolean(previous?.conflicting || previous &&
        (previous.control_id!==result.source.control_id || previous.scenario_id!==result.source.scenario_id
          || JSON.stringify(previous.react_lifecycle_identity)!==JSON.stringify(result.runtime.react_lifecycle_identity||null)))});
    }
    if (result && options.onJoin) {
      const delivered = options.onJoin(result, record);
      if (delivered && typeof delivered.then === 'function') return delivered.then(() => {});
    }
  }

  return {
    schema: SCHEMA,
    map_fingerprint: map.fingerprint,
    joinFrontier,
    joinStrictReplay,
    joinContextOrigin:lifecycleSession.joinContextOrigin,
    bindings: { name: options.name || `react-source:${map.fingerprint.slice(0, 12)}`, identity: {}, actions,
      react_lifecycle: { schema: 'producttrace.react-lifecycle-manifest.v1',
        map_fingerprint: map.fingerprint, entries: lifecycleEntries.map(copy), frontiers:lifecycleFrontiers.map(copy) } },
    diagnostics,
    candidates,
    request_bridge: options.requestBridge ? requestBridgeManifest : null,
    instrumentSource,
    join,
    joinCallback,
    joinCallbackSource,
    joinSharedCallback,
    joinClassUpdate:classUpdates.join,
    joinClass:classes.join,
    joinHost:hosts.join,
    joinServer:servers.join,
    joinRoot,
    joinRootCommit,
    joinRootRecovery,
    joinElement,
    joinLazyCommit,
    joinIdCommit,
    joinPredicateUse,
    joinBoundaryCommit,
    joinPortalCommit,
    joinPortal:portals.join,
    joinRef,
    joinLifecycle,
    joinWrapper:lifecycleSession.joinWrapper,
    joinApi,
    createApiRuntime,
    onRecord,
  };
}
