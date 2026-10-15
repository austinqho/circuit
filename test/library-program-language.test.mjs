import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {LIBRARY_PROGRAM_SYNTAX} from '../analysis/library-program-syntax.mjs';

test('reader handlers and public types share one operation vocabulary',()=>{
  const expected=Object.keys(LIBRARY_PROGRAM_SYNTAX).sort();
  const read=filename=>ts.createSourceFile(filename,fs.readFileSync(new URL(filename,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
  const handlers=new Set(),types=new Set();
  const visitHandler=node=>{if(ts.isCaseClause(node)&&ts.isStringLiteral(node.expression))handlers.add(node.expression.text);ts.forEachChild(node,visitHandler)};
  visitHandler(read('../analysis/library-program.mjs'));assert.deepEqual([...handlers].sort(),expected);
  const visitType=node=>{if(ts.isPropertySignature(node)&&node.name.getText()==='op'){
    const members=ts.isUnionTypeNode(node.type)?node.type.types:[node.type];
    for(const member of members)if(ts.isLiteralTypeNode(member)&&ts.isStringLiteral(member.literal))types.add(member.literal.text);
  }ts.forEachChild(node,visitType)};
  visitType(read('../analysis/library-program.d.mts'));assert.deepEqual([...types].sort(),expected);
  assert.throws(()=>{LIBRARY_PROGRAM_SYNTAX.call.target='string'},TypeError);
  // This checks vocabulary consistency only. Each operation still needs real
  // behavior and negative tests; declaring a case is not evidence of semantics.
});
