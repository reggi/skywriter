import yaml from 'yaml'

type Data = Record<string, unknown> | unknown[]

function isData(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? true : Array.isArray(value)
}

export function dataType(input: string): {type: 'json' | 'yaml'; value: Data} {
  if (input == null) throw new Error('Empty input')
  const text = input.trim()
  if (!text) throw new Error('Empty input')

  // 1) Try JSON first (strict) - only accept objects/arrays, not primitives
  try {
    const value = JSON.parse(text)
    if (isData(value)) {
      return {type: 'json', value}
    }
  } catch {
    // ignore
  }

  // 2) Try YAML - accept only structured data (objects/arrays)
  try {
    const value = yaml.parse(text)
    if (value !== undefined && isData(value)) {
      return {type: 'yaml', value}
    }
    // If YAML parsed but returned a primitive or undefined, fall through to throw
  } catch {
    // YAML parsing failed, fall through to throw
  }

  // For primitives or malformed input, throw error so it's stored as-is
  throw new Error('Input is neither valid JSON nor valid YAML')
}
