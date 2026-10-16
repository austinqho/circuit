// Regression (LibreChat 45cc53c): small callbacks (eight from round two, four
// from round three) and 22 real .ts functions (round five) that the boundary
// recovery once resolved to their enclosing function. Each must have its own
// function id in the build's runtime-attribution manifest.
//   node test/browser/manifest-regression-8.mjs <attribution manifest>
import fs from 'node:fs';
import zlib from 'node:zlib';

const EXPECTED = [
  'function:4fac7d010be784d964569ec6cc1d4c59621d975da839630a89cd8c028463444a:497:561', // client/src/routes/RouteErrorBoundary.tsx
  'function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:14130:14192', // client/src/components/Chat/Messages/MessageNav.tsx
  'function:1096ee24562adfcc32f10adb252318d90e50a4c938f378919fad7cf6b6dfe16d:26054:26072', // packages/data-provider/src/schemas.ts
  'function:61199481a7452471da98cf1ae2934a5cdb4a73c01cb14f6c416c26bba6462287:642:701', // client/src/data-provider/Favorites.ts
  'function:7b3a946d3652c29c6aed7a9d3bd35c5614c20a64753bcd6cdc752a0661dde4b4:1220:1526', // client/src/hooks/Conversations/useUpdateTagsInConvo.ts
  'function:28cb056bb5323e334f91fd50ea7146c1e224552f40fb5e0d41ef8f27945275d4:3869:4093', // client/src/data-provider/mutations.ts
  'function:7c166bff5d26989388748d0e1845cec618f16cf2b748ce98a6f7bf02bb3e72f2:1292:1355', // client/src/components/Endpoints/Settings/Assistants.tsx
  'function:0b2efbbff4a39340fe6f17c84d11e1dfeb8616c9d35e9c695c91ca477e0b7d7b:14541:14571', // client/src/components/Chat/Messages/Content/Parts/SubagentCall.tsx
  // Round three: callbacks whose mapped start lands on the key or JSX attribute
  // they are the value of (`retryDelay: () => …`, `onClick={() => …}`, `{(…) => (`).
  'function:bfc4c9499f98a4aab7d563d89d39dc13dfd1dafb5eafe80e43abf817ad5d8af2:5447:5509', // client/src/components/Chat/Messages/Content/AskUserQuestion.tsx
  'function:c3157a7c2c41cf7836df40621b7304393c56cbd1b99632f5f2577a7f2940253c:1995:2241', // client/src/components/Conversations/Conversations.tsx
  'function:dfcf7a4ec1c81feda318c946819ce72f02bf686bc9b0308df1440ddc2186977e:1662:1813', // client/src/components/Projects/ProjectChatList.tsx
  'function:0529711a20cfc7f7c65df7e7a2964a942facdac2da89ea2d41c3045d22b56e35:6568:6579', // client/src/data-provider/SSE/queries.ts
  // Round five: real functions in .ts files that the boundary rule dropped
  // because it parsed .ts sources as TSX (a generic arrow `<T>(…) =>` or a
  // `<T>value` assertion earlier in the file turned the rest into JSX text).
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:4643:4857', // packages/data-provider/src/parsers.ts export function getFirstDefinedValue(pos
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:4859:5051', // packages/data-provider/src/parsers.ts export function getNonEmptyValue(possibl
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:6141:6385', // packages/data-provider/src/parsers.ts (modelStr: string): string => {
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:6503:6693', // packages/data-provider/src/parsers.ts (modelStr: string): string => {
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:6729:9333', // packages/data-provider/src/parsers.ts (endpointOption: Partial<t.TEndpointOpti
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:11497:12693', // packages/data-provider/src/parsers.ts export function parseTextParts(
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:11710:11934', // packages/data-provider/src/parsers.ts (textValue: string) => {
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:13305:13548', // packages/data-provider/src/parsers.ts function applyTimezone(value: dayjs.Dayj
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:13550:14455', // packages/data-provider/src/parsers.ts export function replaceSpecialVars({
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:15182:15729', // packages/data-provider/src/parsers.ts export function encodeEphemeralAgentId({
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:16409:17583', // packages/data-provider/src/parsers.ts export function parseEphemeralAgentId(ag
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:17738:17862', // packages/data-provider/src/parsers.ts export function isEphemeralAgentId(agent
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:18221:18326', // packages/data-provider/src/parsers.ts export function stripAgentIdSuffix(agent
  'function:07490603b8c2d4248fed8c1888b687e792e481e88780639b419ace4743b3692d:18622:18736', // packages/data-provider/src/parsers.ts export function appendAgentIdSuffix(agen
  'function:dc45dbed82a6e87e1e32be38335d04258c0cd41971476384c681dfcac0fd802b:12338:12533', // client/src/utils/artifacts.ts export function isPreviewOnlyArtifact(ty
  'function:dc45dbed82a6e87e1e32be38335d04258c0cd41971476384c681dfcac0fd802b:12699:12823', // client/src/utils/artifacts.ts export function isCodeOnlyArtifact(type:
  'function:dc45dbed82a6e87e1e32be38335d04258c0cd41971476384c681dfcac0fd802b:17192:17964', // client/src/utils/artifacts.ts export function languageForFilename(
  'function:dc45dbed82a6e87e1e32be38335d04258c0cd41971476384c681dfcac0fd802b:18495:19065', // client/src/utils/artifacts.ts export function longestLeadingBacktickRu
  'function:dc45dbed82a6e87e1e32be38335d04258c0cd41971476384c681dfcac0fd802b:19965:20480', // client/src/utils/artifacts.ts export function wrapAsFencedCodeBlock(so
  'function:dc45dbed82a6e87e1e32be38335d04258c0cd41971476384c681dfcac0fd802b:27431:31222', // client/src/utils/artifacts.ts export function detectArtifactTypeFromFi
  'function:dc45dbed82a6e87e1e32be38335d04258c0cd41971476384c681dfcac0fd802b:32158:32424', // client/src/utils/artifacts.ts (file: Partial<Pick<TFile, 'updatedAt' |
  'function:dc45dbed82a6e87e1e32be38335d04258c0cd41971476384c681dfcac0fd802b:33261:36952', // client/src/utils/artifacts.ts export function fileToArtifact(
];
const file = process.argv[2];
const raw = fs.readFileSync(file);
const manifest = JSON.parse(file.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8'));
const ids = new Set(manifest.functions.map(row => row.id));
const results = EXPECTED.map(id => ({ id, present: ids.has(id) }));
console.log(JSON.stringify({ present: results.filter(row => row.present).length, expected: EXPECTED.length, results }, null, 2));
if (results.some(row => !row.present)) process.exitCode = 1;
