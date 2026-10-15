import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { InstrumentationBase, InstrumentationNodeModuleDefinition } from '@opentelemetry/instrumentation';
import { METHODS as HTTP_METHODS, ServerResponse } from 'node:http';

const METHODS = [...new Set(['all', ...HTTP_METHODS.map(method => method.toLowerCase())])];

function routePath(request, registeredPath) {
  const base = request?.baseUrl || '';
  const matched = request?.route?.path ?? registeredPath ?? '';
  const joined = `${base}/${String(matched)}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}

function errorStatus(span, error) {
  const message = error instanceof Error ? error.message : String(error);
  span.recordException(error instanceof Error ? error : new Error(message));
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

// `position.next` is the handler's index in the route's flattened handler
// stack, so route pattern + method + index names exactly one handler even when
// middleware is registered as (nested) arrays.
// `kind` says which registration the span names (the MCP prints it as the
// issuer of the database operations under it): `route` (a callback registered
// on a route: `router.get(path, ...)`), `error_middleware` (a four-argument
// error handler registered with `app.use` / `router.use`, which the official
// Express instrumentation does not wrap), `param` (a `router.param` callback,
// which runs outside every layer span).
const SPAN_PREFIX = { route: 'express handler', error_middleware: 'express error handler', param: 'express param' };

function wrapHandler(instrumentation, handler, metadata, position) {
  if (Array.isArray(handler)) return handler.map(item => wrapHandler(instrumentation, item, metadata, position));
  metadata = { ...metadata, index: position.next++ };
  if (typeof handler !== 'function' || handler.__productTraceExpressHandler) return handler;
  const kind = metadata.kind || 'route';
  const isErrorHandler = kind !== 'param' && handler.length === 4;
  // Only error handlers are wrapped from `use`; everything else registered
  // with `use` is a layer the official instrumentation already names.
  if (kind === 'error_middleware' && !isErrorHandler) return handler;
  const handlerName = handler.name || '<anonymous>';

  const invoke = (receiver, args) => {
    const requestIndex = isErrorHandler ? 1 : 0;
    const nextIndex = isErrorHandler ? 3 : 2;
    const request = args[requestIndex];
    const parent = context.active();
    const tracer = instrumentation.tracer;
    const path = routePath(request, metadata.registeredPath);
    return tracer.startActiveSpan(`${SPAN_PREFIX[kind]} - ${handlerName}`, {
      attributes: {
        'http.route': path,
        'producttrace.express.handler.name': handlerName,
        'producttrace.express.handler.method': metadata.method.toUpperCase(),
        'producttrace.express.handler.index': metadata.index,
        'producttrace.express.handler.error_handler': isErrorHandler,
        'producttrace.express.handler.kind': kind,
        ...(kind === 'param' ? { 'producttrace.express.param.name': metadata.param } : {}),
      },
    }, span => {
      let ended = false;
      const end = error => {
        if (ended) return;
        ended = true;
        if (error !== undefined && error !== null && error !== 'route' && error !== 'router') {
          errorStatus(span, error);
        }
        span.end();
      };
      if (typeof args[nextIndex] === 'function') {
        const next = args[nextIndex];
        args[nextIndex] = (...nextArgs) => {
          end(nextArgs[0]);
          return context.with(parent, () => next(...nextArgs));
        };
      }
      try {
        const result = handler.apply(receiver, args);
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result).then(value => {
            end();
            return value;
          }, error => {
            end(error);
            throw error;
          });
        }
        end();
        return result;
      } catch (error) {
        end(error);
        throw error;
      }
    });
  };

  const wrapped = kind === 'param'
    ? function productTraceExpressParam(request, response, next, value, name) {
      return invoke(this, [request, response, next, value, name]);
    }
    : isErrorHandler
      ? function productTraceExpressErrorHandler(error, request, response, next) {
        return invoke(this, [error, request, response, next]);
      }
      : function productTraceExpressHandler(request, response, next) {
        return invoke(this, [request, response, next]);
      };
  Object.defineProperty(wrapped, '__productTraceExpressHandler', { value: true });
  Object.defineProperty(wrapped, 'name', { value: handlerName, configurable: true });
  return wrapped;
}

// Express 5 exposes Route as Router.Route (the `router` package); Express 4
// exports it as express.Route (lib/router/route.js) and Router.Route is absent.
function routePrototype(moduleExports) {
  return (moduleExports?.Router?.Route || moduleExports?.Route)?.prototype || null;
}

// Express 5: Router is a constructor (`Router.prototype.use/param`); Express 4:
// `express.Router` is the prototype object itself (`proto.use/param`). Both
// `app.use` and `app.param` delegate to these.
function routerPrototype(moduleExports) {
  const Router = moduleExports?.Router;
  if (!Router) return null;
  return typeof Router.prototype?.route === 'function' ? Router.prototype : Router;
}

// Replace `target[name]` with `make(previous)`; returns a restore function that
// only undoes the replacement while it is still in place (a later wrapper over
// it stays intact, and so does ours under it).
const overrides = new WeakMap();
function override(target, name, make) {
  const previous = target[name];
  if (previous?.__productTraceOverride) return () => {};
  const replaced = make(previous);
  Object.defineProperty(replaced, '__productTraceOverride', { value: true });
  // A shimmer unwrap aimed at the wrapper under ours (the official
  // instrumentation's, on disable) removes ours and then that one.
  Object.defineProperty(replaced, '__unwrap', { value: () => { if (target[name] === replaced) target[name] = previous; previous?.__unwrap?.(); } });
  target[name] = replaced;
  return () => { if (target[name] === replaced) target[name] = previous; };
}

// The code that sent a response: when the response head is written, the span
// active in the writer's context gets `producttrace.response.status_code`. The
// active span is whatever server code is running (a middleware layer span, a
// handler span, the HTTP server span when no named code is active), carried by
// the async context, never guessed from timing. One patch per process.
const RESPONSE_STATUS = 'producttrace.response.status_code';
let responsePatch = null;
function patchResponseWriter() {
  if (responsePatch) return;
  const original = ServerResponse.prototype.writeHead;
  const patched = function productTraceWriteHead(statusCode, ...rest) {
    if (!this.headersSent) {
      const span = trace.getSpan(context.active());
      if (span && typeof span.isRecording === 'function' && span.isRecording()) span.setAttribute(RESPONSE_STATUS, Number(statusCode));
    }
    return original.call(this, statusCode, ...rest);
  };
  ServerResponse.prototype.writeHead = patched;
  responsePatch = { original, patched };
}
function unpatchResponseWriter() {
  if (!responsePatch) return;
  if (ServerResponse.prototype.writeHead === responsePatch.patched) ServerResponse.prototype.writeHead = responsePatch.original;
  responsePatch = null;
}

/**
 * The official Express instrumentation proves that a route dispatcher ran but
 * does not create one span per callback registered on that route. This narrow
 * companion instrumentation adds those callback spans so ProductTrace can
 * distinguish an entered route from the terminal handler actually executing.
 * It also names the server code the official instrumentation leaves unnamed:
 * four-argument error middleware registered with `use` and `router.param`
 * callbacks (both otherwise run under whatever span happened to be active),
 * and it marks the span active when the response head is written
 * (`producttrace.response.status_code`), so the code that ended a request is
 * an identifier on a span rather than a guess.
 */
export class ProductTraceExpressHandlerInstrumentation extends InstrumentationBase {
  constructor() {
    super('producttrace-express-handlers', '0.1.0');
  }

  init() {
    const instrumentation = this;
    return new InstrumentationNodeModuleDefinition('express', ['>=4 <6'], moduleExports => {
      const prototype = routePrototype(moduleExports);
      if (!prototype) return moduleExports;
      for (const method of METHODS) {
        if (typeof prototype[method] !== 'function') continue;
        this._wrap(prototype, method, original => function productTraceRouteRegistration(...handlers) {
          const registeredPath = this.path;
          const position = { next: 0 };
          const mapped = handlers.map(handler => wrapHandler(instrumentation, handler, { method, registeredPath }, position));
          return original.apply(this, mapped);
        });
      }
      const router = routerPrototype(moduleExports);
      // `use` and `param` are replaced WITHOUT shimmer's wrapped markers: the
      // official instrumentation unwraps any `use` it finds wrapped before
      // wrapping it itself, which silently dropped its own `router.use` patch
      // (and with it the middleware spans of Express 4 apps) when both used
      // `_wrap`. A plain override is wrapped over, never unwrapped.
      const restores = [];
      if (router && typeof router.use === 'function') {
        // Four-argument error handlers registered with `use` (app or router).
        restores.push(override(router, 'use', original => function productTraceUseRegistration(...args) {
          const registeredPath = typeof args[0] === 'string' ? args[0] : undefined;
          const position = { next: 0 };
          const mapped = args.map(arg => (typeof arg === 'function' || Array.isArray(arg)
            ? wrapHandler(instrumentation, arg, { method: 'use', registeredPath, kind: 'error_middleware' }, position) : arg));
          return original.apply(this, mapped);
        }));
      }
      if (router && typeof router.param === 'function') {
        restores.push(override(router, 'param', original => function productTraceParamRegistration(name, fn, ...rest) {
          if (typeof name !== 'string' || typeof fn !== 'function') return original.call(this, name, fn, ...rest);
          const wrapped = wrapHandler(instrumentation, fn, { method: 'param', registeredPath: undefined, kind: 'param', param: name }, { next: 0 });
          return original.call(this, name, wrapped, ...rest);
        }));
      }
      overrides.set(moduleExports, restores);
      return moduleExports;
    }, moduleExports => {
      const prototype = routePrototype(moduleExports);
      if (prototype) for (const method of METHODS) if (typeof prototype[method] === 'function') this._unwrap(prototype, method);
      const router = routerPrototype(moduleExports);
      for (const restore of overrides.get(moduleExports) || []) restore();
      overrides.delete(moduleExports);
    });
  }

  enable() {
    super.enable();
    patchResponseWriter();
  }

  disable() {
    super.disable();
    unpatchResponseWriter();
  }
}
