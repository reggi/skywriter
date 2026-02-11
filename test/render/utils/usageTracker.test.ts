import {test} from 'node:test'
import assert from 'node:assert'
import {usageTracker} from '../../../src/render/utils/usageTracker.ts'

test('createUsageTracker should track basic property access', () => {
  const obj = {name: 'John', age: 30}
  const [tracked, getUsage] = usageTracker(obj)

  // Access properties
  const name = tracked.name
  const age = tracked.age

  const snapshot = getUsage()

  assert.strictEqual(name, 'John')
  assert.strictEqual(age, 30)
  assert.strictEqual(snapshot.usage.name, 1)
  assert.strictEqual(snapshot.usage.age, 1)
})

test('createUsageTracker should track nested property access', () => {
  const obj = {
    user: {
      profile: {
        name: 'Alice',
        email: 'alice@example.com',
      },
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  // Access nested properties
  const name = tracked.user.profile.name
  const email = tracked.user.profile.email

  const snapshot = getUsage()

  assert.strictEqual(name, 'Alice')
  assert.strictEqual(email, 'alice@example.com')
  assert.deepStrictEqual(snapshot.usage, {
    user: {
      profile: {
        name: 1,
        email: 1,
      },
    },
  })
})

test('createUsageTracker should increment count for multiple accesses', () => {
  const obj = {value: 42}
  const [tracked, getUsage] = usageTracker(obj)

  // Access the same property multiple times
  void tracked.value
  void tracked.value
  void tracked.value

  const snapshot = getUsage()

  assert.strictEqual(snapshot.usage.value, 3)
})

test('createUsageTracker should track array values', () => {
  const obj = {items: ['a', 'b', 'c']}
  const [tracked, getUsage] = usageTracker(obj)

  const items = tracked.items

  const snapshot = getUsage()

  assert.deepStrictEqual(items, ['a', 'b', 'c'])
  assert.strictEqual(snapshot.usage.items, 1)
})

test('createUsageTracker should track function values', () => {
  const obj = {
    greet: () => 'Hello',
  }
  const [tracked, getUsage] = usageTracker(obj)

  const greet = tracked.greet

  const snapshot = getUsage()

  assert.strictEqual(typeof greet, 'function')
  assert.strictEqual(greet(), 'Hello')
  assert.strictEqual(snapshot.usage.greet, 1)
})

test('createUsageTracker should track null values', () => {
  const obj = {value: null}
  const [tracked, getUsage] = usageTracker(obj)

  const value = tracked.value

  const snapshot = getUsage()

  assert.strictEqual(value, null)
  assert.strictEqual(snapshot.usage.value, 1)
})

test('createUsageTracker should track undefined values', () => {
  const obj = {value: undefined}
  const [tracked, getUsage] = usageTracker(obj)

  const value = tracked.value

  const snapshot = getUsage()

  assert.strictEqual(value, undefined)
  assert.strictEqual(snapshot.usage.value, 1)
})

test('createUsageTracker should track boolean values', () => {
  const obj = {active: true, disabled: false}
  const [tracked, getUsage] = usageTracker(obj)

  const active = tracked.active
  const disabled = tracked.disabled

  const snapshot = getUsage()

  assert.strictEqual(active, true)
  assert.strictEqual(disabled, false)
  assert.strictEqual(snapshot.usage.active, 1)
  assert.strictEqual(snapshot.usage.disabled, 1)
})

test('createUsageTracker should track number values including zero', () => {
  const obj = {count: 0, total: 100}
  const [tracked, getUsage] = usageTracker(obj)

  const count = tracked.count
  const total = tracked.total

  const snapshot = getUsage()

  assert.strictEqual(count, 0)
  assert.strictEqual(total, 100)
  assert.strictEqual(snapshot.usage.count, 1)
  assert.strictEqual(snapshot.usage.total, 1)
})

test('createUsageTracker should track empty string values', () => {
  const obj = {name: '', label: 'test'}
  const [tracked, getUsage] = usageTracker(obj)

  const name = tracked.name
  const label = tracked.label

  const snapshot = getUsage()

  assert.strictEqual(name, '')
  assert.strictEqual(label, 'test')
  assert.strictEqual(snapshot.usage.name, 1)
  assert.strictEqual(snapshot.usage.label, 1)
})

test('createUsageTracker should track intermediate object accesses', () => {
  const obj = {
    user: {
      name: 'Bob',
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  // Access intermediate object
  void tracked.user

  const snapshot = getUsage()

  // 'user' should be tracked now
  assert.strictEqual(snapshot.usage.user, 1)
})

test('createUsageTracker getUsageSnapshot should return a deep copy', () => {
  const obj = {value: 1}
  const [tracked, getUsage] = usageTracker(obj)

  void tracked.value

  const snapshot1 = getUsage()
  const snapshot2 = getUsage()

  // Should be equal but not the same object
  assert.deepStrictEqual(snapshot1, snapshot2)
  assert.notStrictEqual(snapshot1, snapshot2)

  // Modifying one shouldn't affect the other
  snapshot1.usage.value = 999
  assert.strictEqual(snapshot2.usage.value, 1)
})

test('createUsageTracker should handle complex nested structures', () => {
  const obj = {
    data: {
      level1: {
        level2: {
          level3: {
            deepValue: 'found',
          },
        },
      },
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  const deepValue = tracked.data.level1.level2.level3.deepValue

  const snapshot = getUsage()

  assert.strictEqual(deepValue, 'found')
  assert.deepStrictEqual(snapshot.usage, {
    data: {
      level1: {
        level2: {
          level3: {
            deepValue: 1,
          },
        },
      },
    },
  })
})

test('createUsageTracker should track multiple properties at different levels', () => {
  const obj = {
    a: 1,
    b: {
      c: 2,
      d: {
        e: 3,
      },
    },
    f: 4,
  }
  const [tracked, getUsage] = usageTracker(obj)

  void tracked.a
  void tracked.b.c
  void tracked.b.d.e
  void tracked.f
  void tracked.a // Access again

  const snapshot = getUsage()

  assert.deepStrictEqual(snapshot.usage, {
    a: 2, // accessed twice
    b: {
      c: 1,
      d: {
        e: 1,
      },
    },
    f: 1,
  })
})

test('createUsageTracker should handle objects with no properties accessed', () => {
  const obj = {name: 'test', value: 42}
  const [, getUsage] = usageTracker(obj)

  // Don't access any properties
  const snapshot = getUsage()

  assert.deepStrictEqual(snapshot.usage, {})
  assert.deepStrictEqual(snapshot.calls, {})
})

test('createUsageTracker should work with mixed value types', () => {
  const obj = {
    string: 'text',
    number: 42,
    boolean: true,
    null: null,
    undefined: undefined,
    array: [1, 2, 3],
    function: () => 'result',
    nested: {
      value: 'deep',
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  void tracked.string
  void tracked.number
  void tracked.boolean
  void tracked.null
  void tracked.undefined
  void tracked.array
  void tracked.function
  void tracked.nested.value

  const snapshot = getUsage()

  assert.strictEqual(snapshot.usage.string, 1)
  assert.strictEqual(snapshot.usage.number, 1)
  assert.strictEqual(snapshot.usage.boolean, 1)
  assert.strictEqual(snapshot.usage.null, 1)
  assert.strictEqual(snapshot.usage.undefined, 1)
  assert.strictEqual(snapshot.usage.array, 1)
  assert.strictEqual(snapshot.usage.function, 1)
  assert.deepStrictEqual(snapshot.usage.nested, {value: 1})
})

test('createUsageTracker should preserve original object functionality', () => {
  const obj = {
    value: 10,
    getValue() {
      return this.value
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  // Access value
  const value = tracked.value

  // Access method
  const getValue = tracked.getValue

  const snapshot = getUsage()

  assert.strictEqual(value, 10)
  assert.strictEqual(typeof getValue, 'function')
  assert.strictEqual(snapshot.usage.value, 1)
  assert.strictEqual(snapshot.usage.getValue, 1)
})

test('createUsageTracker should handle accessing same nested path multiple times', () => {
  const obj = {
    config: {
      theme: {
        color: 'blue',
      },
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  void tracked.config.theme.color
  void tracked.config.theme.color
  void tracked.config.theme.color

  const snapshot = getUsage()

  assert.deepStrictEqual(snapshot.usage, {
    config: {
      theme: {
        color: 3,
      },
    },
  })
})

test('createUsageTracker should create nested usage structure when overwriting number', () => {
  const obj = {
    level1: {
      level2a: 'value2a',
      level2b: {
        level3: 'value3',
      },
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  // Access level2a first (creates number in usage)
  void tracked.level1.level2a

  // Then access level2b.level3 (should create nested structure)
  void tracked.level1.level2b.level3

  const snapshot = getUsage()

  assert.deepStrictEqual(snapshot.usage, {
    level1: {
      level2a: 1,
      level2b: {
        level3: 1,
      },
    },
  })
})

test('createUsageTracker should track function calls with arguments', () => {
  const obj = {
    greet: (name: string) => `Hello, ${name}`,
  }
  const [tracked, getUsage] = usageTracker(obj)

  const result1 = tracked.greet('Alice')
  const result2 = tracked.greet('Bob')

  const snapshot = getUsage()

  assert.strictEqual(result1, 'Hello, Alice')
  assert.strictEqual(result2, 'Hello, Bob')
  assert.strictEqual(snapshot.usage.greet, 2)
  assert.deepStrictEqual(snapshot.calls, {
    greet: [{args: ['Alice']}, {args: ['Bob']}],
  })
})

test('createUsageTracker should track nested function calls with arguments', () => {
  const obj = {
    love: {
      fetchDoc: (path: string) => `Document: ${path}`,
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  const result1 = tracked.love.fetchDoc('/amore')
  const result2 = tracked.love.fetchDoc('/amore2')

  const snapshot = getUsage()

  assert.strictEqual(result1, 'Document: /amore')
  assert.strictEqual(result2, 'Document: /amore2')
  assert.strictEqual((snapshot.usage.love as Record<string, number>).fetchDoc, 2)
  assert.deepStrictEqual(snapshot.calls, {
    love: {
      fetchDoc: [{args: ['/amore']}, {args: ['/amore2']}],
    },
  })
})

test('createUsageTracker should track function calls with multiple arguments', () => {
  const obj = {
    add: (a: number, b: number, c: number) => a + b + c,
  }
  const [tracked, getUsage] = usageTracker(obj)

  const result = tracked.add(1, 2, 3)

  const snapshot = getUsage()

  assert.strictEqual(result, 6)
  assert.deepStrictEqual(snapshot.calls, {
    add: [{args: [1, 2, 3]}],
  })
})

test('createUsageTracker should track function calls with no arguments', () => {
  const obj = {
    getValue: () => 42,
  }
  const [tracked, getUsage] = usageTracker(obj)

  const result = tracked.getValue()

  const snapshot = getUsage()

  assert.strictEqual(result, 42)
  assert.deepStrictEqual(snapshot.calls, {
    getValue: [{args: []}],
  })
})

test('createUsageTracker should track function calls with complex argument types', () => {
  const obj = {
    process: (data: unknown) => data,
  }
  const [tracked, getUsage] = usageTracker(obj)

  tracked.process({id: 1, name: 'test'})
  tracked.process([1, 2, 3])
  tracked.process(null)
  tracked.process(undefined)

  const snapshot = getUsage()

  // Note: undefined is serialized as null due to JSON.stringify limitation
  assert.deepStrictEqual(snapshot.calls.process, [
    {args: [{id: 1, name: 'test'}]},
    {args: [[1, 2, 3]]},
    {args: [null]},
    {args: [null]}, // undefined becomes null in JSON serialization
  ])
})

test('createUsageTracker should track both property access and function calls separately', () => {
  const obj = {
    config: {
      name: 'App',
      getVersion: () => '1.0.0',
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  // Access property
  const name = tracked.config.name

  // Call function
  const version = tracked.config.getVersion()

  const snapshot = getUsage()

  assert.strictEqual(name, 'App')
  assert.strictEqual(version, '1.0.0')

  // Property access is tracked
  assert.deepStrictEqual(snapshot.usage, {
    config: {
      name: 1,
      getVersion: 1,
    },
  })

  // Function call is tracked
  assert.deepStrictEqual(snapshot.calls, {
    config: {
      getVersion: [{args: []}],
    },
  })
})

test('createUsageTracker should not track calls when function is only accessed but not called', () => {
  const obj = {
    greet: (name: string) => `Hello, ${name}`,
  }
  const [tracked, getUsage] = usageTracker(obj)

  // Access the function but don't call it
  void tracked.greet

  const snapshot = getUsage()

  // Property access is tracked
  assert.strictEqual(snapshot.usage.greet, 1)

  // No function calls tracked
  assert.deepStrictEqual(snapshot.calls, {})
})

test('createUsageTracker should track deeply nested function calls', () => {
  const obj = {
    api: {
      v1: {
        users: {
          get: (id: number) => `User ${id}`,
        },
      },
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  tracked.api.v1.users.get(123)
  tracked.api.v1.users.get(456)

  const snapshot = getUsage()

  assert.deepStrictEqual(snapshot.calls, {
    api: {
      v1: {
        users: {
          get: [{args: [123]}, {args: [456]}],
        },
      },
    },
  })
})

test('createUsageTracker should track function calls on accessed property objects', () => {
  const obj = {
    database: {
      users: {
        findById: (id: number) => `User ${id}`,
        findByEmail: (email: string) => `User with ${email}`,
      },
    },
  }
  const [tracked, getUsage] = usageTracker(obj)

  // Access the users object first, then call functions on it
  const users = tracked.database.users
  users.findById(1)
  users.findByEmail('test@example.com')

  const snapshot = getUsage()

  // Property access should be tracked - users object is accessed, then its functions
  assert.deepStrictEqual(snapshot.usage, {
    database: {
      users: {
        findById: 1,
        findByEmail: 1,
      },
    },
  })

  // Function calls should be tracked
  assert.deepStrictEqual(snapshot.calls, {
    database: {
      users: {
        findById: [{args: [1]}],
        findByEmail: [{args: ['test@example.com']}],
      },
    },
  })
})
