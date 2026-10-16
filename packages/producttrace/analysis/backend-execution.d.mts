import type { BackendSpan } from '../backend/index.js';
import type { RequestHandlerBridge } from './request-handler-bridge.mjs';

export declare function confirmBackendExecution(
  bridge: RequestHandlerBridge,
  spans: BackendSpan[],
): RequestHandlerBridge;

export declare const BACKEND_EXECUTION_SPAN_SCHEMA: 'producttrace.backend-span.v1';
