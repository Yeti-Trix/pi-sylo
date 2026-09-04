import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  assignTask,
  completeTask,
  initTaskStoreFile,
  resolveTaskId,
  submitTask,
} from './task-store.ts'

describe('resolveTaskId', () => {
  it('accepts full UUID and unique 8-char prefix', () => {
    const tasks = [
      {
        id: 'c5c80100-aaaa-bbbb-cccc-ddddeeeeffff',
        session_id: 's1',
        assignee_seat_id: 'seat-a',
        assignee_label: 'Debater 1',
        title: 't',
        description: 'd',
        status: 'open',
        assigner_seat_id: 'seat-moderator',
        assigned_cycle: 1,
        created_at: 1,
      },
    ]
    assert.equal(resolveTaskId(tasks, 'c5c80100-aaaa-bbbb-cccc-ddddeeeeffff'), tasks[0].id)
    assert.equal(resolveTaskId(tasks, 'c5c80100'), tasks[0].id)
  })

  it('rejects ambiguous prefix', () => {
    const tasks = [
      {
        id: 'c5c80100-aaaa-bbbb-cccc-ddddeeeeffff',
        session_id: 's1',
        assignee_seat_id: 'seat-a',
        assignee_label: 'Debater 1',
        title: 't1',
        description: 'd',
        status: 'open',
        assigner_seat_id: 'seat-moderator',
        assigned_cycle: 1,
        created_at: 1,
      },
      {
        id: 'c5c80100-bbbb-cccc-dddd-eeeeffff0000',
        session_id: 's1',
        assignee_seat_id: 'seat-b',
        assignee_label: 'Debater 2',
        title: 't2',
        description: 'd',
        status: 'open',
        assigner_seat_id: 'seat-moderator',
        assigned_cycle: 1,
        created_at: 2,
      },
    ]
    assert.throws(() => resolveTaskId(tasks, 'c5c80100'), /Ambiguous task id prefix/)
  })
})

describe('completeTask with prefix id', () => {
  it('marks submitted task complete when moderator passes 8-char prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sylo-tt-task-'))
    const path = join(dir, 'tasks.json')
    initTaskStoreFile({ path, sessionId: 'sess', moderatorSeatId: 'seat-moderator' })
    const task = assignTask({
      path,
      callerSeatId: 'seat-moderator',
      assigneeSeatId: 'seat-a',
      assigneeLabel: 'Debater 1',
      title: 'Source pricing',
      description: 'Find solo consultant rates',
      cycle: 1,
    })
    submitTask({
      path,
      callerSeatId: 'seat-a',
      taskId: task.id,
      result: 'Found rates.',
    })
    const prefix = task.id.slice(0, 8)
    const done = completeTask({ path, callerSeatId: 'seat-moderator', taskId: prefix })
    assert.equal(done.status, 'complete')
  })
})
