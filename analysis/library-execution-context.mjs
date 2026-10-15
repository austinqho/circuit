import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';

/** Shared by one installation's boundaries. These are observed execution
 * relationships, not rule admission or backend success. Only the real call
 * enters this context; interpreting a proposed rule never creates an event.
 */
export function createLibraryExecutionContext({prefix=`library-execution:${randomUUID()}`,maxEvents=8192}={}) {
  if(typeof prefix!=='string'||!prefix.length||prefix.length>200||!Number.isInteger(maxEvents)||maxEvents<1||maxEvents>65536)
    throw new TypeError('execution_context_options');
  const storage=new AsyncLocalStorage(),events=[];
  let overflow=false;
  const copy=record=>record?structuredClone(record):null;
  return Object.freeze({
    run({kind,occurrence,callback,ordinal,source},work) {
      if(!['library_invocation','callback_invocation'].includes(kind)||typeof occurrence!=='string'||typeof work!=='function')
        throw new TypeError('execution_context_event');
      if(kind==='callback_invocation'&&(typeof callback!=='string'||!Number.isInteger(ordinal)||ordinal<0))
        throw new TypeError('execution_context_callback');
      if(overflow||events.length>=maxEvents) {
        overflow=true;
        // An omitted child must not accidentally lend its parent's identity
        // to a downstream effect. Preserve application execution unobserved.
        return storage.run(undefined,()=>work(null));
      }
      const parent=storage.getStore();
      const record={id:`${prefix}:${events.length+1}`,kind,occurrence,
        parent_id:parent?.record.id??null,
        parent_relation:parent?(parent.active?'synchronous':'async_continuation'):null,
        ...(kind==='callback_invocation'?{callback,ordinal}:{}),
        ...(source?{source:structuredClone(source)}:{}),outcome:'incomplete'};
      const frame={record,active:true};events.push(record);
      try {
        const result=storage.run(frame,()=>work(copy(record)));
        // Returning a Promise is still just a return. This does not attest its
        // eventual resolution, render commit, database result or business use.
        record.outcome='return';return result;
      } catch(error) {record.outcome='throw';throw error;}
      finally {frame.active=false;}
    },
    current() {return overflow?null:copy(storage.getStore()?.record);},
    checkpoint() {return {status:overflow?'frontier':'observed_execution',reason:overflow?'execution_event_limit':null,
      scope:'Observed Node execution ancestry only; agreement with a rule requires its separate boundary report.',events:events.map(copy)};},
  });
}
