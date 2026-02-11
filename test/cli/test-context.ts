import type {CliContext} from '../../src/cli/utils/types.ts'

/**
 * Create a mock CliContext for tests
 */
export function createMockCliContext(overrides: Partial<CliContext> = {}): CliContext {
  return {
    cliName: 'wondoc',
    cliId: 'wondoc',
    cwd: process.cwd(),
    ...overrides,
  }
}

/**
 * Default mock context for tests
 */
export const mockCliContext: CliContext = createMockCliContext()
