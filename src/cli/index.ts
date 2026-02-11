#!/usr/bin/env node
import {program} from './utils/program.ts'

const exitCode = await program(process.argv.slice(2))
process.exitCode = exitCode
