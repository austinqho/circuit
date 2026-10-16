/** Capture the actual registered marker without invoking an application getter.
 * A JSX element is a description. No commit, render, or callback is inferred.
 */
export function readReactBoundaryValue(rule,value,usage) {
  if(usage==='read')return {usage,value_type:typeof value,marker:typeof value==='symbol'?Symbol.keyFor(value)||null:null};
  let marker,type;
  try {
    if(value===null || typeof value!=='object')return {usage,reason:'boundary_element_required'};
    marker=Object.getOwnPropertyDescriptor(value,'$$typeof');
    type=Object.getOwnPropertyDescriptor(value,rule.type_property);
  } catch (_) {return {usage,reason:'boundary_element_descriptor_unobserved'};}
  if(!marker || !type || !Object.prototype.hasOwnProperty.call(marker,'value') || !Object.prototype.hasOwnProperty.call(type,'value'))
    return {usage,reason:'boundary_element_data_properties_required'};
  return {usage,value_type:typeof type.value,marker:typeof type.value==='symbol'?Symbol.keyFor(type.value)||null:null,
    element_marker:typeof marker.value==='symbol'?Symbol.keyFor(marker.value)||null:null};
}
