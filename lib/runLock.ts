// Distributed run-lock using Supabase apex_run_locks table.
// Prevents concurrent runs of the same job type across multiple cron triggers.
//
// SQL to create the table (run once in Supabase SQL Editor):
//   CREATE TABLE IF NOT EXISTS apex_run_locks (
//     job_type        TEXT PRIMARY KEY,
//     locked          BOOLEAN DEFAULT FALSE,
//     locked_at       TIMESTAMPTZ,
//     lock_expires_at TIMESTAMPTZ,
//     last_run_at     TIMESTAMPTZ,
//     last_run_ms     INT,
//     run_count       INT DEFAULT 0
//   );
//   INSERT INTO apex_run_locks (job_type, locked)
//   VALUES ('monitor', false), ('decide', false), ('evaluate', false), ('brief', false)
//   ON CONFLICT (job_type) DO NOTHING;

import { getSupabaseServer } from '@/lib/supabase'

// Lock TTLs — safety net if a run crashes without releasing
const LOCK_TTL_MS: Record<string, number> = {
  monitor:  60_000,
  decide:   180_000,
  evaluate: 120_000,
  brief:    120_000,
}

type LockRow = { locked: boolean; lock_expires_at: string | null } | null

export async function acquireLock(jobType: string): Promise<boolean> {
  const sb = getSupabaseServer()
  if (!sb) return true  // no DB configured — proceed without lock

  const now     = new Date()
  const ttl     = LOCK_TTL_MS[jobType] ?? 120_000
  const expires = new Date(now.getTime() + ttl)

  const { data: current } = await Promise.resolve(
    sb.from('apex_run_locks')
      .select('locked, lock_expires_at')
      .eq('job_type', jobType)
      .maybeSingle()
  ).catch(() => ({ data: null })) as { data: LockRow }

  if (current?.locked) {
    const alreadyExpired = current.lock_expires_at
      ? new Date(current.lock_expires_at) < now
      : false
    if (!alreadyExpired) {
      console.log(`[LOCK] ${jobType} already running — skipping this trigger`)
      return false
    }
    console.log(`[LOCK] ${jobType} lock was stale — forcing release and re-acquiring`)
  }

  const { error } = await Promise.resolve(
    sb.from('apex_run_locks').upsert(
      { job_type: jobType, locked: true, locked_at: now.toISOString(), lock_expires_at: expires.toISOString() },
      { onConflict: 'job_type' },
    )
  ).catch((e: Error) => ({ error: e })) as { error: Error | { message: string } | null }

  if (error) {
    console.error(`[LOCK] Failed to acquire ${jobType}:`, (error as { message?: string }).message ?? error)
    return true  // proceed anyway on DB error rather than blocking indefinitely
  }

  console.log(`[LOCK] ${jobType} acquired (expires ${expires.toISOString()})`)
  return true
}

export async function releaseLock(jobType: string, durationMs: number): Promise<void> {
  const sb = getSupabaseServer()
  if (!sb) return
  await Promise.resolve(
    sb.from('apex_run_locks').update({
      locked:          false,
      locked_at:       null,
      lock_expires_at: null,
      last_run_at:     new Date().toISOString(),
      last_run_ms:     durationMs,
    }).eq('job_type', jobType)
  ).catch(() => {})
  console.log(`[LOCK] ${jobType} released after ${durationMs}ms`)
}

export async function withLock<T>(
  jobType: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const acquired = await acquireLock(jobType)
  if (!acquired) return null

  const start = Date.now()
  try {
    const result = await fn()
    await releaseLock(jobType, Date.now() - start)
    return result
  } catch (err: unknown) {
    await releaseLock(jobType, Date.now() - start)
    throw err
  }
}
