import {createReactPredicateUseObserver} from '../analysis/react-predicate-use.mjs';
import {createReactProfilerObserver,interpretReactProfilerCommit} from '../analysis/react-profiler-runtime.mjs';
import {createReactStrictReplayObserver} from '../analysis/react-strict-replay.mjs';
import {createReactDescriptorCommitObserver} from '../analysis/react-descriptor-commit.mjs';
import {createReactIdCommitObserver} from '../analysis/react-id-commit.mjs';
import {createReactBoundaryCommitObserver,selectReactBoundaryCommit,predictReactFragmentIdentity} from '../analysis/react-boundary-commit.mjs';
import {createReactLazyCommitObserver} from '../analysis/react-lazy-commit.mjs';
import {createReactClassObserver} from '../analysis/react-class-runtime.mjs';
import {createReactHostObserver} from '../analysis/react-host-runtime.mjs';
import {createReactServerObserver} from '../analysis/react-server-runtime.mjs';
import {createReactRootObserver} from '../analysis/react-root-runtime.mjs';
import {createReactElementObserver} from '../analysis/react-element-runtime.mjs';
import {createReactPortalObserver} from '../analysis/react-portal-runtime.mjs';
import {createReactPortalCommitObserver} from '../analysis/react-portal-commit.mjs';
import {readReactBoundaryValue} from '../analysis/react-boundary-runtime.mjs';
import {createReactScopeObserver} from '../analysis/react-scope-runtime.mjs';
import {createReactContextObserver} from '../analysis/react-context-runtime.mjs';
import {createReactRefObserver} from '../analysis/react-ref-runtime.mjs';
import {createReactRefCommitObserver} from '../analysis/react-ref-commit.mjs';
import {createUserEventModel} from '../analysis/user-event-model.mjs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonicalRuntime = resolve(packageRoot, 'src/producttrace-runtime.js');
const packagedRuntime = resolve(packageRoot, 'dist/producttrace-runtime.js');

// Keep one observer implementation for Node and browser use. The source copy
// is generated so the distributed runtime remains standalone and byte-identical.
let runtimeSource=await readFile(canonicalRuntime,'utf8');
for(const [name,factory] of [['PREDICATE_USE',createReactPredicateUseObserver],['PROFILER',createReactProfilerObserver],['PROFILER_PROGRAM',interpretReactProfilerCommit],['STRICT_REPLAY',createReactStrictReplayObserver],['FRAGMENT_IDENTITY',predictReactFragmentIdentity],['BOUNDARY_COMMIT',createReactBoundaryCommitObserver],['BOUNDARY_SELECT',selectReactBoundaryCommit],['LAZY_COMMIT',createReactLazyCommitObserver],['ID_COMMIT',createReactIdCommitObserver],['DESCRIPTOR',createReactDescriptorCommitObserver],['PORTAL_COMMIT',createReactPortalCommitObserver],['CLASS',createReactClassObserver],['HOST',createReactHostObserver],['SERVER',createReactServerObserver],['ROOT',createReactRootObserver],['SCOPE',createReactScopeObserver],['REF_COMMIT',createReactRefCommitObserver],['REF',createReactRefObserver],['CONTEXT',createReactContextObserver],['BOUNDARY',readReactBoundaryValue],['ELEMENT',createReactElementObserver],['PORTAL',createReactPortalObserver]]) {
  const markerStart=`  // BEGIN GENERATED REACT ${name} OBSERVER`,markerEnd=`  // END GENERATED REACT ${name} OBSERVER`;
  const start=runtimeSource.indexOf(markerStart),end=runtimeSource.indexOf(markerEnd);
  if(start<0 || end<start)throw new Error(`React ${name} observer markers are missing`);
  runtimeSource=runtimeSource.slice(0,start)+markerStart+'\n  '+factory.toString().replaceAll('\n','\n  ')+'\n'+runtimeSource.slice(end);
}
await writeFile(canonicalRuntime,runtimeSource);

await mkdir(dirname(packagedRuntime), { recursive: true });
await copyFile(canonicalRuntime, packagedRuntime);

const [source, built] = await Promise.all([
  readFile(canonicalRuntime),
  readFile(packagedRuntime),
]);

if (!source.equals(built)) {
  throw new Error('Packaged runtime differs from the canonical runtime');
}

// The attribution runtime is inlined into built HTML by integrations/vite.mjs.
// Ship it from dist/ so installed packages never read src/.
const canonicalAttribution = resolve(packageRoot, 'src/runtime-attribution-browser.js');
const packagedAttribution = resolve(packageRoot, 'dist/runtime-attribution-browser.js');
// The trusted-user-event model (D-G1-21) is one function shared with Node
// (analysis/user-event-model.mjs), inlined verbatim so the runtime stays standalone.
{
  let attributionSource = await readFile(canonicalAttribution, 'utf8');
  const markerStart = '  // BEGIN GENERATED USER EVENT MODEL', markerEnd = '  // END GENERATED USER EVENT MODEL';
  const start = attributionSource.indexOf(markerStart), end = attributionSource.indexOf(markerEnd);
  if (start < 0 || end < start) throw new Error('User event model markers are missing');
  attributionSource = attributionSource.slice(0, start) + markerStart + '\n  ' + createUserEventModel.toString().replaceAll('\n', '\n  ') + '\n' + attributionSource.slice(end);
  await writeFile(canonicalAttribution, attributionSource);
}
await copyFile(canonicalAttribution, packagedAttribution);
if (!(await readFile(canonicalAttribution)).equals(await readFile(packagedAttribution))) {
  throw new Error('Packaged attribution runtime differs from the canonical source');
}

console.error(`built byte-identical runtime (${built.byteLength} bytes)`);
