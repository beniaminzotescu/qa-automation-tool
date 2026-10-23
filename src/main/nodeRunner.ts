import { app } from 'electron'
import { join } from 'node:path'
import { quote } from './process'

// The tools the app runs as separate programs (Playwright's test runner, its browser installer and the
// browser tool for Claude) come with the app. They run on the app's own Electron in Node mode, so the
// tester's computer needs no Node.js and nothing is downloaded from npm.

/** The app's node_modules folder outside the packed archive (see asarUnpack in electron-builder.yml). */
export function unpackedModules(): string {
  return join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'node_modules')
}

/** Environment that makes the app's Electron behave as plain Node. */
export const NODE_MODE = { ELECTRON_RUN_AS_NODE: '1' }

/** A command line that runs a script of a bundled package with the app's Electron as Node. */
export function nodeCommandLine(script: string, args = ''): string {
  return `${quote(process.execPath)} ${quote(script)}${args ? ` ${args}` : ''}`
}

export const playwrightTestCli = (): string => join(unpackedModules(), '@playwright', 'test', 'cli.js')
export const playwrightCoreCli = (): string => join(unpackedModules(), 'playwright-core', 'cli.js')
export const playwrightMcpCli = (): string => join(unpackedModules(), '@playwright', 'mcp', 'cli.js')
