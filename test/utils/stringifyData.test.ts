import {test, describe} from 'node:test'
import assert from 'node:assert/strict'
import {stringifyData} from '../../src/utils/stringifyData.ts'

describe('stringifyData', () => {
  describe('JSON data type', () => {
    test('should return formatted JSON when pretty is true', () => {
      const data = '{"name":"test","value":123}'
      const result = stringifyData(data, 'json', true)
      assert.strictEqual(result, '{\n  "name": "test",\n  "value": 123\n}')
    })

    test('should return unformatted JSON when pretty is false', () => {
      const data = '{"name":"test","value":123}'
      const result = stringifyData(data, 'json', false)
      assert.strictEqual(result, '{"name":"test","value":123}')
    })

    test('should return unformatted JSON when pretty is undefined', () => {
      const data = '{"name":"test","value":123}'
      const result = stringifyData(data, 'json')
      assert.strictEqual(result, '{"name":"test","value":123}')
    })

    test('should handle nested JSON objects', () => {
      const data = '{"outer":{"inner":{"deep":"value"}}}'
      const result = stringifyData(data, 'json', true)
      assert.ok(result.includes('"outer"'))
      assert.ok(result.includes('"inner"'))
      assert.ok(result.includes('"deep"'))
    })

    test('should handle JSON arrays', () => {
      const data = '[1,2,3,{"key":"value"}]'
      const result = stringifyData(data, 'json', true)
      assert.ok(result.includes('1'))
      assert.ok(result.includes('"key"'))
    })

    test('should return original data for invalid JSON', () => {
      const data = 'not valid json {'
      const result = stringifyData(data, 'json', true)
      assert.strictEqual(result, 'not valid json {')
    })
  })

  describe('YAML data type', () => {
    test('should convert JSON to YAML', () => {
      const data = '{"name":"test","value":123}'
      const result = stringifyData(data, 'yaml')
      assert.ok(result.includes('name: test'))
      assert.ok(result.includes('value: 123'))
    })

    test('should handle nested objects in YAML', () => {
      const data = '{"outer":{"inner":"value"}}'
      const result = stringifyData(data, 'yaml')
      assert.ok(result.includes('outer:'))
      assert.ok(result.includes('inner: value'))
    })

    test('should handle arrays in YAML', () => {
      const data = '{"items":["a","b","c"]}'
      const result = stringifyData(data, 'yaml')
      assert.ok(result.includes('items:'))
      assert.ok(result.includes('- a'))
      assert.ok(result.includes('- b'))
      assert.ok(result.includes('- c'))
    })

    test('should return original data for invalid JSON when converting to YAML', () => {
      const data = 'invalid json'
      const result = stringifyData(data, 'yaml')
      assert.strictEqual(result, 'invalid json')
    })
  })

  describe('null or empty data type', () => {
    test('should return original data when dataType is null', () => {
      const data = '{"name":"test"}'
      const result = stringifyData(data, null)
      assert.strictEqual(result, '{"name":"test"}')
    })

    test('should return original data when data is empty string', () => {
      const result = stringifyData('', 'json')
      assert.strictEqual(result, '')
    })

    test('should return original data for unknown data type', () => {
      const data = '{"name":"test"}'
      const result = stringifyData(data, 'unknown')
      assert.strictEqual(result, '{"name":"test"}')
    })
  })

  describe('edge cases', () => {
    test('should handle empty JSON object', () => {
      const data = '{}'
      const result = stringifyData(data, 'json', true)
      assert.strictEqual(result, '{}')
    })

    test('should handle empty JSON array', () => {
      const data = '[]'
      const result = stringifyData(data, 'json', true)
      assert.strictEqual(result, '[]')
    })

    test('should handle JSON with special characters', () => {
      const data = '{"text":"hello\\nworld","quote":"\\"quoted\\""}'
      const result = stringifyData(data, 'json', true)
      assert.ok(result.includes('hello\\nworld'))
    })

    test('should handle boolean and null values in JSON', () => {
      const data = '{"bool":true,"nil":null,"num":0}'
      const result = stringifyData(data, 'json', true)
      assert.ok(result.includes('true'))
      assert.ok(result.includes('null'))
      assert.ok(result.includes('0'))
    })
  })
})
