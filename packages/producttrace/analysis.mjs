// Entry point: `producttrace/analysis`. Build-time source analysis: map a React
// app's controls and an Express app's routes, then join observed requests to them.
export {
  analyzeReact,
  createReactRuntimeIntegration,
  analyzeBackendRoutes,
  matchRequestToRoute,
  connectRequestToHandler,
  confirmBackendExecution,
} from './analysis/index.mjs';
