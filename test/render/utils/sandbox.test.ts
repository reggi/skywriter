import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateModule,
  transformModuleCode,
  extractFunctions,
  sandboxedEtaRender,
} from '../../../src/render/utils/sandbox.ts'

describe('transformModuleCode', () => {
  test('should transform export default function', () => {
    const code = `export default function(data) { return data; }`
    const result = transformModuleCode(code)
    assert.ok(result.includes('__exports.default = function'))
    assert.ok(!result.includes('export default'))
  })

  test('should transform export default async function', () => {
    const code = `export default async function(data) { return data; }`
    const result = transformModuleCode(code)
    assert.ok(result.includes('__exports.default = async function'))
  })

  test('should transform export default arrow function', () => {
    const code = `export default (ctx) => ({ title: ctx.title })`
    const result = transformModuleCode(code)
    assert.ok(result.includes('__exports.default = (ctx)'))
  })

  test('should transform export default object literal', () => {
    const code = `export default { status: 'ok' };`
    const result = transformModuleCode(code)
    assert.ok(result.includes("__exports.default = { status: 'ok' }"))
  })

  test('should transform named exports', () => {
    const code = `export const value = 42;\nexport const name = 'test';`
    const result = transformModuleCode(code)
    assert.ok(result.includes('__exports.value'))
    assert.ok(result.includes('__exports.name'))
  })

  test('should preserve local bindings for named exports', () => {
    const code = `export const value = 42;\nconst doubled = value * 2;`
    const result = transformModuleCode(code)
    // The local binding `value` should be preserved (not renamed to __exports_value)
    assert.ok(result.includes('const value = 42'))
    assert.ok(!result.includes('__exports_value'))
    assert.ok(result.includes('__exports.value = value'))
  })
})

describe('extractFunctions', () => {
  test('should replace functions with markers', () => {
    const fn = () => 42
    const {sanitized, registry} = extractFunctions({myFn: fn, value: 'hello'})
    const obj = sanitized as Record<string, unknown>
    assert.equal(obj.value, 'hello')
    assert.ok((obj.myFn as Record<string, unknown>).__sandboxFnRef)
    assert.equal(Object.keys(registry).length, 1)
  })

  test('should handle nested objects with functions', () => {
    const fn = () => 'result'
    const {sanitized, registry} = extractFunctions({nested: {fn, data: 123}})
    const obj = sanitized as Record<string, Record<string, unknown>>
    assert.equal(obj.nested.data, 123)
    assert.ok((obj.nested.fn as Record<string, unknown>).__sandboxFnRef)
    assert.equal(Object.keys(registry).length, 1)
  })

  test('should convert dates to ISO strings', () => {
    const date = new Date('2024-01-01T00:00:00Z')
    const {sanitized} = extractFunctions({date})
    const obj = sanitized as Record<string, string>
    assert.equal(obj.date, '2024-01-01T00:00:00.000Z')
  })

  test('should handle arrays', () => {
    const fn = () => 'result'
    const {sanitized, registry} = extractFunctions([fn, 'hello', 42])
    const arr = sanitized as unknown[]
    assert.equal(arr[1], 'hello')
    assert.equal(arr[2], 42)
    assert.ok((arr[0] as Record<string, unknown>).__sandboxFnRef)
    assert.equal(Object.keys(registry).length, 1)
  })

  test('should pass through primitives', () => {
    const {sanitized} = extractFunctions('hello')
    assert.equal(sanitized, 'hello')
  })

  test('should handle null and undefined', () => {
    assert.equal(extractFunctions(null).sanitized, null)
    assert.equal(extractFunctions(undefined).sanitized, undefined)
  })
})

