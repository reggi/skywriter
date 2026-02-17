import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {evaluateModule, transformModuleCode, extractFunctions} from '../../../src/render/utils/sandbox.ts'

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
      const {callResult} = await evaluateModule(code, [{}])
      assert.equal(callResult, undefined)
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

    test('should enforce execution timeout', async () => {
      const code = `export default function() { while(true) {} }`
      await assert.rejects(() => evaluateModule(code, [{}]), /Script execution timed out/)
    })
  })
})
