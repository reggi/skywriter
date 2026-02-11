import {assemble} from '../utils/assemble.ts'
import {render as renderDocument} from '../../render/index.ts'
import type {CliCommand} from '../utils/types.ts'

/**
 * Render the current working directory document and output as JSON
 */
export const render: CliCommand = async _ctx => {
  const document = await assemble()
  const rendered = await renderDocument(document)

  process.stdout.write(JSON.stringify(rendered) + '\n')
}
