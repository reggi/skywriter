import type {MiddlewareHandler} from 'hono'

/**
 * Represents a discovered document location
 */
export interface DiscoveredDocument {
  /** The path from settings.json */
  path: string
  /** The filesystem directory containing the document */
  fsPath: string
  /** Whether this document has a template subdirectory */
  hasTemplate: boolean
  /** Whether this document has a slot subdirectory */
  hasSlot: boolean
  /** The template_path from settings.json (if any) */
  templatePath: string | null
  /** The slot_path from settings.json (if any) */
  slotPath: string | null
}

/**
 * Result of document discovery
 */
export interface DiscoveryResult {
  /** Map of document paths to their discovery info */
  documents: Map<string, DiscoveredDocument>
  /** Documents sorted alphabetically by path */
  sortedPaths: string[]
  /** Errors encountered during discovery */
  errors: Array<{fsPath: string; error: string}>
  /** Paths that appear multiple times (templates/slots reused) */
  duplicates: Map<string, string[]>
}

/**
 * Getter function for discovery result (allows for mutable discovery)
 */
export type DiscoveryGetter = () => DiscoveryResult

/**
 * Factory for creating CLI middleware with arguments
 */
export type CliMiddlewareFactory<T extends unknown[]> = (...args: T) => MiddlewareHandler
