import * as vm from 'node:vm'
import {Eta} from 'eta'

const eta = new Eta({autoEscape: false, autoTrim: false, useWith: true})

// Inline JS for freezing all constructor properties inside a vm context.
// Must run AFTER any host functions have been wrapped into sandbox-realm functions.
const FREEZE_CONSTRUCTORS = `
  var __desc = { value: undefined, writable: false, configurable: false };
  Object.defineProperty(globalThis, 'constructor', __desc);
  Object.defineProperty(Object.prototype, 'constructor', __desc);
  Object.defineProperty(Object.getPrototypeOf(function(){}), 'constructor', __desc);
  Object.defineProperty(Object.getPrototypeOf(async function(){}), 'constructor', __desc);
  Object.defineProperty(Object.getPrototypeOf(function*(){}), 'constructor', __desc);
  Object.defineProperty(Object.getPrototypeOf(async function*(){}), 'constructor', __desc);

  // Strip host file paths from error stacks to prevent information leakage.
  Error.prepareStackTrace = function(err, frames) {
    var msg = err.toString();
    var filtered = [];
    for (var i = 0; i < frames.length; i++) {
      var fn = frames[i].getFileName();
      if (fn && (fn.indexOf('file:///') === 0 || fn.indexOf('/') === 0 || fn.indexOf('node:') === 0)) continue;
      filtered.push('    at ' + frames[i].toString());
    }
    return filtered.length > 0 ? msg + '\\n' + filtered.join('\\n') : msg;
  };
`

// Create a sandboxed vm context. Host functions are passed in via hostFunctions
// and must be re-wrapped into sandbox-realm functions via setupScript before
// FREEZE_CONSTRUCTORS runs. The setupScript should:
// 1. Capture host references into local vars
// 2. Create sandbox-realm wrapper functions on globalThis
// 3. Delete the __host* globals
function createSandboxContext(contextGlobals: Record<string, unknown>, setupScript: string): vm.Context {
  const context = vm.createContext(contextGlobals)

  vm.runInContext(
    `
    (function() {
      ${setupScript}
      ${FREEZE_CONSTRUCTORS}
    })();
  `,
    context,
  )

  return context
}

// Render an Eta template string inside a sandboxed vm context.
// Template data is JSON-serialized across the boundary so no host
// objects (and their prototype chains) leak into the sandbox.
// Returns the rendered string. When trackedData is provided, the
// sandbox reports which properties were accessed so the host-side
// usage tracker can be updated.
export async function sandboxedEtaRender(
  templateStr: string,
  data: Record<string, unknown>,
  trackedData?: Record<string, unknown>,
): Promise<string> {
  const fnBody = eta.compileToString(templateStr)

  // Replace Eta's include/layout helpers that reference `this` (the Eta instance)
  // with no-ops, and swap this.config references with sandbox-local functions.
  const safeFnBody = fnBody
    .replace(/let include = .*?;/s, 'let include = function() { return "[include not supported]"; };')
    .replace(/let includeAsync = .*?;/s, 'let includeAsync = async function() { return "[include not supported]"; };')
    .replace(/this\.config\.escapeFunction/g, '__eta_escape')
    .replace(/this\.config\.filterFunction/g, '__eta_filter')

  // Serialize raw data across the boundary via JSON so host-realm prototypes
  // don't leak into the sandbox.
  const {sanitized} = extractFunctions(data)
  const dataJson = JSON.stringify(sanitized)

  // Host callback to record a property access on the tracked proxy.
  // Called from within the sandbox when template code accesses a property.
  const __hostTrack = trackedData
    ? (path: string) => {
        // Walk the tracked proxy following the dotted path to trigger its get traps
        const parts = path.split('.')
        let current: unknown = trackedData
        for (const part of parts) {
          if (current && typeof current === 'object') {
            current = (current as Record<string, unknown>)[part]
          } else {
            break
          }
        }
      }
    : undefined

  const contextGlobals: Record<string, unknown> = {
    __hostEscape: (str: unknown) => String(str),
    __hostFilter: (val: unknown) => String(val),
  }

  let trackSetup = ''
  if (__hostTrack) {
    contextGlobals.__hostTrack = __hostTrack
    trackSetup = `
      var hostTrack = __hostTrack;
      globalThis.__track = function(p) { return hostTrack(p); };
      delete globalThis.__hostTrack;
    `
  }

  const context = createSandboxContext(
    contextGlobals,
    `
      var hostEscape = __hostEscape;
      var hostFilter = __hostFilter;
      globalThis.__eta_escape = function(s) { return hostEscape(s); };
      globalThis.__eta_filter = function(v) { return hostFilter(v); };
      delete globalThis.__hostEscape;
      delete globalThis.__hostFilter;
      ${trackSetup}
    `,
  )

  // Build a proxy wrapper inside the sandbox that reports property access
  // back to the host via __track. This replaces the old approach of passing
  // host Proxy objects directly into the VM.
  const trackingCode = __hostTrack
    ? `
    function __wrapTracked(obj, prefix) {
      if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
      return new Proxy(obj, {
        get: function(target, prop) {
          if (typeof prop !== 'string') return target[prop];
          var path = prefix ? prefix + '.' + prop : prop;
          __track(path);
          var val = target[prop];
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            return __wrapTracked(val, path);
          }
          return val;
        }
      });
    }
    `
    : ''

  const itExpr = __hostTrack
    ? `__wrapTracked(JSON.parse(${JSON.stringify(dataJson)}), '')`
    : `JSON.parse(${JSON.stringify(dataJson)})`

  const script = `
    (async function() {
      var __eta_escape = globalThis.__eta_escape;
      var __eta_filter = globalThis.__eta_filter;
      ${trackingCode}
      var it = ${itExpr};
      var options = {};
      ${safeFnBody}
    })()
  `

  const s = new vm.Script(script, {filename: 'template.eta'})
  const result = s.runInContext(context, {timeout: 5000})

  if (result && typeof (result as Promise<string>).then === 'function') {
    return (await result) as string
  }
  return result as string
}

