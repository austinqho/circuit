import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,predictLiteralExport} from '../../analysis/react-execution-rule.mjs';

const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const surfaces=['react','react-dom','react-dom/server'];
if(process.argv.includes('--child')) {
  const require=createRequire(path.join(repository,'package.json'));
  const observations=surfaces.map(surface=>({surface,value:require(surface).version}));
  console.log(JSON.stringify(observations));
} else {
  const builds=['development','production'];
  const observations=builds.flatMap(build=>JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}}))
    .map(row=>({...row,build})));
  let rejected=0;
  for(const row of observations) {
    const rule=getReactBehavior({surface:row.surface,exportName:'version',version:'18.3.1'}).execution;
    assert.equal(validateReactExecutionRule(rule).valid,true);
    const prediction=predictLiteralExport(rule,{build:row.build});
    assert.equal(prediction.value,row.value);
    assert.deepEqual(prediction.callbacks,[]);assert.deepEqual(prediction.schedules,[]);
    const wrong={...rule,values:{...rule.values,[row.build]:'18.2.0'}};
    assert.equal(validateReactExecutionRule(wrong).valid,true);
    assert.notEqual(predictLiteralExport(wrong,{build:row.build}).value,row.value);
    rejected++;
  }
  console.log(JSON.stringify({apis:surfaces.map(surface=>`${surface}/version/18.3.1`),
    format_pass:true,behavior_pass:true,builds,observed_exports:observations,
    well_formed_incorrect_rules_rejected:rejected},null,2));
}
