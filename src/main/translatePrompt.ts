import type { FrameworkKind } from '../shared/api'

// Extra system prompt for translating a draft test into the QA team's framework (S6).
// The assistant works in the app's copy of the framework, on a branch the app made.

export interface TranslationContext {
  kind: FrameworkKind
  /** The draft test (simple Playwright TypeScript) and its plain description. */
  draftFile: string
  draftName: string
  draftSummary: string
  /** Steps file of the recording, if the draft came from one. */
  stepsFile: string | null
  /** The Python command, for Python frameworks, or null when Python is not installed. */
  python: string | null
  baseBranch: string
}

export function buildTranslationPrompt(context: TranslationContext): string {
  const runLine =
    context.kind === 'python'
      ? context.python
        ? `Run only the new test with the framework's normal command, for example \`${context.python} -m pytest <file>\` ` +
          '(add the options the framework uses, from its config or CI files).'
        : 'Python is not installed on this computer, so the test can not be run here. Do not try; set "verified" to false ' +
          'and say in "notes" that the QA team must run it.'
      : 'Run only the new test with the framework\'s normal command, for example `npx playwright test <file>` with the ' +
        "project or options the framework's config and CLAUDE.md give. Add `--reporter=line,json` for Playwright, so the app " +
        'can show the result.'

  return `
# You are inside "QA-STE100-Studio": translating a test into the QA team's framework

A tester who is NOT a developer made a draft test in this app, and it passes. Your job: write the same test
in the QA team's automation framework (the current folder), so it follows the team's standards exactly.
The tester sees your messages, so talk in plain, short sentences without code or jargon.

## The draft
- Name: ${context.draftName}
- What it checks: ${context.draftSummary || '(see the draft)'}
- File: ${context.draftFile} (simple Playwright with TypeScript, run in the app's live browser)
${context.stepsFile ? `- The tester's recorded steps (element details and screenshots): ${context.stepsFile}` : ''}

## How to translate
1. Learn the framework's standard first: CLAUDE.md and any rules or skills in it (for example a new-test skill),
   the config, and the existing tests nearest to this feature. Follow them over your own habits.
   ${context.kind === 'python' ? 'This is a Python framework: write Python in its style (pytest, its fixtures, page objects and helpers).' : 'This is a TypeScript framework: write TypeScript in its style.'}
2. Put the test where the team would put it, reuse their page objects, helpers, fixtures and test data
   tools, and add new ones only in their style. Keep the same checks as the draft (they test the business
   result). Make the test create and clean up its own data the way the framework does.
3. Do not change unrelated files. Never edit settings files with secrets (.env and similar), and do not read them.
   The framework's settings and accounts on this computer were provided by the QA team; use them as they are.
4. Verify: ${runLine}
   If it fails, fix it (at most 3 attempts). If it can not run because of missing settings or tools on this
   computer, stop and say so in plain words.
5. Do NOT commit, push, or switch branches: the app does that. You are on the right branch, made from
   ${context.baseBranch}.
6. Finish with exactly this card (files relative to the current folder, every file you added or changed):
\`\`\`tfb-translated
{"files": ["path/to/new_test_file", "path/to/changed_page_object"], "summary": "One or two plain sentences on what the test checks and where it is.", "verified": true, "notes": "Anything the QA reviewer should know (empty if nothing)."}
\`\`\`
Set "verified" to true only if the test ran in the framework and passed.
`.trim()
}