// Transform ES module syntax to CommonJS-style for vm evaluation
export function transformModuleCode(code: string): string {
  const exports: string[] = []
  let transformed = code

  // Handle: export default <expression>
  // Must check for 'export default function' and 'export default async function' first
  transformed = transformed.replace(/export\s+default\s+(async\s+)?function\b/g, (_, asyncKeyword) => {
    exports.push('default')
    return `__exports.default = ${asyncKeyword || ''}function`
  })

  // Handle remaining: export default <expression> (arrow functions, objects, literals)
  transformed = transformed.replace(/export\s+default\s+/g, () => {
    exports.push('default')
    return '__exports.default = '
  })

  // Handle: export const/let/var name = ...
  // Preserve the original local binding and strip only the `export` keyword,
  // then assign to __exports after initialization so intra-module references work.
  transformed = transformed.replace(/export\s+(const|let|var)\s+(\w+)/g, (_, keyword, name) => {
    exports.push(name)
    return `${keyword} ${name}`
  })

  // Add assignment after initialization for named exports
  for (const name of exports) {
    if (name !== 'default') {
      transformed += `\n__exports.${name} = ${name};`
    }
  }

  return transformed
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type AnyFunction = Function

// Extract functions from an object tree, replacing them with markers.
// Returns the JSON-safe object and a registry of extracted functions.
export function extractFunctions(obj: unknown): {sanitized: unknown; registry: Record<string, AnyFunction>} {
  const registry: Record<string, AnyFunction> = {}
  let counter = 0

  function walk(val: unknown): unknown {
    if (val === null || val === undefined) return val
    if (typeof val === 'function') {
      const key = `__fn_${counter++}`
      registry[key] = val as AnyFunction
      return {__sandboxFnRef: key}
    }
    if (Array.isArray(val)) return val.map(walk)
    if (typeof val === 'object') {
      if (val instanceof Date || Object.prototype.toString.call(val) === '[object Date]') {
        return (val as Date).toISOString()
      }
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        result[k] = walk(v)
      }
      return result
    }
    return val
  }

  return {sanitized: walk(obj), registry}
}

