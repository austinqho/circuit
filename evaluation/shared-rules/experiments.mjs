// Trusted independent inputs. No library answers or programs are stored here,
// and this module is never included in a model proposal context.
export const EXPERIMENTS = {
  plain_values({dataFunction}){
    const fn=dataFunction();
    const values=[undefined,null,false,true,0,-0,NaN,17,'','text',0n,1n,Symbol('value'),{},[1,2],fn,{nested:fn}];
    return [{id:'no-arguments',roots:[{args:[]} ]},...values.map((value,index)=>({id:'value-'+index,
      roots:[{args:[value]},{args:[value,{id:'unrelated'}]}]}))];
  },
};
