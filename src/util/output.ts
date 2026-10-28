/** Retention for rendered PNGs so a long-lived install does not grow without bound. */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface RetentionPolicy {
  /** Keep at most this many PNGs (newest first). `0` disables the count cap. */
  maxFiles: number
  /** Delete PNGs older than this many days. `0` disables the age cap. */
  maxAgeDays: number
}

interface Candidate {
  path: string
  mtimeMs: number
}

/**
 * Delete old rendered cards. Never throws: a failed cleanup must not fail a query.
 * @param dir - output directory to prune.
 * @param policy - count/age caps.
 * @returns how many files were removed.
 */
export async function pruneOutput(dir: string, policy: RetentionPolicy): Promise<number> {
  if (policy.maxFiles <= 0 && policy.maxAgeDays <= 0) return 0
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  const candidates: Candidate[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.png')) continue
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (info.isFile()) candidates.push({ path, mtimeMs: info.mtimeMs })
    } catch {
      // A file that vanished mid-scan needs no cleanup.
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const deadline = policy.maxAgeDays > 0 ? Date.now() - policy.maxAgeDays * 86_400_000 : Number.NEGATIVE_INFINITY
  const doomed = candidates.filter((candidate, index) =>
    (policy.maxFiles > 0 && index >= policy.maxFiles) || candidate.mtimeMs < deadline)
  for (const candidate of doomed) {
    await rm(candidate.path, { force: true }).catch(() => undefined)
  }
  return doomed.length
}
