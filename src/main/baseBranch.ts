// The branch new tests start from. Teams name it differently, so the app picks the first of
// develop, main and master that the repository has, and otherwise the repository's own default.

const PREFERRED = ['develop', 'main', 'master']

/**
 * @param branches  branch names on the remote, without "origin/" or "refs/heads/"
 * @param defaultBranch  the remote's default branch (its HEAD), if known
 */
export function pickBaseBranch(branches: string[], defaultBranch: string | null): string | null {
  return PREFERRED.find((name) => branches.includes(name)) ?? defaultBranch ?? branches[0] ?? null
}

/** Reads `git ls-remote --symref <url>` output: the branches and the default branch. */
export function parseLsRemote(output: string): { branches: string[]; defaultBranch: string | null } {
  const branches = [...output.matchAll(/refs\/heads\/(\S+)/g)].map((m) => m[1])
  const defaultBranch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(output)?.[1] ?? null
  return { branches: [...new Set(branches)], defaultBranch }
}
