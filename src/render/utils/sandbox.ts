import * as vm from 'node:vm'

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
  transformed = transformed.replace(/export\s+(const|let|var)\s+(\w+)/g, (_, keyword, name) => {
    exports.push(name)
    return `__exports.${name} = undefined; ${keyword} __exports_${name}`
  })

  // Add assignment after initialization for named exports
  for (const name of exports) {
    if (name !== 'default') {
      transformed += `\n__exports.${name} = __exports_${name};`
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
): Promise<{exports: Record<string, unknown>; callResult?: unknown}> {
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

  // Only __fnBridge crosses into the sandbox — it's a host function but the
  // sandbox's Function.prototype.constructor is frozen, so it can't be used
  // to escape. The sandbox never receives host objects it can walk.
  const context = vm.createContext({
    __fnBridge,
    console: Object.freeze({
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    }),
  })

  // Freeze every constructor the sandbox could use to reach the host Function
  // and set up the sandbox-internal variables & function-ref hydration.
  vm.runInContext(
    `
    'use strict';
    (function() {
      const desc = { value: undefined, writable: false, configurable: false };
      Object.defineProperty(Object.prototype, 'constructor', desc);
      Object.defineProperty(Object.getPrototypeOf(function(){}), 'constructor', desc);
      Object.defineProperty(Object.getPrototypeOf(async function(){}), 'constructor', desc);
      Object.defineProperty(Object.getPrototypeOf(function*(){}), 'constructor', desc);
      Object.defineProperty(Object.getPrototypeOf(async function*(){}), 'constructor', desc);
    })();

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
  const result = JSON.parse(resultJson) as {value?: unknown}

  return {exports, callResult: result.value}
}