describe('evaluateModule', () => {
  describe('functional behavior', () => {
    test('should evaluate default export function', async () => {
      const code = `export default function() { return { message: 'hello', count: 42 }; }`
      const {callResult} = await evaluateModule(code, [{}])
      const result = callResult as Record<string, unknown>
      assert.equal(result.message, 'hello')
      assert.equal(result.count, 42)
    })

    test('should evaluate default export arrow function', async () => {
      const code = `export default (ctx) => ({ title: ctx.title })`
      const {callResult} = await evaluateModule(code, [{title: 'MyTitle'}])
      const result = callResult as Record<string, unknown>
      assert.equal(result.title, 'MyTitle')
    })

    test('should evaluate default export async function', async () => {
      const code = `export default async function(ctx) { return { count: 5 }; }`
      const {callResult} = await evaluateModule(code, [{}])
      const result = callResult as Record<string, unknown>
      assert.equal(result.count, 5)
    })

    test('should evaluate static default export', async () => {
      const code = `export default { status: 'ok' };`
      // Without callArgs, just evaluate exports
      const {exports} = await evaluateModule(code)
      assert.deepEqual((exports as Record<string, Record<string, unknown>>).default, {status: 'ok'})
    })

    test('should evaluate named exports', async () => {
      const code = `export const value = 42;\nexport const name = 'test';`
      const {exports} = await evaluateModule(code)
      assert.equal(exports.value, 42)
      assert.equal(exports.name, 'test')
    })

    test('should bridge host functions via callArgs', async () => {
      const mockGetPage = async (query: Record<string, string>) => {
        return {title: `Page: ${query.path}`}
      }

      const code = `export default async function(ctx) {
        const page = await ctx.fn.getPage({ path: '/hello' });
        return { pageTitle: page.title };
      }`

      const {callResult} = await evaluateModule(code, [{fn: {getPage: mockGetPage}}])
      const result = callResult as Record<string, unknown>
      assert.equal(result.pageTitle, 'Page: /hello')
    })

    test('should handle function that returns undefined', async () => {
      const code = `export default function() { return undefined; }`
      const {callResult, called} = await evaluateModule(code, [{}])
      assert.equal(callResult, undefined)
      assert.equal(called, true)
    })

    test('should set called to false when no default export function exists', async () => {
      const code = `export default { status: 'ok' };`
      const {called} = await evaluateModule(code, [{}])
      assert.equal(called, false)
    })

    test('should set called to false when no callArgs provided', async () => {
      const code = `export default function() { return 42; }`
      const {called} = await evaluateModule(code)
      assert.equal(called, false)
    })

    test('should allow named exports to reference each other', async () => {
      const code = `export const value = 42;\nexport const doubled = value * 2;`
      const {exports} = await evaluateModule(code)
      assert.equal(exports.value, 42)
      assert.equal(exports.doubled, 84)
    })

    test('should handle function that throws error', async () => {
      const code = `export default function() { throw new Error('boom'); }`
      await assert.rejects(() => evaluateModule(code, [{}]), /boom/)
    })

    test('should provide console to sandbox', async () => {
      // Just verify it doesn't throw when using console
      const code = `export default function() { console.log('test'); return { ok: true }; }`
      const {callResult} = await evaluateModule(code, [{}])
      assert.deepEqual(callResult, {ok: true})
    })
  })

  describe('security - blocks dangerous access', () => {
    test('should block process access', async () => {
      const code = `export default function() { return { env: process.env }; }`
      await assert.rejects(() => evaluateModule(code, [{}]), /process is not defined/)
    })

    test('should block require()', async () => {
      const code = `export default function() { const fs = require('fs'); return {}; }`
      await assert.rejects(() => evaluateModule(code, [{}]), /require is not defined/)
    })

    test('should block import()', async () => {
      const code = `export default async function() { const fs = await import('fs'); return {}; }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block globalThis.process', async () => {
      const code = `export default function() { return { pid: globalThis.process.pid }; }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block eval to access process', async () => {
      const code = `export default function() { return eval('process.env'); }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block Function constructor escape via this', async () => {
      const code = `export default function() {
        const p = this.constructor.constructor('return process')();
        return { env: p.env };
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block Function constructor escape via function prototype', async () => {
      const code = `export default function() {
        const F = (function(){}).constructor;
        const p = F('return process')();
        return { env: p.env };
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block Function constructor escape via async function prototype', async () => {
      const code = `export default async function() {
        const F = (async function(){}).constructor;
        const p = await F('return process')();
        return { env: p.env };
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block constructor escape via arguments', async () => {
      const code = `export default function(data) {
        const p = data.constructor.constructor('return process')();
        return { env: p.env };
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block constructor escape via string prototype', async () => {
      const code = `export default function() {
        return ''['constructor']['constructor']('return process')();
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block constructor escape via array prototype', async () => {
      const code = `export default function() {
        return [].constructor.constructor('return process')();
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block constructor escape via console.log', async () => {
      const code = `export default function() {
        const F = console.log.constructor;
        const p = F('return process')();
        return { env: p.env };
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block constructor escape via console method prototype', async () => {
      const code = `export default function() {
        const F = Object.getPrototypeOf(console.warn).constructor;
        const p = F('return process')();
        return { env: p.env };
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block constructor escape via __fnBridge', async () => {
      const code = `export default function() {
        const F = __fnBridge.constructor;
        const p = F('return process')();
        return { env: p.env };
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should block globalThis.constructor escape', async () => {
      const code = `export default function() {
        return { pid: globalThis.constructor.constructor('return process')().pid };
      }`
      await assert.rejects(() => evaluateModule(code, [{}]))
    })

    test('should not leak host file paths in error stacks', async () => {
      const code = `export default function() {
        try { null.x } catch(e) { return { stack: e.stack }; }
      }`
      const {callResult} = await evaluateModule(code, [{}])
      const result = callResult as Record<string, string>
      assert.ok(!result.stack.includes('file:///'), 'Stack should not contain file:/// URLs')
      assert.ok(result.stack.includes('server.js'), 'Stack should contain sandbox filename')
    })

    test('should not expose host references in globalThis', async () => {
      const code = `export default function() {
        return {
          hostBridge: typeof __hostFnBridge,
          hostConsole: typeof __hostConsole,
        };
      }`
      const {callResult} = await evaluateModule(code, [{}])
      const result = callResult as Record<string, string>
      assert.equal(result.hostBridge, 'undefined')
      assert.equal(result.hostConsole, 'undefined')
    })

    test('should enforce execution timeout', async () => {
      const code = `export default function() { while(true) {} }`
      await assert.rejects(() => evaluateModule(code, [{}]), /Script execution timed out/)
    })
  })
})

describe('sandboxedEtaRender', () => {
  describe('functional behavior', () => {
    test('should render simple variable interpolation', async () => {
      const result = await sandboxedEtaRender('<%= title %>', {title: 'Hello'})
      assert.equal(result, 'Hello')
    })

    test('should render conditionals', async () => {
      const result = await sandboxedEtaRender('<% if (show) { %>visible<% } %>', {show: true})
      assert.equal(result, 'visible')
    })

    test('should render loops', async () => {
      const result = await sandboxedEtaRender('<% items.forEach(function(item) { %><%= item %><% }) %>', {
        items: ['a', 'b'],
      })
      assert.equal(result, 'ab')
    })

    test('should render nested object access', async () => {
      const result = await sandboxedEtaRender('<%= data.key %>', {data: {key: 'value'}})
      assert.equal(result, 'value')
    })

    test('should handle async expressions', async () => {
      const result = await sandboxedEtaRender('<%= await Promise.resolve("async") %>', {})
      assert.equal(result, 'async')
    })
  })

  describe('security - blocks dangerous access', () => {
    test('should block process access', async () => {
      await assert.rejects(() => sandboxedEtaRender('<%= process.pid %>', {}), /process is not defined/)
    })

    test('should block process.env access', async () => {
      await assert.rejects(() => sandboxedEtaRender('<%= process.env.HOME %>', {}), /process is not defined/)
    })

    test('should block require()', async () => {
      await assert.rejects(() => sandboxedEtaRender("<% const fs = require('fs') %>", {}), /require is not defined/)
    })

    test('should block import()', async () => {
      await assert.rejects(() =>
        sandboxedEtaRender("<% const fs = await import('fs') %><%= fs.readdirSync('.')[0] %>", {}),
      )
    })

    test('should not expose fetch', async () => {
      const result = await sandboxedEtaRender('<%= typeof fetch %>', {})
      assert.equal(result, 'undefined')
    })

    test('should not expose setTimeout', async () => {
      const result = await sandboxedEtaRender('<%= typeof setTimeout %>', {})
      assert.equal(result, 'undefined')
    })

    test('should block constructor escape via inline code', async () => {
      await assert.rejects(() => sandboxedEtaRender("<%= (function(){}).constructor('return process')().pid %>", {}))
    })

    test('should block globalThis.constructor escape via this', async () => {
      await assert.rejects(() => sandboxedEtaRender('<%= this.constructor.constructor("return process")().pid %>', {}))
    })

    test('should not leak host file paths in error stacks', async () => {
      const result = await sandboxedEtaRender('<% try { null.x } catch(e) { %><%= e.stack %><% } %>', {})
      assert.ok(!result.includes('file:///'), 'Stack should not contain file:/// URLs')
      assert.ok(result.includes('template.eta'), 'Stack should contain sandbox filename')
    })
  })
})
