/**
 * Creates a usage tracker that wraps an object with Proxies to track property access and function calls.
 * Returns a tuple of [trackedObject, getUsageSnapshot] where getUsageSnapshot() returns
 * a deep copy of the usage record including property access counts and function call arguments.
 */
export function usageTracker<T extends Record<string, unknown>>(
  obj: T,
): [T, () => {usage: Record<string, unknown>; calls: Record<string, unknown>}] {
  const usage: Record<string, unknown> = {}
  const calls: Record<string, unknown> = {}

  function track(path: string[]): void {
    let current: Record<string, unknown> = usage
    for (let i = 0; i < path.length; i++) {
      const key = path[i]
      const isLast = i === path.length - 1

      if (isLast) {
        // For the last key, increment the counter
        const currentValue = current[key]
        if (typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)) {
          // If it's already an object with nested properties, keep it and add a counter
          const objValue = currentValue as Record<string, unknown>
          current[key] =
            objValue.__count !== undefined ? {...objValue, __count: (objValue.__count as number) + 1} : currentValue
        } else {
          current[key] = ((currentValue as number) || 0) + 1
        }
      } else {
        // For intermediate keys, ensure they're objects
        const currentValue = current[key]
        if (typeof currentValue !== 'object' || currentValue === null || Array.isArray(currentValue)) {
          current[key] = {}
        }
        current = current[key] as Record<string, unknown>
      }
    }
  }

  function trackCall(path: string[], args: unknown[]): void {
    let current: Record<string, unknown> = calls
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]
      if (!current[key] || Array.isArray(current[key])) {
        current[key] = {}
      }
      current = current[key] as Record<string, unknown>
    }
    const lastKey = path[path.length - 1]
    if (!Array.isArray(current[lastKey])) {
      current[lastKey] = []
    }
    // Deep clone args to preserve undefined values
    ;(current[lastKey] as unknown[]).push({args: args.map(arg => arg)})
  }

  function createTrackedObject<U extends object>(target: U, path: string[] = []): U {
    return new Proxy(target, {
      get(obj, prop: string) {
        const currentPath = [...path, prop]
        const value = (obj as Record<string, unknown>)[prop]

        // Track property access
        track(currentPath)

        // If it's a function, wrap it to track calls
        if (typeof value === 'function') {
          return new Proxy(value, {
            apply(target, thisArg, args) {
              trackCall(currentPath, args)
              return Reflect.apply(target, thisArg, args)
            },
          })
        }

        // If value is an object (but not null or array), wrap it in a proxy too
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return createTrackedObject(value as object, currentPath)
        }

        return value
      },
    }) as U
  }

  function getUsageSnapshot(): {usage: Record<string, unknown>; calls: Record<string, unknown>} {
    return {
      usage: JSON.parse(JSON.stringify(usage)) as Record<string, unknown>,
      calls: JSON.parse(JSON.stringify(calls)) as Record<string, unknown>,
    }
  }

  const tracked = createTrackedObject(obj)
  return [tracked, getUsageSnapshot]
}
