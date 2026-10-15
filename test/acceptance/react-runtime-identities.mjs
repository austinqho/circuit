import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';

const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));
const {chromium}=require('playwright'),React=require('react');
assert.equal(React.version,'18.3.1');
const assets={
  '/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
  '/react.js':fs.readFileSync(path.join(repository,'node_modules/react/umd/react.development.js')),
  '/react-dom.js':fs.readFileSync(path.join(repository,'node_modules/react-dom/umd/react-dom.development.js')),
};
const html=`<!doctype html><div id="root"></div><script src="/runtime.js"></script><script>
window.records=[];ProductTrace.start({name:'identity-probe',identity:{},actions:[{event:'click',sourceControl:'map:control',action:'mapped'}]},
{outputMode:'evidence',onRecord:record=>records.push(record)});
</script><script src="/react.js"></script><script src="/react-dom.js"></script><script>
let set;function App(){const[count,update]=React.useState(0);set=update;return React.createElement('button',{'data-producttrace-control-click':'map:control'},String(count))}
const root=ReactDOM.createRoot(document.getElementById('root'));ReactDOM.flushSync(()=>root.render(React.createElement(App)));
window.__probe={rerender:()=>ReactDOM.flushSync(()=>set(value=>value+1)),actions:()=>records.filter(record=>record.kind==='action')};
</script>`;
const server=http.createServer((request,response)=>{
  if(assets[request.url])response.end(assets[request.url]);
  else{response.setHeader('content-type','text/html');response.end(html);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.click('button');const first=await page.evaluate(()=>window.__probe.actions().at(-1));
  assert.equal(first.action,'mapped');assert.equal(first.trusted,true);
  assert.equal(first.react_identity.runtime_observed,true);assert.equal(first.react_identity.render_observed,false);
  assert.equal(first.react_identity.render_id,null);assert.match(first.react_identity.root_id,/^react-root:/u);
  await page.evaluate(()=>window.__probe.rerender());await page.click('button');
  const second=await page.evaluate(()=>window.__probe.actions().at(-1));
  assert.equal(second.react_identity.root_id,first.react_identity.root_id);
  assert.equal(second.react_identity.instance_id,first.react_identity.instance_id);
  assert.equal(second.react_identity.mount_id,first.react_identity.mount_id);
  assert.notEqual(second.react_identity.commit_id,first.react_identity.commit_id);
  console.log(JSON.stringify({react:React.version,real_browser:true,root_identity_stable:true,
    mounted_fiber_identity_stable:true,commit_identity_changed:true,render_attempt_identity_observed:false},null,2));
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
