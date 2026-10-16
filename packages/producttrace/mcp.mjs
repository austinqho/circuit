// Entry point: `producttrace/mcp`. The MCP server agents use to query a store.
// `main(argv)` runs it over stdio (what the `producttrace-mcp` bin does);
// `createTracerServer(options)` returns the server to connect to your own transport.
export { main, createTracerServer } from './mcp/server.mjs';