// Evaluate a module string in a sandboxed vm context.
// All data crosses the boundary via JSON; host functions are bridged
// through a single callback so no host objects leak into the sandbox.
export async function evaluateModule(
  code: string,
  callArgs?: unknown[],
): Promise<{exports: Record<string, unknown>; callResult?: unknown; called: boolean}> {
  const transformed = transformModuleCode(code)

  // Extract any functions (like fn.getPage) from the args
  const {sanitized: safeArgs, registry: fnRegistry} = callArgs
    ? extractFunctions(callArgs)
    : {sanitized: undefined, registry: {}}

  const argsJson = safeArgs !== undefined ? JSON.stringify(safeArgs) : 'null'

  // Single host callback that the sandbox can use to invoke bridged functions.
  // It receives/returns JSON strings so no host objects cross the boundary.
  const __fnBridge = async (key: string, argsJsonStr: string): Promise<string> => {
    const fn = fnRegistry[key]
    if (!fn) throw new Error(`Unknown function reference: ${key}`)
    const args = JSON.parse(argsJsonStr) as unknown[]
    const result = await fn(...args)
    return JSON.stringify(result)
  }

  const context = createSandboxContext(
    {
      __hostFnBridge: __fnBridge,
      __hostConsole: {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info,
        debug: console.debug,
      },
    },
    `
      // Wrap host functions into sandbox-realm functions BEFORE constructors
      // are frozen, so .constructor on these wrappers is undefined.
      var hostBridge = __hostFnBridge;
      var hostConsole = __hostConsole;
      globalThis.__fnBridge = function(key, argsJson) { return hostBridge(key, argsJson); };
      globalThis.console = Object.freeze({
        log: function() { return hostConsole.log.apply(hostConsole, arguments); },
        warn: function() { return hostConsole.warn.apply(hostConsole, arguments); },
        error: function() { return hostConsole.error.apply(hostConsole, arguments); },
        info: function() { return hostConsole.info.apply(hostConsole, arguments); },
        debug: function() { return hostConsole.debug.apply(hostConsole, arguments); },
      });
      delete globalThis.__hostFnBridge;
      delete globalThis.__hostConsole;
    `,
  )

  // Set up sandbox-internal variables and function-ref hydration
  vm.runInContext(
    `
    var __exports = {};
    var __result = {};
    var __callArgs = ${argsJson};

    // Replace {__sandboxFnRef: key} markers with async wrapper functions
    function __hydrateFnRefs(obj) {
      if (obj === null || obj === undefined) return obj;
      if (Array.isArray(obj)) return obj.map(__hydrateFnRefs);
      if (typeof obj === 'object') {
        if (typeof obj.__sandboxFnRef === 'string') {
          var key = obj.__sandboxFnRef;
          return async function() {
            var argsArr = [];
            for (var i = 0; i < arguments.length; i++) argsArr.push(arguments[i]);
            var resultJson = await __fnBridge(key, JSON.stringify(argsArr));
            return JSON.parse(resultJson);
          };
        }
        var result = {};
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
          result[keys[i]] = __hydrateFnRefs(obj[keys[i]]);
        }
        return result;
      }
      return obj;
    }

    if (__callArgs) {
      __callArgs = __hydrateFnRefs(__callArgs);
    }
  `,
    context,
  )

  let fullScript = `'use strict';\n${transformed}`
  if (callArgs !== undefined) {
    fullScript += `
;(async () => {
  if (typeof __exports.default === 'function') {
    __result.called = true;
    __result.value = await __exports.default(...__callArgs);
  }
})();`
  }

  const script = new vm.Script(fullScript, {filename: 'server.js'})
  const maybePromise = script.runInContext(context, {timeout: 5000})

  if (maybePromise && typeof maybePromise.then === 'function') {
    await maybePromise
  }

  // Read exports and result back from the sandbox via JSON
  const exportsJson = vm.runInContext('JSON.stringify(__exports)', context) as string
  const exports = JSON.parse(exportsJson) as Record<string, unknown>

  const resultJson = vm.runInContext('JSON.stringify(__result)', context) as string
  const result = JSON.parse(resultJson) as {value?: unknown; called?: boolean}

  return {exports, callResult: result.value, called: result.called === true}
}
