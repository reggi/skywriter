import type {FunctionContext} from './types.ts'

/**
 * Creates a noop FunctionContext where all methods throw authentication errors.
 * Used as a fallback when the user is not logged in.
 *
 * @param cliName - The CLI name to display in error messages
 */
export function functionContextNoop(cliName: string): FunctionContext {
  const authError = (method: string) =>
    new Error(`fn.${method}() requires authentication. Run "${cliName} login" to connect to a server.`)

  return {
    getPage: async () => {
      throw authError('getPage')
    },
    getPages: async () => {
      throw authError('getPages')
    },
    getUploads: async () => {
      throw authError('getUploads')
    },
  }
}
