import test from 'node:test';
import assert from 'node:assert/strict';
import {compileReactSources} from '../analysis/react-compiler.mjs';

const packages={react:{version:'18.3.1',verified:true,verification_sha256:'react-fixture'},
 'react-dom':{version:'18.3.1',verified:true,verification_sha256:'dom-fixture'}};

test('an immutable local alias retains the exact React export semantic',()=>{
 const source="import * as DOM from 'react-dom';const place=DOM.createPortal;place('child',document.body,'key');";
 const map=compileReactSources({'app.tsx':source},{packages});
 const call=map.react_semantics.find(row=>row.export==='createPortal'&&row.usage_kind!=='value_read');
 assert.ok(call);assert.equal(call.surface,'react-dom');assert.equal(call.package_verification_sha256,'dom-fixture');
});

test('mutable and non-React aliases do not borrow React semantics',()=>{
 for(const source of [
  "import * as DOM from 'react-dom';let place=DOM.createPortal;place=other;place('x',document.body);",
  "import * as DOM from 'react-dom';const place=other;place('x',document.body);",
 ]){
  const map=compileReactSources({'app.tsx':source},{packages});
  assert.equal(map.react_semantics.some(row=>row.export==='createPortal'&&row.usage_kind!=='value_read'),false);
 }
});
