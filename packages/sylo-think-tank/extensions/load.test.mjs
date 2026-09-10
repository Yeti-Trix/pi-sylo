import assert from 'node:assert/strict'
import test from 'node:test'

test('config.ts re-exports validateThinkTankSeats for debate-engine', async () => {
  const config = await import('./config.ts')
  assert.equal(typeof config.validateThinkTankSeats, 'function')
})

test('think-tank extension module loads', async () => {
  const mod = await import('./index.ts')
  assert.equal(typeof mod.default, 'function')
  let toolCount = 0
  mod.default({
    registerTool() {
      toolCount++
    },
  })
  assert.equal(toolCount, 3)
})

test('think-tank seat subprocess registers assignment tools only', async () => {
  const prev = process.env.SYLO_THINK_TANK_SEAT_RUN
  process.env.SYLO_THINK_TANK_SEAT_RUN = '1'
  try {
    const mod = await import('./index.ts')
    let toolCount = 0
    const hooks = []
    mod.default({
      registerTool() {
        toolCount++
      },
      // Seat mode also installs the vision fallback for text-only seat models,
      // so the stub has to accept event hooks as well as tools.
      on(event) {
        hooks.push(event)
      },
    })
    assert.equal(toolCount, 4)
    assert.deepEqual(hooks, ['tool_result'])
  } finally {
    if (prev === undefined) delete process.env.SYLO_THINK_TANK_SEAT_RUN
    else process.env.SYLO_THINK_TANK_SEAT_RUN = prev
  }
})
