import type { ReactRuntimeIntegration } from './runtime-join.mjs';

export declare function createBrowserRequestBridgeSource(
  integration: ReactRuntimeIntegration,
  options: { bridgeEndpoint: string; service: string; applicationId?: string },
): string;

export declare const BROWSER_REQUEST_BRIDGE_SCHEMA: 'producttrace.browser-request-bridge-manifest.v1';
