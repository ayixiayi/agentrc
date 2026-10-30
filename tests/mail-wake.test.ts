import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WAKE } from '../claude/agentrc/hooks/mail'

// A stub `amp` that records its arguments and acts as STUB says: `held` refuses a plain run the
// way an Amp holding the thread does and accepts -ox; `free` runs the turn; `broken` fails.
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$STUB:$*" in
  held:*-ox*) exit 0 ;;
  held:*) echo "Error: This thread is already open and active in another Amp (PID 1, /repo)."; exit 1 ;;
  free:*) echo "done"; exit 0 ;;
  chatty:*) echo "agentrc-mail: exit 1. Error: This thread is already open and active in another Amp"; exit 0 ;;
  *) echo "Error: Thread not found"; exit 1 ;;
esac
`

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentrc-wake.'))
  writeFileSync(join(dir, 'amp'), STUB)
  chmodSync(join(dir, 'amp'), 0o755)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function wake(stub: string, mode = '') {
  const run = Bun.spawnSync(['sh', '-c', WAKE, 'agentrc-mail', join(dir, 'log'), 'T-1', 'You have mail.', mode], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB: stub, CALLS: join(dir, 'calls') },
  })
  const calls = () => readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')
  return { code: run.exitCode, out: run.stdout.toString().trim(), calls }
}

test('a thread another Amp has open gets the notice through -ox', () => {
  const r = wake('held')
  expect([r.code, r.out]).toEqual([0, 'delivered'])
  expect(r.calls()).toEqual(['threads continue T-1 -x You have mail.', 'threads continue T-1 -ox -x You have mail.'])
})

test('a thread nobody has open runs headless, with the mode of a new thread', () => {
  const r = wake('free', 'low')
  expect([r.code, r.out]).toEqual([0, 'started'])
  expect(r.calls()).toEqual(['threads continue T-1 -m low -x You have mail.'])
})

test('a failure is reported with Amp error line', () => {
  const r = wake('broken')
  expect([r.code, r.out]).toEqual([1, 'Error: Thread not found'])
})

test('a turn whose answer quotes the lock error or a marker is not sent again', () => {
  const r = wake('chatty')
  expect([r.code, r.out]).toEqual([0, 'started'])
  expect(r.calls()).toEqual(['threads continue T-1 -x You have mail.'])
})
