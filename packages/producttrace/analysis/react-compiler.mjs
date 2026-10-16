import ts from 'typescript';
import {validateReactExecutionRule,planSynchronousScope,planReactTestScope,planComponentWrapper} from './react-execution-rule.mjs';
import { createHash } from 'node:crypto';
import { libraryContractPackages, matchLibraryContract, producerContracts } from './library-contracts.mjs';
import { getReactApiRecord, REACT_API_INVENTORY } from './react-semantics.mjs';
import { stableFunctionId } from './runtime-attribution.mjs';

const VERSION = 30;
const digest = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value);
const semanticBankFingerprint = digest(stable(REACT_API_INVENTORY));
const nativeEvents = new Set(['onClick', 'onDoubleClick', 'onChange', 'onInput', 'onSubmit', 'onKeyDown', 'onKeyUp', 'onKeyPress', 'onPointerDown', 'onPointerUp', 'onMouseDown', 'onMouseUp', 'onFocus', 'onBlur', 'onContextMenu', 'onDragStart', 'onDrop', 'onTouchStart', 'onTouchEnd']);
const functionLike = n => Boolean(n)
  && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
    || ts.isMethodDeclaration(n));
const unwrap = n => { while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isNonNullExpression(n))) n = n.expression; return n; };

/** Pure, bounded source analysis. It does not execute application code or inspect disk. */
export function compileReactSources(files, options = {}) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new TypeError('files must be a map of relative paths to source text');
  const sources = new Map();
  for (const [raw, source] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = raw.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!file || file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').some(part => !part || part === '..' || part === '.')) throw new TypeError(`Expected a repository-relative source path: ${raw}`);
    if (typeof source !== 'string') throw new TypeError(`Source must be text: ${raw}`);
    if (sources.has(file)) throw new TypeError(`Duplicate normalized source path: ${file}`);
    sources.set(file, source);
  }
  const manifest = [...sources].map(([path, source]) => ({ path, sha256: digest(source) }));
  const moduleAliases = new Map(Object.entries(options.moduleAliases || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => [name, typeof value === 'string' ? { file: value } : value]));
  for (const [name, value] of moduleAliases) {
    if (!name || !value || typeof value.file !== 'string' || !sources.has(value.file)) throw new TypeError(`Invalid module alias: ${name}`);
  }
  const aliasEvidence = [...moduleAliases].map(([key, value]) => ({ specifier: value.importer ? key.slice(key.indexOf('\0') + 1) : key, ...value }));
  const packageEvidence = new Map(Object.entries(options.packages || {}).sort(([a], [b]) => a.localeCompare(b)));
  const knownContractPackages = new Set(libraryContractPackages());
  const resolvedPackages = [...packageEvidence].map(([name, evidence]) => ({ name, ...evidence }));
  const output = { schema: 'producttrace.react-map.v1', fingerprint: digest(stable({ version: VERSION, semanticBankFingerprint, files: manifest, moduleAliases: aliasEvidence, packages: resolvedPackages })), files: manifest,
    resolution: { module_aliases: aliasEvidence, packages: resolvedPackages },
    claims: { source_indexed: true, runtime_observed: false, source_complete: false }, nodes: [], edges: [], components: [], placements: [], controls: [], scenarios: [], states: [], react_values: [], react_semantics: [], react_protocols: [], react_server_consumers: [], react_backlog: [], library_contracts: [], library_backlog: [], diagnostics: [] };
  const nodes = new Map(), syntaxNodes = new Map(), edges = new Map(), diagnostics = new Map();
  const sourceFiles = new Map([...sources].map(([file, source]) => [file, ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /\.tsx?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX)]));
  const relativeImport = (specifier, containing) => {
    if (!specifier.startsWith('.')) return moduleAliases.get(`${containing}\0${specifier}`)?.file
      || moduleAliases.get(specifier)?.file || null;
    const parts = containing.split('/').slice(0, -1);
    for (const part of specifier.split('/')) { if (part === '..') { if (!parts.length) return null; parts.pop(); } else if (part !== '.') parts.push(part); }
    const base = parts.join('/');
    return [base, ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'].map(ext => base + ext)].find(file => sourceFiles.has(file)) || null;
  };
  const host = { getSourceFile: name => sourceFiles.get(name), getDefaultLibFileName: () => '', writeFile() {}, getCurrentDirectory: () => '', getDirectories: () => [], fileExists: name => sourceFiles.has(name), readFile: name => sources.get(name), getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, containing) => names.map(name => { const file = relativeImport(name, containing); return file ? { resolvedFileName: file, extension: file.endsWith('.tsx') ? ts.Extension.Tsx : file.endsWith('.ts') ? ts.Extension.Ts : file.endsWith('.jsx') ? ts.Extension.Jsx : ts.Extension.Js } : undefined; }) };
  const program = ts.createProgram([...sourceFiles.keys()], { allowJs: true, checkJs: false, noLib: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext }, host);
  const checker = program.getTypeChecker();
  const symbol = n => n ? checker.getSymbolAtLocation(n) : undefined;
  const node = (n, kind = 'expression') => {
    const sf = n.getSourceFile(), start = n.getStart(sf), end = n.end, text = sf.text.slice(start, end);
    // Function identities are shared with the post-JS transform: original
    // file content hash plus the original function start:end span. Other
    // analyzer nodes retain their compact semantic ids.
    const id = kind === 'function' ? stableFunctionId(sf.text, start, end)
      : `${kind}:${digest(stable([sf.fileName, start, end, kind, text])).slice(0, 24)}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind, file: sf.fileName, start, end, text });
    if (!syntaxNodes.has(id)) syntaxNodes.set(id, n);
    return id;
  };
  const issue = (code, n, message, placement) => {
    const row = { code, ...(n ? { node_id: node(n) } : {}), ...(placement ? { placement_id: placement.id } : {}), message };
    diagnostics.set(stable(row), row);
  };
  const edge = (from, to, relation, scenario, conditions = [], extra = {}) => {
    const row = { from, to, relation, ...(scenario ? { scenario_id: scenario.id } : {}), conditions, evidence_ids: [...new Set([from, to])], ...extra };
    const id = `edge:${digest(stable(row)).slice(0, 24)}`;
    edges.set(id, { id, ...row });
  };
  for (const sf of sourceFiles.values()) {
    for (const error of sf.parseDiagnostics) { output.claims.source_indexed = false; issue('syntax_error', sf, ts.flattenDiagnosticMessageText(error.messageText, '\n')); }
    for (const statement of sf.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const spec = statement.moduleSpecifier.text;
      if (spec.startsWith('.') && !relativeImport(spec, sf.fileName)) issue('unresolved_import', statement, `Import ${spec} is outside the supplied source set.`);
    }
  }
  const functions = new Map(), componentList = [], stateBySymbol = new Map(), mutatedSymbols = new Set();
  // A changed local callback binding is not inherently unknowable. Keep every
  // simple assignment value so the runtime can identify the function object
  // that was actually supplied to React. Unsupported mutations remain marked
  // incomplete; they never become a plausible source match.
  const assignedValuesBySymbol = new Map(), incompleteAssignments = new Set();
  const REACT_CONTEXT_ENV = Symbol('react-context-values');
  const markIncompleteMutation = raw => {
    const n=unwrap(raw);if(!n)return;
    if(ts.isIdentifier(n)){const sym=symbol(n);if(sym){mutatedSymbols.add(sym);incompleteAssignments.add(sym);}return;}
    if(ts.isPropertyAccessExpression(n)||ts.isElementAccessExpression(n)){markIncompleteMutation(n.expression);return;}
    ts.forEachChild(n,markIncompleteMutation);
  };
  for (const sf of sourceFiles.values()) { const scan = n => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const left=unwrap(n.left);
      if(n.operatorToken.kind===ts.SyntaxKind.EqualsToken && ts.isIdentifier(left)) {
        const sym=symbol(left);if(sym){mutatedSymbols.add(sym);const values=assignedValuesBySymbol.get(sym)||[];values.push(n.right);assignedValuesBySymbol.set(sym,values);}
      } else markIncompleteMutation(n.left);
    }
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator)) markIncompleteMutation(n.operand);
    ts.forEachChild(n, scan);
  }; scan(sf); }
  const fnName = fn => fn.name?.text || (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : null);
  function packageInstallation(packageName, importerFile) {
    const evidence = packageEvidence.get(packageName);
    if (!evidence) return null;
    if (!Array.isArray(evidence.installations)) return evidence;
    const matches = evidence.installations.filter(installation => installation.importers?.some(row => row.importer === importerFile));
    return matches.length === 1 ? matches[0] : null;
  }
  function reactImport(call, seen = new Set()) {
    const expression = unwrap(call.tagName || call.expression);
    if(!expression || seen.has(expression) || seen.size>=20)return null;
    seen=new Set(seen).add(expression);
    if (expression && ts.isPropertyAccessExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
      const parent = reactImport({ expression: expression.expression });
      if (parent) return { ...parent, member: expression.name.text };
    }
    if (ts.isIdentifier(expression)) {
      const resolved=symbol(expression),declaration = resolved?.declarations?.[0];
      if (declaration && ts.isImportSpecifier(declaration)) {
        const imp = declaration.parent.parent.parent;
        if (ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier)
          && ['react', 'react-dom', 'react-dom/client', 'react-dom/server'].includes(imp.moduleSpecifier.text)) {
          return { surface: imp.moduleSpecifier.text, exportName: (declaration.propertyName || declaration.name).text };
        }
      }
      // Follow only a local immutable const initialized from an exact React
      // export. The alias changes the spelling of the call, not its package,
      // version, installed implementation, or runtime value.
      if(declaration&&ts.isVariableDeclaration(declaration)&&declaration.initializer
        &&(declaration.parent.flags&ts.NodeFlags.Const)&&!mutatedSymbols.has(resolved)
        &&sourceFiles.has(declaration.getSourceFile().fileName))
        return reactImport({expression:declaration.initializer},seen);
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const declaration = symbol(expression.expression)?.declarations?.[0];
      if (declaration && ts.isImportSpecifier(declaration)) {
        const imp = declaration.parent.parent.parent;
        if (ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier)
          && imp.moduleSpecifier.text === 'react') {
          return { surface: 'react', exportName: (declaration.propertyName || declaration.name).text,
            member: expression.name.text };
        }
      }
      const imp = declaration && (ts.isNamespaceImport(declaration) ? declaration.parent.parent
        : ts.isImportClause(declaration) ? declaration.parent : null);
      if (imp && ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier)
        && ['react', 'react-dom', 'react-dom/client', 'react-dom/server'].includes(imp.moduleSpecifier.text)) {
          return { surface: imp.moduleSpecifier.text, exportName: expression.name.text };
      }
    }
    return null;
  }
  function resolveReactSemantic(call) {
    const identity = reactImport(call);
    if (!identity) return null;
    if (relativeImport(identity.surface, call.getSourceFile().fileName)) {
      return { identity, admitted: false, reason: 'workspace_module_named_like_react' };
    }
    const packageName = identity.surface === 'react' ? 'react' : 'react-dom';
    const evidence = packageInstallation(packageName, call.getSourceFile().fileName);
    if (!evidence) return { identity, admitted: false, reason: 'react_package_resolution_unavailable' };
    const record = getReactApiRecord({ ...identity, version: evidence.version });
    if (!record) return { identity, evidence, admitted: false, reason: 'react_semantics_version_or_export_unavailable' };
    if (evidence.verified !== true) return { identity, evidence, record, admitted: false,
      reason: evidence.reason || 'react_package_source_unverified' };
    return { identity, evidence, record, admitted: true };
  }
  function retainReactSemantic(call, semantic) {
    if (!semantic?.record || !semantic.evidence) return;
    const callId = node(call, 'call');
    const row = { id: `react-semantic:${digest(stable([callId, semantic.record.id, semantic.evidence.verification_sha256])).slice(0, 24)}`,
      semantic_id: semantic.record.id, call_id: callId, surface: semantic.record.surface,
      export: semantic.record.export, version: semantic.evidence.version,
      disposition: semantic.record.disposition, semantic_kind: semantic.record.semantic_kind,
      package_verification_sha256: semantic.evidence.verification_sha256,
      condition: semantic.record.condition, reason: semantic.record.reason,
      behavior: semantic.record.behavior,
      causal_bindings: reactCausalBindings(call, semantic),
      ...(ts.isJsxOpeningElement(call) || ts.isJsxSelfClosingElement(call)?{usage_kind:'jsx_boundary',
        element_source_id:node(ts.isJsxOpeningElement(call)?call.parent:call,'jsx_element'),
        element_is_jsx_child:[ts.SyntaxKind.JsxElement,ts.SyntaxKind.JsxFragment].includes((ts.isJsxOpeningElement(call)?call.parent:call).parent.kind)}:{}),
      claim: 'source_contract', runtime_observed: false };
    if (!output.react_semantics.some(item => item.id === row.id)) output.react_semantics.push(row);
    return row;
  }
  function retainReactValueSemantic(expression, semantic) {
    if (!semantic?.record || !semantic.evidence) return;
    const sourceId = node(expression, 'react_value_usage');
    const row = { id: `react-semantic:${digest(stable([sourceId, semantic.record.id,
      semantic.evidence.verification_sha256, 'value_usage'])).slice(0, 24)}`,
      semantic_id: semantic.record.id, call_id: sourceId, surface: semantic.record.surface,
      export: semantic.record.export, version: semantic.evidence.version,
      disposition: semantic.record.disposition, semantic_kind: semantic.record.semantic_kind,
      package_verification_sha256: semantic.evidence.verification_sha256,
      condition: semantic.record.condition, reason: semantic.record.reason,
      behavior: semantic.record.behavior,
      causal_bindings: reactCausalBindings(expression, semantic),
      usage_kind: 'value_read', claim: 'source_contract', runtime_observed: false };
    if (!output.react_semantics.some(item => item.id === row.id)) output.react_semantics.push(row);
    return row;
  }
  function retainReactClassSemantic(declaration, semantic) {
    if (!semantic?.record || !semantic.evidence) return null;
    const classId = node(declaration, 'class');
    const heritage=declaration.heritageClauses?.flatMap(clause=>[...clause.types]).find(type=>ts.isPropertyAccessExpression(type.expression)&&ts.isIdentifier(type.expression.expression)&&reactImport({expression:type.expression})?.exportName===semantic.record.export);
    const render=declaration.members.find(member=>ts.isMethodDeclaration(member)&&member.name?.getText()===semantic.record.behavior.execution?.render_method&&!member.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.StaticKeyword));
    let mapping=null;
    if(declaration.name&&ts.isSourceFile(declaration.parent)&&heritage&&render?.body&&!render.asteriskToken&&!render.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword)
      &&!mutatedSymbols.has(symbol(declaration.name))&&!ts.getDecorators?.(declaration)?.length){
      const reads=[];let unsupported=false;
      const scan=current=>{
        if(current!==render&&ts.isFunctionLike(current))return;
        if(ts.isCallExpression(current)&&ts.isIdentifier(current.expression)&&current.expression.text==='eval')unsupported=true;
        if(ts.isPropertyAccessExpression(current)&&current.expression.kind===ts.SyntaxKind.ThisKeyword&&['props','state'].includes(current.name.text)){
          const parent=current.parent;
          // Wrapping a value is safe only at a read site. Assignment targets and
          // direct method/tag calls have extra reference/receiver semantics.
          let referenceUse=ts.isCallExpression(parent)&&parent.expression===current||ts.isTaggedTemplateExpression(parent)&&parent.tag===current;
          let descendant=current;
          for(let ancestor=parent;ancestor&&!ts.isStatement(ancestor);descendant=ancestor,ancestor=ancestor.parent){
            if(ts.isBinaryExpression(ancestor)&&ancestor.left===descendant&&ancestor.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&ancestor.operatorToken.kind<=ts.SyntaxKind.LastAssignment)referenceUse=true;
            if((ts.isForOfStatement(ancestor)||ts.isForInStatement(ancestor))&&ancestor.initializer===descendant)referenceUse=true;
          }
          // for-in/of is a statement, so inspect its initializer separately.
          for(let value=current;value&&!ts.isStatement(value);value=value.parent){if((ts.isForOfStatement(value.parent)||ts.isForInStatement(value.parent))&&value.parent.initializer===value)referenceUse=true;}
          if(referenceUse||ts.isBinaryExpression(parent)&&parent.left===current&&parent.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&parent.operatorToken.kind<=ts.SyntaxKind.LastAssignment
            ||ts.isPrefixUnaryExpression(parent)||ts.isPostfixUnaryExpression(parent)||ts.isDeleteExpression(parent))unsupported=true;
          else reads.push({source_id:node(current,'class_input_read'),field:current.name.text});
        }
        ts.forEachChild(current,scan);
      };scan(render);
      if(!unsupported)mapping={name:declaration.name.text,namespace:heritage.expression.expression.text,render_source_id:node(render,'function'),
        body_start:render.body.getStart()+1,body_end:render.body.getEnd()-1,reads};
    }

    const callbacks = semantic.record.behavior.callbacks.map(slot => {
      const name = slot.slot.replace(/^static /u, '');
      const member = declaration.members.find(value => value.name?.getText() === name);
      return { ...slot, source_id: member ? node(member, 'function') : null, captures: [],
        resolution: member ? 'class_member_source' : 'member_not_declared' };
    });
    const contextType = declaration.members.find(value => value.name?.getText() === 'contextType');
    const row = { id: `react-semantic:${digest(stable([classId, semantic.record.id,
      semantic.evidence.verification_sha256])).slice(0, 24)}`,
      semantic_id: semantic.record.id, call_id: classId, surface: semantic.record.surface,
      export: semantic.record.export, version: semantic.evidence.version,
      disposition: semantic.record.disposition, semantic_kind: semantic.record.semantic_kind,
      package_verification_sha256: semantic.evidence.verification_sha256,
      condition: semantic.record.condition, reason: semantic.record.reason,
      behavior: semantic.record.behavior,
      causal_bindings: { owner_source_id: classId, owner_instance: 'runtime_required', member: null,
        inputs: contextType?.initializer ? {'class.contextType':node(contextType.initializer)} : {},
        class_mapping:mapping,callbacks,
        frontier: 'Class source does not identify a mounted instance, accepted render, commit, callback, or captured runtime values.' },
      claim: 'source_contract', runtime_observed: false };
    if (!output.react_semantics.some(item => item.id === row.id)) output.react_semantics.push(row);
    return row;
  }
  function captures(callback) {
    const values = new Map();
    const visit = current => {
      if (ts.isIdentifier(current)) {
        // Property names and binding declarations are not reads of captures.
        if (ts.isPropertyAccessExpression(current.parent) && current.parent.name === current) return;
        const declaration = symbol(current)?.declarations?.[0];
        if (declaration && !(declaration.getSourceFile() === callback.getSourceFile()
          && declaration.pos >= callback.pos && declaration.end <= callback.end)) {
          const id = node(declaration, 'capture_binding');
          values.set(id, { binding_id: id, read_id: node(current), value_status: 'runtime_capture_required' });
        }
      }
      ts.forEachChild(current, visit);
    };
    visit(callback);
    return [...values.values()];
  }
  function namedBodyIdentity(fn) {
    if(!(ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)) || !fn.name || !fn.body || fn.asteriskToken
      || fn.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword))return null;
    const shadows=name=>ts.isIdentifier(name)?[fn.name.text,'arguments'].includes(name.text)
      :(ts.isObjectBindingPattern(name)||ts.isArrayBindingPattern(name)) && name.elements.some(element=>ts.isBindingElement(element)&&shadows(element.name));
    let shadowed=false;
    const scan=current=>{
      if(current!==fn && functionLike(current)){if(ts.isFunctionDeclaration(current)&&current.name&&shadows(current.name))shadowed=true;return;}
      if((ts.isVariableDeclaration(current)||ts.isParameter(current)||ts.isClassDeclaration(current))&&current.name&&shadows(current.name))shadowed=true;
      ts.forEachChild(current,scan);
    };scan(fn);
    return shadowed?null:{source_id:node(fn,'function'),self_name:fn.name.text};
  }
  function sharedBodyIdentity(fn) {
    const named=namedBodyIdentity(fn);if(named)return {...named,kind:'named'};
    if(!(ts.isArrowFunction(fn)||ts.isFunctionExpression(fn)) || !fn.body || fn.asteriskToken
      || fn.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword))return null;
    // A new lexical observer binding could change direct eval's name lookup.
    // Keep that source shape unresolved instead of guessing its free variables.
    let directEval=false;const scan=current=>{if(ts.isCallExpression(current) && ts.isIdentifier(current.expression)
      && current.expression.text==='eval')directEval=true;ts.forEachChild(current,scan);};scan(fn);
    return directEval?null:{source_id:node(fn,'function'),kind:'factory'};
  }
  function reactCausalBindings(site, semantic) {
    let owner = site.parent;
    while (owner && !functionLike(owner) && !ts.isClassDeclaration(owner) && !ts.isClassExpression(owner)) owner = owner.parent;
    const inputs = {};
    for (const [index, argument] of [...site.arguments || []].entries()) inputs[`arguments.${index}`] = argument;
    const optionsIndex = semantic.identity.exportName === 'hydrateRoot' ? 2 : 1;
    const options = unwrap(site.arguments?.[optionsIndex]);
    if (options && ts.isObjectLiteralExpression(options)) {
      const properties = new Map();
      for (const property of options.properties) {
        if (ts.isSpreadAssignment(property)) { properties.clear(); continue; }
        if (!property.name || ts.isComputedPropertyName(property.name)) { properties.clear(); continue; }
        properties.delete(property.name.text);
        if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
          properties.set(property.name.text,property.initializer);
        }
      }
      for (const [name,value] of properties) inputs[`options.${name}`]=value;
    }
    if (site.attributes) for (const attribute of site.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        for (const key of Object.keys(inputs)) if (key.startsWith('props.')) delete inputs[key];
        continue;
      }
      if (ts.isJsxAttribute(attribute)) delete inputs[`props.${attribute.name.getText()}`];
      if (ts.isJsxAttribute(attribute) && attribute.initializer) {
        const value = ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer;
        if (value) inputs[`props.${attribute.name.getText()}`] = value;
      }
    }
    const retainedFunction = (expression, seen = new Set()) => {
      const value = unwrap(expression);
      if (functionLike(value)) return value;
      if (!value) return null;
      let sym;
      if(ts.isIdentifier(value))sym=symbol(value);
      else if(ts.isPropertyAccessExpression(value)||ts.isElementAccessExpression(value)){
        // ESM namespace exports are resolved by the compiler, not by executing
        // a property getter. Ordinary objects and computed keys are different:
        // they need their own observed value provenance.
        const receiver=unwrap(value.expression),receiverSymbol=receiver&&ts.isIdentifier(receiver)?symbol(receiver):null;
        if(!receiverSymbol||mutatedSymbols.has(receiverSymbol)
          ||!receiverSymbol.declarations?.some(ts.isNamespaceImport))return null;
        const name=ts.isPropertyAccessExpression(value)?value.name.text:
          value.argumentExpression&&ts.isStringLiteral(value.argumentExpression)?value.argumentExpression.text:null;
        if(name===null)return null;
        sym=checker.getPropertyOfType(checker.getTypeAtLocation(receiver),name);
      }else return null;
      if (!sym || mutatedSymbols.has(sym) || seen.has(sym)) return null;
      seen.add(sym);
      // Follow only aliases resolved by this compiler's supplied source files.
      // No package download, module execution, or unchecked declaration fallback.
      if(sym.flags & ts.SymbolFlags.Alias) {
        const target=checker.getAliasedSymbol(sym);
        if(!target || target===sym || seen.has(target) || mutatedSymbols.has(target))return null;
        sym=target;seen.add(sym);
      }
      const declaration = sym.declarations?.length === 1 && sym.declarations[0];
      if(!declaration || !sourceFiles.has(declaration.getSourceFile().fileName)
        || /\.d\.[cm]?ts$/u.test(declaration.getSourceFile().fileName))return null;
      // Naming the source is separate from assigning it to a hook owner. A
      // shared function needs occurrence-specific selection and consumption.
      if(declaration && ts.isFunctionDeclaration(declaration))return namedBodyIdentity(declaration)?declaration:null;
      if(!declaration || !ts.isVariableDeclaration(declaration) || !(declaration.parent.flags & ts.NodeFlags.Const))return null;
      const local=declaration.getSourceFile()===owner?.getSourceFile() && declaration.pos>=owner.pos && declaration.end<=owner.end;
      const target=retainedFunction(declaration.initializer,seen);
      return local || target && sharedBodyIdentity(target)?target:null;
    };
    const behavior = semantic.record.behavior;
    const member = semantic.identity.member;
    const slots = member ? behavior?.members?.[member]?.callbacks || [] : behavior?.callbacks || [];
    // A cleanup source is only a conditional return relationship. Finding it
    // does not establish that setup committed or returned this function.
    if (['useEffect','useLayoutEffect','useInsertionEffect'].includes(semantic.identity.exportName)) {
      const setup = unwrap(site.arguments?.[0]);
      if (setup && functionLike(setup) && !(ts.getCombinedModifierFlags(setup) & ts.ModifierFlags.Async) && !setup.asteriskToken) {
        const returns=[];
        const scan = current => {
          if (current !== setup.body && functionLike(current)) return;
          if (ts.isReturnStatement(current)) { returns.push(current); return; }
          ts.forEachChild(current,scan);
        };
        if (setup.body && ts.isBlock(setup.body)) {
          scan(setup.body);
          const last=setup.body.statements.at(-1);
          if (returns.length===1 && returns[0]===last && functionLike(unwrap(last.expression))) inputs.cleanup=last.expression;
        } else if (functionLike(unwrap(setup.body))) inputs.cleanup=setup.body;
      }
    }
    return {
      owner_source_id: owner ? node(owner, 'function') : null,
      owner_instance: 'runtime_required',
      member: member || null,
      inputs: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, node(value)])),
      callbacks: slots.map(slot => {
        const inputKey = slot.slot.replace(/ if .*$/, '');
        const input = Object.hasOwn(inputs, inputKey) ? unwrap(inputs[inputKey]) : null;
        const resolved = slot.retained || behavior?.execution?.kind === 'state_queue'
          ? retainedFunction(input) : null;
        const value = resolved || input;
        return { ...slot, source_id: value ? resolved && sharedBodyIdentity(resolved)?node(value,'function'):node(value) : null,
          captures: value && functionLike(value) ? captures(value) : [],
          ...(resolved && namedBodyIdentity(resolved)?{named_body:namedBodyIdentity(resolved)}:{}),
          ...(resolved && sharedBodyIdentity(resolved)?{shared_body:sharedBodyIdentity(resolved)}:{}),
          resolution: value && functionLike(value)
            ? value === input ? 'inline_source'
              : value.getSourceFile()===owner?.getSourceFile() && value.pos>=owner.pos && value.end<=owner.end?'local_immutable_callback':'shared_source_callback'
            : 'runtime_or_value_resolution_required' };
      }),
      frontier: 'Source contracts do not identify a committed render, mounted instance, invocation, or captured runtime values.',
    };
  }
  function retainReactBacklog(call, semantic, reason = semantic?.reason) {
    const identity = semantic?.identity || reactImport(call);
    if (!identity) return;
    const row = { call_id: node(call, 'call'), surface: identity.surface, export: identity.exportName,
      version: semantic?.evidence?.version, reason: reason || 'react_semantics_unavailable' };
    if (!output.react_backlog.some(item => stable(item) === stable(row))) output.react_backlog.push(row);
  }
  const wrappedComponentSource = (raw, seen=new Set()) => {
    const value=unwrap(raw);if(!value || seen.has(value) || seen.size>20)return null;
    seen=new Set(seen).add(value);
    if(functionLike(value))return value;
    if(ts.isIdentifier(value)) {
      let binding=symbol(value);if(!binding || mutatedSymbols.has(binding))return null;
      if(binding.flags & ts.SymbolFlags.Alias){try{binding=checker.getAliasedSymbol(binding);}catch{return null;}}
      if(mutatedSymbols.has(binding))return null;
      for(const declaration of binding.declarations||[]) {
        if(!sourceFiles.has(declaration.getSourceFile().fileName))continue;
        if(functionLike(declaration))return declaration;
        if(ts.isVariableDeclaration(declaration) && declaration.parent.flags & ts.NodeFlags.Const)
          return wrappedComponentSource(declaration.initializer,seen);
      }
      return null;
    }
    if(!ts.isCallExpression(value))return null;
    const semantic=resolveReactSemantic(value),rule=semantic?.record?.behavior?.execution;
    if(!semantic?.admitted || rule?.kind!=='component_wrapper')return null;
    const plan=planComponentWrapper(rule,{args:[...value.arguments]});
    return plan.status==='planned'?wrappedComponentSource(plan.fields[rule.component_field],seen):null;
  };
  const wrappedCallback = declaration => {
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer || !ts.isCallExpression(unwrap(declaration.initializer))) return null;
    return wrappedComponentSource(declaration.initializer);
  };
  const registerComponent = (fn, name) => {
    const id = node(fn, 'function');
    functions.set(fn, { id, name, fn });
    if (name && /^[A-Z]/.test(name) && !componentList.some(component => component.fn === fn)) {
      const record = { id, name, file: fn.getSourceFile().fileName };
      output.components.push(record);
      componentList.push({ ...record, fn });
    }
  };
  const registerFunctions = n => {
    if (functionLike(n)) {
      registerComponent(n, fnName(n));
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const callback = wrappedCallback(n);
      if (callback) registerComponent(callback, n.name.text);
    }
    ts.forEachChild(n, registerFunctions);
  };
  for (const sf of sourceFiles.values()) registerFunctions(sf);
  for (const sf of sourceFiles.values()) {
    const scan = current => {
      if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
        const heritage = current.heritageClauses?.flatMap(clause => [...clause.types]).find(type => {
          const identity = reactImport({expression:type.expression});
          return identity?.surface === 'react' && ['Component','PureComponent'].includes(identity.exportName);
        });
        if (heritage) {
          const semantic = resolveReactSemantic({expression:heritage.expression,
            getSourceFile:() => current.getSourceFile()});
          if (semantic?.admitted) {
            const application = retainReactClassSemantic(current, semantic);
            const visitMember = memberNode => {
              if (ts.isCallExpression(memberNode) && ts.isPropertyAccessExpression(memberNode.expression)
                  && memberNode.expression.expression.kind === ts.SyntaxKind.ThisKeyword
                  && ['setState','forceUpdate'].includes(memberNode.expression.name.text)) {
                const callId = node(memberNode, 'call');
                const member = memberNode.expression.name.text;
                const memberBehavior = semantic.record.behavior.members?.[member];
                const callbackBindings = (memberBehavior?.callbacks || []).map(slot => {
                  const match = /arguments\.(\d+)/u.exec(slot.slot);
                  const value = match ? unwrap(memberNode.arguments[Number(match[1])]) : null;
                  let body=null;
                  if(value&&(ts.isFunctionExpression(value)||ts.isArrowFunction(value))&&value.body&&!value.asteriskToken&&!value.modifiers?.some(row=>row.kind===ts.SyntaxKind.AsyncKeyword)
                    &&value.parameters.every(parameter=>ts.isIdentifier(parameter.name)&&!parameter.dotDotDotToken&&!parameter.initializer)){
                    let unsafe=false;const scan=current=>{if(current!==value&&ts.isFunctionLike(current))return;if(ts.isCallExpression(current)&&ts.isIdentifier(current.expression)&&current.expression.text==='eval')unsafe=true;ts.forEachChild(current,scan);};scan(value);
                    if(!unsafe)body={kind:ts.isArrowFunction(value)?'arrow':'function',parameters:value.parameters.map(parameter=>parameter.name.text),
                      start:value.body.getStart()+(ts.isBlock(value.body)?1:0),end:value.body.getEnd()-(ts.isBlock(value.body)?1:0),block:ts.isBlock(value.body)};
                  }
                  return { slot:slot.slot, source_id:functionLike(value) ? node(value, 'function') : null,body,callback_candidate:!!value&&!ts.isObjectLiteralExpression(value)&&!ts.isArrayLiteralExpression(value)&&!ts.isLiteralExpression(value)&&![ts.SyntaxKind.NullKeyword,ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword].includes(value.kind) };
                });
                const updateRule=memberBehavior?.execution;
                if(validateReactExecutionRule(updateRule).valid&&updateRule.kind==='class_update')for(const binding of callbackBindings){
                  const match=/arguments\.(\d+)/.exec(binding.slot),index=match?Number(match[1]):null;
                  const role=index===updateRule.payload_argument?'calculation':index===updateRule.completion_argument?'completion':null;
                  if(binding.source_id&&binding.body&&role)edge(callId,binding.source_id,'callback_forward',null,[{node_id:callId,text:'The callback registered by this call is invoked',branch:'truthy',runtime_observed:false}],{react_semantic_id:semantic.record.id,class_source_id:application.call_id,
                    class_update_member:member,callback_source_id:binding.source_id,callback_role:role,callback_index:index,callback_argument_roles:role==='calculation'?updateRule.calculation_arguments:updateRule.completion_arguments,
                    claim:'source_contract',runtime_observed:false});
                }
                output.react_protocols.push({
                  id:`react-protocol:${digest(stable([application.id, callId, member])).slice(0,24)}`,
                  semantic_id:semantic.record.id, semantic_application_id:application.id,
                  producer_call_id:application.call_id, member_call_id:callId, member,member_rule:memberBehavior?.execution||null,callee_end:memberNode.expression.getEnd(),
                  callback_bindings:callbackBindings, claim:'source_contract', runtime_observed:false,
                });
              }
              ts.forEachChild(memberNode, visitMember);
            };
            for (const member of current.members) visitMember(member);
          } else if (semantic) retainReactBacklog(heritage.expression, semantic);
        }
        return;
      }
      ts.forEachChild(current, scan);
    };
    scan(sf);
  }
  // Root/server calls and JSX boundaries often live outside a component's body.
  // Account for them without pretending they ran during a particular click.
  for (const sf of sourceFiles.values()) {
    const scan = current => {
      if (ts.isCallExpression(current) || ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
        const semantic = resolveReactSemantic(current);
        if (semantic?.admitted) retainReactSemantic(current, semantic);
        else if (semantic) retainReactBacklog(current, semantic);
      }
      ts.forEachChild(current, scan);
    };
    scan(sf);
  }
  // Public value exports (version strings, special element types, class bases,
  // and namespace objects such as Children) are executable source occurrences
  // too. Keep them separate from calls so runtime integration can observe a
  // read without pretending the value itself was invoked.
  for (const sf of sourceFiles.values()) {
    const scan = current => {
      if (ts.isPropertyAccessExpression(current)) {
        const usedAsCallTarget = ts.isCallExpression(current.parent) && current.parent.expression === current;
        const usedAsJsxTag = (ts.isJsxOpeningElement(current.parent)
          || ts.isJsxSelfClosingElement(current.parent) || ts.isJsxClosingElement(current.parent))
          && current.parent.tagName === current;
        if (!usedAsCallTarget && !usedAsJsxTag) {
          const semantic = resolveReactSemantic({ expression: current,
            getSourceFile: () => current.getSourceFile(), parent: current.parent });
          if (semantic?.admitted && !semantic.identity.member) retainReactValueSemantic(current, semantic);
          else if (semantic && !semantic.identity.member) retainReactBacklog(current, semantic);
        }
      }
      ts.forEachChild(current, scan);
    };
    scan(sf);
  }
  function reactHook(call) {
    const identity = reactImport(call);
    return identity?.surface === 'react' ? identity.exportName : null;
  }
  for (const component of componentList) {
    const scan = n => {
      if (n !== component.fn && functionLike(n)) return;
      if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer && ts.isCallExpression(unwrap(n.initializer))) {
        const call = unwrap(n.initializer), hook = reactHook(call), parts = n.name.elements;
        const topLevel = ts.isVariableDeclarationList(n.parent) && ts.isVariableStatement(n.parent.parent) && n.parent.parent.parent === component.fn.body;
        if (['useState', 'useReducer'].includes(hook) && topLevel && parts.length === 2
          && parts.every(p => ts.isBindingElement(p) && ts.isIdentifier(p.name))) {
          const id = `state:${digest(node(n, 'state_declaration')).slice(0, 24)}`;
          const state = { id, kind: hook === 'useReducer' ? 'reducer' : 'state',
            component_id: component.id, hook_call_id:node(call,'call'), value_name: parts[0].name.text,
            setter_name: parts[1].name.text, declaration_id: node(n, 'state_declaration'),
            ...(hook === 'useReducer' ? { reducer_source_id: node(call.arguments[0]),
              initial_source_id: call.arguments[1] ? node(call.arguments[1]) : null,
              initializer_source_id: call.arguments[2] ? node(call.arguments[2]) : null } : {}) };
          output.states.push(state); stateBySymbol.set(symbol(parts[0].name), { kind: 'state', state, role: 'value', node_id: node(parts[0].name) }); stateBySymbol.set(symbol(parts[1].name), { kind: 'state', state, role: 'setter', node_id: node(parts[1].name) });
        } else if ((hook || /use[A-Z]/.test(call.expression.getText())) && !(hook==='useTransition' && resolveReactSemantic(call)?.admitted)) issue('unsupported_hook', call, 'This call is not a supported imported React useState binding.');
      } else if(ts.isVariableDeclaration(n)&&ts.isArrayBindingPattern(n.name)&&n.initializer) {
        const source=unwrap(n.initializer),tuple=ts.isIdentifier(source)?stateBySymbol.get(symbol(source)):null;
        if(tuple?.kind==='state_tuple'&&n.name.elements.length===2
          &&n.name.elements.every(part=>ts.isBindingElement(part)&&ts.isIdentifier(part.name))) {
          stateBySymbol.set(symbol(n.name.elements[0].name),{kind:'state',state:tuple.state,role:'value',node_id:node(n.name.elements[0].name)});
          stateBySymbol.set(symbol(n.name.elements[1].name),{kind:'state',state:tuple.state,role:'setter',node_id:node(n.name.elements[1].name)});
        }
      } else if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer&&ts.isCallExpression(unwrap(n.initializer))) {
        const call=unwrap(n.initializer),hook=reactHook(call);
        const topLevel=ts.isVariableDeclarationList(n.parent)&&ts.isVariableStatement(n.parent.parent)&&n.parent.parent.parent===component.fn.body;
        if(['useState','useReducer'].includes(hook)&&topLevel) {
          const id=`state:${digest(node(n,'state_declaration')).slice(0,24)}`;
          const state={id,kind:hook==='useReducer'?'reducer':'state',component_id:component.id,
            hook_call_id:node(call,'call'),value_name:null,setter_name:null,declaration_id:node(n,'state_declaration'),
            ...(hook==='useReducer'?{reducer_source_id:node(call.arguments[0]),initial_source_id:call.arguments[1]?node(call.arguments[1]):null,
              initializer_source_id:call.arguments[2]?node(call.arguments[2]):null}:{})};
          output.states.push(state);stateBySymbol.set(symbol(n.name),{kind:'state_tuple',state,node_id:node(n.name)});
        }
      } else if (ts.isCallExpression(n)) {
        const hook = reactHook(n);
        if (hook) {
          const semantic = resolveReactSemantic(n);
          if (semantic?.admitted) retainReactSemantic(n, semantic);
          else if (hook === 'useCallback') retainReactBacklog(n, semantic);
          if (hook === 'useCallback' && !semantic?.admitted) {
            issue('react_semantics_unattested', n,
              `React useCallback semantics were not admitted (${semantic?.reason || 'react_semantics_unavailable'}).`);
          } else if (semantic?.record?.disposition === 'unsupported') {
            retainReactBacklog(n, semantic, 'react_api_explicitly_unsupported');
            issue('unsupported_hook', n, `React ${hook} is inventoried but its tracing semantics are unsupported.`);
          } else if (!['useState', 'useReducer', 'useCallback', 'useMemo', 'useContext', 'useRef', 'useTransition', 'useDeferredValue'].includes(hook)
            && semantic?.record?.semantic_kind !== 'synchronous_scope'
            && semantic?.record?.disposition !== 'no_relevant_tracing_effect') {
            issue('unsupported_hook', n, `React ${hook} execution semantics are not modeled.`);
          }
        }
      }
      ts.forEachChild(n, scan);
    };
    scan(component.fn);
  }
  const descriptor = value => {
    if (!value) return { kind: 'unknown' };
    const contextProvenance = value.react_context_id
      ? { react_context_id: value.react_context_id } : {};
    if (value.kind === 'literal') return { kind: 'literal', value: value.value,
      ...(value.node_id ? { node_id: value.node_id } : {}), ...contextProvenance };
    if (value.kind === 'function') return { kind: 'function', node_id: node(value.fn, 'function'),
      ...contextProvenance };
    if (value.kind === 'state') return { kind: 'state', state_id: value.state.id, role: value.role, ...(value.placement ? { placement_id: value.placement.id } : {}) };
    if (value.kind === 'react_ref' || value.kind === 'react_ref_current') return {
      kind: value.kind, ref_id: value.ref.id, role: value.kind === 'react_ref' ? 'object' : 'current',
      ...(value.placement ? { placement_id: value.placement.id } : {}),
    };
    if (value.kind === 'react_context') return { kind: 'react_context', context_id: value.context.id };
    if (value.kind === 'react_root') return { kind: 'react_root', root_source_id: value.root.call_id };
    if (value.kind === 'object') return { kind: 'object',
      properties: Object.fromEntries([...value.fields].map(([key, val]) => [key, descriptor(val)])),
      ...contextProvenance };
    return { kind: 'source', ...(value.node_id ? { node_id: value.node_id } : {}),
      ...(value.text ? { text: value.text } : {}), ...contextProvenance };
  };
  const missing = Object.freeze({ kind: 'missing' });
  const unknown = n => ({ kind: 'source', node_id: n ? node(n) : undefined, text: n?.getText() });
  const importedIdentity = raw => {
    const expression = unwrap(raw);
    if (ts.isIdentifier(expression)) {
      const declaration = symbol(expression)?.declarations?.find(ts.isImportSpecifier);
      if (declaration) {
        const imp = declaration.parent.parent.parent;
        if (ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier)) {
          return { package: imp.moduleSpecifier.text, member: (declaration.propertyName || declaration.name).text };
        }
      }
      const defaultDeclaration = symbol(expression)?.declarations?.find(ts.isImportClause);
      if (defaultDeclaration?.name === expression) {
        const imp = defaultDeclaration.parent;
        if (ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier)) {
          return { package: imp.moduleSpecifier.text, member: 'default' };
        }
      }
    }
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const declarations = symbol(expression.expression)?.declarations || [];
      const declaration = declarations.find(item => ts.isNamespaceImport(item) || ts.isImportClause(item));
      if (declaration) {
        const imp = ts.isNamespaceImport(declaration) ? declaration.parent.parent : declaration.parent;
        if (ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier)) {
          return { package: imp.moduleSpecifier.text, member: expression.name.text };
        }
      }
    }
    return null;
  };
  const contractEvidence = (evidence, contract) => {
    if (!evidence) return null;
    if (!Array.isArray(evidence.contract_verifications)) return evidence;
    const verification = evidence.contract_verifications.find(row => row.contract_id === contract.id);
    return verification ? { ...evidence, ...verification } : { ...evidence, verified: false, reason: 'contract_source_verification_unavailable' };
  };
  const returnedFunction = (factory, context, placement) => {
    if (factory.kind !== 'function' || !factory.fn.body) return null;
    const env = new Map(factory.env);
    if (factory.fn.parameters[0]) bindPattern(factory.fn.parameters[0].name, context, env, placement);
    let expression = null;
    if (!ts.isBlock(factory.fn.body)) expression = factory.fn.body;
    else {
      const returns = factory.fn.body.statements.filter(ts.isReturnStatement);
      if (returns.length === 1 && returns[0] === factory.fn.body.statements.at(-1)) expression = returns[0].expression;
    }
    const value = expression ? evaluate(expression, env, placement) : null;
    return value?.kind === 'function' ? value : null;
  };
  const returnedLibraryCallable = (call, env, placement) => {
    const identity = importedIdentity(call.expression);
    if (!identity) return null;
    const firstPartyImport = relativeImport(identity.package, call.getSourceFile().fileName);
    if (firstPartyImport) {
      const target = exportedFunction(firstPartyImport, identity.member);
      if (!target?.body) return null;
      const childEnv = prepareFunctionEnvironment(target, [...call.arguments], env, placement);
      let expression = null;
      if (!ts.isBlock(target.body)) expression = target.body;
      else {
        const final = target.body.statements.at(-1);
        const prior = target.body.statements.slice(0, -1);
        if (ts.isReturnStatement(final) && final.expression && prior.every(statement => ts.isVariableStatement(statement))
          && prior.reduce((count, statement) => count + statement.declarationList.declarations.length, 0) <= 1) {
          expression = final.expression;
        }
      }
      const modeled = expression ? evaluate(expression, childEnv, placement) : null;
      return modeled?.kind === 'library_callable'
        ? { ...modeled, wrapper_call_ids: [node(call, 'call'), ...(modeled.wrapper_call_ids || [])] }
        : modeled?.kind === 'library_unresolved' ? modeled : null;
    }
    const evidence = packageInstallation(identity.package, call.getSourceFile().fileName);
    if (!evidence) return null;
    const contracts = producerContracts({ packageName: identity.package, version: evidence.version,
      producer: identity.member, kind: 'factory_returns_callback' });
    if (contracts.length !== 1) return null;
    const contract = contracts[0], admittedEvidence = contractEvidence(evidence, contract);
    if (admittedEvidence.verified !== true) return { kind: 'library_unresolved', contract, evidence: admittedEvidence,
      producer_call: call, reason: admittedEvidence.reason || 'package_installation_unverified' };
    const factoryExpression = call.arguments[contract.factory_argument];
    const factory = factoryExpression ? evaluate(factoryExpression, env, placement) : null;
    const callbackContext = { kind: 'object', fields: new Map(['snapshot', 'set', 'reset', 'refresh', 'gotoSnapshot', 'transact_UNSTABLE']
      .map(name => [name, { kind: 'source', text: `${contract.package}.${contract.producer}.${name}` }])) };
    const callback = returnedFunction(factory, callbackContext, placement);
    if (!callback) return { kind: 'library_unresolved', contract, evidence: admittedEvidence,
      producer_call: call, reason: 'contract_callback_unresolved' };
    return { kind: 'library_callable', contract, evidence: admittedEvidence, producer_call: call,
      callback, callback_context: callbackContext, wrapper_call_ids: [] };
  };
  const returnedLibraryObject = (call, importerFile) => {
    const identity = importedIdentity(call.expression);
    if (!identity || relativeImport(identity.package, importerFile)) return null;
    const evidence = packageInstallation(identity.package, importerFile);
    if (!evidence) return null;
    const contracts = producerContracts({ packageName: identity.package, version: evidence.version, producer: identity.member })
      .filter(contract => contract.kind === 'returned_member_returns_callback');
    if (!contracts.length) return null;
    const fields = new Map();
    for (const contract of contracts) {
      const admittedEvidence = contractEvidence(evidence, contract);
      fields.set(contract.returned_member, admittedEvidence.verified === true
        ? { kind: 'library_callback_factory', contract, evidence: admittedEvidence, producer_call: call, wrapper_call_ids: [] }
        : { kind: 'library_unresolved', contract, evidence: admittedEvidence, producer_call: call,
          reason: admittedEvidence.reason || 'package_installation_unverified' });
    }
    return { kind: 'object', fields };
  };
  const returnedLibraryEffect = (call, importerFile) => {
    const identity = importedIdentity(call.expression);
    if (!identity || relativeImport(identity.package, importerFile)) return null;
    const evidence = packageInstallation(identity.package, importerFile);
    if (!evidence) return null;
    const contracts = producerContracts({ packageName: identity.package, version: evidence.version,
      producer: identity.member, kind: 'returned_function_effect' });
    if (contracts.length !== 1) return null;
    const contract = contracts[0], admittedEvidence = contractEvidence(evidence, contract);
    return admittedEvidence.verified === true
      ? { kind: 'library_effect_callable', contract, evidence: admittedEvidence, producer_call: call, wrapper_call_ids: [] }
      : { kind: 'library_unresolved', contract, evidence: admittedEvidence, producer_call: call,
        reason: admittedEvidence.reason || 'package_installation_unverified' };
  };
  const directLibraryRender = (call, env, placement) => {
    const identity = importedIdentity(call.expression);
    if (!identity || relativeImport(identity.package, call.getSourceFile().fileName)) return null;
    const evidence = packageInstallation(identity.package, call.getSourceFile().fileName);
    if (!evidence) return null;
    const contracts = producerContracts({ packageName: identity.package, version: evidence.version,
      producer: identity.member, kind: 'function_renders_argument' });
    if (contracts.length !== 1) return null;
    const contract = contracts[0], admittedEvidence = contractEvidence(evidence, contract);
    if (admittedEvidence.verified !== true) return { status: 'backlog', contract, evidence: admittedEvidence,
      reason: admittedEvidence.reason || 'package_installation_unverified' };
    const rendered = call.arguments[contract.render_argument]
      ? evaluate(call.arguments[contract.render_argument], env, placement) : missing;
    const props = call.arguments[contract.props_argument]
      ? evaluate(call.arguments[contract.props_argument], env, placement) : missing;
    if (rendered.kind !== 'function') return { status: 'backlog', contract, evidence: admittedEvidence,
      reason: rendered.kind === 'literal' && rendered.value == null ? 'contract_render_argument_empty'
        : 'contract_render_argument_ambiguous' };
    return { status: 'modeled', contract, evidence: admittedEvidence, rendered, props };
  };
  const directLibraryEffect = call => {
    const identity = importedIdentity(call.expression);
    if (!identity || relativeImport(identity.package, call.getSourceFile().fileName)) return null;
    const evidence = packageInstallation(identity.package, call.getSourceFile().fileName);
    if (!evidence) return null;
    const contracts = producerContracts({ packageName: identity.package, version: evidence.version,
      producer: identity.member, kind: 'direct_function_effect' });
    if (contracts.length !== 1) return null;
    const contract = contracts[0], admittedEvidence = contractEvidence(evidence, contract);
    return admittedEvidence.verified === true
      ? { kind: 'library_effect_callable', contract, evidence: admittedEvidence,
        producer_call: call, wrapper_call_ids: [] }
      : { kind: 'library_unresolved', contract, evidence: admittedEvidence, producer_call: call,
        reason: admittedEvidence.reason || 'package_installation_unverified' };
  };
  /* Keep workspace module traversal lazy. A namespace import can expose hundreds of
   * exports, but a product path uses one member at a time. Resolving that member on
   * demand both bounds the analysis and lets us reject duplicate barrel exports
   * before any callback or library effect is attributed to the scenario. */
  const workspaceNamespace = (file, declaration) => ({
    kind: 'workspace_namespace', file, node_id: declaration ? node(declaration, 'binding') : undefined,
  });
  const workspaceLocalValue = (file, name, env, placement, exportTrail) => {
    const sf = sourceFiles.get(file);
    if (!sf) return null;
    const candidates = [];
    const add = (origin, value) => { if (value) candidates.push({ origin, value }); };
    for (const statement of sf.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        if (!mutatedSymbols.has(symbol(statement.name))) {
          add(node(statement, 'function'), { kind: 'function', fn: statement, env: new Map(env), placement });
        }
        continue;
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer
            || mutatedSymbols.has(symbol(declaration.name))) continue;
          add(node(declaration, 'binding'), evaluate(declaration.initializer, env, placement));
        }
        continue;
      }
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || !statement.importClause) continue;
      const target = relativeImport(statement.moduleSpecifier.text, file);
      if (!target) continue;
      const clause = statement.importClause;
      if (clause.name?.text === name && !mutatedSymbols.has(symbol(clause.name))) {
        const resolved = workspaceExportValue(target, 'default', env, placement, exportTrail);
        if (resolved) add(resolved.origin, resolved.value);
      }
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)
        && clause.namedBindings.name.text === name
        && !mutatedSymbols.has(symbol(clause.namedBindings.name))) {
        add(`namespace:${target}`, workspaceNamespace(target, clause.namedBindings));
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) {
          if (specifier.name.text !== name || mutatedSymbols.has(symbol(specifier.name))) continue;
          const importedName = (specifier.propertyName || specifier.name).text;
          const resolved = workspaceExportValue(target, importedName, env, placement, exportTrail);
          if (resolved) add(resolved.origin, resolved.value);
        }
      }
    }
    const unique = new Map(candidates.map(candidate => [candidate.origin, candidate]));
    return unique.size === 1 ? [...unique.values()][0] : null;
  };
  const workspaceMayExport = (file, name, trail = new Set()) => {
    const key = `${file}:${name}`;
    if (trail.has(key)) return false;
    trail = new Set(trail).add(key);
    const sf = sourceFiles.get(file);
    if (!sf) return true;
    for (const statement of sf.statements) {
      const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && ts.isFunctionDeclaration(statement) && statement.name?.text === name) return true;
      if (exported && ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name)
          && declaration.name.text === name)) return true;
      if (name === 'default' && ts.isExportAssignment(statement) && !statement.isExportEquals) return true;
      if (!ts.isExportDeclaration(statement)) continue;
      const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? relativeImport(statement.moduleSpecifier.text, file) : null;
      if (!statement.exportClause) {
        if (!target || workspaceMayExport(target, name, trail)) return true;
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        if (statement.exportClause.name.text === name) return true;
      } else if (ts.isNamedExports(statement.exportClause)
        && statement.exportClause.elements.some(specifier => specifier.name.text === name)) return true;
    }
    return false;
  };
  function workspaceExportValue(file, name, env, placement, trail = new Set()) {
    const key = `${file}:${name}`;
    if (trail.has(key)) return null;
    trail = new Set(trail).add(key);
    const sf = sourceFiles.get(file);
    if (!sf) return null;
    const explicit = [], stars = [];
    let uncertainExplicit = false, uncertainStar = false;
    const add = (list, origin, value) => { if (value) list.push({ origin, value }); };
    for (const statement of sf.statements) {
      const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && ts.isFunctionDeclaration(statement) && statement.name?.text === name
        && !mutatedSymbols.has(symbol(statement.name))) {
        add(explicit, node(statement, 'function'), {
          kind: 'function', fn: statement, env: new Map(env), placement,
        });
      }
      if (exported && ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer
            || mutatedSymbols.has(symbol(declaration.name))) continue;
          add(explicit, node(declaration, 'binding'), evaluate(declaration.initializer, env, placement));
        }
      }
      if (name === 'default' && ts.isExportAssignment(statement) && !statement.isExportEquals) {
        add(explicit, node(statement, 'binding'), evaluate(statement.expression, env, placement));
      }
      if (!ts.isExportDeclaration(statement)) continue;
      const hasModule = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier);
      const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? relativeImport(statement.moduleSpecifier.text, file) : null;
      if (!statement.exportClause && hasModule) {
        if (!target) uncertainStar = true;
        else {
          const resolved = workspaceExportValue(target, name, env, placement, trail);
          if (resolved) stars.push(resolved);
          else if (workspaceMayExport(target, name)) uncertainStar = true;
        }
        continue;
      }
      if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
        if (statement.exportClause.name.text === name) {
          if (target) add(explicit, `namespace:${target}`, workspaceNamespace(target, statement.exportClause));
          else uncertainExplicit = true;
        }
        continue;
      }
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
      for (const specifier of statement.exportClause.elements) {
        if (specifier.name.text !== name) continue;
        const local = (specifier.propertyName || specifier.name).text;
        if (hasModule && target) {
          const resolved = workspaceExportValue(target, local, env, placement, trail);
          if (resolved) explicit.push(resolved);
          else if (workspaceMayExport(target, local)) uncertainExplicit = true;
        } else if (hasModule) {
          uncertainExplicit = true;
        } else {
          const resolved = workspaceLocalValue(file, local, env, placement, trail);
          if (resolved) explicit.push(resolved);
          else uncertainExplicit = true;
        }
      }
    }
    if (uncertainExplicit || !explicit.length && uncertainStar) return null;
    const selected = explicit.length ? explicit : stars;
    const unique = new Map(selected.map(candidate => [candidate.origin, candidate]));
    return unique.size === 1 ? [...unique.values()][0] : null;
  }
  const importedSourceValue = (expression, env, placement, seen) => {
    if (!ts.isIdentifier(expression)) return null;
    const declaration = symbol(expression)?.declarations?.find(item => ts.isImportClause(item)
      || ts.isImportSpecifier(item) || ts.isNamespaceImport(item));
    if (!declaration) return null;
    const imp = ts.isImportClause(declaration) ? declaration.parent
      : ts.isNamespaceImport(declaration) ? declaration.parent.parent : declaration.parent.parent.parent;
    if (!ts.isImportDeclaration(imp) || !ts.isStringLiteral(imp.moduleSpecifier)) return null;
    const file = relativeImport(imp.moduleSpecifier.text, expression.getSourceFile().fileName);
    if (!file) return null;
    if (ts.isImportClause(declaration)) {
      return workspaceExportValue(file, 'default', env, placement)?.value || null;
    }
    if (ts.isNamespaceImport(declaration)) {
      return workspaceNamespace(file, declaration);
    }
    if (ts.isImportSpecifier(declaration)) {
      const name = (declaration.propertyName || declaration.name).text;
      return workspaceExportValue(file, name, env, placement)?.value || null;
    }
    return null;
  };
  function knownReactContext(raw, seen = new Set()) {
    const n = unwrap(raw);
    if (!n || seen.has(n) || seen.size > 40) return null;
    seen = new Set(seen).add(n);
    if (ts.isIdentifier(n)) {
      const sym = symbol(n);
      if (!sym || mutatedSymbols.has(sym)) return null;
      const declaration = sym.declarations?.find(value => ts.isVariableDeclaration(value) && value.initializer);
      return declaration ? knownReactContext(declaration.initializer, seen) : null;
    }
    if (!ts.isCallExpression(n)) return null;
    const semantic = resolveReactSemantic(n);
    if (!semantic?.admitted || semantic.identity.surface !== 'react'
        || semantic.identity.exportName !== 'createContext') return null;
    const callId = node(n, 'call');
    const value = output.react_values.find(candidate => candidate.kind === 'context'
      && candidate.call_id === callId);
    if (!value) return null;
    return { id: value.id, call_id: callId, default_value: value.default_value,
      semantic_id: semantic.record.id,
      semantic_application_id: output.react_semantics.find(row => row.call_id === callId
        && row.semantic_id === semantic.record.id)?.id || null };
  }
  const invokeLibraryCallbackFactory = (factory, call, env, placement) => {
    const callables = [];
    for (const spec of factory.contract.callback_arguments || []) {
      const expression = call.arguments[spec.argument];
      if (!expression) {
        if (spec.required) return { kind: 'library_unresolved', contract: factory.contract, evidence: factory.evidence,
          producer_call: factory.producer_call, reason: 'contract_callback_unresolved' };
        continue;
      }
      const callback = evaluate(expression, env, placement);
      if (callback.kind !== 'function') return { kind: 'library_unresolved', contract: factory.contract,
        evidence: factory.evidence, producer_call: factory.producer_call, reason: 'contract_callback_ambiguous' };
      const callbackValues = (spec.callback_argument_object || factory.contract.callback_argument_object || []).map(name => ({
        kind: 'source', text: `${factory.contract.package}.${factory.contract.returned_member}.${name}`,
      }));
      callables.push({ kind: 'library_callable', contract: factory.contract, evidence: factory.evidence,
        producer_call: factory.producer_call, intermediate_call: call, callback,
        callback_values: callbackValues, contract_branch: spec.branch,
        wrapper_call_ids: factory.wrapper_call_ids || [] });
    }
    return { kind: 'library_callable_set', callables };
  };
  function evaluate(raw, env, placement, seen = new Set()) {
    const n = unwrap(raw); if (!n) return { kind: 'unknown' };
    if (seen.has(n) || seen.size > 40) return unknown(n);
    seen = new Set(seen).add(n);
    if (functionLike(n)) return { kind: 'function', fn: n, env: new Map(env), placement };
    if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n)) return { kind: 'literal', value: ts.isNumericLiteral(n) ? Number(n.text) : n.text, node_id: node(n) };
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: n.kind === ts.SyntaxKind.NullKeyword ? null : n.kind === ts.SyntaxKind.TrueKeyword, node_id: node(n) };
    if (ts.isConditionalExpression(n)) {
      const condition = evaluate(n.condition, env, placement, seen);
      if (condition.kind === 'literal') return evaluate(condition.value ? n.whenTrue : n.whenFalse, env, placement, seen);
      return unknown(n);
    }
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
      const value = evaluate(n.operand, env, placement, seen);
      return value.kind === 'literal' ? { kind: 'literal', value: !value.value, node_id: node(n) } : unknown(n);
    }
    if (ts.isPrefixUnaryExpression(n)
      && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(n.operator)) {
      const value = evaluate(n.operand, env, placement, seen);
      return value.kind === 'literal' && typeof value.value === 'number'
        ? { kind: 'literal', value: n.operator === ts.SyntaxKind.MinusToken ? -value.value : value.value,
          node_id: node(n) }
        : unknown(n);
    }
    if (ts.isIdentifier(n)) {
      let sym = symbol(n);
      if (mutatedSymbols.has(sym)) return unknown(n);
      if (env.has(sym)) return env.get(sym);
      if (stateBySymbol.has(sym)) { const state = stateBySymbol.get(sym); let owner = placement; while (owner && owner.component_id !== state.state.component_id) owner = output.placements.find(p => p.id === owner.parent_id); return owner ? { ...state, placement: owner } : unknown(n); }
      const imported = importedSourceValue(n, env, placement, seen);
      if (imported) return imported;
      if (sym?.flags & ts.SymbolFlags.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch {} }
      if (mutatedSymbols.has(sym)) return unknown(n);
      for (const declaration of sym?.declarations || []) {
        if (functionLike(declaration)) return { kind: 'function', fn: declaration, env: new Map(env), placement };
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) return evaluate(declaration.initializer, env, placement, seen);
        if(ts.isBindingElement(declaration) && ts.isArrayBindingPattern(declaration.parent)) {
          const variable=declaration.parent.parent;
          if(ts.isVariableDeclaration(variable) && variable.initializer && variable.parent.flags & ts.NodeFlags.Const && !declaration.dotDotDotToken) {
            const tuple=evaluate(variable.initializer,env,placement,seen),index=declaration.parent.elements.indexOf(declaration);
            if(tuple.kind==='react_transition_tuple')return index===tuple.rule.start_index?{kind:'react_transition_start',root:tuple.root,rule:tuple.rule,member:'startTransition'}:unknown(n);
          }
        }
        if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
          const variable = declaration.parent.parent;
          if (ts.isVariableDeclaration(variable) && variable.initializer) {
            const object = evaluate(variable.initializer, env, placement, seen);
            const key = declaration.propertyName?.getText().replace(/^['"]|['"]$/gu, '') || declaration.name.getText();
            if (object.kind === 'object') return object.fields.get(key) || unknown(n);
          }
        }
      }
    }
    if (ts.isPropertyAccessExpression(n)) {
      const receiver = evaluate(n.expression, env, placement, seen);
      if (receiver.kind === 'object') return receiver.fields.get(n.name.text) || unknown(n);
      if (receiver.kind === 'memo_alternatives') return {...receiver,options:receiver.options.map(option=>({
        ...option,value:option.value.kind==='object'?option.value.fields.get(n.name.text)||unknown(n):unknown(n)}))};
      if (receiver.kind === 'react_ref' && n.name.text === 'current') {
        return { kind: 'react_ref_current', ref: receiver.ref, placement: receiver.placement };
      }
      if (receiver.kind === 'react_context' && ['Provider', 'Consumer'].includes(n.name.text)) {
        return { kind: 'react_context_member', context: receiver.context, member: n.name.text };
      }
      if (receiver.kind === 'react_root' && ['render', 'unmount'].includes(n.name.text)) {
        return { kind: 'react_root_member', root: receiver.root, member: n.name.text };
      }
      if (receiver.kind === 'workspace_namespace') {
        return workspaceExportValue(receiver.file, n.name.text, env, placement)?.value || unknown(n);
      }
    }
    if(ts.isElementAccessExpression(n)&&n.argumentExpression
      &&(ts.isStringLiteral(n.argumentExpression)||ts.isNumericLiteral(n.argumentExpression))){
      const receiver=evaluate(n.expression,env,placement,seen);
      if(receiver.kind==='workspace_namespace'&&ts.isStringLiteral(n.argumentExpression))return workspaceExportValue(receiver.file,n.argumentExpression.text,env,placement)?.value||unknown(n);
      if(receiver.kind==='state_tuple'&&['0','1'].includes(n.argumentExpression.text))return {
        kind:'state',state:receiver.state,role:n.argumentExpression.text==='0'?'value':'setter',node_id:node(n),placement:receiver.placement,
      };
    }
    if (ts.isObjectLiteralExpression(n)) {
      const fields = new Map();
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) fields.set(p.name.text, evaluate(p.initializer, env, placement, seen));
        else if (ts.isMethodDeclaration(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
          fields.set(p.name.text, { kind: 'function', fn: p, env: new Map(env), placement });
        }
        else if (ts.isShorthandPropertyAssignment(p)) {
          const sym = checker.getShorthandAssignmentValueSymbol(p);
          const declaration = sym?.declarations?.find(item => functionLike(item)
            || ts.isVariableDeclaration(item) && item.initializer);
          const resolved = env.get(sym)
            || (functionLike(declaration) ? { kind: 'function', fn: declaration, env: new Map(env), placement }
              : declaration?.initializer ? evaluate(declaration.initializer, env, placement, seen) : null)
            || evaluate(p.name, env, placement, seen);
          fields.set(p.name.text, resolved);
        }
        else return unknown(n);
      }
      return { kind: 'object', fields };
    }
    if (ts.isCallExpression(n)) {
      const semantic = resolveReactSemantic(n);
      if (semantic?.admitted && semantic.identity.surface === 'react'
          && ['createContext', 'createRef', 'useRef', 'useContext'].includes(semantic.identity.exportName)) {
        retainReactSemantic(n, semantic);
        const callId = node(n, 'call');
        if (semantic.identity.exportName === 'createContext') {
          const application = output.react_semantics.find(row => row.call_id === callId
            && row.semantic_id === semantic.record.id);
          const defaultValue = evaluate(n.arguments[0], env, placement, seen);
          const context = { id: `react-context:${digest(callId).slice(0, 24)}`, call_id: callId,
            default_value: defaultValue, semantic_id: semantic.record.id,
            semantic_application_id: application?.id || null };
          if (application) application.causal_bindings.context_id = context.id;
          if (!output.react_values.some(value => value.id === context.id)) {
            output.react_values.push({ id:context.id, call_id:callId, default_value:descriptor(defaultValue),
              kind: 'context', component_id: null });
          }
          return { kind: 'react_context', context };
        }
        if (semantic.identity.exportName === 'createRef' || semantic.identity.exportName === 'useRef') {
          const ref = { id: `react-ref:${digest(stable([callId, semantic.identity.exportName])).slice(0, 24)}`,
            call_id: callId, initial_value: semantic.identity.exportName === 'createRef'
              ? { kind: 'literal', value: null } : descriptor(evaluate(n.arguments[0], env, placement, seen)) };
          if (!output.react_values.some(value => value.id === ref.id)) {
            output.react_values.push({ ...ref, kind: semantic.identity.exportName === 'createRef' ? 'created_ref' : 'hook_ref',
              component_id: semantic.identity.exportName === 'useRef'
                ? output.placements.find(value => value.id === placement?.id)?.component_id || null : null });
          }
          return { kind: 'react_ref', ref, placement };
        }
        let contextValue = evaluate(n.arguments[0], env, placement, seen);
        if (contextValue.kind !== 'react_context') {
          const context = knownReactContext(n.arguments[0]);
          if (!context) return unknown(n);
          contextValue = { kind: 'react_context', context };
        }
        const application = output.react_semantics.find(row => row.call_id === callId
          && row.semantic_id === semantic.record.id);
        if (application) application.causal_bindings.context_id = contextValue.context.id;
        const contexts = env.get(REACT_CONTEXT_ENV);
        const selected = contexts instanceof Map && contexts.has(contextValue.context.id)
          ? contexts.get(contextValue.context.id) : contextValue.context.default_value;
        return { ...selected, react_context_id: contextValue.context.id };
      }
      if(semantic?.admitted && semantic.identity.surface==='react'
        && semantic.record.behavior?.execution?.kind==='state_queue') {
        retainReactSemantic(n,semantic);
        const state=output.states.find(row=>row.hook_call_id===node(n,'call'));
        return state?{kind:'state_tuple',state,placement}:unknown(n);
      }
      if(semantic?.admitted && semantic.identity.surface==='react' && semantic.record.behavior?.execution?.kind==='transition_hook') {
        retainReactSemantic(n,semantic);
        return {kind:'react_transition_tuple',rule:semantic.record.behavior.execution,
          root:{call_id:node(n,'call'),semantic_id:semantic.record.id,
            semantic_application_id:output.react_semantics.find(row=>row.call_id===node(n,'call'))?.id}};
      }
      if (semantic?.admitted && ['react-dom', 'react-dom/client'].includes(semantic.identity.surface)
          && ['createRoot', 'hydrateRoot'].includes(semantic.identity.exportName)) {
        retainReactSemantic(n, semantic);
        return { kind: 'react_root', root: { call_id: node(n, 'call'), semantic_id: semantic.record.id,
          semantic_application_id: output.react_semantics.find(row => row.call_id === node(n, 'call'))?.id,
          surface: semantic.identity.surface, export: semantic.identity.exportName } };
      }
      if (semantic?.identity.surface === 'react' && semantic.identity.exportName === 'useCallback') {
        if (!semantic.admitted || semantic.record?.semantic_kind !== 'retained_callback') {
          retainReactBacklog(n, semantic);
          return unknown(n);
        }
        retainReactSemantic(n, semantic);
        const callback = unwrap(n.arguments[0]);
        // React may return the callback retained from an earlier render. Its
        // source occurrence stays known, but current props cannot stand in for
        // the values captured by that older function.
        const callbackValue = evaluate(callback, env, placement, seen);
        if (callbackValue.kind !== 'function') {
          retainReactBacklog(n, semantic, 'memoized_callback_identity_unresolved');
          issue('memoized_callback_identity_unresolved', n,
            'The useCallback input does not resolve to one immutable source function.', placement);
          return unknown(n);
        }
        const captured = new Map([...env].map(([key, current]) =>
          [key, key === REACT_CONTEXT_ENV ? current : unknown(n)]));
        issue('memoized_callback_capture_unresolved', n,
          'The inline callback source is known; retained render captures and runtime invocation remain unproved.', placement);
        return { kind: 'function', fn: callbackValue.fn, env: captured, placement,
          producer_call_id: node(n, 'call'), react_semantic_id: semantic.record.id };
      }
      if (semantic?.admitted && semantic.identity.surface === 'react'
          && semantic.record.behavior?.execution?.kind === 'memo_value') {
        retainReactSemantic(n, semantic);
        const argument=n.arguments[semantic.record.behavior.execution.callback_argument];
        // Keep function sources, but never choose a calculator from concrete
        // props belonging to a newer render of a retained cache.
        const choiceEnv=new Map([...env].map(([key,value])=>[key,key===REACT_CONTEXT_ENV
          || ['function','workspace_namespace'].includes(value?.kind)?value:unknown(n)]));
        const alternatives=callbackAlternatives(argument,choiceEnv,placement);
        const application=output.react_semantics.find(row=>row.call_id===node(n,'call'));
        retainMemoCandidates(application,argument,alternatives);
        if(!alternatives.complete||!alternatives.options.length||alternatives.options.length>32
          ||alternatives.options.some(({callback:factory})=>factory.fn.asteriskToken
            ||ts.getCombinedModifierFlags(factory.fn)&ts.ModifierFlags.Async)){
          retainReactBacklog(n,semantic,'memo_calculator_source_unresolved');return unknown(n);
        }
        const resultCallbacks=[],values=[];
        const mark=(value,path=[])=>{
          if(value.kind==='function') {
            if(!resultCallbacks.some(row=>row.source_id===node(value.fn,'function') && JSON.stringify(row.path)===JSON.stringify(path)))
              resultCallbacks.push({path,source_id:node(value.fn,'function'),captures:captures(value.fn)});
            return {...value,producer_call_id:node(n,'call'),react_semantic_id:semantic.record.id};
          }
          return value.kind==='object'?{...value,fields:new Map([...value.fields].map(([key,field])=>[key,mark(field,[...path,key])]))}:value;
        };
        for(const {callback:factory,conditions} of alternatives.options){
          const returned=memoReturnAlternatives(factory.fn);
          if(!returned.complete){retainReactBacklog(n,semantic,'memo_calculator_return_unresolved');return unknown(n);}
          const captured=new Map([...factory.env].map(([key,current])=>[key,key===REACT_CONTEXT_ENV?current:unknown(n)]));
          const childEnv=prepareFunctionEnvironment(factory.fn,[],captured,placement);
          for(const option of returned.options)for(const shape of memoExpressionAlternatives(option.expression,[...conditions,...option.conditions]))
            values.push({conditions:shape.conditions,value:mark(evaluate(shape.expression,childEnv,placement,new Set(seen).add(n)))});
        }
        if(values.length>32 || values.some(value=>value.conditions.length>32)) {
          retainReactBacklog(n,semantic,'memo_return_alternatives_limit');return unknown(n);
        }
        const marked=values.length===1 && !values[0].conditions.length?values[0].value
          :{kind:'memo_alternatives',options:values};
        if(application)application.causal_bindings.result_callbacks=resultCallbacks;
        issue('memoized_value_capture_unresolved',n,
          'The calculator return shape is known; selected cache identity and old captures require runtime evidence.',placement);
        return marked;
      }
      const target = evaluate(n.expression, env, placement, seen);
      if (target.kind === 'library_callback_factory') return invokeLibraryCallbackFactory(target, n, env, placement);
      return returnedLibraryObject(n, n.getSourceFile().fileName)
        || returnedLibraryEffect(n, n.getSourceFile().fileName)
        || returnedLibraryCallable(n, env, placement) || unknown(n);
    }
    return unknown(n);
  }
  function retainMemoCandidates(application,argument,alternatives){
    if(!application||functionLike(unwrap(argument)))return;
    const slot=application.causal_bindings.callbacks.find(row=>row.slot==='arguments.0');if(!slot)return;
    const candidates=slot.candidates||(slot.candidates=[]);
    for(const {callback} of alternatives.options.slice(0,32)){
      if(callback.fn.asteriskToken||ts.getCombinedModifierFlags(callback.fn)&ts.ModifierFlags.Async)continue;
      const sourceId=node(callback.fn,'function');
      if(!candidates.some(row=>row.source_id===sourceId))candidates.push({source_id:sourceId,captures:captures(callback.fn),resolution:'runtime_source_candidate'});
    }
    slot.dynamic_source=true;
    if(!alternatives.complete||!candidates.length||alternatives.options.length>32)slot.source_frontier=true;
  }
  function retainScopeCandidates(application, alternatives) {
    if(!application)return;
    const candidates=application.causal_bindings.scope_callbacks || [];
    for(const option of alternatives.options.slice(0,32)) {
      // Candidate identity is shared across direct scopes, returned transition
      // starters, memo callbacks, and state updaters. Use one canonical
      // function node ID so the same runtime function cannot acquire two
      // conflicting source identities merely because it crossed two APIs.
      const sourceId=node(option.callback.fn,'function');
      if(!candidates.some(row=>row.source_id===sourceId))candidates.push({source_id:sourceId,captures:captures(option.callback.fn)});
    }
    application.causal_bindings.scope_callbacks=candidates;
    if(!alternatives.complete || alternatives.options.length>32)application.causal_bindings.scope_callback_frontier=true;
  }
  function retainTransitionCandidates(protocol,alternatives) {
    const candidates=protocol.scope_callbacks || (protocol.scope_callbacks=[]);
    for(const option of alternatives.options.slice(0,32)) {
      const sourceId=node(option.callback.fn,'function');
      if(!candidates.some(row=>row.source_id===sourceId))candidates.push({source_id:sourceId,captures:captures(option.callback.fn)});
    }
    if(!alternatives.complete || alternatives.options.length>32)protocol.scope_callback_frontier=true;
  }
  function callbackAlternatives(raw, env, placement, existingConditions = [], seen = new Set()) {
    const n = unwrap(raw);
    if (!n || seen.has(n) || seen.size > 20) return { options: [], complete: false };
    seen = new Set(seen).add(n);
    const direct = evaluate(n, env, placement);
    if (direct.kind === 'function') return { options: [{ callback: direct, conditions: existingConditions }], complete: true };
    if (direct.kind === 'memo_alternatives') return {
      options:direct.options.filter(option=>option.value.kind==='function').map(option=>({callback:option.value,
        conditions:[...existingConditions,...option.conditions]})),
      complete:direct.options.every(option=>option.value.kind==='function'),
    };
    if (ts.isConditionalExpression(n)) {
      const condition = evaluate(n.condition, env, placement);
      if (condition.kind === 'literal') {
        return callbackAlternatives(condition.value ? n.whenTrue : n.whenFalse,
          env, placement, existingConditions, seen);
      }
      const truthy = callbackAlternatives(n.whenTrue, env, placement,
        [...existingConditions, { node_id: node(n.condition, 'condition'),
          text: n.condition.getText(), branch: 'truthy' }], seen);
      const falsyNode = unwrap(n.whenFalse);
      const falsyAbsent = falsyNode && (falsyNode.kind === ts.SyntaxKind.UndefinedKeyword
        || ts.isIdentifier(falsyNode) && falsyNode.text === 'undefined'
        || falsyNode.kind === ts.SyntaxKind.NullKeyword);
      const falsy = falsyAbsent ? { options: [], complete: true }
        : callbackAlternatives(n.whenFalse, env, placement,
          [...existingConditions, { node_id: node(n.condition, 'condition'),
            text: n.condition.getText(), branch: 'falsy' }], seen);
      return { options: [...truthy.options, ...falsy.options], complete: truthy.complete && falsy.complete };
    }
    if (ts.isIdentifier(n)) {
      const sym = symbol(n);
      const declaration = sym?.declarations?.find(value => ts.isVariableDeclaration(value) && value.initializer);
      if (mutatedSymbols.has(sym)) {
        // Index only explicit local assignment values. The original function
        // objects are tagged where they are defined; exact runtime identity,
        // rather than assignment order or a guessed branch, selects a source.
        const values=[...(declaration?.initializer?[declaration.initializer]:[]),...(assignedValuesBySymbol.get(sym)||[])];
        const options=[];let complete=Boolean(declaration?.initializer)&&!incompleteAssignments.has(sym);
        for(const value of values.slice(0,33)) {
          const alternative=callbackAlternatives(value,env,placement,existingConditions,seen);
          for(const option of alternative.options)if(!options.some(row=>row.callback.fn===option.callback.fn))options.push(option);
          if(!alternative.complete)complete=false;
        }
        if(values.length>32)complete=false;
        return {options:options.slice(0,32),complete};
      }
      // A local const may hold an unresolved conditional function choice. Its
      // initializer still supplies candidates; caller-substituted parameters do not.
      if(env.has(sym) && !(declaration?.parent.flags & ts.NodeFlags.Const))return {options:[],complete:false};
      if (declaration?.initializer) return callbackAlternatives(declaration.initializer,
        env, placement, existingConditions, seen);
    }
    return { options: [], complete: false };
  }
  function bindPattern(pattern, value, env, placement) {
    if (ts.isIdentifier(pattern)) env.set(symbol(pattern), value);
    else if (ts.isObjectBindingPattern(pattern)) {
      const used = new Set();
      for (const member of pattern.elements) {
        if (member.dotDotDotToken) {
          const fields = value?.kind === 'object' ? new Map([...value.fields].filter(([key]) => !used.has(key))) : null;
          bindPattern(member.name, fields ? { kind: 'object', fields } : unknown(member), env, placement);
          continue;
        }
        const key = member.propertyName?.getText().replace(/^['"]|['"]$/g, '') || member.name.getText();
        used.add(key);
        let bound = value?.kind === 'object' ? value.fields.get(key) : null;
        if (!bound && member.initializer) bound = evaluate(member.initializer, env, placement);
        bindPattern(member.name, bound || unknown(member), env, placement);
      }
    }
    else if (ts.isArrayBindingPattern(pattern)) for (const [index,member] of pattern.elements.entries()) if (ts.isBindingElement(member)) {
      const callable=value?.kind==='react_transition_tuple' && index===value.rule.start_index && !member.dotDotDotToken
        && pattern.parent?.parent?.flags & ts.NodeFlags.Const;
      const statePart=value?.kind==='state_tuple'&&!member.dotDotDotToken&&index<2
        ?{kind:'state',state:value.state,role:index===0?'value':'setter',node_id:node(member.name),placement:value.placement}:null;
      bindPattern(member.name,statePart||callable?statePart||{kind:'react_transition_start',root:value.root,rule:value.rule,member:'startTransition'}:unknown(member),env,placement);
    }
  }
  const straightLineReturn = fn => {
    if (!fn.body) return { status: 'ambiguous', reason: 'first_party_return_unresolved' };
    if (!ts.isBlock(fn.body)) return { status: 'resolved', expression: fn.body };
    const values = [];
    const scan = current => {
      if (current !== fn.body && functionLike(current)) return;
      if (ts.isReturnStatement(current) && current.expression) { values.push(current); return; }
      ts.forEachChild(current, scan);
    };
    scan(fn.body);
    const final = fn.body.statements.at(-1);
    if (values.length !== 1 || !ts.isReturnStatement(final) || values[0] !== final || !final.expression) {
      return { status: 'ambiguous', reason: values.length > 1 ? 'multiple_first_party_returns' : 'first_party_return_unresolved' };
    }
    if (fn.asteriskToken || (ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async)) {
      return { status: 'ambiguous', reason: 'async_or_generator_wrapper' };
    }
    const initializerHasEffects = initializer => {
      let unsafe = false;
      const scan = current => {
        if (unsafe || current !== initializer && functionLike(current)) return;
        if (ts.isCallExpression(current) || ts.isNewExpression(current) || ts.isAwaitExpression(current)
          || ts.isYieldExpression(current) || ts.isDeleteExpression(current)
          || ts.isTaggedTemplateExpression(current)
          || ts.isBinaryExpression(current) && current.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
            && current.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          || (ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current))
            && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(current.operator)) {
          unsafe = true;
          return;
        }
        ts.forEachChild(current, scan);
      };
      scan(initializer);
      return unsafe;
    };
    let parameterDefaultHasEffects = false;
    for (const parameter of fn.parameters) {
      const scan = current => {
        if (parameterDefaultHasEffects) return;
        if ((ts.isParameter(current) || ts.isBindingElement(current)) && current.initializer
          && initializerHasEffects(current.initializer)) {
          parameterDefaultHasEffects = true;
          return;
        }
        ts.forEachChild(current, scan);
      };
      scan(parameter);
    }
    if (parameterDefaultHasEffects
      || fn.body.statements.slice(0, -1).some(statement => !ts.isVariableStatement(statement)
      || statement.declarationList.declarations.some(declaration => declaration.initializer
        && initializerHasEffects(declaration.initializer)))) {
      return { status: 'ambiguous', reason: 'non_straight_line_wrapper' };
    }
    return { status: 'resolved', expression: final.expression };
  };
  // Enumerate source alternatives only inside the calculator. Actual returned
  // function identities select a path later; current render props cannot do so.
  function memoExpressionAlternatives(raw,conditions=[]) {
    const expression=unwrap(raw);
    if(ts.isConditionalExpression(expression))return [
      ...memoExpressionAlternatives(expression.whenTrue,conditionsFor(expression.condition,'truthy',conditions)),
      ...memoExpressionAlternatives(expression.whenFalse,conditionsFor(expression.condition,'falsy',conditions)),
    ];
    return [{expression,conditions}];
  }
  function memoReturnAlternatives(fn) {
    const simple=straightLineReturn(fn);
    if(simple.status==='resolved')return {complete:true,options:[{expression:simple.expression,conditions:[]}]};
    if(!ts.isBlock(fn.body))return {complete:false,options:[]};
    const options=[];
    let unsupported=false;
    const sequence=(statements,conditions)=>{
      if(unsupported || options.length>32 || conditions.length>32){unsupported=true;return false;}
      const [first,...rest]=statements;
      if(!first)return false;
      if(ts.isReturnStatement(first) && first.expression) {
        options.push({expression:first.expression,conditions});return true;
      }
      if(ts.isBlock(first))return sequence([...first.statements,...rest],conditions);
      if(ts.isIfStatement(first)) {
        const yes=sequence([first.thenStatement,...rest],conditionsFor(first.expression,'truthy',conditions));
        const no=sequence(first.elseStatement?[first.elseStatement,...rest]:rest,conditionsFor(first.expression,'falsy',conditions));
        return yes && no;
      }
      // Loops, mutations, exceptions, and branch-local bindings need their own
      // analysis. Never discard them to manufacture a complete return union.
      unsupported=true;return false;
    };
    const complete=sequence([...fn.body.statements],[]);
    return {complete:complete && !unsupported,options};
  }
  const prepareFunctionEnvironment = (fn, actual, parentEnv, placement) => {
    const env = new Map(parentEnv);
    fn.parameters.forEach((parameter, index) => {
      let value = index < actual.length ? evaluate(actual[index], parentEnv, placement) : missing;
      if (value.kind === 'missing' && parameter.initializer) value = evaluate(parameter.initializer, env, placement);
      bindPattern(parameter.name, value, env, placement);
    });
    if (ts.isBlock(fn.body)) {
      for (const statement of fn.body.statements) {
        if (ts.isReturnStatement(statement)) break;
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          const value = declaration.initializer ? evaluate(declaration.initializer, env, placement) : missing;
          bindPattern(declaration.name, value, env, placement);
        }
      }
    }
    return env;
  };
  const optionValue = (expression, name, env, placement, seen = new Set()) => {
    const value = unwrap(expression);
    if (!value || seen.has(value)) return { status: 'ambiguous' };
    seen = new Set(seen).add(value);
    if (ts.isIdentifier(value)) {
      const resolved = env.get(symbol(value));
      if (resolved?.kind === 'missing') return { status: 'absent' };
      if (resolved?.kind === 'object') return { status: 'value', value: resolved.fields.get(name) || missing };
      const declaration = symbol(value)?.declarations?.find(ts.isVariableDeclaration);
      return declaration?.initializer ? optionValue(declaration.initializer, name, env, placement, seen) : { status: 'ambiguous' };
    }
    if (!ts.isObjectLiteralExpression(value)) return { status: 'ambiguous' };
    let selected = missing;
    let unknownSpreadAfterSelection = false;
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = optionValue(property.expression, name, env, placement, seen);
        if (spread.status === 'ambiguous') { unknownSpreadAfterSelection = true; continue; }
        if (spread.status === 'value' && spread.value.kind !== 'missing') selected = spread.value;
        continue;
      }
      const key = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? property.name.text : null;
      if (key !== name) continue;
      if (ts.isPropertyAssignment(property)) selected = evaluate(property.initializer, env, placement);
      else if (ts.isShorthandPropertyAssignment(property)) selected = evaluate(property.name, env, placement);
      else return { status: 'ambiguous' };
      unknownSpreadAfterSelection = false;
    }
    return unknownSpreadAfterSelection ? { status: 'ambiguous' } : { status: 'value', value: selected };
  };
  const libraryProducer = (call, env, placement, returnedMember, seen = new Set()) => {
    if (seen.has(call) || seen.size >= 12) return { status: 'ambiguous', reason: 'library_producer_recursion' };
    seen = new Set(seen).add(call);
    const identity = importedIdentity(call.expression);
    const firstPartyImport = identity && relativeImport(identity.package, call.getSourceFile().fileName);
    if (identity && !firstPartyImport) {
      const evidence = packageInstallation(identity.package, call.getSourceFile().fileName);
      if (!evidence) return { status: 'backlog', package: identity.package, producer: identity.member,
        returned_member: returnedMember, reason: 'package_version_unavailable' };
      const contract = matchLibraryContract({ packageName: identity.package, version: evidence.version,
        producer: identity.member, returnedMember });
      if (!contract) return { status: 'backlog', package: identity.package, version: evidence.version,
        producer: identity.member, returned_member: returnedMember, reason: 'verified_contract_unavailable' };
      const admittedEvidence = contractEvidence(evidence, contract);
      if (admittedEvidence.verified !== true) return { status: 'backlog', package: identity.package,
        version: evidence.version, producer: identity.member, returned_member: returnedMember,
        reason: admittedEvidence.reason || 'package_installation_unverified' };
      if (contract.verification.package_integrity
        && contract.verification.package_integrity !== evidence.integrity) {
        return { status: 'backlog', package: identity.package, version: evidence.version,
          producer: identity.member, returned_member: returnedMember,
          reason: evidence.integrity ? 'package_integrity_mismatch' : 'package_integrity_unavailable' };
      }
      const options = call.arguments[contract.option_argument];
      if (!options) return { status: 'backlog', package: identity.package, version: evidence.version,
        producer: identity.member, returned_member: returnedMember, reason: 'contract_options_unavailable' };
      const callback = optionValue(options, contract.invokes_option, env, placement);
      if (callback.status !== 'value' || callback.value.kind !== 'function') {
        return { status: 'backlog', package: identity.package, version: evidence.version,
          producer: identity.member, returned_member: returnedMember,
          reason: callback.status === 'ambiguous' ? 'contract_callback_ambiguous' : 'contract_callback_unresolved' };
      }
      return { status: 'modeled', contract, evidence: admittedEvidence, producer_call: call, callback: callback.value };
    }
    const firstPartyFunction = identity && firstPartyImport ? exportedFunction(firstPartyImport, identity.member) : null;
    if (identity && firstPartyImport && !firstPartyFunction) {
      return { status: 'ambiguous', reason: 'first_party_export_ambiguous' };
    }
    const target = firstPartyFunction ? { kind: 'function', fn: firstPartyFunction, env: new Map(env), placement }
      : evaluate(call.expression, env, placement);
    if (target.kind !== 'function') return { status: 'ambiguous', reason: 'first_party_producer_unresolved' };
    const returned = straightLineReturn(target.fn);
    if (returned.status !== 'resolved' || !ts.isCallExpression(unwrap(returned.expression))) {
      return { status: 'ambiguous', reason: returned.reason || 'first_party_return_unresolved' };
    }
    const childEnv = prepareFunctionEnvironment(target.fn, [...call.arguments], target.env, placement);
    const modeled = libraryProducer(unwrap(returned.expression), childEnv, placement, returnedMember, seen);
    if (modeled?.status === 'modeled') {
      return { ...modeled, wrapper_call_ids: [node(call, 'call'), ...(modeled.wrapper_call_ids || [])] };
    }
    return modeled;
  };
  const returnedMemberCall = expression => {
    if (!ts.isIdentifier(unwrap(expression))) return null;
    const memberSymbol = symbol(unwrap(expression));
    if (mutatedSymbols.has(memberSymbol)) return null;
    const declaration = memberSymbol?.declarations?.find(ts.isBindingElement);
    if (!declaration || !ts.isObjectBindingPattern(declaration.parent)) return null;
    const variable = declaration.parent.parent;
    const initializer = ts.isVariableDeclaration(variable) ? unwrap(variable.initializer) : null;
    if (!initializer || !ts.isCallExpression(initializer)) return null;
    const member = declaration.propertyName?.getText().replace(/^['"]|['"]$/gu, '') || declaration.name.getText();
    return { member, call: initializer };
  };
  const resolveLibraryCallback = (expression, env, placement) => {
    const returned = returnedMemberCall(expression);
    if (!returned) return null;
    return libraryProducer(returned.call, env, placement, returned.member);
  };
  function conditionsFor(expression, branch, existing) { return [...existing, { node_id: node(expression, 'condition'), text: expression.getText(), branch }]; }
  const terminates = n => n && (ts.isReturnStatement(n) || ts.isThrowStatement(n) || ts.isBlock(n) && terminates(n.statements.at(-1)) || ts.isIfStatement(n) && n.elseStatement && terminates(n.thenStatement) && terminates(n.elseStatement));
  function visitBlock(block, conditions, visit, addCondition) {
    let current = conditions;
    for (const statement of block.statements) {
      visit(statement, current);
      if (terminates(statement)) break;
      if (ts.isIfStatement(statement)) {
        if (terminates(statement.thenStatement)) current = addCondition(statement.expression, 'falsy', current);
        else if (terminates(statement.elseStatement)) current = addCondition(statement.expression, 'truthy', current);
      }
    }
  }
  function stateReads(n, env, placement, callback) {
    const seen = new Set();
    const visit = current => { if (current !== n && functionLike(current)) return; if (ts.isIdentifier(current)) { const value = evaluate(current, env, placement); if (value.kind === 'state' && value.role === 'value' && !seen.has(value.state.id)) { seen.add(value.state.id); callback(value, current); } } ts.forEachChild(current, visit); };
    visit(n);
  }
  const retainReactProtocol = (call, target, scenario = null, conditions = []) => {
    const callId = node(call, 'call');
    const row = { id: `react-protocol:${digest(stable([target.root.call_id, callId, target.member,
      scenario?.id || null])).slice(0, 24)}`,
      semantic_id: target.root.semantic_id, semantic_application_id: target.root.semantic_application_id,
      producer_call_id: target.root.call_id, member_call_id: callId, member: target.member,
      ...(scenario ? { scenario_id: scenario.id, placement_id: scenario.placement_id } : {}),
      claim: 'source_contract', runtime_observed: false };
    const retained=output.react_protocols.find(value=>value.id===row.id);
    if (!retained) output.react_protocols.push(row);
    if (scenario) edge(callId, target.root.call_id, 'react_protocol', scenario, conditions, {
      react_semantic_id: target.root.semantic_id, producer_call_id: target.root.call_id,
      protocol_member: target.member, evidence_ids: [callId, target.root.call_id],
    });
    return retained || row;
  };
  const applyLibraryCallable = (originId, modeled, scenario, currentConditions, actual, described, placement, seen) => {
    const targetId = node(modeled.callback.fn, 'function');
    const producerSourceId = node(modeled.producer_call, ts.isCallExpression(modeled.producer_call) ? 'call'
      : ts.isJsxOpeningElement(modeled.producer_call) || ts.isJsxSelfClosingElement(modeled.producer_call) ? 'jsx' : 'expression');
    const callbackActual = modeled.callback_values || (modeled.contract.callback_argument_forwarding === 'all' ? actual : []);
    const callbackArguments = callbackActual.map(descriptor);
    const branchConditions = modeled.contract_branch ? [...currentConditions, {
      node_id: node(modeled.intermediate_call || modeled.producer_call, 'condition'),
      text: `${modeled.contract.package}.${modeled.contract.returned_member || modeled.contract.producer}.${modeled.contract_branch}`,
      branch: 'truthy',
    }] : currentConditions;
    edge(originId, targetId, 'library_callback', scenario, branchConditions, {
      arguments: described, callback_arguments: callbackArguments,
      contract_id: modeled.contract.id, package: modeled.contract.package,
      package_version: modeled.evidence.version, producer_source_id: producerSourceId,
      ...(ts.isCallExpression(modeled.producer_call) ? { producer_call_id: producerSourceId } : {}),
      ...(modeled.intermediate_call ? { intermediate_call_id: node(modeled.intermediate_call, 'call') } : {}),
      wrapper_call_ids: modeled.wrapper_call_ids || [],
      placement_id: placement?.id || scenario.placement_id,
      callback_timing: modeled.contract.callback_timing,
      contract_conditions: [modeled.contract.condition],
      evidence_ids: [originId, targetId, producerSourceId, ...(modeled.wrapper_call_ids || [])],
    });
    const application = { id: `library-contract:${digest(stable([scenario.id, originId, modeled.contract.id, targetId])).slice(0, 24)}`,
      contract_id: modeled.contract.id, scenario_id: scenario.id, activation_id: originId,
      invocation_call_id: originId, producer_source_id: producerSourceId,
      ...(ts.isCallExpression(modeled.producer_call) ? { producer_call_id: producerSourceId } : {}),
      callback_id: targetId, arguments: described, callback_arguments: callbackArguments,
      wrapper_call_ids: modeled.wrapper_call_ids || [], placement_id: placement?.id || scenario.placement_id,
      package: modeled.contract.package, version: modeled.evidence.version,
      package_verification_sha256: modeled.evidence.verification_sha256,
      kind: modeled.contract.kind, callback_timing: modeled.contract.callback_timing,
      condition: modeled.contract.condition,
      ...(modeled.intermediate_call ? { intermediate_call_id: node(modeled.intermediate_call, 'call') } : {}),
      ...(modeled.contract_branch ? { contract_branch: modeled.contract_branch } : {}) };
    if (!output.library_contracts.some(row => row.id === application.id)) output.library_contracts.push(application);
    invoke(modeled.callback, callbackActual, scenario, branchConditions, seen);
  };
  const applyLibraryEffect = (call, modeled, scenario, currentConditions, actual, described, placement) => {
    const callId = node(call, 'call'), effectId = node(call, 'library_effect');
    const targetIndex = modeled.contract.target_argument ?? modeled.contract.url_argument;
    const target = actual[targetIndex] || unknown(call);
    const optionsValue = actual[modeled.contract.options_argument] || missing;
    const effect = { kind: modeled.contract.effect, target: descriptor(target),
      ...(modeled.contract.method ? { method: modeled.contract.method } : {}),
      ...(modeled.contract.url_argument != null ? { url_input: descriptor(target) } : {}),
      ...(modeled.contract.body_argument != null ? { body: descriptor(actual[modeled.contract.body_argument] || missing) } : {}),
      ...(optionsValue.kind !== 'missing' ? { options: descriptor(optionsValue) } : {}),
      timing: modeled.contract.effect_timing };
    edge(callId, effectId, 'library_effect', scenario, currentConditions, {
      arguments: described, effect, contract_id: modeled.contract.id,
      package: modeled.contract.package, package_version: modeled.evidence.version,
      producer_call_id: node(modeled.producer_call, 'call'), wrapper_call_ids: modeled.wrapper_call_ids || [],
      placement_id: placement?.id || scenario.placement_id,
      contract_conditions: [modeled.contract.condition],
      evidence_ids: [callId, effectId, node(modeled.producer_call, 'call'), ...(modeled.wrapper_call_ids || [])],
    });
    const application = { id: `library-contract:${digest(stable([scenario.id, callId, modeled.contract.id, effect])).slice(0, 24)}`,
      contract_id: modeled.contract.id, scenario_id: scenario.id, invocation_call_id: callId,
      producer_call_id: node(modeled.producer_call, 'call'), wrapper_call_ids: modeled.wrapper_call_ids || [],
      placement_id: placement?.id || scenario.placement_id, package: modeled.contract.package,
      version: modeled.evidence.version, package_verification_sha256: modeled.evidence.verification_sha256,
      kind: modeled.contract.kind, effect, condition: modeled.contract.condition };
    if (!output.library_contracts.some(row => row.id === application.id)) output.library_contracts.push(application);
  };
  function invoke(value, args, scenario, conditions, seen = new Set()) {
    if (value.kind !== 'function') return;
    const fn = value.fn, fnId = node(fn, 'function');
    if(value.producer_call_id && value.react_semantic_id)edge(value.producer_call_id,fnId,'react_callback_value',scenario,conditions,{
      react_semantic_id:value.react_semantic_id,claim:'source_contract',runtime_observed:false});
    if (seen.has(fn) || seen.size >= 32) { issue(seen.has(fn) ? 'recursive_callback' : 'analysis_limit', fn, 'Callback expansion stops at this recursive or bounded source boundary.', value.placement); return; }
    seen = new Set(seen).add(fn);
    const env = new Map(value.env); fn.parameters.forEach((parameter, index) => bindPattern(parameter.name, args[index] || unknown(parameter), env, value.placement));
    const visit = (n, currentConditions) => {
      if (n !== fn && functionLike(n)) return;
      if (ts.isBlock(n)) { visitBlock(n, currentConditions, visit, conditionsFor); return; }
      if (ts.isIterationStatement(n, false) || ts.isSwitchStatement(n) || ts.isTryStatement(n)) { issue('unsupported_control_flow', n, 'Loop, switch, or exception execution remains an explicit source boundary.', value.placement); return; }
      if (ts.isIfStatement(n)) { visit(n.expression, currentConditions); visit(n.thenStatement, conditionsFor(n.expression, 'truthy', currentConditions)); if (n.elseStatement) visit(n.elseStatement, conditionsFor(n.expression, 'falsy', currentConditions)); return; }
      if (ts.isConditionalExpression(n)) { visit(n.condition, currentConditions); visit(n.whenTrue, conditionsFor(n.condition, 'truthy', currentConditions)); visit(n.whenFalse, conditionsFor(n.condition, 'falsy', currentConditions)); return; }
      if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)) { visit(n.left, currentConditions); visit(n.right, conditionsFor(n.left, n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? 'truthy' : 'falsy', currentConditions)); return; }
      if (ts.isCallExpression(n)) {
        const callId = node(n, 'call');
        let target = evaluate(n.expression, env, value.placement);
        if (!['function', 'state', 'library_callable', 'library_callable_set', 'library_effect_callable', 'library_unresolved'].includes(target.kind)) {
          target = directLibraryEffect(n) || target;
        }
        const actual = n.arguments.map(arg => evaluate(arg, env, value.placement)), described = actual.map(descriptor);
        edge(fnId, callId, 'call_site', scenario, currentConditions, { arguments: described });
        const react = resolveReactSemantic(n);
        const scopeRule=react?.record?.behavior?.execution;
        const synchronousScope=react?.admitted && !react.identity.member
          && validateReactExecutionRule(scopeRule).valid && ['synchronous_scope','test_scope'].includes(scopeRule.kind);
        if(react?.admitted && scopeRule?.kind==='children_collection' && validateReactExecutionRule(scopeRule).valid
          && ['map','forEach'].includes(react.identity.member)) {
          const alternatives=callbackAlternatives(n.arguments[scopeRule.callback_argument],env,value.placement,currentConditions);
          const condition={node_id:callId,text:'Children traversal invoked the callback for a leaf',branch:'truthy',runtime_observed:false};
          for(const option of alternatives.options.slice(0,32)) {
            const callback=option.callback,args=[unknown(n),unknown(n)],guards=[...option.conditions,condition];
            edge(callId,node(callback.fn,'function'),'callback_forward',scenario,guards,{callback_source_id:node(callback.fn),
              callback_arguments:args.map(descriptor),callback_timing:'synchronous_child_traversal',react_semantic_id:react.record.id,producer_call_id:callId});
            invoke(callback,args,scenario,guards,seen);
          }
          issue('children_traversal_inputs_unobserved',n,'Callback source is guarded by actual traversal; child count, values, and result keys require evidence.',value.placement);
          ts.forEachChild(n,child=>visit(child,currentConditions));return;
        }
        if (synchronousScope) {
          const testScope=scopeRule.kind==='test_scope';
          const plan=testScope?planReactTestScope(scopeRule,{args:actual,build:'development'}):planSynchronousScope(scopeRule,{args:actual});
          const alternatives=callbackAlternatives(n.arguments[scopeRule.callback_argument],env,value.placement,currentConditions);
          retainScopeCandidates(output.react_semantics.find(row=>row.call_id===callId),alternatives);
          for(const option of alternatives.options.slice(0,32)) {
            const callback=option.callback,callbackArgs=plan.arguments.map(value=>value||unknown(n));
            const guards=testScope?[...option.conditions,{node_id:callId,text:'Development act invoked its callback',branch:'truthy',runtime_observed:false}]:option.conditions;
            edge(callId,node(callback.fn,'function'),'callback_forward',scenario,guards,{
              callback_source_id:node(callback.fn),callback_arguments:callbackArgs.map(descriptor),callback_timing:'synchronous',
              react_semantic_id:react.record.id,producer_call_id:callId,contract_conditions:react.record.behavior.constraints,
            });
            invoke(callback,callbackArgs,scenario,guards,seen);
          }
          if(!alternatives.complete || !alternatives.options.length || alternatives.options.length>32) {
            retainReactBacklog(n,react,'react_scope_callback_unresolved');
            issue('dynamic_callback',n,'React scope callback alternatives are incomplete; runtime source identity is required.',value.placement);
          }
          ts.forEachChild(n, child => visit(child, currentConditions));
          return;
        }
        if (target.kind === 'state' && target.role === 'setter') {
          const update=actual[0];
          const alternatives=target.state.kind==='state'
            ?callbackAlternatives(n.arguments[0],env,value.placement,currentConditions):{options:[],complete:true};
          const updaterCandidates=alternatives.options.slice(0,32).map(option=>({
            source_id:node(option.callback.fn,'function'),captures:captures(option.callback.fn),conditions:option.conditions,
          }));
          edge(callId,target.state.id,'state_write',scenario,currentConditions,{arguments:described,
            hook_call_id:target.state.hook_call_id,callee_source_id:node(n.expression),
            ...(updaterCandidates.length===1?{updater_source_id:updaterCandidates[0].source_id,
              updater_input_id:node(n.arguments[0]),updater_captures:updaterCandidates[0].captures}:{}),
            ...(updaterCandidates.length>1?{updater_source_candidates:updaterCandidates,updater_input_id:node(n.arguments[0])}:{}),
            ...(target.placement?{state_placement_id:target.placement.id}:{})});
          for(const option of alternatives.options.slice(0,32)) {
            edge(callId,node(option.callback.fn,'function'),'state_updater',scenario,option.conditions,
              {hook_call_id:target.state.hook_call_id,callback_arguments:[{kind:'unknown',reason:'pending_state_requires_runtime'}],callback_timing:'react_update_calculation',runtime_observed:false});
            invoke(option.callback,[unknown(n)],scenario,option.conditions,seen);
          }
          if(target.state.kind==='state'&&(!alternatives.complete||alternatives.options.length>32)
            &&(updaterCandidates.length>0 || update?.kind==='unknown'))
            issue('state_updater_source_unresolved',n,'The setter callback alternatives are incomplete; runtime source identity is required.',value.placement);
          issue('state_commit_causality_unproven',n,'A requested update and observed calculation do not prove which render committed it.',value.placement);
        }
        else if(target.kind==='react_transition_start') {
          const protocol=retainReactProtocol(n,target,scenario,currentConditions);
          const alternatives=callbackAlternatives(n.arguments[target.rule.start_rule.callback_argument],env,value.placement,currentConditions);
          retainTransitionCandidates(protocol,alternatives);
          for(const option of alternatives.options.slice(0,32)) {
            const callback=option.callback;
            edge(callId,node(callback.fn,'function'),'callback_forward',scenario,option.conditions,{arguments:[],react_semantic_id:target.root.semantic_id,producer_call_id:target.root.call_id,callback_timing:'synchronous_transition_scope'});
            invoke(callback,[],scenario,option.conditions,seen);
          }
          if(!alternatives.complete || !alternatives.options.length || alternatives.options.length>32)
            issue('transition_callback_source_unresolved',n,'The returned transition scope needs an observed callback source.',value.placement);
        }
        else if (target.kind === 'react_root_member') {
          retainReactProtocol(n, target, scenario, currentConditions);
          if (target.member === 'render') issue('react_root_commit_unproven', n,
            'root.render schedules reconciliation; a source call does not prove a committed render.', value.placement);
        }
        else if (target.kind === 'function') {
          edge(callId, node(target.fn, 'function'), 'call', scenario, currentConditions, { arguments: described });
          edge(fnId, node(target.fn, 'function'), 'callback_forward', scenario, currentConditions, { arguments: described, call_site_id: callId });
          scenario.captured_arguments.push(...described);
          invoke(target, actual, scenario, currentConditions, seen);
        } else if (target.kind === 'library_callable') {
          applyLibraryCallable(callId, target, scenario, currentConditions, actual, described, value.placement, seen);
        } else if (target.kind === 'library_callable_set') {
          for (const callable of target.callables) applyLibraryCallable(callId, callable, scenario, currentConditions, actual, described, value.placement, seen);
        } else if (target.kind === 'library_effect_callable') {
          applyLibraryEffect(n, target, scenario, currentConditions, actual, described, value.placement);
        } else if (target.kind === 'library_unresolved') {
          const backlog = { call_id: callId, scenario_id: scenario.id, package: target.contract.package,
            version: target.evidence?.version, producer: target.contract.producer, reason: target.reason };
          if (!output.library_backlog.some(row => stable(row) === stable(backlog))) output.library_backlog.push(backlog);
          issue('dynamic_callback', n, `Library boundary remains unresolved (${target.reason}).`, value.placement);
        } else {
          const modeled = resolveLibraryCallback(n.expression, env, value.placement);
          if (modeled?.status === 'modeled') {
            const targetId = node(modeled.callback.fn, 'function');
            const callbackContext = { kind: 'object', fields: new Map((modeled.contract.callback_argument_object || [])
              .map(name => [name, { kind: 'source', text: `${modeled.contract.package}.${modeled.contract.returned_member}.${name}` }])) };
            const callbackArguments = [callbackContext].map(descriptor);
            edge(callId, targetId, 'library_callback', scenario, currentConditions, {
              arguments: described, callback_arguments: callbackArguments,
              contract_id: modeled.contract.id, package: modeled.contract.package,
              package_version: modeled.evidence.version, producer_call_id: node(modeled.producer_call, 'call'),
              wrapper_call_ids: modeled.wrapper_call_ids || [],
              placement_id: value.placement?.id || scenario.placement_id,
              callback_timing: modeled.contract.callback_timing,
              contract_conditions: [modeled.contract.condition],
              evidence_ids: [callId, targetId, node(modeled.producer_call, 'call'), ...(modeled.wrapper_call_ids || [])],
            });
            const application = { id: `library-contract:${digest(stable([scenario.id, callId, modeled.contract.id, targetId])).slice(0, 24)}`,
              contract_id: modeled.contract.id, scenario_id: scenario.id, invocation_call_id: callId,
              producer_call_id: node(modeled.producer_call, 'call'), callback_id: targetId,
              wrapper_call_ids: modeled.wrapper_call_ids || [],
              placement_id: value.placement?.id || scenario.placement_id,
              package: modeled.contract.package, version: modeled.evidence.version,
              package_verification_sha256: modeled.evidence.verification_sha256,
              returned_member: modeled.contract.returned_member, invokes_option: modeled.contract.invokes_option,
              callback_timing: modeled.contract.callback_timing, condition: modeled.contract.condition };
            if (!output.library_contracts.some(row => row.id === application.id)) output.library_contracts.push(application);
            invoke(modeled.callback, [callbackContext], scenario, currentConditions, seen);
          } else {
            if (modeled?.status === 'backlog') {
              const backlog = { call_id: callId, scenario_id: scenario.id, ...modeled };
              delete backlog.status;
              if (!output.library_backlog.some(row => stable(row) === stable(backlog))) output.library_backlog.push(backlog);
            }
            issue('dynamic_callback', n, modeled?.reason
              ? `Library callback remains unresolved (${modeled.reason}).`
              : 'Call target or library execution boundary is unresolved.', value.placement);
          }
        }
        // Argument expressions execute, but callback bodies do not execute merely by being passed.
        for (const argument of n.arguments) if (!functionLike(unwrap(argument))) visit(argument, currentConditions);
        return;
      }
      if (ts.isIdentifier(n)||ts.isElementAccessExpression(n)) { const read = evaluate(n, env, value.placement); if (read.kind === 'state' && read.role === 'value') edge(read.state.id, node(n, 'state_reader'), 'state_read', scenario, currentConditions, { state_placement_id: read.placement?.id || scenario.placement_id }); }
      ts.forEachChild(n, child => visit(child, currentConditions));
    };
    if (fn.body) visit(fn.body, conditions);
  }
  const sourceFunction = (sf, name) => {
    for (const statement of sf.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
        const initializer = unwrap(declaration.initializer);
        if (functionLike(initializer)) return initializer;
        const callback = wrappedCallback(declaration);
        if (callback) return callback;
      }
    }
    return null;
  };
  const exportedFunction = (file, name, seen = new Set()) => {
    const key = `${file}:${name}`;
    if (seen.has(key)) return null;
    seen = new Set(seen).add(key);
    const sf = sourceFiles.get(file);
    if (!sf) return null;
    const explicit = [];
    const stars = [];
    for (const statement of sf.statements) {
      const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && (ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement))) {
        const direct = sourceFunction({ statements: [statement] }, name);
        if (direct) explicit.push(direct);
      }
      if (!ts.isExportDeclaration(statement)) continue;
      const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? relativeImport(statement.moduleSpecifier.text, file) : null;
      if (!statement.exportClause && target) {
        const found = exportedFunction(target, name, seen);
        if (found) stars.push(found);
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          if (specifier.name.text !== name) continue;
          const local = (specifier.propertyName || specifier.name).text;
          const found = target ? exportedFunction(target, local, seen) : sourceFunction(sf, local);
          if (found) explicit.push(found);
        }
      }
    }
    const choices = explicit.length ? explicit : stars;
    return [...new Set(choices)].length === 1 ? choices[0] : null;
  };
  const importedFunction = expression => {
    if (!ts.isIdentifier(expression)) return null;
    const declaration = symbol(expression)?.declarations?.[0];
    if (!declaration || !ts.isImportSpecifier(declaration)) return null;
    const imp = declaration.parent.parent.parent;
    if (!ts.isImportDeclaration(imp) || !ts.isStringLiteral(imp.moduleSpecifier)) return null;
    const file = relativeImport(imp.moduleSpecifier.text, expression.getSourceFile().fileName);
    return file ? exportedFunction(file, (declaration.propertyName || declaration.name).text) : null;
  };
  const referenced = new Set(),elementReferenced=new Set();
  const componentFor = expression => {
    if (ts.isIdentifier(expression) && symbol(expression)?.declarations?.some(ts.isImportSpecifier)) {
      const imported = importedFunction(expression);
      return imported ? componentList.find(component => component.fn === imported) : null;
    }
    const value = evaluate(expression, new Map(), null);
    const fn = value.kind === 'function' ? value.fn : null;
    return fn ? componentList.find(c => c.fn === fn) : null;
  };
  const transparentMembers = new Map([
    ['@radix-ui/react-dialog', new Set(['Root', 'Portal', 'Content'])],
  ]);
  const importedMember = (raw, seen = new Set()) => {
    const expression = unwrap(raw);
    if (!expression || seen.has(expression)) return null;
    seen.add(expression);
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const declaration = symbol(expression.expression)?.declarations?.[0];
      if (declaration && ts.isNamespaceImport(declaration)) {
        const imp = declaration.parent.parent;
        if (ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier)) return { module: imp.moduleSpecifier.text, member: expression.name.text };
      }
    }
    if (ts.isIdentifier(expression)) {
      const declaration = symbol(expression)?.declarations?.[0];
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return importedMember(declaration.initializer, seen);
    }
    return null;
  };
  const transparentTag = expression => {
    const imported = importedMember(expression);
    return !!imported && transparentMembers.get(imported.module)?.has(imported.member);
  };
  const forwardsChildren = component => {
    const childrenSymbols = new Set();
    for (const parameter of component.fn.parameters) {
      if (ts.isObjectBindingPattern(parameter.name)) for (const member of parameter.name.elements) {
        const key = member.propertyName?.getText().replace(/^['"]|['"]$/g, '') || member.name.getText();
        if (key === 'children' && ts.isIdentifier(member.name)) childrenSymbols.add(symbol(member.name));
      }
    }
    if (!childrenSymbols.size) return false;
    let found = false;
    const returnedThroughKnownContainers = expression => {
      let current = expression.parent;
      let returned = !ts.isBlock(component.fn.body);
      while (current && current !== component.fn) {
        if (ts.isConditionalExpression(current) || ts.isIfStatement(current)
          || ts.isBinaryExpression(current) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(current.operatorToken.kind)) return false;
        if (ts.isJsxElement(current)) {
          const tag = current.openingElement.tagName, value = evaluate(tag, new Map(), null);
          if (!(/^[a-z]/.test(tag.getText()) || value.kind === 'literal' && typeof value.value === 'string' || transparentTag(tag))) return false;
        }
        if (ts.isReturnStatement(current)) {
          returned = current.parent === component.fn.body;
          if (returned) {
            const preceding = component.fn.body.statements.slice(0, component.fn.body.statements.indexOf(current));
            if (preceding.some(statement => ts.isIfStatement(statement) || ts.isIterationStatement(statement, false)
              || ts.isSwitchStatement(statement) || ts.isTryStatement(statement) || terminates(statement))) returned = false;
          }
          break;
        }
        current = current.parent;
      }
      return returned;
    };
    const scan = current => {
      if (found || current !== component.fn && functionLike(current)) return;
      if (ts.isJsxExpression(current) && current.expression && ts.isIdentifier(current.expression) && childrenSymbols.has(symbol(current.expression))) {
        found = returnedThroughKnownContainers(current);
      }
      ts.forEachChild(current, scan);
    };
    scan(component.fn);
    return found;
  };
  // Follow immutable factory aliases to their exact attested creation call.
  // Calling a getter, mutable variable, or arbitrary wrapper needs more evidence.
  const elementFactoryOrigin=(raw,seen=new Set())=>{
    const value=unwrap(raw);if(!value||seen.has(value)||seen.size>20)return null;
    seen=new Set(seen).add(value);
    if(ts.isCallExpression(value)){
      const semantic=resolveReactSemantic(value),rule=semantic?.record?.behavior?.execution;
      return semantic?.admitted&&rule?.kind==='element_factory'&&validateReactExecutionRule(rule).valid
        &&!value.arguments.some(ts.isSpreadElement)?{call:value,semantic,rule}:null;
    }
    if(!ts.isIdentifier(value))return null;
    const sym=symbol(value);if(!sym||mutatedSymbols.has(sym))return null;
    const declaration=sym.declarations?.find(ts.isVariableDeclaration);
    if(!declaration?.initializer||!(declaration.parent.flags&ts.NodeFlags.Const))return null;
    return elementFactoryOrigin(declaration.initializer,seen);
  };
  // Follow a React element description through local immutable aliases. The
  // alias itself is not evidence of rendering; it only lets a later clone
  // retain the exact original construction call and its verified rule.
  const elementDescriptionOrigin=(raw,seen=new Set())=>{
    const value=unwrap(raw);if(!value||seen.has(value)||seen.size>20)return null;
    seen=new Set(seen).add(value);
    if(ts.isCallExpression(value))return value;
    if(!ts.isIdentifier(value))return null;
    const sym=symbol(value);if(!sym||mutatedSymbols.has(sym))return null;
    const declaration=sym.declarations?.find(ts.isVariableDeclaration);
    if(!declaration?.initializer||!(declaration.parent.flags&ts.NodeFlags.Const))return null;
    return elementDescriptionOrigin(declaration.initializer,seen);
  };
  const elementTypeExpression=(raw,depth=0)=>{
    const call=elementDescriptionOrigin(raw);if(depth>16||!call)return null;
    const factory=ts.isIdentifier(call.expression)?elementFactoryOrigin(call.expression):null;
    const semantic=factory?.semantic||resolveReactSemantic(call),rule=factory?.rule.construction||semantic?.record?.behavior?.execution;
    if(!semantic?.admitted||!validateReactExecutionRule(rule).valid)return null;
    if(rule.kind==='element_construction')return factory?.call.arguments[factory.rule.type_argument]||call.arguments[rule.type_argument]||null;
    if(rule.kind==='element_clone')return elementTypeExpression(call.arguments[rule.element_argument],depth+1);
    return null;
  };
  // Retain only property names whose values come from a direct object literal.
  // Runtime code may inspect these exact own data properties without
  // enumerating an arbitrary caller object or invoking an accessor/proxy.
  const elementPropertyInputs=(call,program,{factoryCall=false}={})=>{
    const rule=program?.kind==='element_factory'?program.construction:program;
    if(!validateReactExecutionRule(rule).valid||!['element_construction','element_clone'].includes(rule.kind))return [];
    const offset=factoryCall?1:0,inputIndex=rule.config_argument-offset;
    const config=unwrap(call.arguments[inputIndex]);
    if(!config||config.kind===ts.SyntaxKind.NullKeyword)return [];
    if(!ts.isObjectLiteralExpression(config))return [];
    const rows=[];
    for(const property of config.properties){
      if(!(ts.isPropertyAssignment(property)||ts.isShorthandPropertyAssignment(property)||ts.isMethodDeclaration(property))
        ||!property.name||property.name.kind===ts.SyntaxKind.ComputedPropertyName)return [];
      const name=ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)||ts.isNumericLiteral(property.name)
        ?property.name.text:null;
      if(name===null||name==='__proto__'||['__self','__source'].includes(name))return [];
      rows.push({input_index:inputIndex,name,target:['key','ref'].includes(name)?name:'props',source_id:node(property,'binding')});
    }
    const children=[...call.arguments].slice(rule.children_start-offset);
    if(children.length===1&&!ts.isSpreadElement(children[0]))rows.push({input_index:rule.children_start-offset,name:'children',
      target:'props',source_id:node(children[0],'binding'),argument_value:true});
    return rows;
  };
  for (const sf of sourceFiles.values()) { const scan = n => {
    if(ts.isCallExpression(n)){
      const factory=ts.isIdentifier(n.expression)?elementFactoryOrigin(n.expression):null;
      if(factory){const producer=node(factory.call,'call'),callId=node(n,'call');
        output.react_protocols.push({id:`react-protocol:${digest(stable([producer,callId,'factory'])).slice(0,24)}`,
          semantic_id:factory.semantic.record.id,producer_call_id:producer,member_call_id:callId,member:'factory',
          callee_source_id:node(n.expression),element_property_inputs:elementPropertyInputs(n,factory.rule,{factoryCall:true}),
          claim:'source_contract',runtime_observed:false});
      }
      const creation=elementFactoryOrigin(n);
      if(creation){const type=n.arguments[creation.rule.type_argument],child=type?componentFor(type):null;
        if(child){referenced.add(child.id);elementReferenced.add(child.id);}}
    }
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) { const component = componentFor(n.tagName); if (component) referenced.add(component.id); }
    if(ts.isCallExpression(n)){const semantic=resolveReactSemantic(n),rule=semantic?.record?.behavior?.execution;
      if(semantic?.admitted && rule?.kind==='element_construction' && validateReactExecutionRule(rule).valid){
        let owner=n.parent;while(owner && !functionLike(owner))owner=owner.parent;
        const component=n.arguments[rule.type_argument]?componentFor(n.arguments[rule.type_argument]):null;
        if(component && componentList.some(candidate=>candidate.fn===owner)){referenced.add(component.id);elementReferenced.add(component.id);}
      }}ts.forEachChild(n, scan); }; scan(sf); }
  let placementCount = 0;
  const renderedComponents = new Set();
  function render(component, parent, origin, props, ancestry = [], inheritedConditions = [], contextValues = new Map(), argumentValues = null, closureEnv = null) {
    if (placementCount >= 2000 || ancestry.length >= 32) { issue('analysis_limit', origin || component.fn, 'React placement expansion reached its explicit bound.', parent); return; }
    if (ancestry.includes(component.id)) { issue('recursive_component', origin, 'Recursive component placement remains unresolved.', parent); return; }
    const placement = { id: `placement:${digest(stable([parent?.id || 'root', component.id, origin ? node(origin, 'jsx') : null])).slice(0, 24)}`, component_id: component.id, parent_id: parent?.id || null, source_node_id: node(origin || component.fn, origin ? 'jsx' : 'function'), props: Object.fromEntries([...props].map(([key, val]) => [key, descriptor(val)])) };
    output.placements.push(placement); placementCount++; renderedComponents.add(component.id);
    const env = new Map(closureEnv || []); env.set(REACT_CONTEXT_ENV, contextValues); component.fn.parameters.forEach((parameter, i) => bindPattern(parameter.name,
      argumentValues && i < argumentValues.length ? argumentValues[i]
        : argumentValues ? unknown(parameter)
          : i === 0 ? { kind: 'object', fields: props } : unknown(parameter), env, placement));
    const reveal = (target, conditions) => { for (const condition of conditions) { const expression = conditionAst.get(condition.node_id); if (!expression) continue; stateReads(expression, env, placement, (value, read) => { edge(value.state.id, node(read, 'state_reader'), 'state_read', null, conditions, { state_placement_id: value.placement?.id || placement.id }); edge(value.state.id, condition.node_id, 'conditional_render', null, conditions, { state_placement_id: value.placement?.id || placement.id }); edge(value.state.id, target, 'possible_reveal', null, conditions, { state_placement_id: value.placement?.id || placement.id, placement_id: placement.id }); }); } };
    const addCondition = (expression, branch, conditions) => { const result = conditionsFor(expression, branch, conditions); conditionAst.set(result.at(-1).node_id, expression); return result; };
    const containsJsx = n => { let found = false; const walk = current => { if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) found = true; ts.forEachChild(current, walk); }; walk(n); return found; };
    const elementComponentInput=(raw,depth=0)=>{
      const call=elementDescriptionOrigin(raw);if(depth>16||!call)return null;
      const factory=ts.isIdentifier(call.expression)?elementFactoryOrigin(call.expression):null;
      const semantic=factory?.semantic||resolveReactSemantic(call),rule=factory?.rule.construction||semantic?.record?.behavior?.execution;
      if(!semantic?.admitted||!validateReactExecutionRule(rule).valid||!['element_construction','element_clone'].includes(rule.kind)||call.arguments.some(argument=>ts.isSpreadElement(argument)))return null;
      const clone=rule.kind==='element_clone',base=clone?elementComponentInput(call.arguments[rule.element_argument],depth+1):null;
      const type=factory?factory.call.arguments[factory.rule.type_argument]:call.arguments[rule.type_argument];
      const child=clone?base?.child:type?componentFor(type):null;
      const config=unwrap(call.arguments[rule.config_argument-(factory?1:0)]);
      if(!child||(config&&config.kind!==ts.SyntaxKind.NullKeyword&&!ts.isObjectLiteralExpression(config)))return null;
      const props=new Map(base?.props||[]);
      if(config&&ts.isObjectLiteralExpression(config)){
        if(config.properties.some(property=>!(ts.isPropertyAssignment(property)||ts.isShorthandPropertyAssignment(property))||!(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)))){
          issue('element_component_properties_unresolved',call,'Dynamic properties, spreads and accessors remain unresolved.',placement);return null;
        }
        // Object-literal prototype setters and later React props assignments
        // can change inherited values. A flat prop map cannot represent that.
        if(config.properties.some(property=>property.name.text==='__proto__')){
          issue('element_prototype_write_unmodeled',call,'Prototype-changing configuration cannot be reduced to explicit component props.',placement);return null;
        }
        const values=evaluate(config,env,placement).fields;
        for(const property of config.properties){const name=property.name.text;if(!rule.reserved_props.includes(name))props.set(name,{...values.get(name),binding:property});}
      }
      const children=[...call.arguments].slice(rule.children_start-(factory?1:0));
      if(children.length&&rule.children_policy==='replace')props.set('children',children.length===1?evaluate(children[0],env,placement):unknown(call));
      return {child,props};
    };
    // Follow a local, immutable JSX value only at its rendered use. A source
    // allocation is not a placement: unused values stay unreturned, and a value
    // used at several sites needs occurrence-specific placement evidence.
    const jsxStatements=[],expandedJsxAliases=new Set(),aliasStack=new Set();
    let aliasReferences=null;
    const localAlias=identifier=>{
      const binding=symbol(identifier),declaration=binding?.declarations?.find(ts.isVariableDeclaration);
      if(!declaration?.initializer||!ts.isIdentifier(declaration.name))return null;
      let owner=declaration.parent;while(owner&&!functionLike(owner))owner=owner.parent;
      return owner===component.fn?{binding,declaration}:null;
    };
    const containsAliasedJsx=(raw,seen=new Set())=>{
      const value=unwrap(raw);if(!value||seen.has(value)||seen.size>=20)return false;seen.add(value);
      if(containsJsx(value))return true;
      if(ts.isIdentifier(value)){const alias=localAlias(value);return !!alias&&containsAliasedJsx(alias.declaration.initializer,seen);}
      return ts.isArrayLiteralExpression(value)&&value.elements.some(item=>containsAliasedJsx(item,new Set(seen)));
    };
    const referenceCount=binding=>{
      if(!aliasReferences){
        aliasReferences=new Map();
        const scan=current=>{
          if(ts.isTypeNode(current))return;
          if(ts.isIdentifier(current)&&!(ts.isVariableDeclaration(current.parent)&&current.parent.name===current)){
            const reference=symbol(current);if(reference)aliasReferences.set(reference,(aliasReferences.get(reference)||0)+1);
          }
          ts.forEachChild(current,scan);
        };scan(component.fn.body);
      }
      return aliasReferences.get(binding)||0;
    };
    const isRenderedValue=n=>{
      let child=n,parent=n.parent;
      while(parent&&(ts.isParenthesizedExpression(parent)||ts.isAsExpression(parent)||ts.isNonNullExpression(parent)||ts.isTypeAssertionExpression(parent))){child=parent;parent=parent.parent;}
      return !!parent&&(ts.isReturnStatement(parent)||ts.isJsxExpression(parent)||ts.isArrayLiteralExpression(parent)
        ||ts.isConditionalExpression(parent)&&parent.condition!==child
        ||ts.isBinaryExpression(parent)&&[ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind)
          &&(parent.right===child||parent.operatorToken.kind===ts.SyntaxKind.BarBarToken)
        ||ts.isVariableDeclaration(parent)&&aliasStack.has(parent));
    };
    const visit = (n, conditions, currentContexts = contextValues) => {
      if (n !== component.fn && functionLike(n)) return;
      if (ts.isBlock(n)) { visitBlock(n, conditions, (child, next) => visit(child, next, currentContexts), addCondition); return; }
      if (ts.isIterationStatement(n, false) || ts.isSwitchStatement(n) || ts.isTryStatement(n)) { issue('unsupported_control_flow', n, 'Loop, switch, or exception rendering remains unresolved.', placement); return; }
      if(ts.isVariableStatement(n)){if(containsJsx(n))jsxStatements.push(n);return;}
      if(ts.isExpressionStatement(n)){if(containsJsx(n))issue('unreturned_jsx',n,'Constructed JSX is not a proven returned component subtree.',placement);return;}
      if (ts.isObjectLiteralExpression(n)) { if (containsJsx(n)) issue('unsupported_render_value', n, 'JSX stored in an object is not a proven rendered subtree.', placement); return; }
      if (ts.isIfStatement(n)) { visit(n.thenStatement, addCondition(n.expression, 'truthy', conditions), currentContexts); if (n.elseStatement) visit(n.elseStatement, addCondition(n.expression, 'falsy', conditions), currentContexts); return; }
      if (ts.isConditionalExpression(n)) { visit(n.whenTrue, addCondition(n.condition, 'truthy', conditions), currentContexts); visit(n.whenFalse, addCondition(n.condition, 'falsy', conditions), currentContexts); return; }
      if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)) { visit(n.left, conditions, currentContexts); visit(n.right, addCondition(n.left, n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? 'truthy' : 'falsy', conditions), currentContexts); return; }
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
        const opening = ts.isJsxElement(n) ? n.openingElement : n, jsxId = node(n, 'jsx'), sourceTag = opening.tagName.getText(), attributes = opening.attributes.properties;
        const tagValue = evaluate(opening.tagName, env, placement);
        const nativeTag = /^[a-z]/.test(sourceTag) ? sourceTag : tagValue.kind === 'literal' && typeof tagValue.value === 'string' ? tagValue.value : null;
        reveal(jsxId, conditions);
        let forwardedChildren = false;
        const boundarySemantic=resolveReactSemantic(opening),boundaryRule=boundarySemantic?.admitted?boundarySemantic.record.behavior?.execution:null;
        if(validateReactExecutionRule(boundaryRule).valid && boundaryRule.kind==='boundary_type') {
          // Index the possible renderer inputs, keeping their selection as an
          // obligation. Element creation alone does not discharge this guard.
          for(const input of boundaryRule.child_inputs) {
            const explicitChildren=ts.isJsxElement(n)?n.children.filter(child=>!ts.isJsxExpression(child) || child.expression):[];
            const hasExplicitChildren=explicitChildren.some(child=>!ts.isJsxText(child) || child.text.trim());
            let candidate=null,spreadUnknown=false;
            // JSX props are assigned in source order. A later explicit value
            // wins over a spread; a later unknown spread invalidates an earlier
            // candidate. Positional JSX children override the children prop.
            for(const attribute of attributes) {
              if(ts.isJsxSpreadAttribute(attribute)){candidate=null;spreadUnknown=true;continue;}
              if(!ts.isJsxAttribute(attribute) || attribute.name.getText()!==input)continue;
              candidate=attribute.initializer&&ts.isJsxExpression(attribute.initializer)?attribute.initializer.expression:attribute.initializer;
              spreadUnknown=false;
            }
            const whitespaceAmbiguous=input==='children' && !hasExplicitChildren && explicitChildren.length>0 && (candidate || spreadUnknown);
            if(input==='children' && hasExplicitChildren){candidate=null;spreadUnknown=false;}
            if(spreadUnknown || whitespaceAmbiguous) {
              issue(whitespaceAmbiguous?'boundary_children_whitespace_unresolved':'boundary_input_spread_unresolved',opening,
                `The final ${input} input is not established by the supplied JSX source.`,placement);continue;
            }
            const candidates=input==='children' && hasExplicitChildren?explicitChildren:candidate?[candidate]:[];
            const guard={node_id:node(n,'condition'),text:`${boundarySemantic.record.export} renderer selected ${input}`,branch:'truthy',
              react_boundary_input:input,source_call_id:node(opening,'call'),semantic_id:boundarySemantic.record.id,runtime_observed:false};
            for(const candidate of candidates)visit(candidate,[...conditions,guard],currentContexts);
          }
          issue('react_boundary_renderer_selection_unobserved',opening,'Boundary inputs are possible source paths; creating the element does not prove renderer selection or execution.',placement);
          return;
        }

        if (tagValue.kind === 'react_context_member' && tagValue.member === 'Provider') {
          let provided = null, valueSource = opening, exactFinalValue = false;
          for (const attribute of attributes) {
            if (ts.isJsxSpreadAttribute(attribute)) {
              const spread = evaluate(attribute.expression, env, placement);
              if (spread.kind === 'object') {
                if (spread.fields.has('value')) {
                  provided = spread.fields.get('value');
                  valueSource = attribute;
                  exactFinalValue = true;
                }
              } else {
                provided = null;
                valueSource = attribute;
                exactFinalValue = false;
              }
              continue;
            }
            if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'value') continue;
            const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer)
              ? attribute.initializer.expression : attribute.initializer;
            provided = !attribute.initializer ? { kind: 'literal', value: true, node_id: node(attribute) }
              : expression ? evaluate(expression, env, placement) : unknown(attribute);
            valueSource = attribute;
            exactFinalValue = true;
          }
          if (!exactFinalValue || !provided) {
            issue('context_provider_value_unresolved', opening,
              'A context Provider needs one exact final value prop before consumers can inherit it.', placement);
            return;
          }
          if (provided.kind === 'source' && !provided.node_id) provided = unknown(valueSource);
          const nextContexts = new Map(currentContexts);
          nextContexts.set(tagValue.context.id, provided);
          const protocol = { id:`react-protocol:${digest(stable([tagValue.context.call_id, jsxId, 'Provider'])).slice(0,24)}`,
            semantic_id:tagValue.context.semantic_id,
            semantic_application_id:tagValue.context.semantic_application_id,
            producer_call_id:tagValue.context.call_id,member_call_id:jsxId,member:'Provider',context_id:tagValue.context.id,
            callback_bindings:[],claim:'source_contract',runtime_observed:false };
          if (!output.react_protocols.some(value => value.id === protocol.id)) output.react_protocols.push(protocol);
          if (ts.isJsxElement(n)) for (const child of n.children) visit(child, conditions, nextContexts);
          return;
        }
        if (tagValue.kind === 'react_context_member' && tagValue.member === 'Consumer') {
          const children = ts.isJsxElement(n) ? n.children.filter(child => !ts.isJsxText(child) || child.text.trim()) : [];
          const expression = children.length === 1 && ts.isJsxExpression(children[0])
            ? children[0].expression : null;
          const callback = expression ? evaluate(expression, env, placement) : null;
          const callbackSourceId = callback?.kind === 'function'
            ? node(callback.fn, 'function') : expression ? node(expression) : null;
          const protocol = { id:`react-protocol:${digest(stable([tagValue.context.call_id, jsxId, 'Consumer', callbackSourceId])).slice(0,24)}`,
            semantic_id:tagValue.context.semantic_id,
            semantic_application_id:tagValue.context.semantic_application_id,
            producer_call_id:tagValue.context.call_id,member_call_id:jsxId,member:'Consumer',context_id:tagValue.context.id,
            callback_bindings:callbackSourceId ? [{slot:'props.children',source_id:callbackSourceId,
              resolution:callback?.kind === 'function' ? 'exact_source_function' : 'runtime_selected_value'}] : [],
            claim:'source_contract',runtime_observed:false };
          if (!output.react_protocols.some(value => value.id === protocol.id)) output.react_protocols.push(protocol);
          if (callback?.kind !== 'function') {
            issue('context_consumer_render_callback_unresolved', opening,
              'Context.Consumer callback selection requires runtime evidence before its returned subtree can be expanded.', placement);
            return;
          }
          const selected = currentContexts.has(tagValue.context.id)
            ? currentContexts.get(tagValue.context.id) : tagValue.context.default_value;
          const contextualValue = { ...selected, react_context_id:tagValue.context.id };
          let child = componentList.find(candidate => candidate.fn === callback.fn);
          if (!child) {
            const registered = functions.get(callback.fn);
            child = { ...registered, id:registered?.id || node(callback.fn, 'function'),
              name:registered?.name || '<Context.Consumer callback>', fn:callback.fn,
              file:callback.fn.getSourceFile().fileName };
            componentList.push(child);
            output.components.push({ id:child.id, name:child.name, file:child.file });
          }
          render(child, placement, children[0], new Map(), [...ancestry, component.id], conditions,
            currentContexts, [contextualValue], callback.env);
          return;
        }
        if (nativeTag) {
          const bindings = new Map();
          for (const attribute of attributes) {
            if (ts.isJsxSpreadAttribute(attribute)) {
              const spread = evaluate(attribute.expression, env, placement);
              if (spread.kind === 'object') {
                for (const [name, value] of spread.fields) if (/^on[A-Z]/.test(name)) bindings.set(name, { handler: value, binding: value.binding || attribute, expression: null, uncertain: false });
              } else {
                issue('unsupported_spread', attribute, 'Unknown JSX spreads can supply or replace props and event bindings.', placement);
                for (const binding of bindings.values()) binding.uncertain = true;
              }
              continue;
            }
            if (!ts.isJsxAttribute(attribute) || !/^on[A-Z]/.test(attribute.name.getText())) continue;
            const name = attribute.name.getText();
            const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : null;
            if (attribute.initializer && ts.isJsxExpression(attribute.initializer) && !expression) { output.claims.source_indexed = false; issue('syntax_error', attribute, 'JSX attributes require a nonempty expression.', placement); }
            bindings.set(name, { handler: expression ? evaluate(expression, env, placement) : unknown(attribute), binding: attribute, expression, uncertain: false });
          }
          if (nativeTag === 'form' || nativeTag === 'button' && !attributes.some(a => ts.isJsxAttribute(a) && a.name.getText() === 'type' && a.initializer && ts.isStringLiteral(a.initializer) && a.initializer.text === 'button')) issue('unsupported_submission', opening, 'Native form submission and default activation are separate unresolved boundaries.', placement);
          for (const [name, binding] of bindings) {
            if (!nativeEvents.has(name)) issue('unsupported_event', binding.binding, `Native ${name} is not in the bounded event contract.`, placement);
            const handler = !binding.uncertain && nativeEvents.has(name) ? binding.handler : unknown(binding.binding);
            const bindingId = node(binding.binding, 'binding');
            const alternatives = handler.kind === 'function' || handler.kind === 'library_callable'
              || handler.kind === 'library_callable_set' || !binding.expression
              ? { options: [], complete: false }
              : callbackAlternatives(binding.expression, env, placement, conditions);
            if (!binding.uncertain && nativeEvents.has(name) && alternatives.complete
                && alternatives.options.length > 0) {
              const id = `control:${digest(stable([bindingId, placement.id])).slice(0, 24)}`;
              const handlerIds = [...new Set(alternatives.options.map(option => node(option.callback.fn, 'function')))];
              const control = { id, source_node_id: jsxId, binding_id: bindingId,
                event: name.slice(2).toLowerCase(), tag: nativeTag, placement_id: placement.id,
                handler_ids: handlerIds, conditions, status: 'resolved', callback_selection: 'runtime_required' };
              output.controls.push(control);
              reveal(id, conditions);
              for (const [optionIndex, option] of alternatives.options.entries()) {
                const handlerId = node(option.callback.fn, 'function');
                const scenarioConditions = option.conditions;
                const scenario = { id: `scenario:${digest(stable([id, handlerId, optionIndex,
                  scenarioConditions])).slice(0, 24)}`, control_id:id, placement_id:placement.id,
                  handler_ids:[handlerId], captured_arguments:[], conditions:scenarioConditions,
                  callback_selection:'runtime_required' };
                output.scenarios.push(scenario);
                edge(control.id, handlerId, 'event_handler', scenario, scenarioConditions, {
                  evidence_ids:[control.id, handlerId], callback_selection:'runtime_required' });
                invoke(option.callback, [], scenario, scenarioConditions);
              }
              issue('runtime_callback_selection_required', binding.binding,
                'Finite callback alternatives are source-indexed; runtime invocation must select the exact function occurrence.', placement);
              continue;
            }
            const resolvedHandlers = handler.kind === 'function' ? [handler]
              : handler.kind === 'library_callable' ? [handler.callback]
              : handler.kind === 'library_callable_set' ? handler.callables.map(callable => callable.callback) : [];
            const id = `control:${digest(stable([bindingId, placement.id])).slice(0, 24)}`, handlerIds = resolvedHandlers.map(item => node(item.fn, 'function'));
            const control = { id, source_node_id: jsxId, binding_id: bindingId, event: name.slice(2).toLowerCase(), tag: nativeTag, placement_id: placement.id, handler_ids: handlerIds, conditions, status: handlerIds.length ? 'resolved' : 'unresolved' };
            output.controls.push(control); const scenario = { id: `scenario:${digest(id).slice(0, 24)}`, control_id: id, placement_id: placement.id, handler_ids: handlerIds, captured_arguments: [], conditions }; output.scenarios.push(scenario);
            reveal(id, conditions);
            if (handlerIds.length) {
              if (handler.kind === 'library_callable') applyLibraryCallable(control.id, handler, scenario, conditions, [], [], placement, new Set());
              else if (handler.kind === 'library_callable_set') for (const callable of handler.callables) applyLibraryCallable(control.id, callable, scenario, conditions, [], [], placement, new Set());
              else {
                for (const handlerId of handlerIds) edge(control.id, handlerId, 'event_handler', scenario, conditions,
                  handler.producer_call_id ? { producer_call_id: handler.producer_call_id,
                    evidence_ids: [control.id, handlerId, handler.producer_call_id],
                    ...(handler.react_semantic_id ? { react_semantic_id: handler.react_semantic_id } : {}) } : {});
                invoke(handler, [], scenario, conditions);
              }
            } else {
              if (handler.kind === 'library_unresolved') {
                const backlog = { call_id: bindingId, scenario_id: scenario.id, package: handler.contract.package,
                  version: handler.evidence?.version, producer: handler.contract.producer, reason: handler.reason };
                if (!output.library_backlog.some(row => stable(row) === stable(backlog))) output.library_backlog.push(backlog);
              }
              issue('dynamic_callback', binding.binding, binding.uncertain ? 'A later JSX prop may replace this handler.' : 'Event target is not an exact source function.', placement);
            }
          }
        } else {
          const child = componentFor(opening.tagName), childProps = new Map();
          for (const attribute of attributes) {
            if (ts.isJsxSpreadAttribute(attribute)) { childProps.clear(); continue; }
            if (!ts.isJsxAttribute(attribute)) continue;
            const key = attribute.name.getText(), init = attribute.initializer;
            const value = !init ? { kind: 'literal', value: true } : ts.isStringLiteral(init) ? evaluate(init, env, placement) : ts.isJsxExpression(init) ? evaluate(init.expression, env, placement) : unknown(init);
            childProps.set(key, { ...value, binding: attribute });
          }
          if (child) {
            forwardedChildren = forwardsChildren(child);
            render(child, placement, n, childProps, [...ancestry, component.id], conditions, currentContexts);
          } else if (transparentTag(opening.tagName)) forwardedChildren = true;
          else {
            const identity = importedIdentity(opening.tagName);
            const evidence = identity ? packageInstallation(identity.package, opening.getSourceFile().fileName) : null;
            const contracts = identity && evidence ? producerContracts({ packageName: identity.package,
              version: evidence.version, producer: identity.member, kind: 'component_event' }) : [];
            if (!contracts.length) {
              issue('unresolved_component', opening, 'Custom component or library behavior is outside the supplied component graph.', placement);
              if (identity && evidence && knownContractPackages.has(identity.package)) {
                const backlog = { call_id: jsxId, placement_id: placement.id, package: identity.package,
                  version: evidence.version, producer: identity.member,
                  reason: evidence.reason || 'verified_component_contract_unavailable' };
                if (!output.library_backlog.some(row => stable(row) === stable(backlog))) output.library_backlog.push(backlog);
              }
            }
            for (const contract of contracts) {
              const admittedEvidence = contractEvidence(evidence, contract);
              if (admittedEvidence.verified === true) forwardedChildren ||= contract.forwards_children === true;
              const binding = childProps.get(contract.callback_prop);
              const bindingId = binding?.binding ? node(binding.binding, 'binding') : node(opening, 'binding');
              const id = `control:${digest(stable([bindingId, placement.id, contract.id])).slice(0, 24)}`;
              const callback = binding?.kind === 'function' ? binding : null;
              const handlerIds = callback ? [node(callback.fn, 'function')] : [];
              const control = { id, source_node_id: jsxId, binding_id: bindingId,
                event: contract.activation_event, tag: `${contract.package}.${contract.producer}`,
                placement_id: placement.id, handler_ids: handlerIds, conditions,
                status: callback && admittedEvidence.verified === true ? 'resolved' : 'unresolved' };
              output.controls.push(control);
              const scenario = { id: `scenario:${digest(id).slice(0, 24)}`, control_id: id,
                placement_id: placement.id, handler_ids: handlerIds, captured_arguments: [], conditions };
              output.scenarios.push(scenario);
              if (callback && admittedEvidence.verified === true) {
                const eventValue = { kind: 'source', text: `${contract.package}.${contract.producer}.${contract.activation_event}.event` };
                applyLibraryCallable(control.id, { kind: 'library_callable', contract, evidence: admittedEvidence,
                  producer_call: opening, callback, callback_values: [eventValue], wrapper_call_ids: [] },
                scenario, conditions, [eventValue], [descriptor(eventValue)], placement, new Set());
              } else {
                const reason = admittedEvidence.verified !== true
                  ? admittedEvidence.reason || 'package_installation_unverified'
                  : binding ? 'contract_callback_ambiguous' : 'contract_callback_unresolved';
                const backlog = { call_id: id, scenario_id: scenario.id, package: contract.package,
                  version: evidence.version, producer: contract.producer, callback_prop: contract.callback_prop, reason };
                if (!output.library_backlog.some(row => stable(row) === stable(backlog))) output.library_backlog.push(backlog);
                issue('dynamic_callback', binding?.binding || opening, `Library component callback remains unresolved (${reason}).`, placement);
              }
            }
          }
        }
        if (ts.isJsxElement(n)) {
          if (nativeTag || forwardedChildren) for (const child of n.children) visit(child, conditions, currentContexts);
          else if (n.children.some(child => !ts.isJsxText(child) || child.text.trim())) issue('unsupported_children', n, 'Custom component children require a verified render or forwarding contract.', placement);
        }
        return;
      }
      if(ts.isCallExpression(n)) {
        const semantic=resolveReactSemantic(n),rule=semantic?.admitted?semantic.record.behavior?.execution:null;
        if((validateReactExecutionRule(rule).valid && ['element_construction','element_clone'].includes(rule.kind))
          || (ts.isIdentifier(n.expression)&&elementFactoryOrigin(n.expression))) {
          // A returned createElement call with an exact native type is the
          // same product control as equivalent JSX. Keep the call itself as
          // the stamp target; the runtime compiler will add the source stamp
          // to its explicit object-literal config without evaluating it.
          const factory=ts.isIdentifier(n.expression)?elementFactoryOrigin(n.expression):null;
          const construction=factory?.rule.construction||rule;
          const typeExpression=elementTypeExpression(n);
          const typeValue=typeExpression?evaluate(typeExpression,env,placement):null;
          const nativeTag=typeValue?.kind==='literal'&&typeof typeValue.value==='string'&&/^[a-z]/.test(typeValue.value)?typeValue.value:null;
          if(nativeTag&&['element_construction','element_clone'].includes(construction?.kind)){
            const offset=factory?1:0,config=unwrap(n.arguments[construction.config_argument-offset]);
            const consumed={node_id:node(n,'call'),text:'React renderer consumed this native element description',branch:'truthy',runtime_observed:false};
            const nextConditions=[...conditions,consumed];
            if(!config||!ts.isObjectLiteralExpression(config)||config.properties.some(property=>ts.isSpreadAssignment(property))){
              issue('element_native_config_unresolved',n,'Native createElement controls require an explicit object-literal config before a source stamp can be added.',placement);return;
            }
            for(const property of config.properties){
              if(!(ts.isPropertyAssignment(property)||ts.isShorthandPropertyAssignment(property)||ts.isMethodDeclaration(property))
                ||!property.name||property.name.kind===ts.SyntaxKind.ComputedPropertyName)continue;
              const name=property.name.getText().replace(/^['"]|['"]$/g,'');if(!/^on[A-Z]/.test(name))continue;
              if(!nativeEvents.has(name)){issue('unsupported_event',property,`Native ${name} is not in the bounded event contract.`,placement);continue;}
              const expression=ts.isPropertyAssignment(property)?property.initializer:ts.isShorthandPropertyAssignment(property)?property.name:property;
              const handler=evaluate(expression,env,placement),bindingId=node(property,'binding');
              const id=`control:${digest(stable([bindingId,placement.id])).slice(0,24)}`;
              const handlerIds=handler.kind==='function'?[node(handler.fn,'function')]:[];
              const control={id,source_node_id:node(n,'call'),binding_id:bindingId,event:name.slice(2).toLowerCase(),tag:nativeTag,
                placement_id:placement.id,handler_ids:handlerIds,conditions:nextConditions,status:handlerIds.length?'resolved':'unresolved'};
              output.controls.push(control);const scenario={id:`scenario:${digest(id).slice(0,24)}`,control_id:id,placement_id:placement.id,
                handler_ids:handlerIds,captured_arguments:[],conditions:nextConditions};output.scenarios.push(scenario);reveal(id,nextConditions);
              if(handlerIds.length){edge(control.id,handlerIds[0],'event_handler',scenario,nextConditions);invoke(handler,[],scenario,nextConditions);}
              else issue('dynamic_callback',property,'Native createElement event target is not an exact source function.',placement);
            }
            for(const child of [...n.arguments].slice(construction.children_start-offset))if(!ts.isSpreadElement(child))visit(child,nextConditions,currentContexts);
            issue('element_renderer_consumption_unobserved',n,'Type/prop source selection does not prove this description was committed.',placement);return;
          }
          const input=elementComponentInput(n);
          if(!input){issue('element_component_input_unresolved',n,'Element construction or cloning needs an exact component source and explicit property inputs.',placement);return;}
          const condition={node_id:node(n,'call'),text:'React renderer consumed this element description',branch:'truthy',runtime_observed:false};
          render(input.child,placement,n,input.props,[...ancestry,component.id],[...conditions,condition],currentContexts);
          issue('element_renderer_consumption_unobserved',n,'Type/prop source selection does not prove a description-to-commit relationship or default-prop evaluation.',placement);return;
        }
        if(validateReactExecutionRule(rule).valid && rule.kind==='portal_description') {
          if(n.arguments.some(argument=>ts.isSpreadElement(argument)) || !n.arguments[rule.children_argument]) {
            issue('portal_children_input_unresolved',n,'Portal child position requires explicit arguments.',placement);return;
          }
          const callId=node(n,'call'),condition={node_id:callId,text:'React renderer consumed portal children',branch:'truthy',
            react_portal_input:rule.children_argument,semantic_id:semantic.record.id,runtime_observed:false};
          visit(n.arguments[rule.children_argument],[...conditions,condition],currentContexts);
          issue('portal_renderer_consumption_unobserved',n,'A returned portal describes children and a container; construction does not prove their commit.',placement);return;
        }
      }
      if (ts.isCallExpression(n) && !reactHook(n)) {
        const modeledRender = directLibraryRender(n, env, placement);
        if (modeledRender?.status === 'modeled') {
          const callId = node(n, 'call'), targetId = node(modeledRender.rendered.fn, 'function');
          edge(callId, targetId, 'library_render', null, conditions, {
            arguments: n.arguments.map(argument => descriptor(evaluate(argument, env, placement))),
            contract_id: modeledRender.contract.id, package: modeledRender.contract.package,
            package_version: modeledRender.evidence.version,
            placement_id: placement.id, render_timing: modeledRender.contract.render_timing,
            contract_conditions: [modeledRender.contract.condition],
            evidence_ids: [callId, targetId],
          });
          const application = { id: `library-contract:${digest(stable([placement.id, callId, modeledRender.contract.id, targetId])).slice(0, 24)}`,
            contract_id: modeledRender.contract.id, invocation_call_id: callId, callback_id: targetId,
            placement_id: placement.id, package: modeledRender.contract.package,
            version: modeledRender.evidence.version,
            package_verification_sha256: modeledRender.evidence.verification_sha256,
            kind: modeledRender.contract.kind, render_timing: modeledRender.contract.render_timing,
            condition: modeledRender.contract.condition };
          if (!output.library_contracts.some(row => row.id === application.id)) output.library_contracts.push(application);
          let child = componentList.find(candidate => candidate.fn === modeledRender.rendered.fn);
          if (!child) {
            const registered = functions.get(modeledRender.rendered.fn);
            child = { ...registered, name: registered?.name || '<flexRender callback>', file: modeledRender.rendered.fn.getSourceFile().fileName };
            componentList.push(child);
            output.components.push({ id: child.id, name: child.name, file: child.file });
          }
          const props = modeledRender.props.kind === 'object' ? modeledRender.props.fields : new Map();
          render(child, placement, n, props, [...ancestry, component.id], conditions, currentContexts,
            null, modeledRender.rendered.env);
          return;
        }
        if (modeledRender?.status === 'backlog') {
          const backlog = { call_id: node(n, 'call'), placement_id: placement.id,
            package: modeledRender.contract.package, version: modeledRender.evidence?.version,
            producer: modeledRender.contract.producer, reason: modeledRender.reason };
          if (!output.library_backlog.some(row => stable(row) === stable(backlog))) output.library_backlog.push(backlog);
          issue('unsupported_render_call', n, `Library render boundary remains unresolved (${modeledRender.reason}).`, placement);
          return;
        }
        // JSX returned by arbitrary calls / render props needs execution and invocation evidence.
        let callbackJsx = false; const inspect = current => { if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) callbackJsx = true; ts.forEachChild(current, inspect); }; for (const arg of n.arguments) if (functionLike(unwrap(arg))) inspect(arg);
        if (callbackJsx) issue('dynamic_callback', n, 'JSX inside a higher-order callback is not expanded without an invocation contract.', placement);
        issue('unsupported_render_call', n, 'A returned or child call requires an explicit component-output contract.', placement);
        return;
      }
      if(ts.isIdentifier(n)&&isRenderedValue(n)){
        const alias=localAlias(n);
        if(alias&&containsAliasedJsx(alias.declaration.initializer)){
          const {binding,declaration}=alias;
          if(!(declaration.parent.flags&ts.NodeFlags.Const)||mutatedSymbols.has(binding)){
            issue('mutable_jsx_alias',n,'A changed JSX binding cannot select an exact rendered allocation.',placement);return;
          }
          if(referenceCount(binding)!==1){issue('ambiguous_jsx_alias_placement',n,'A JSX value with multiple uses needs runtime placement selection.',placement);return;}
          if(aliasStack.has(declaration)||aliasStack.size>=20){issue('jsx_alias_limit',n,'JSX alias expansion reached its explicit bound.',placement);return;}
          expandedJsxAliases.add(declaration);aliasStack.add(declaration);
          visit(unwrap(declaration.initializer),conditions,currentContexts);aliasStack.delete(declaration);return;
        }
      }
      if ((ts.isIdentifier(n)||ts.isElementAccessExpression(n)) && !(ts.isBindingElement(n.parent) && n.parent.name === n) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
        const value = evaluate(n, env, placement);
        if (value.kind === 'state' && value.role === 'value') edge(value.state.id, node(n, 'state_reader'), 'state_read', null, conditions, { state_placement_id: value.placement?.id || placement.id });
      }
      ts.forEachChild(n, child => visit(child, conditions, currentContexts));
    };
    if (component.fn.body) visit(component.fn.body, inheritedConditions);
    for(const statement of jsxStatements)if(statement.declarationList.declarations.some(declaration=>declaration.initializer
      &&containsJsx(declaration.initializer)&&!expandedJsxAliases.has(declaration)))
      issue('unreturned_jsx',statement,'Constructed JSX is not a proven returned component subtree.',placement);
  }
  const conditionAst = new Map();
  for (const component of componentList.filter(c => !referenced.has(c.id))) render(component, null, null, new Map());
  // Cycles can have no topological root; retain a bounded hypothetical root and report recursion.
  for (const component of componentList) if (!renderedComponents.has(component.id)) {
    if(elementReferenced.has(component.id))issue('element_component_placement_unresolved',component.fn,'An element type referenced by construction is not a separately proven root placement.');
    else render(component, null, null, new Map());
  }
  // Retain direct library boundaries that source indexing found but current control/render traversal could not reach.
  for (const sf of sourceFiles.values()) {
    const scan = current => {
      if (ts.isCallExpression(current)) {
        const identity = importedIdentity(current.expression);
        const evidence = identity ? packageInstallation(identity.package, sf.fileName) : null;
        if (identity && evidence) {
          const contracts = producerContracts({ packageName: identity.package, version: evidence.version,
            producer: identity.member }).filter(contract => ['direct_function_effect', 'function_renders_argument'].includes(contract.kind));
          for (const contract of contracts) {
            const callId = node(current, 'call');
            if (output.library_contracts.some(row => row.contract_id === contract.id && row.invocation_call_id === callId)
              || output.library_backlog.some(row => row.call_id === callId && row.package === contract.package)) continue;
            const admittedEvidence = contractEvidence(evidence, contract);
            output.library_backlog.push({ call_id: callId, package: contract.package, version: evidence.version,
              producer: contract.producer, reason: admittedEvidence.verified === true
                ? 'library_boundary_not_reached_by_control_or_render_scenario'
                : admittedEvidence.reason || 'package_installation_unverified' });
          }
        }
      }
      ts.forEachChild(current, scan);
    };
    scan(sf);
  }
  // Returned React root members are source protocols even when called outside
  // a control scenario. Their execution still requires runtime evidence.
  const rootProducerAlternatives=(raw,seen=new Set())=>{
    const value=unwrap(raw);if(!value||seen.has(value)||seen.size>20)return [];
    seen=new Set(seen).add(value);
    const evaluated=evaluate(value,new Map(),null);
    if(evaluated.kind==='react_root')return [evaluated.root];
    if(ts.isConditionalExpression(value))return [...rootProducerAlternatives(value.whenTrue,seen),...rootProducerAlternatives(value.whenFalse,seen)];
    if(ts.isIdentifier(value)){
      const binding=symbol(value),declaration=binding?.declarations?.length===1&&binding.declarations[0];
      if(declaration&&ts.isVariableDeclaration(declaration)&&declaration.initializer&&(declaration.parent.flags&ts.NodeFlags.Const)
        &&!mutatedSymbols.has(binding))return rootProducerAlternatives(declaration.initializer,seen);
    }
    return [];
  };
  for (const sf of sourceFiles.values()) {
    const scan = current => {
      if (ts.isCallExpression(current)) {
        const target = evaluate(current.expression, new Map(), null);
        if (target.kind === 'react_root_member') retainReactProtocol(current, target);
        else {
          const property=ts.isPropertyAccessExpression(current.expression)?current.expression.name.text
            :ts.isElementAccessExpression(current.expression)&&ts.isStringLiteral(current.expression.argumentExpression)?current.expression.argumentExpression.text:null;
          const receiver=property&&['render','unmount'].includes(property)?current.expression.expression:null;
          const alternatives=receiver?rootProducerAlternatives(receiver):[];
          if(alternatives.length===1)retainReactProtocol(current,{kind:'react_root_member',root:alternatives[0],member:property});
          else if(alternatives.length>1)issue('react_root_receiver_ambiguous',current,
            'This call can target more than one concurrent root, so runtime handle identity is required before selecting a producer.');
        }
        if(target.kind==='react_transition_start') {
          const protocol=retainReactProtocol(current,target),argument=current.arguments[target.rule.start_rule.callback_argument];
          retainTransitionCandidates(protocol,callbackAlternatives(argument,new Map(),null));
        }
      }
      ts.forEachChild(current, scan);
    };
    scan(sf);
  }
  // Context creation may be reached after a hook body during the bounded
  // render walk. Reconcile the exact immutable context argument once all
  // source-owned createContext values have been indexed.
  for (const application of output.react_semantics) {
    if (application.export !== 'createContext' || application.causal_bindings?.context_id) continue;
    const call=syntaxNodes.get(application.call_id);
    if (call && ts.isCallExpression(call)) evaluate(call,new Map(),null);
  }
  for (const application of output.react_semantics) {
    if (application.export !== 'useContext' || application.causal_bindings?.context_id) continue;
    const argument = syntaxNodes.get(application.causal_bindings?.inputs?.['arguments.0']);
    const context = knownReactContext(argument);
    if (context) application.causal_bindings.context_id = context.id;
  }
  for(const application of output.react_semantics) {
    const rule=application.behavior?.execution;if(rule?.kind!=='component_wrapper' || application.causal_bindings.owner_source_id)continue;
    const call=syntaxNodes.get(application.call_id),callback=unwrap(call?.arguments?.[rule.component_argument]);
    if(!callback || !ts.isFunctionExpression(callback) || !callback.name || callback.asteriskToken
      || callback.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword))continue;
    // The body probe reads the function's own name and arguments object. Reject
    // bindings that could shadow either, including destructured parameters and
    // hoisted function declarations; no replacement callback is introduced.
    let shadowed=false;
    const shadows=name=>{
      if(ts.isIdentifier(name))return [callback.name.text,'arguments'].includes(name.text);
      if(ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))return name.elements.some(element=>
        ts.isBindingElement(element) && shadows(element.name));
      return false;
    };
    const scan=current=>{
      if(current!==callback && functionLike(current)) {
        if(ts.isFunctionDeclaration(current) && current.name && shadows(current.name))shadowed=true;
        return;
      }
      if((ts.isVariableDeclaration(current) || ts.isParameter(current) || ts.isClassDeclaration(current))
        && current.name && shadows(current.name))shadowed=true;
      ts.forEachChild(current,scan);
      if(ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text==='eval')shadowed=true;
    };scan(callback);
    if(!shadowed)application.causal_bindings.wrapper_render={source_id:node(callback,'function'),self_name:callback.name.text};
  }
  // A pending boolean selects a source branch; it does not prove that a
  // scheduled update, selected subtree, or render subsequently committed.
  for(const application of output.react_semantics) {
    const rule=application.behavior?.execution;if(rule?.kind!=='transition_hook')continue;
    const call=syntaxNodes.get(application.call_id),declaration=call?.parent;
    if(!declaration || !ts.isVariableDeclaration(declaration) || declaration.initializer!==call
      || !ts.isArrayBindingPattern(declaration.name) || !(declaration.parent.flags & ts.NodeFlags.Const))continue;
    const member=declaration.name.elements[rule.pending_index];
    if(!member || !ts.isBindingElement(member) || member.dotDotDotToken || !ts.isIdentifier(member.name)
      || mutatedSymbols.has(symbol(member.name)))continue;
    const binding=symbol(member.name),reads=[];let owner=call.parent;while(owner && !functionLike(owner))owner=owner.parent;
    const scan=current=>{
      if(functionLike(current))return;
      if(ts.isConditionalExpression(current) || ts.isIfStatement(current)) {
        const condition=ts.isConditionalExpression(current)?current.condition:current.expression;
        if(ts.isIdentifier(condition) && symbol(condition)===binding)reads.push({read_id:node(condition),
          truthy_source_id:node(ts.isConditionalExpression(current)?current.whenTrue:current.thenStatement),
          falsy_source_id:current.whenFalse||current.elseStatement?node(current.whenFalse||current.elseStatement):null});
      }
      ts.forEachChild(current,scan);
    };
    if(owner?.body)scan(owner.body);application.causal_bindings.pending_branch_reads=reads;
  }
  // Preserve hook results into same-render JSX expression sites. Captured uses
  // need a separate retained-callback origin and are not inferred here.
  for(const application of output.react_semantics) {
    if(!['id_allocation','deferred_value'].includes(application.behavior?.execution?.kind))continue;
    const deferred=application.behavior.execution.kind==='deferred_value';
    const call=syntaxNodes.get(application.call_id),declaration=call?.parent;
    if(!declaration || !ts.isVariableDeclaration(declaration) || declaration.initializer!==call
      || !ts.isIdentifier(declaration.name) || !(declaration.parent.flags & ts.NodeFlags.Const)
      || mutatedSymbols.has(symbol(declaration.name)))continue;
    const binding=symbol(declaration.name);let owner=call.parent;
    while(owner && !functionLike(owner))owner=owner.parent;
    const uses=[];
    // An immutable alias in this render retains the same string. Never follow
    // captured or mutable bindings by comparing their spelling or runtime value.
    const sameIdBinding=(raw,seen=new Set())=>{
      const value=unwrap(raw);if(!value||!ts.isIdentifier(value)||seen.size>=20)return false;
      const target=symbol(value);if(!target||seen.has(target)||mutatedSymbols.has(target))return false;
      if(target===binding)return true;
      const alias=target.declarations?.find(ts.isVariableDeclaration);
      if(!alias?.initializer||!(alias.parent.flags&ts.NodeFlags.Const))return false;
      let enclosing=alias.parent;while(enclosing&&!functionLike(enclosing))enclosing=enclosing.parent;
      return enclosing===owner&&sameIdBinding(alias.initializer,new Set(seen).add(target));
    };
    const scan=current=>{
      if(functionLike(current))return;
      if(deferred && ts.isJsxExpression(current) && current.expression && ts.isIdentifier(current.expression)
        && symbol(current.expression)===binding && ts.isJsxElement(current.parent)
        && ts.isIdentifier(current.parent.openingElement.tagName) && /^[a-z]/u.test(current.parent.openingElement.tagName.text))
        uses.push({read_id:node(current.expression),property:'children'});
      if(!deferred && ts.isJsxAttribute(current) && ['id','htmlFor','aria-labelledby','aria-describedby',
        'aria-controls','aria-owns','aria-activedescendant','aria-details','aria-errormessage'].includes(current.name.text)
        && current.initializer && ts.isJsxExpression(current.initializer)) {
        const value=current.initializer.expression,host=current.parent?.parent;
        if(sameIdBinding(value) && host?.tagName
          && ts.isIdentifier(host.tagName) && /^[a-z]/u.test(host.tagName.text)){
          const element=ts.isJsxOpeningElement(host)?host.parent:host;
          uses.push({read_id:node(value),property:current.name.text,element_source_id:node(element),
            element_is_jsx_child:[ts.SyntaxKind.JsxElement,ts.SyntaxKind.JsxFragment].includes(element.parent.kind)});
        }
      }
      ts.forEachChild(current,scan);
    };
    if(owner?.body)scan(owner.body);
    application.causal_bindings[deferred?'deferred_reads':'id_property_reads']=uses;
  }
  const retainedResultBindings=new Map();
  for(const application of output.react_semantics) {
    if(application.behavior?.execution?.kind!=='retained_callback')continue;
    const call=syntaxNodes.get(application.call_id),declaration=call?.parent;
    if(!declaration || !ts.isVariableDeclaration(declaration) || declaration.initializer!==call
      || !ts.isIdentifier(declaration.name) || !(declaration.parent.flags & ts.NodeFlags.Const)
      || mutatedSymbols.has(symbol(declaration.name)))continue;
    retainedResultBindings.set(symbol(declaration.name),application.call_id);
  }
  for(const application of output.react_semantics) {
    if(application.behavior?.execution?.kind!=='external_store')continue;
    for(const callback of application.causal_bindings.callbacks) {
      const expression=syntaxNodes.get(application.causal_bindings.inputs[callback.slot]);
      if(expression && ts.isIdentifier(expression)) {
        const producer=retainedResultBindings.get(symbol(expression));
        if(producer)callback.retained_producer_call_id=producer;
      }
    }
  }
  const contextBindings = new Map();
  for (const application of output.react_semantics) {
    if (application.export !== 'useContext' || !application.causal_bindings.context_id) continue;
    const call = syntaxNodes.get(application.call_id), declaration = call?.parent;
    if (!declaration || !ts.isVariableDeclaration(declaration) || declaration.initializer !== call
        || !ts.isIdentifier(declaration.name) || !(declaration.parent.flags & ts.NodeFlags.Const)
        || mutatedSymbols.has(symbol(declaration.name))) continue;
    const binding = node(declaration, 'capture_binding');
    application.causal_bindings.context_result_binding_id = binding;
    contextBindings.set(symbol(declaration.name), { binding_id: binding, source_call_id: application.call_id });
  }
  for (const application of output.react_semantics) {
    if (!['retained_callback','commit_effect','memo_value','imperative_handle'].includes(application.behavior?.execution?.kind)) continue;
    for (const callback of application.causal_bindings.callbacks) {
      const fn = syntaxNodes.get(callback.source_id);
      if (!fn || !functionLike(fn)) continue;
      const reads = [];
      const scan = current => {
        if (functionLike(current) || ts.isTypeNode(current)) return;
        if (ts.isIdentifier(current)) {
          const parent = current.parent;
          const shorthand = ts.isShorthandPropertyAssignment(parent) && parent.name === current;
          const sym = shorthand ? checker.getShorthandAssignmentValueSymbol(parent) : symbol(current);
          const binding = contextBindings.get(sym);
          const isName = ts.isPropertyAccessExpression(parent) && parent.name === current
            || ts.isPropertyAssignment(parent) && parent.name === current
            || (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && parent.tagName === current;
          if (binding && !isName) reads.push({ ...binding, read_id: node(current), shorthand });
        }
        ts.forEachChild(current, scan);
      };
      if (fn.body) scan(fn.body);
      callback.context_reads = reads;
    }
  }
  // Include source-owned callbacks even when their call is outside a UI scenario.
  // Runtime tags select the actual value; this list never selects a branch.
  for(const application of output.react_semantics) {
    const rule=application.behavior?.execution;
    if(validateReactExecutionRule(rule).valid&&['element_construction','element_clone'].includes(rule.kind)){
      const call=syntaxNodes.get(application.call_id);
      if(call&&ts.isCallExpression(call))application.causal_bindings.element_property_inputs=elementPropertyInputs(call,rule);
    }
    if(validateReactExecutionRule(rule).valid&&rule.kind==='dom_root'){
      const inputId=application.causal_bindings.inputs[`options.${rule.recoverable_error_option}`];
      const input=syntaxNodes.get(inputId),alternatives=callbackAlternatives(input,new Map(),null);
      application.causal_bindings.root_recovery_callbacks=alternatives.options.slice(0,32).map(option=>({
        source_id:node(option.callback.fn,'function'),captures:captures(option.callback.fn),conditions:option.conditions}));
      application.causal_bindings.root_recovery_callback_frontier=!alternatives.complete||alternatives.options.length!==1;
      for(const option of alternatives.options.slice(0,32))edge(application.call_id,node(option.callback.fn,'function'),'callback_forward',null,
        [{node_id:application.call_id,text:'React invoked the registered recoverable-error callback',branch:'truthy',runtime_observed:false}],
        {callback_source_id:node(option.callback.fn,'function'),callback_timing:'recovery',react_semantic_id:application.semantic_id});
    }
    if(validateReactExecutionRule(rule).valid&&['server_string','legacy_server_stream','readable_server_stream','pipeable_server_stream'].includes(rule.kind)){
      const argument=unwrap(syntaxNodes.get(application.causal_bindings.inputs[`arguments.${rule.element_argument}`]));
      const opening=argument&&(ts.isJsxElement(argument)?argument.openingElement:ts.isJsxSelfClosingElement(argument)?argument:null);
      const construction=argument&&ts.isCallExpression(argument)?resolveReactSemantic(argument):null;
      const type=opening?.tagName||(construction?.admitted&&construction.record.behavior.execution?.kind==='element_construction'
        ?argument.arguments[construction.record.behavior.execution.type_argument]:null);
      const component=type&&ts.isIdentifier(type)&&!mutatedSymbols.has(symbol(type))?componentFor(type):null;
      const identity=component&&namedBodyIdentity(component.fn);
      if(identity&&ts.isFunctionDeclaration(component.fn)&&ts.isSourceFile(component.fn.parent)){
        application.causal_bindings.server_component=identity;
        edge(application.call_id,identity.source_id,'callback_forward',null,
          [{node_id:application.call_id,text:'The server renderer entered the supplied root component',branch:'truthy',runtime_observed:false}],
          {callback_source_id:identity.source_id,callback_timing:rule.callback_timing,react_semantic_id:application.semantic_id});
      }else application.causal_bindings.server_component_frontier='server_root_component_source_unresolved';
      continue;
    }
    if(validateReactExecutionRule(rule).valid&&rule.kind==='lazy_component'){
      const argument=syntaxNodes.get(application.causal_bindings.inputs[`arguments.${rule.loader_argument}`]);
      const alternatives=callbackAlternatives(argument,new Map(),null);
      for(const option of alternatives.options){const callback=option.callback;
        edge(application.call_id,node(callback.fn,'function'),'callback_forward',null,
          [{node_id:application.call_id,text:'React lazy initialization invoked the stored loader',branch:'truthy',runtime_observed:false}],
          {callback_source_id:node(callback.fn),callback_timing:'renderer_initialization',react_semantic_id:application.semantic_id});
      }
      continue;
    }
    if(validateReactExecutionRule(rule).valid&&rule.kind==='memo_value'){
      const argument=syntaxNodes.get(application.causal_bindings.inputs[`arguments.${rule.callback_argument}`]);
      retainMemoCandidates(application,argument,callbackAlternatives(argument,new Map(),null));
      continue;
    }
    if(!validateReactExecutionRule(rule).valid || !['synchronous_scope','test_scope'].includes(rule.kind))continue;
    const argument=syntaxNodes.get(application.causal_bindings.inputs[`arguments.${rule.callback_argument}`]);
    retainScopeCandidates(application,callbackAlternatives(argument,new Map(),null));
  }
  // A predicate result can feed a direct condition or a local immutable boolean
  // alias. Cross-function captures and mutable values need occurrence provenance
  // and are deliberately not treated as the result of the current invocation.
  const predicateResultSource=(raw,owner,seen=new Set())=>{
    const value=unwrap(raw);if(!value || seen.has(value) || seen.size>20)return null;
    seen=new Set(seen).add(value);
    if(ts.isCallExpression(value)) {
      const semantic=resolveReactSemantic(value);
      return semantic?.admitted && semantic.record?.behavior?.execution?.kind==='element_predicate'
        ?{call_id:node(value,'call'),inverted:false}:null;
    }
    if(ts.isPrefixUnaryExpression(value) && value.operator===ts.SyntaxKind.ExclamationToken) {
      const result=predicateResultSource(value.operand,owner,seen);return result?{...result,inverted:!result.inverted}:null;
    }
    if(!ts.isIdentifier(value))return null;
    const sym=symbol(value);if(!sym || mutatedSymbols.has(sym))return null;
    const declaration=sym.declarations?.find(ts.isVariableDeclaration);
    if(!declaration?.initializer || !(declaration.parent.flags & ts.NodeFlags.Const))return null;
    let enclosing=declaration.parent;while(enclosing && !functionLike(enclosing))enclosing=enclosing.parent;
    if(enclosing!==owner)return null;
    return predicateResultSource(declaration.initializer,owner,seen);
  };
  const conditionIds=new Set([...edges.values()].flatMap(edge=>edge.conditions.map(condition=>condition.node_id)));
  for(const conditionId of conditionIds) {
    const condition=syntaxNodes.get(conditionId);if(!condition)continue;
    let owner=condition.parent;while(owner && !functionLike(owner))owner=owner.parent;
    const result=predicateResultSource(condition,owner);if(!result)continue;
    const application=output.react_semantics.find(row=>row.call_id===result.call_id);if(!application)continue;
    (application.causal_bindings.predicate_conditions ||= []).push({condition_id:conditionId,inverted:result.inverted});
    // A local frame gives each synchronous body invocation its own boolean
    // provenance. Captures and dynamic evaluation cannot borrow that frame.
    if(!owner||ts.isMethodDeclaration(owner)||!ts.isBlock(owner.body)||owner.asteriskToken
      ||ts.getCombinedModifierFlags(owner)&ts.ModifierFlags.Async)continue;
    let unsafe=false;const names=new Set();
    const inspect=current=>{
      if(ts.isIdentifier(current))names.add(current.text);
      if(ts.isWithStatement(current)||ts.isCallExpression(current)&&ts.isIdentifier(current.expression)&&current.expression.text==='eval')unsafe=true;
      ts.forEachChild(current,inspect);
    };
    inspect(owner.getSourceFile());if(unsafe)continue;
    let frameName=`__productTracePredicateFrame${owner.getStart()}`;
    while(names.has(frameName))frameName+='_';
    application.causal_bindings.predicate_frame={owner_source_id:node(owner,'function'),name:frameName};
  }
  const refProducer=(raw,seen=new Set())=>{
    const value=unwrap(raw);if(!value || seen.has(value) || seen.size>20)return null;
    seen=new Set(seen).add(value);
    if(ts.isCallExpression(value)) {
      const semantic=resolveReactSemantic(value);
      return semantic?.admitted && semantic.record?.behavior?.execution?.kind==='ref_cell'?node(value,'call'):null;
    }
    if(!ts.isIdentifier(value))return null;
    let sym=symbol(value);if(sym?.flags & ts.SymbolFlags.Alias){try{sym=checker.getAliasedSymbol(sym);}catch(_){return null;}}
    const declaration=sym?.declarations?.find(ts.isVariableDeclaration);
    // A current-property write mutates the cell, not this const binding. Do not
    // discard its identity merely because the general evaluator marks contents
    // mutable. A let binding or a caller-supplied ref still needs separate proof.
    return declaration?.initializer && declaration.parent.flags & ts.NodeFlags.Const
      ?refProducer(declaration.initializer,seen):null;
  };
  for(const sf of sourceFiles.values()) {
    const visit=current=>{
      if(ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
        const property=ts.isPropertyAccessExpression(current)?current.name.text:
          current.argumentExpression && ts.isStringLiteralLike(current.argumentExpression)?current.argumentExpression.text:null;
        const producer=property==='current'?refProducer(current.expression):null;
        const application=producer?output.react_semantics.find(row=>row.call_id===producer):null;
        if(application) {
          const parent=current.parent,assignment=ts.isBinaryExpression(parent) && parent.left===current;
          const write=assignment && parent.operatorToken.kind===ts.SyntaxKind.EqualsToken;
          let frontier=current.questionDotToken?'optional_ref_access_unsupported':null;
          if(assignment && parent.operatorToken.kind>=ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind<=ts.SyntaxKind.LastAssignment && !write
            || (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression===current
            || ts.isTaggedTemplateExpression(parent) && parent.tag===current
            || ts.isDeleteExpression(parent)
            || (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(parent.operator))frontier='ref_reference_operation_unsupported';
          let container=current;
          while(container.parent && (ts.isParenthesizedExpression(container.parent) || ts.isAsExpression(container.parent)
            || ts.isNonNullExpression(container.parent) || ts.isTypeAssertionExpression(container.parent) || ts.isArrayLiteralExpression(container.parent)
            || ts.isPropertyAssignment(container.parent) || ts.isObjectLiteralExpression(container.parent)
            || ts.isSpreadElement(container.parent) || ts.isSpreadAssignment(container.parent)))container=container.parent;
          const outer=container.parent;
          if((ts.isCallExpression(outer) || ts.isNewExpression(outer)) && outer.expression===container
            || ts.isTaggedTemplateExpression(outer) && outer.tag===container || ts.isDeleteExpression(outer)
            || (ts.isPrefixUnaryExpression(outer) || ts.isPostfixUnaryExpression(outer)) && [ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(outer.operator))frontier='ref_reference_operation_unsupported';
          if(container!==current && ts.isBinaryExpression(outer) && outer.left===container && outer.operatorToken.kind===ts.SyntaxKind.EqualsToken
            || (ts.isForOfStatement(outer) || ts.isForInStatement(outer)) && outer.initializer===container)frontier='ref_assignment_pattern_unsupported';
          const methodCall=ts.isCallExpression(outer) && unwrap(outer.expression)===current;
          if(methodCall)frontier=current.questionDotToken || outer.questionDotToken?'optional_ref_call_unsupported':null;
          const target=write?parent:current;
          let owner=current.parent;while(owner && !functionLike(owner))owner=owner.parent;
          const ownerId=owner?node(owner,'function'):null;
          const scenarios=ownerId?[...new Set([...edges.values()].filter(edge=>edge.to===ownerId && edge.scenario_id
            && ['event_handler','call','callback_forward'].includes(edge.relation)).map(edge=>edge.scenario_id))]:[];
          (application.causal_bindings.ref_accesses ||= []).push({source_id:node(target,'ref_access'),
            receiver_id:node(current.expression),owner_source_id:ownerId,scenario_ids:scenarios,
            mode:methodCall?'invoke':write?'write':'read',...(methodCall?{call_id:node(outer,'call')}:{}),
            ...(write?{value_id:node(parent.right)}:{}),frontier});
        }
      }
      ts.forEachChild(current,visit);
    };visit(sf);
  }
  for(const application of output.react_semantics.filter(row=>row.behavior?.execution?.kind==='ref_cell')) {
    const accesses=application.causal_bindings.ref_accesses||[],call=syntaxNodes.get(application.call_id);
    const expressions=[...(application.behavior.execution.initial==='argument' && call?.arguments?.[0]?[call.arguments[0]]:[]),
      ...accesses.filter(row=>row.mode==='write').map(row=>syntaxNodes.get(row.value_id)).filter(Boolean)];
    const candidates=[];
    for(const expression of expressions) {
      const alternatives=callbackAlternatives(expression,new Map(),null);
      for(const option of alternatives.options) {
        const id=node(option.callback.fn,'function');
        if(!candidates.some(row=>row.source_id===id) && candidates.length<32)candidates.push({source_id:id,captures:captures(option.callback.fn)});
      }
    }
    application.causal_bindings.ref_callbacks=candidates;
    // Candidate edges remain conditional until the runtime identifies the
    // actual object read from the cell. A write in source is not selection proof.
    for(const access of accesses.filter(row=>row.mode==='invoke' && !row.frontier))for(const candidate of candidates)
      for(const scenario of access.scenario_ids)edge(access.call_id,candidate.source_id,'callback_forward',{id:scenario},[],
        {call_site_id:access.call_id,ref_source_call_id:application.call_id,ref_access_id:access.source_id,runtime_selection_required:true});
  }
  // Server renderers return several different public resource shapes, but the
  // application eventually consumes each one. Follow only immutable local
  // values back to an exact React server call before instrumenting them. Merely
  // sharing a file with a renderer is not enough: adding a no-op after every
  // await or stream operation can itself perturb unrelated scheduling.
  const serverKinds=new Set(['legacy_server_stream','readable_server_stream','pipeable_server_stream']);
  const serverCalls=new Map(output.react_semantics.filter(row=>serverKinds.has(row.behavior?.execution?.kind))
    .map(row=>[row.call_id,{kind:row.behavior.execution.kind,source:syntaxNodes.get(row.call_id)}]));
  const serverFiles=new Set([...serverCalls.values()].map(row=>row.source?.getSourceFile().fileName).filter(Boolean));
  const retainServerConsumer=(kind,current,extra={})=>{
    const sourceId=node(current,'server_consumer');
    const row={id:`react-server-consumer:${digest(stable([kind,sourceId,extra])).slice(0,24)}`,
      kind,source_id:sourceId,file:current.getSourceFile().fileName,...extra};
    if(!output.react_server_consumers.some(value=>value.id===row.id))output.react_server_consumers.push(row);
  };
  const callbackBody=callback=>{
    const value=unwrap(callback);
    if(!(ts.isArrowFunction(value)||ts.isFunctionExpression(value))||value.asteriskToken||!value.body)return null;
    if(ts.isBlock(value.body))return {source_id:node(value,'function'),block:true,start:value.body.getStart()+1,end:value.body.getEnd()-1};
    return {source_id:node(value,'function'),block:false,start:value.body.getStart(),end:value.body.getEnd()};
  };
  for(const file of serverFiles){
    const sf=sourceFiles.get(file),ordered=[];
    const collect=current=>{ordered.push(current);ts.forEachChild(current,collect);};collect(sf);
    const resolvedBindings=new Map(),pipeDestinations=new Set();
    const serverOrigin=(raw,seen=new Set())=>{
      const value=unwrap(raw);if(!value||seen.has(value)||seen.size>20)return null;seen=new Set(seen).add(value);
      if(ts.isCallExpression(value))return serverCalls.get(node(value,'call'))||null;
      if(!ts.isIdentifier(value))return null;
      const binding=symbol(value);if(resolvedBindings.has(binding))return resolvedBindings.get(binding);
      const declaration=binding?.declarations?.length===1&&binding.declarations[0];
      if(declaration&&ts.isVariableDeclaration(declaration)&&declaration.initializer
        &&(declaration.parent.flags&ts.NodeFlags.Const)&&!mutatedSymbols.has(binding))return serverOrigin(declaration.initializer,seen);
      return null;
    };
    for(const current of ordered){
      if(ts.isCallExpression(current)&&ts.isPropertyAccessExpression(unwrap(current.expression))){
        const callee=unwrap(current.expression),receiver=unwrap(callee.expression),member=callee.name.text;
        const destination=unwrap(current.arguments[0]),origin=serverOrigin(receiver);
        const destinationSymbol=destination&&ts.isIdentifier(destination)&&symbol(destination);
        if(member==='pipe'&&origin?.kind==='pipeable_server_stream'&&ts.isIdentifier(receiver)
          &&current.arguments.length===1&&destinationSymbol&&!mutatedSymbols.has(destinationSymbol)){
          retainServerConsumer('pipe',current,{receiver_id:node(receiver),destination_id:node(destination)});
          pipeDestinations.add(destinationSymbol);
        }
      }
      if(ts.isForOfStatement(current)&&current.awaitModifier&&ts.isIdentifier(unwrap(current.expression))
        &&['legacy_server_stream','readable_server_stream'].includes(serverOrigin(current.expression)?.kind)){
        let abrupt=false;
        const inspect=value=>{if(value!==current&&functionLike(value))return;
          if(ts.isBreakStatement(value)||ts.isReturnStatement(value)){abrupt=true;return;}ts.forEachChild(value,inspect);};
        inspect(current.statement);
        if(!abrupt)retainServerConsumer('async_iteration',current,{resource_id:node(unwrap(current.expression))});
      }
      if(ts.isVariableStatement(current)&&current.declarationList.declarations.length===1){
        const declaration=current.declarationList.declarations[0],initializer=unwrap(declaration.initializer);
        const binding=ts.isIdentifier(declaration.name)&&symbol(declaration.name);
        if(initializer&&binding&&(current.declarationList.flags&ts.NodeFlags.Const)&&!mutatedSymbols.has(binding)
          &&ts.isAwaitExpression(initializer)&&ts.isIdentifier(unwrap(initializer.expression))
          &&serverOrigin(initializer.expression)?.kind==='readable_server_stream'){
          const origin=serverOrigin(initializer.expression);
          retainServerConsumer('await_binding',current,{promise_id:node(unwrap(initializer.expression)),binding:declaration.name.text});
          resolvedBindings.set(binding,origin);
        }
      }
    }
    // Listener registration often appears before pipe(), so select callbacks
    // only after the destination identities have been collected.
    for(const current of ordered)if(ts.isCallExpression(current)&&ts.isPropertyAccessExpression(unwrap(current.expression))){
      const callee=unwrap(current.expression),receiver=unwrap(callee.expression),member=callee.name.text;
      const event=unwrap(current.arguments[0]),direct=serverOrigin(receiver)?.kind==='legacy_server_stream';
      if(['on','once','addListener'].includes(member)&&ts.isIdentifier(receiver)&&(direct||pipeDestinations.has(symbol(receiver)))
        &&current.arguments.length>=2&&ts.isStringLiteralLike(event)&&['end','finish','error','close'].includes(event.text)){
        const body=callbackBody(current.arguments[1]);
        if(body)retainServerConsumer('event',current,{receiver_id:node(receiver),event:event.text,callback:body});
      }
    }
  }
  output.nodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)); output.edges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)); output.diagnostics = [...diagnostics.values()].sort((a, b) => stable(a).localeCompare(stable(b)));
  for (const key of ['components', 'placements', 'controls', 'scenarios', 'states', 'react_values', 'react_semantics', 'react_protocols', 'react_server_consumers', 'library_contracts']) output[key].sort((a, b) => a.id.localeCompare(b.id));
  output.react_backlog.sort((a, b) => stable(a).localeCompare(stable(b)));
  output.library_backlog.sort((a, b) => stable(a).localeCompare(stable(b)));
  return output;
}
