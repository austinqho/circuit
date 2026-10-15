import {validateReactExecutionRule} from './react-execution-rule.mjs';
/** A factory stores its type now and supplies it to construction on later calls.
 * Planning does not invoke the component or read the deprecated `.type` getter. */
export function planElementFactory(rule,{args=[],invocation}={}) {
 if(!validateReactExecutionRule(rule).valid || rule.kind!=='element_factory' || !Array.isArray(args)
  || invocation!==undefined&&!Array.isArray(invocation))return {status:'unresolved',reason:'element_factory_rule_required'};
 const type=args[rule.type_argument];
 if(invocation!==undefined)return planElementConstruction(rule.construction,[type,...invocation]);
 return {status:'planned',type,allocation:rule.allocation,callbacks:rule.creation_callbacks==='invoke'?[type]:[],renderer_execution_proven:false};
}
/** Data-property construction model for the installed React element contract.
 * Used by independent oracles, never to reread live application configuration.
 * Accessors and user key coercion remain explicit instead of executing them. */
export function planElementConstruction(rule,args=[]) {
 if(!validateReactExecutionRule(rule).valid || rule?.kind!=='element_construction')return {status:'unresolved',reason:'element_rule_required'};
 let frontier=null;const read=(value,key)=>{try{if(value==null)return undefined;let object=Object(value),depth=0;
  while(object){if(++depth>64){frontier='element_prototype_budget';return undefined;}const property=Object.getOwnPropertyDescriptor(object,key);
   if(property){if(!Object.hasOwn(property,'value')){frontier='element_accessor_unobserved';return undefined;}return property.value;}object=Object.getPrototypeOf(object);}
 }catch{frontier='element_descriptor_unobserved';}};
 const type=args[rule.type_argument],config=args[rule.config_argument],props={};let key=null,ref=null;
 if(config!=null){
  ref=read(config,'ref');if(ref===undefined)ref=null;
  const rawKey=read(config,'key');if(rawKey!==undefined){
   if(rawKey!==null && ['object','function','symbol'].includes(typeof rawKey))return {status:'unresolved',reason:'element_key_coercion_required'};
   key=String(rawKey);
  }
  try{for(const name of Object.keys(Object(config))){if(rule.reserved_props.includes(name))continue;if(name==='__proto__'){frontier='element_prototype_write_unmodeled';continue;}Object.defineProperty(props,name,{value:read(config,name),enumerable:true,writable:true,configurable:true});}}
  catch{frontier='element_properties_unobserved';}
 }
 const children=args.slice(rule.children_start);
 if(children.length && rule.children_policy==='replace')props.children=children.length===1?children[0]:children;
 const defaults=type?read(type,'defaultProps'):undefined;
 if(defaults){try{for(const name in defaults){if(rule.default_policy==='always'||props[name]===undefined)props[name]=read(defaults,name);}}catch{frontier='element_defaults_unobserved';}}
 if(frontier)return {status:'unresolved',reason:frontier};
 return {status:'planned',marker:rule.marker,type,key,ref,props,owner_policy:{...rule.owner},callbacks:rule.callbacks_at_creation==='invoke'?[type]:[],
  renderer_execution_proven:false,allocation:'fresh'};
}

export function planElementClone(rule,args=[],options={}) {
 const owner=options.owner;
 if(!validateReactExecutionRule(rule).valid || rule.kind!=='element_clone')return {status:'unresolved',reason:'element_clone_rule_required'};
 const element=args[rule.element_argument];if(element==null)return {status:'planned',operation:'throw',reason:'element_required'};
 let frontier=null;const read=(value,key)=>{try{if(value==null)return undefined;let object=Object(value),depth=0;
  while(object){if(++depth>64){frontier='element_prototype_budget';return undefined;}const property=Object.getOwnPropertyDescriptor(object,key);
   if(property){if(!Object.hasOwn(property,'value')){frontier='element_accessor_unobserved';return undefined;}return property.value;}object=Object.getPrototypeOf(object);}
 }catch{frontier='element_descriptor_unobserved';}};
 const type=read(element,'type'),previous=read(element,'props'),config=args[rule.config_argument],props={};
 let key=read(element,'key'),ref=read(element,'ref'),nextOwner=read(element,'_owner');
 const put=(name,value)=>{if(name==='__proto__'){frontier='element_prototype_write_unmodeled';return;}Object.defineProperty(props,name,{value,enumerable:true,writable:true,configurable:true});};
 if(previous!=null){try{for(const name of Reflect.ownKeys(Object(previous))){const property=Object.getOwnPropertyDescriptor(Object(previous),name);if(property?.enumerable)put(name,read(previous,name));}}catch{frontier='element_properties_unobserved';}}
 if(config!=null){
  const nextRef=read(config,'ref');if(nextRef!==undefined){ref=nextRef;if(rule.ref_owner==='replace_on_ref'){if(!Object.hasOwn(options,'owner'))return {status:'unresolved',reason:'element_owner_required'};nextOwner=owner;}}
  const nextKey=read(config,'key');if(nextKey!==undefined){if(nextKey!==null&&['object','function','symbol'].includes(typeof nextKey))return {status:'unresolved',reason:'element_key_coercion_required'};key=String(nextKey);}
  const defaults=type?read(type,'defaultProps'):undefined;
  try{for(const name of Object.keys(Object(config))){if(rule.reserved_props.includes(name))continue;const value=read(config,name);put(name,value===undefined&&defaults!==undefined?read(defaults,name):value);}
   if(rule.default_policy==='all_undefined'&&defaults)for(const name in defaults)if(props[name]===undefined)put(name,read(defaults,name));
  }catch{frontier='element_properties_unobserved';}
 }
 const children=args.slice(rule.children_start);if(children.length&&rule.children_policy==='replace')put('children',children.length===1?children[0]:children);
 if(frontier)return {status:'unresolved',reason:frontier};
 return {status:'planned',operation:'return',marker:rule.marker,type,key,ref,props,owner:nextOwner,callbacks:rule.callbacks_at_creation==='invoke'?[type]:[],allocation:'fresh',renderer_execution_proven:false};
}
