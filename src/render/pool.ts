import { Worker } from 'node:worker_threads'
import type { CharacterCardData, CharacterEntry, ItemEntry, MasteryEntry, PlayerCardData, SkillEntry, TacticalEntry, TierEntry, TraitEntry } from '../types.ts'
import type { CharacterRatingData } from '../data/rating.ts'

export interface RenderDictionaries {
  characters: CharacterEntry[]
  tiers: TierEntry[]
  items: ItemEntry[]
  masteries: MasteryEntry[]
  skills: SkillEntry[]
  tactical: TacticalEntry[]
  traits: TraitEntry[]
}

export interface RenderJob {
  kind: 'player' | 'character' | 'rank'
  data: PlayerCardData | CharacterCardData | CharacterRatingData
  dictionaries: RenderDictionaries
  dataDir: string
  fontDir: string
  characterId?: number
}

interface QueuedJob {
  job: RenderJob
  resolve: (value: { png: Buffer; width: number; height: number }) => void
  reject: (reason: unknown) => void
  timer: NodeJS.Timeout
}

interface WorkerSlot {
  worker: Worker
  idle: boolean
  current?: QueuedJob | undefined
}

/** Reusable worker_threads renderer pool. */
export class RenderWorkerPool {
  private readonly slots: WorkerSlot[] = []
  private readonly queue: Omit<QueuedJob, 'timer'>[] = []
  private nextId = 1
  private closed = false

  constructor(
    private readonly size: number,
    private readonly timeoutMs: number,
  ) {}

  render(job: RenderJob): Promise<{ png: Buffer; width: number; height: number }> {
    if (this.closed) return Promise.reject(new Error('render pool is closed'))
    return new Promise((resolve, reject) => {
      const item = { job, resolve, reject }
      const idle = this.slots.find(slot => slot.idle && slot.current === undefined)
      if (idle !== undefined) {
        this.dispatch(idle, item)
      } else if (this.slots.length < this.size) {
        const slot = this.createSlot()
        this.dispatch(slot, item)
      } else {
        this.queue.push(item)
      }
    })
  }

  async close(): Promise<void> {
    this.closed = true
    const pending = this.queue.splice(0)
    for (const item of pending) item.reject(new Error('render pool is closed'))
    await Promise.all(this.slots.map(async slot => {
      if (slot.current !== undefined) clearTimeout(slot.current.timer)
      await slot.worker.terminate()
    }))
    this.slots.length = 0
  }

  private dispatch(slot: WorkerSlot, item: Omit<QueuedJob, 'timer'>): void {
    const id = this.nextId++
    const timer = setTimeout(() => {
      if (slot.current?.job === item.job) {
        slot.current.reject(new Error('render worker timed out'))
        slot.current = undefined
        void slot.worker.terminate()
        this.slots.splice(this.slots.indexOf(slot), 1)
      }
    }, this.timeoutMs)
    const current: QueuedJob = { ...item, timer }
    slot.idle = false
    slot.current = current
    slot.worker.postMessage({ id, ...item.job, characterId: item.job.characterId })
  }

  private createSlot(): WorkerSlot {
    const worker = new Worker(new URL('./worker.js', import.meta.url))
    const slot: WorkerSlot = { worker, idle: true }
    worker.on('message', (message: {
      id: number
      png?: Uint8Array
      width?: number
      height?: number
      error?: string
    }) => {
      const current = slot.current
      if (current === undefined) return
      clearTimeout(current.timer)
      slot.current = undefined
      slot.idle = true
      if (message.error !== undefined) {
        current.reject(new Error(message.error))
      } else {
        current.resolve({
          png: Buffer.from(message.png ?? new Uint8Array()),
          width: message.width ?? 0,
          height: message.height ?? 0,
        })
      }
      const next = this.queue.shift()
      if (next !== undefined) this.dispatch(slot, next)
    })
    worker.on('error', error => {
      const current = slot.current
      if (current !== undefined) {
        clearTimeout(current.timer)
        current.reject(error)
      }
      const index = this.slots.indexOf(slot)
      if (index >= 0) this.slots.splice(index, 1)
    })
    this.slots.push(slot)
    return slot
  }
}
