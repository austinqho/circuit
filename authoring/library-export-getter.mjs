import inspector from 'node:inspector';
import {types} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

/** Resolve a compiler-style forwarding getter without invoking it. The only
 * accepted expressions read lexical bindings and own properties; calls, global
 * bindings, proxies, coercions, conditions and arbitrary getter bodies reject.
 * V8 supplies actual closure bindings and source locations, not guessed names.
 * This is an authoring-only, bounded Node host operation, never a browser probe.
 */
export function resolvePureExportGetter(getter,{files,maxDepth=16}={}) {
  if(typeof getter!=='function'||types.isProxy(getter))throw Error('export_getter_requires_plain_function');
  const pinned=new Map(files.map(row=>[row.path,row])),scripts=new Map(),seen=new Set(),resolutions=[];
  const session=new inspector.Session(),slot=`__producttrace_export_${randomUUID().replaceAll('-','')}`;
  const holder=Object.create(null);globalThis[slot]=holder;
  session.connect();session.on('Debugger.scriptParsed',event=>scripts.set(event.params.scriptId,event.params.url));
  const post=(method,params={})=>{
    let done=false,value,error;
    session.post(method,params,(e,result)=>{done=true;error=e;value=result});
    if(!done||error||value?.exceptionDetails)throw Error('export_inspector_unavailable');
    return value;
  };
  const props=objectId=>post('Runtime.getProperties',{objectId,ownProperties:true,generatePreview:false});
  try {
    post('Debugger.enable');
    const holderId=post('Runtime.evaluate',{expression:`globalThis[${JSON.stringify(slot)}]`,objectGroup:slot,generatePreview:false}).result.objectId;
    const remote=value=>{holder.input=value;return props(holderId).result.find(row=>row.name==='input')?.value};
    const materialize=value=>{
      if(!value)throw Error('export_binding_unavailable');
      if(value.objectId) {
        // The function runs on our private plain holder, not on the library
        // object. Passing an inspector reference does not invoke its getters.
        post('Runtime.callFunctionOn',{objectId:holderId,functionDeclaration:'function(value){ this.output = value; }',arguments:[{objectId:value.objectId}],silent:true});
        return holder.output;
      }
      if(value.type==='undefined')return undefined;
      if(Object.hasOwn(value,'value'))return value.value;
      throw Error('export_binding_value_unsupported');
    };
    const resolve=(fn,depth)=>{
      if(depth>maxDepth||seen.has(fn)||typeof fn!=='function'||types.isProxy(fn))throw Error('export_getter_chain_unsupported');
      seen.add(fn);
      const reference=remote(fn);if(!reference?.objectId)throw Error('export_getter_reference_unavailable');
      const details=props(reference.objectId),location=details.internalProperties?.find(row=>row.name==='[[FunctionLocation]]')?.value?.value;
      const url=location&&scripts.get(location.scriptId),filename=url?.startsWith('file:')?fileURLToPath(url):url;
      const file=pinned.get(filename);if(!file)throw Error('export_getter_source_unattested');
      const source=post('Debugger.getScriptSource',{scriptId:location.scriptId}).scriptSource;
      if(source!==file.source)throw Error('export_getter_source_changed');
      const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true),offset=ast.getPositionOfLineAndCharacter(location.lineNumber,location.columnNumber);
      const text=Function.prototype.toString.call(fn);let selected;
      const locate=node=>{
        if(node.getStart(ast)<=offset&&node.end>offset) {
          if((ts.isArrowFunction(node)||ts.isFunctionExpression(node)||ts.isGetAccessor(node))&&node.getText(ast)===text)selected=node;
          ts.forEachChild(node,locate);
        }
      };locate(ast);
      if(!selected||selected.parameters.length||selected.asteriskToken||selected.modifiers?.some(row=>row.kind===ts.SyntaxKind.AsyncKeyword))throw Error('export_getter_shape_unsupported');
      const body=selected.body;
      const expression=ts.isBlock(body)&&body.statements.length===1&&ts.isReturnStatement(body.statements[0])?body.statements[0].expression:ts.isBlock(body)?null:body;
      const allowed=node=>Boolean(node&&(ts.isIdentifier(node)||ts.isPropertyAccessExpression(node)&&allowed(node.expression)
        ||ts.isElementAccessExpression(node)&&allowed(node.expression)&&(ts.isIdentifier(node.argumentExpression)||ts.isStringLiteral(node.argumentExpression)||ts.isNumericLiteral(node.argumentExpression))));
      if(!allowed(expression))throw Error('export_getter_shape_unsupported');
      const scopesId=details.internalProperties?.find(row=>row.name==='[[Scopes]]')?.value?.objectId;
      if(!scopesId)throw Error('export_getter_scopes_unavailable');
      const scopes=props(scopesId).result.filter(row=>/^\d+$/.test(row.name)).map(row=>row.value);
      const binding=name=>{
        for(const scope of scopes) {
          if(!scope?.objectId||scope.description==='Global')continue;
          const descriptor=props(scope.objectId).result.find(row=>row.name===name);
          if(descriptor){if(!descriptor.value||descriptor.get)throw Error('export_binding_unavailable');return materialize(descriptor.value)}
        }
        throw Error('export_global_or_missing_binding');
      };
      const member=(value,key)=>{
        if(value===null||!['object','function'].includes(typeof value)||types.isProxy(value))throw Error('export_member_requires_plain_object');
        if(!((typeof key==='string'&&key.length<=128)||Number.isSafeInteger(key))||['__proto__','prototype','constructor'].includes(String(key)))throw Error('export_member_key_unsupported');
        const descriptor=Object.getOwnPropertyDescriptor(value,key);
        if(!descriptor)throw Error('export_member_requires_own_property');
        return 'value'in descriptor?descriptor.value:resolve(descriptor.get,depth+1);
      };
      const evaluate=node=>ts.isIdentifier(node)?binding(node.text):ts.isPropertyAccessExpression(node)?member(evaluate(node.expression),node.name.text)
        :member(evaluate(node.expression),ts.isIdentifier(node.argumentExpression)?binding(node.argumentExpression.text):ts.isNumericLiteral(node.argumentExpression)?Number(node.argumentExpression.text):node.argumentExpression.text);
      resolutions.push({file:filename,start:selected.getStart(ast),end:selected.end,source:text,sha256:createHash('sha256').update(text).digest('hex')});
      return evaluate(expression);
    };
    const value=resolve(getter,0);
    return {value,resolutions,node_version:process.versions.node};
  } finally {delete globalThis[slot];session.disconnect()}
}
