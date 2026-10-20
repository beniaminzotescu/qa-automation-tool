import { existsSync, readFileSync } from 'node:fs'
import type { TestCaseResult, TestReport } from '../shared/api'

// Reads Playwright's JSON report (written when Claude runs tests with --reporter=line,json)
// into the summary the chat shows.

interface JsonSuite {
  title: string
  file?: string
  specs?: JsonSpec[]
  suites?: JsonSuite[]
}

interface JsonSpec {
  title: string
  file: string
  tests: {
    status: 'expected' | 'unexpected' | 'flaky' | 'skipped'
    results: {
      duration: number
      error?: { message?: string }
      attachments?: { name: string; contentType: string; path?: string }[]
    }[]
  }[]
}

export function readTestReport(path: string): TestReport | null {
  if (!existsSync(path)) return null
  let json: { suites?: JsonSuite[]; stats?: { duration?: number } }
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }

  const tests: TestCaseResult[] = []
  const visit = (suite: JsonSuite, parents: string[]): void => {
    // The top-level suite is the file name; inner suites are describe() blocks.
    const titles = suite.file && parents.length === 0 ? [] : [...parents, suite.title]
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const last = test.results[test.results.length - 1]
        const attachments = test.results.flatMap((r) => r.attachments ?? []).filter((a) => a.path)
        tests.push({
          title: [...titles, spec.title].filter(Boolean).join(' › '),
          file: spec.file,
          status: STATUS[test.status],
          durationMs: test.results.reduce((sum, r) => sum + r.duration, 0),
          error: last?.error?.message ? cleanError(last.error.message) : null,
          screenshots: attachments.filter((a) => a.contentType.startsWith('image/')).map((a) => a.path!),
          video: attachments.find((a) => a.contentType.startsWith('video/'))?.path ?? null,
          trace: attachments.find((a) => a.name === 'trace')?.path ?? null
        })
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles)
  }
  for (const suite of json.suites ?? []) visit(suite, [])

  if (tests.length === 0) return null
  const count = (status: TestCaseResult['status']): number => tests.filter((t) => t.status === status).length
  return {
    passed: count('passed'),
    failed: count('failed'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    durationMs: json.stats?.duration ?? tests.reduce((sum, t) => sum + t.durationMs, 0),
    tests
  }
}

const STATUS: Record<JsonSpec['tests'][number]['status'], TestCaseResult['status']> = {
  expected: 'passed',
  unexpected: 'failed',
  flaky: 'flaky',
  skipped: 'skipped'
}

function cleanError(message: string): string {
  // Strip terminal colour codes and keep the first lines; the rest is in the replay.
  const plain = message.replace(/\u001b\[[0-9;]*m/g, '')
  return plain.split('\n').slice(0, 6).join('\n').trim()
}
