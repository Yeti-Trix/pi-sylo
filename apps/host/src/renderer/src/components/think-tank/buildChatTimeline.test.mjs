import assert from 'node:assert/strict'
import test from 'node:test'

test('buildChatTimeline inserts think tank after trigger message, before follow-ups', async () => {
  const { buildChatTimeline } = await import('./buildChatTimeline.ts')

  const messages = [
    { id: 'u1', role: 'user', content: 'Run think tank', created_at: 100, tool_calls_json: null, status: 'complete' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Starting debate.',
      created_at: 200,
      tool_calls_json: JSON.stringify([
        { ts: 201, event: { type: 'tool_execution_start', toolName: 'sylo_think_tank_run' } },
      ]),
      status: 'complete',
    },
    { id: 'u2', role: 'user', content: 'Follow up?', created_at: 9000, tool_calls_json: null, status: 'complete' },
    { id: 'a2', role: 'assistant', content: 'Follow up answer.', created_at: 9100, tool_calls_json: null, status: 'complete' },
  ]

  const bubbles = [
    {
      id: 't1',
      sessionId: 'sess-1',
      cycle: 1,
      seatId: 'd1',
      seatLabel: 'Debater 1',
      seatAgent: 'debater',
      body: 'Argument',
      phase: 'debate',
      status: 'complete',
      created_at: 500,
      tool_calls_json: null,
    },
  ]

  const rows = buildChatTimeline({
    messages,
    bubbles,
    sessions: [
      {
        sessionId: 'sess-1',
        topic: 'Gate question',
        status: 'complete',
        sourceMessageId: 'a1',
        createdAt: 300,
      },
    ],
  })

  const keys = rows.map((r) => (r.kind === 'message' ? r.message.id : r.key))
  assert.deepEqual(keys, ['u1', 'a1', 'think-tank:sess-1', 'u2', 'a2'])
})

test('buildChatTimeline anchors a second think tank after the later trigger message', async () => {
  const { buildChatTimeline } = await import('./buildChatTimeline.ts')

  const messages = [
    { id: 'u1', role: 'user', content: 'First think tank', created_at: 100, tool_calls_json: null, status: 'complete' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Running first debate.',
      created_at: 200,
      tool_calls_json: JSON.stringify([
        { ts: 201, event: { type: 'tool_execution_start', toolName: 'sylo_think_tank_run' } },
      ]),
      status: 'complete',
    },
    { id: 'u2', role: 'user', content: 'Regular chat', created_at: 5000, tool_calls_json: null, status: 'complete' },
    { id: 'a2', role: 'assistant', content: 'Regular reply.', created_at: 5100, tool_calls_json: null, status: 'complete' },
    { id: 'u3', role: 'user', content: 'Second think tank', created_at: 9000, tool_calls_json: null, status: 'complete' },
    {
      id: 'a3',
      role: 'assistant',
      content: 'Running second debate.',
      created_at: 9100,
      tool_calls_json: JSON.stringify([
        { ts: 9101, event: { type: 'tool_execution_start', toolName: 'sylo_think_tank_run' } },
      ]),
      status: 'complete',
    },
  ]

  const bubbles = [
    {
      id: 't1',
      sessionId: 'sess-1',
      cycle: 1,
      seatId: 'd1',
      seatLabel: 'Debater 1',
      seatAgent: 'debater',
      body: 'First session argument',
      phase: 'debate',
      status: 'complete',
      created_at: 400,
      tool_calls_json: null,
    },
    {
      id: 't2',
      sessionId: 'sess-2',
      cycle: 1,
      seatId: 'd1',
      seatLabel: 'Debater 1',
      seatAgent: 'debater',
      body: 'Second session argument',
      phase: 'debate',
      status: 'complete',
      created_at: 9200,
      tool_calls_json: null,
    },
  ]

  const rows = buildChatTimeline({
    messages,
    bubbles,
    sessions: [
      {
        sessionId: 'sess-1',
        topic: 'First question',
        status: 'complete',
        sourceMessageId: 'a1',
        createdAt: 300,
      },
      {
        sessionId: 'sess-2',
        topic: 'Second question',
        status: 'debating',
        sourceMessageId: 'a3',
        createdAt: 9150,
      },
    ],
  })

  const keys = rows.map((r) => (r.kind === 'message' ? r.message.id : r.key))
  assert.deepEqual(keys, [
    'u1',
    'a1',
    'think-tank:sess-1',
    'u2',
    'a2',
    'u3',
    'a3',
    'think-tank:sess-2',
  ])
})

test('defaultThinkTankBlockCollapsed is true when session finished', async () => {
  const { defaultThinkTankBlockCollapsed } = await import('./buildChatTimeline.ts')
  assert.equal(defaultThinkTankBlockCollapsed('debating'), false)
  assert.equal(defaultThinkTankBlockCollapsed('complete'), true)
})
