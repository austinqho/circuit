/** Shared syntax for the deterministic reader and model transport. Adding an
 * operation here does not implement its meaning: the interpreter and its
 * independent behavior tests must still implement it before it can be used. */
const syntax = {
  literal: {value:'literal'}, undefined: {}, symbol:{key:'string'}, arg:{index:'integer'}, args:{}, receiver:{},
  local:{name:'string'}, get:{value:'instruction',key:'property_key'},
  array:{items:'instructions'}, object:{entries:'entries'},
  type:{value:'instruction'}, same:{left:'instruction',right:'instruction'}, equal:{left:'instruction',right:'instruction'}, not:{value:'instruction'},
  is_array:{value:'instruction'},
  number_add:{left:'instruction',right:'instruction'},
  at:{value:'instruction',index:'instruction'}, every:{items:'instruction',value_name:'string',index_name:'string',test:'instruction'},
  if:{test:'instruction',then:'instruction',else:'instruction'}, bind:{name:'string',value:'instruction',body:'instruction'}, set:{name:'string',value:'instruction'},
  sequence:{steps:'instructions'}, fn:{body:'instruction',this_mode:'receiver_mode'}, call:{target:'instruction',receiver:'instruction',args:'instruction'},
  concat:{items:'instructions'}, slice:{value:'instruction',start:'integer'}, defer:{body:'instruction'}, seal:{value:'instruction'},
  make_error:{name:'error_name',message:'instruction'}, throw:{value:'instruction'},
  keys:{value:'instruction'}, has_own:{value:'instruction',key:'instruction'}, lookup:{value:'instruction',key:'instruction'}, put:{value:'instruction',key:'instruction',item:'instruction'},
  freeze:{value:'instruction'}, string:{value:'instruction'}, frontier:{reason:'string'},
};
export const LIBRARY_PROGRAM_SYNTAX=Object.freeze(Object.fromEntries(Object.entries(syntax).map(([name,shape])=>[name,Object.freeze(shape)])));
