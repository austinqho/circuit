import {createReactStateBoundary} from './library-react-state.mjs';
import {createHostEventBoundary} from './library-host-events.mjs';
import {createLibraryExecutionContext} from './library-execution-context.mjs';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { createLibraryBoundary } from './library-boundary.mjs';
import { createOwnedValueBoundary } from './library-owned-value.mjs';
import { createOwnedReferenceBoundary } from './library-owned-reference.mjs';

// Banks are installation-scoped. Returned objects may cross instrumented files
// without losing the boundary that created them or changing object identity.
const returnedMemberHosts = new WeakMap();
const returnedFunctionHosts = new WeakMap();
const executionContexts = new WeakMap();

/**
 * A shared import-call adapter: no React, TanStack, or rule-kind dispatch lives
 * here. TypeScript binding identity prevents a same-named local function from
 * borrowing an imported library rule. This Node integration is deliberately
 * separate from the browser's existing source/React lifecycle instrumentation.
 */
export function instrumentLibraryPrograms({ source, file = 'application.ts', bank, ownedReferenceHost = null, hostEventHost = null, stateHost = null }) {
  if (typeof source !== 'string' || !bank || typeof bank.lookup !== 'function') throw new TypeError('library_integration_inputs');
  const hash = createHash('sha256').update(file).update('\0').update(source).digest('hex');
  const runtimeKey = `__producttrace_library_${hash.slice(0, 20)}`;
  const options = { allowJs: true, noResolve: true, noLib: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === file ? ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS) : undefined;
  host.fileExists = name => name === file;
  host.readFile = name => name === file ? source : undefined;
  const program = ts.createProgram([file], options, host), checker = program.getTypeChecker(), ast = program.getSourceFile(file);
  if(!returnedMemberHosts.has(bank))returnedMemberHosts.set(bank,new Set());
  if(!returnedFunctionHosts.has(bank))returnedFunctionHosts.set(bank,new Set());
  const functionHosts=returnedFunctionHosts.get(bank);
  if(!executionContexts.has(bank))executionContexts.set(bank,createLibraryExecutionContext());
  const executionContext=executionContexts.get(bank);
  const memberHosts=returnedMemberHosts.get(bank),borrowedSessions=new Map(),memberBindings=[];
  const imports = new Map(), bindings = [], frontiers = [], sessions = new Map(), runtimeFrontiers = [];
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue;
    const specifier = statement.moduleSpecifier.text, clause = statement.importClause;
    if (clause.isTypeOnly) continue;
    if (clause.name) imports.set(checker.getSymbolAtLocation(clause.name), { specifier, exportName: 'default' });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) if (!element.isTypeOnly)
        imports.set(checker.getSymbolAtLocation(element.name), { specifier, exportName: element.propertyName?.text || element.name.text });
    } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      imports.set(checker.getSymbolAtLocation(clause.namedBindings.name), { specifier, namespace: true });
    }
  }
  const transform = context => {
    const f = context.factory;
    const visit = node => {
      if (!ts.isCallExpression(node)) return ts.visitEachChild(node, visit, context);
      let identity, target = node.expression, root = target, optionalMember = false;
      const members = [];
      while (ts.isPropertyAccessExpression(root)) {
        members.unshift(root.name.text); optionalMember ||= Boolean(root.questionDotToken); root = root.expression;
      }
      if (ts.isIdentifier(root)) {
        const binding = imports.get(checker.getSymbolAtLocation(root));
        if (binding) identity = members.length
          ? { specifier: binding.specifier, exportName: [...(binding.namespace ? [] : [binding.exportName]), ...members].join('.') }
          : binding;
      }
      if (!identity || identity.namespace) {
        if(stateHost&&ts.isIdentifier(target)&&target.text!=='eval'&&!node.questionDotToken&&!node.arguments.some(ts.isSpreadElement)){
          const shadow=checker.resolveName('globalThis',node,ts.SymbolFlags.Value,false);
          if(!shadow?.declarations?.some(row=>row.getSourceFile()===ast)){
            const id=`${hash}:function:${node.getStart()}`;
            memberBindings.push({id,file,start:node.getStart(),end:node.end});
            const prepared=f.createCallExpression(f.createPropertyAccessExpression(f.createElementAccessExpression(f.createIdentifier('globalThis'),f.createStringLiteral(runtimeKey)),'prepareObservedCall'),undefined,[f.createStringLiteral(id),target]);
            return f.createCallExpression(prepared,undefined,node.arguments.map(arg=>ts.visitNode(arg,visit)));
          }
        }
        // Resolve direct own-member calls at runtime. Most calls fall through;
        // only an exact object/method registered by a verified factory gets
        // replayed. The preparer preserves receiver-before-argument ordering.
        if(ts.isPropertyAccessExpression(target)&&!ts.isPrivateIdentifier(target.name)&&target.expression.kind!==ts.SyntaxKind.SuperKeyword
          &&!node.questionDotToken&&!optionalMember&&!node.arguments.some(ts.isSpreadElement)) {
          const shadow=checker.resolveName('globalThis',node,ts.SymbolFlags.Value,false);
          if(!shadow?.declarations?.some(row=>row.getSourceFile()===ast)) {
            const id=`${hash}:member:${node.getStart()}`;
            memberBindings.push({id,file,start:node.getStart(),end:node.end});
            const prepared=f.createCallExpression(f.createPropertyAccessExpression(f.createElementAccessExpression(f.createIdentifier('globalThis'),f.createStringLiteral(runtimeKey)),'prepareObservedMember'),undefined,
              [f.createStringLiteral(id),ts.visitNode(target.expression,visit),f.createStringLiteral(target.name.text)]);
            return f.createCallExpression(prepared,undefined,node.arguments.map(arg=>ts.visitNode(arg,visit)));
          }
        }
        return ts.visitEachChild(node, visit, context);
      }
      const globalBinding = checker.resolveName('globalThis', node, ts.SymbolFlags.Value, false);
      if (globalBinding?.declarations?.some(declaration => declaration.getSourceFile() === ast)) {
        frontiers.push({ reason: 'shadowed_runtime_global', ...identity, start: node.getStart(), end: node.end });
        return ts.visitEachChild(node, visit, context);
      }
      let entry = bank.lookup(identity.specifier, identity.exportName);
      if (!entry && identity.exportName.startsWith('default.')) {
        // CJS default interop often exposes the same namespace as named imports.
        // This is only a candidate: invoke still requires the exact admitted
        // function identity, so a distinct ESM default cannot borrow the rule.
        const canonical = identity.exportName.slice('default.'.length);
        entry = bank.lookup(identity.specifier, canonical);
        if (entry) identity = { ...identity, exportName: canonical };
      }
      if (!entry) { frontiers.push({ reason: 'unverified_library_program', ...identity, start: node.getStart(), end: node.end }); return ts.visitEachChild(node, visit, context); }
      if(entry.scope.protocol==='react_state_queue'&&stateHost?.protocol!=='react_state_queue'){
        frontiers.push({reason:'required_state_host_unavailable',...identity,start:node.getStart(),end:node.end});return ts.visitEachChild(node,visit,context);
      }
      if(entry.scope.protocol==='host_event_boundary'&&(typeof hostEventHost?.invoke!=='function'||hostEventHost.protocol!==entry.scope.hostProtocol||hostEventHost.phase!==entry.scope.hostPhase)){
        frontiers.push({reason:'required_lifecycle_host_unavailable',...identity,start:node.getStart(),end:node.end});
        return ts.visitEachChild(node,visit,context);
      }
      if (entry.scope.ownerGeneration === 'host' && typeof ownedReferenceHost?.captureGeneration !== 'function') {
        frontiers.push({reason:'required_generation_host_unavailable',...identity,start:node.getStart(),end:node.end});
        return ts.visitEachChild(node,visit,context);
      }
      if (['owned_returned_reference','owned_call_boundary'].includes(entry.scope.protocol) && typeof ownedReferenceHost?.captureOwner !== 'function') {
        frontiers.push({ reason: 'required_owner_host_unavailable', ...identity, start: node.getStart(), end: node.end });
        return ts.visitEachChild(node, visit, context);
      }
      if (node.questionDotToken || optionalMember
        || node.arguments.some(ts.isSpreadElement)) {
        frontiers.push({ reason: 'optional_or_spread_call_requires_adapter', ...identity, start: node.getStart(), end: node.end });
        return ts.visitEachChild(node, visit, context);
      }
      const id = `${hash}:call:${node.getStart()}`;
      bindings.push({ id, file, start: node.getStart(), end: node.end, ...identity, entry });
      if (members.length) {
        // Resolve the receiver and method before evaluating the call arguments,
        // just like JavaScript. A preparer closure avoids evaluating a nested
        // getter twice or moving argument-side direct eval into a new scope.
        const prepared = f.createCallExpression(f.createPropertyAccessExpression(f.createElementAccessExpression(f.createIdentifier('globalThis'), f.createStringLiteral(runtimeKey)), 'prepareMember'), undefined,
          [f.createStringLiteral(id), target.expression, f.createStringLiteral(target.name.text)]);
        return f.createCallExpression(prepared, undefined, node.arguments.map(arg => ts.visitNode(arg, visit)));
      }
      return f.createCallExpression(f.createPropertyAccessExpression(f.createElementAccessExpression(f.createIdentifier('globalThis'), f.createStringLiteral(runtimeKey)), 'invoke'), undefined,
        [f.createStringLiteral(id), target, f.createVoidZero(), f.createArrayLiteralExpression(node.arguments.map(arg => ts.visitNode(arg, visit)))]);
    };
    return node => ts.visitNode(node, visit);
  };
  const transformed = ts.transform(ast, [transform]);
  const code = ts.createPrinter().printFile(transformed.transformed[0]);
  transformed.dispose();
  const byId = new Map(bindings.map(binding => [binding.id, binding]));
  return {
    code, runtimeKey, memberBindings, bindings: bindings.map(({ entry, ...binding }) => ({ ...binding, rule: entry.id })), frontiers,
    runtime: Object.freeze({
      currentExecution() {return executionContext.current();},
      execution() {return executionContext.checkpoint();},
      prepareObservedCall(id,producer){
        const matches=[];
        for(const host of functionHosts){const invoke=host.session.prepareCall(producer,memberBindings.find(row=>row.id===id));if(invoke){matches.push(invoke);borrowedSessions.set(host.binding,host);}}
        if(matches.length===1)return matches[0];
        if(matches.length>1)runtimeFrontiers.push({binding:id,status:'frontier',reason:'ambiguous_returned_function_owner'});
        return (...args)=>Reflect.apply(producer,undefined,args);
      },
      prepareObservedMember(id,receiver,key) {
        const producer=receiver[key],source=memberBindings.find(row=>row.id===id);
        const matches=[];
        for(const host of memberHosts) {
          const invoke=host.session.prepareMember(receiver,key,producer,source);
          if(invoke){borrowedSessions.set(host.binding,host);matches.push({host,invoke});}
        }
        for(const host of functionHosts){
          const invoke=host.session.prepareCall(producer,source);
          if(invoke){borrowedSessions.set(host.binding,host);matches.push({host,invoke:(...args)=>Reflect.apply(invoke,receiver,args)});}
        }
        if(matches.length===1)return matches[0].invoke;
        if(matches.length>1)for(const {host} of matches)host.session.markMemberAmbiguous?.(receiver,key);
        return (...args)=>Reflect.apply(producer,receiver,args);
      },
      prepareMember(id, receiver, key) {
        const producer = receiver[key], runtime = this;
        return (...args) => runtime.invoke(id, producer, receiver, args);
      },
      invoke(id, producer, receiver, args) {
        const binding = byId.get(id);
        if (!binding || binding.entry.producer !== producer) {
          runtimeFrontiers.push({ binding: id, status: 'frontier', reason: 'library_runtime_export_identity_changed' });
          return Reflect.apply(producer, receiver, args);
        }
        let session = sessions.get(id);
        if (!session) {
          const execution={executionContext,executionSource:{binding:id,file:binding.file,start:binding.start,end:binding.end,rule:binding.entry.id}};
          session = binding.entry.scope.protocol === 'react_state_queue'
            ? createReactStateBoundary({...execution,program:binding.entry.program,api:binding.entry.scope.api,occurrencePrefix:id})
            : binding.entry.scope.protocol === 'host_event_boundary'
            ? createHostEventBoundary({...binding.entry.scope.eventLayout,...execution,program:binding.entry.program,occurrencePrefix:id})
            : binding.entry.scope.protocol === 'owned_returned_reference'
            ? createOwnedReferenceBoundary({ ...execution, producer, program: binding.entry.program, captureOwner: ownedReferenceHost.captureOwner, occurrencePrefix: id })
            : binding.entry.scope.protocol === 'owned_call_boundary'
              ? createOwnedValueBoundary({ ...execution, producer, program: binding.entry.program, accessorObservation: binding.entry.scope.accessorObservation, dataReadEvidence: binding.entry.scope.dataReadEvidence ?? false, callbackArguments: binding.entry.scope.callbackArguments, captureGeneration: ownedReferenceHost.captureGeneration ?? null, captureOwner: ownedReferenceHost.captureOwner, occurrencePrefix: id })
              : createLibraryBoundary({ producer, program: binding.entry.program,
            ...execution,
            dataReadEvidence: binding.entry.scope.dataReadEvidence ?? false, callbackArguments: binding.entry.scope.callbackArguments, returnedCallbackArguments: binding.entry.scope.returnedCallbackArguments ?? [], resultPaths: binding.entry.scope.resultPaths,
            resultIdentityPaths: binding.entry.scope.resultIdentityPaths ?? [], resultMethods: binding.entry.scope.resultMethods ?? [],
            nestedReferences: binding.entry.scope.nestedReferences ?? false,
            errorObservation: binding.entry.scope.errorObservation,
            accessorObservation: binding.entry.scope.accessorObservation,
            occurrencePrefix: id,
            // The independent domain controls observation. A proposed no-op
            // must not disable callback probes by omitting call instructions.
            observationMode: binding.entry.scope.observationMode ?? 'invocations' });
          sessions.set(id, session);
          if(binding.entry.scope.protocol==='react_state_queue')functionHosts.add({session,binding:id,rule:binding.entry.id});
          if(binding.entry.scope.resultMethods?.length)memberHosts.add({session,binding:id,rule:binding.entry.id});
        }
        if(binding.entry.scope.protocol==='react_state_queue')return stateHost.invoke({boundary:session,producer,args,receiver});
        if(binding.entry.scope.protocol==='host_event_boundary')return hostEventHost.invoke({boundary:session,producer,args,receiver});
        const callbackIndices = binding.entry.scope.nestedReferences ? args.map((_, index) => index) : binding.entry.scope.callbackArguments;
        const callbackIds = Object.fromEntries(callbackIndices.map(index => [index, `${id}:argument:${index}`]));
        return session.invoke(args, { receiver, callbackIds });
      },
      checkpoint() {
        return [...runtimeFrontiers, ...[...borrowedSessions.values()].filter(host=>!sessions.has(host.binding)).map(host=>({binding:host.binding,rule:host.rule,...host.session.checkpoint()})), ...[...sessions].map(([id, session]) => ({ binding: id, rule: byId.get(id).entry.id, ...session.checkpoint() }))];
      },
    }),
  };
}
