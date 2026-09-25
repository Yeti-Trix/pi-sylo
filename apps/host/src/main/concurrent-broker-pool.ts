import type { BrokerSupervisor } from './broker-supervisor.js'
import {
  clampMaxConcurrentTurns,
  DEFAULT_MAX_CONCURRENT_TURNS,
} from '../shared/concurrent-turns.js'

export type OverflowBrokerSlot = {
  supervisor: BrokerSupervisor
  ready: boolean
  spawnGeneration: number
  readyWaiters: Array<(ok: boolean) => void>
}

export class TurnBrokerPool {
  readonly overflowBrokers: OverflowBrokerSlot[] = []
  readonly turnBrokerByTurnId = new Map<string, BrokerSupervisor>()

  /**
   * Max in-flight agent turns. Concurrent mode off ⇒ 1. On ⇒ the user's
   * configured max (clamped; default when unset or out of range).
   */
  maxConcurrent(concurrentEnabled: boolean, configuredMax = DEFAULT_MAX_CONCURRENT_TURNS): number {
    return concurrentEnabled ? clampMaxConcurrentTurns(configuredMax) : 1
  }

  isSupervisorBusy(
    supervisor: BrokerSupervisor,
    hasPendingTurn: (turnId: string) => boolean,
  ): boolean {
    for (const [turnId, assigned] of this.turnBrokerByTurnId) {
      if (assigned === supervisor && hasPendingTurn(turnId)) return true
    }
    return false
  }

  assignTurn(turnId: string, supervisor: BrokerSupervisor): void {
    this.turnBrokerByTurnId.set(turnId, supervisor)
  }

  releaseTurn(turnId: string, primary: BrokerSupervisor | undefined): void {
    const supervisor = this.turnBrokerByTurnId.get(turnId)
    this.turnBrokerByTurnId.delete(turnId)
    if (!supervisor || supervisor === primary) return
    const idx = this.overflowBrokers.findIndex((s) => s.supervisor === supervisor)
    if (idx >= 0) {
      this.overflowBrokers[idx]!.supervisor.kill()
      this.overflowBrokers.splice(idx, 1)
    }
  }

  supervisorForTurn(turnId: string): BrokerSupervisor | undefined {
    return this.turnBrokerByTurnId.get(turnId)
  }

  killAllOverflow(): void {
    for (const slot of this.overflowBrokers) {
      slot.supervisor.kill()
    }
    this.overflowBrokers.length = 0
    this.turnBrokerByTurnId.clear()
  }

  markOverflowReady(slot: OverflowBrokerSlot): void {
    slot.ready = true
    for (const w of slot.readyWaiters) w(true)
    slot.readyWaiters.length = 0
  }

  markOverflowFailed(slot: OverflowBrokerSlot): void {
    slot.ready = false
    for (const w of slot.readyWaiters) w(false)
    slot.readyWaiters.length = 0
  }

  waitOverflowReady(slot: OverflowBrokerSlot, timeoutMs = 120_000): Promise<boolean> {
    if (slot.ready) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = slot.readyWaiters.indexOf(done)
        if (i >= 0) slot.readyWaiters.splice(i, 1)
        resolve(false)
      }, timeoutMs)
      const done = (ok: boolean) => {
        clearTimeout(timer)
        resolve(ok)
      }
      slot.readyWaiters.push(done)
    })
  }

  findIdleOverflow(hasPendingTurn: (turnId: string) => boolean): BrokerSupervisor | undefined {
    for (const slot of this.overflowBrokers) {
      if (slot.ready && !this.isSupervisorBusy(slot.supervisor, hasPendingTurn)) {
        return slot.supervisor
      }
    }
    return undefined
  }
}

export const turnBrokerPool = new TurnBrokerPool()
