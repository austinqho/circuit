import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';

// A real Chromium event is required here: synthetic JSDOM events cannot prove
// React DOM's hydration replay behavior.
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const require=createRequire(path.join(repository,'package.json'));
const {chromium}=require('playwright'),React=require('react'),Server=require('react-dom/server');
assert.equal(React.version,'18.3.1');
const e=React.createElement;
const markup=Server.renderToString(e(React.Suspense,{fallback:e('i',null,'waiting')},e('button',{id:'target'},'replay')));
const react=fs.readFileSync(path.join(repository,'node_modules/react/umd/react.development.js'));
const reactDom=fs.readFileSync(path.join(repository,'node_modules/react-dom/umd/react-dom.development.js'));
const html=`<!doctype html><div id="root">${markup}</div><script src="/react.js"></script><script src="/react-dom.js"></script><script>
let release,ready=false;const events=[];const pending=new Promise(done=>release=done);
function App(){if(!ready)throw pending;return React.createElement('button',{id:'target',onMouseOver:event=>events.push({type:event.type,trusted:event.nativeEvent.isTrusted}),onClick:()=>events.push({type:'click'})},'replay')}
ReactDOM.hydrateRoot(document.getElementById('root'),React.createElement(React.Suspense,{fallback:'waiting'},React.createElement(App)));
window.__probe={state:()=>({ready,events:[...events]}),release:()=>{ready=true;release();}};
</script>`;
const server=http.createServer((request,response)=>{
  if(request.url==='/react.js')response.end(react);
  else if(request.url==='/react-dom.js')response.end(reactDom);
  else{response.setHeader('content-type','text/html');response.end(html);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.__probe);
  await page.hover('#target');
  assert.deepEqual(await page.evaluate(()=>window.__probe.state().events),[],'blocked continuous event has not reached application code');
  await page.click('#target');
  assert.deepEqual(await page.evaluate(()=>window.__probe.state().events),[],'blocked discrete event has not reached application code');
  await page.evaluate(()=>window.__probe.release());
  await page.waitForFunction(()=>window.__probe.state().events.length===1);
  const observed=await page.evaluate(()=>window.__probe.state());
  assert.deepEqual(observed.events,[{type:'mouseover',trusted:false}],
    'React 18.3.1 replays the queued continuous event as a cloned event; its selective-hydration flag does not queue the blocked click');
  console.log(JSON.stringify({react:React.version,real_browser:true,continuous_event_replayed:true,
    replayed_native_event_is_trusted:observed.events[0].trusted,blocked_discrete_click_replayed:false},null,2));
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
