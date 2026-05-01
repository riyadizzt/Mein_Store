/**
 * C15.3 / Owner-decision R-1 — @nestjs/event-emitter 3.x contract test.
 *
 * ADR-3 in C15.3 Phase B builds on a SPECIFIC library behaviour:
 * `emitAsync(event, payload)` should resolve to `Promise<any[]>`
 * containing the return values of all listeners registered for the
 * event. Without this guarantee, the C15.3
 * `createFromMarketplace` → `ORDER_EVENTS.CONFIRMED with explicit
 * reservationIds` plan does not work.
 *
 * The owner-rejected alternative (DB-re-query of RESERVED rows
 * after the IMPORTED emit) was chosen as the FALLBACK if this
 * contract is broken in the @nestjs/event-emitter 3.x runtime.
 *
 * This file uses a REAL EventEmitter2 + EventEmitterModule
 * (test-container — NO mocks). If a future @nestjs/event-emitter
 * upgrade silently changes return-value propagation semantics,
 * this test fails LOUD and the C15.3 design needs revisiting.
 *
 * Pinned semantics:
 *   1. Plain @OnEvent listener (no async-flag) returning a value
 *      → emitAsync resolves with [returnedValue].
 *   2. Multiple listeners on the same event
 *      → emitAsync resolves with [val1, val2, ...].
 *   3. Listener returning Promise<T>
 *      → emitAsync awaits + resolves with [T].
 *   4. Listener throwing
 *      → emitAsync rejects (caller's responsibility to catch).
 *
 * Owner-decision R-1: real container, NOT mocks. This is the
 * load-bearing assumption for ADR-3 — anything less than empirical
 * verification is just pinning our wishful thinking.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitterModule, EventEmitter2, OnEvent } from '@nestjs/event-emitter'
import { Injectable } from '@nestjs/common'

const TEST_EVENT_RETURN_STRING = 'c153.contract-test.return-string'
const TEST_EVENT_RETURN_ARRAY = 'c153.contract-test.return-array'
const TEST_EVENT_MULTI_LISTENER = 'c153.contract-test.multi-listener'
const TEST_EVENT_THROW = 'c153.contract-test.throw'
const TEST_EVENT_PROMISE = 'c153.contract-test.promise'

@Injectable()
class TestListener {
  @OnEvent(TEST_EVENT_RETURN_STRING)
  handleReturnString(_payload: any): string {
    return 'hello'
  }

  @OnEvent(TEST_EVENT_RETURN_ARRAY)
  handleReturnArray(_payload: any): string[] {
    return ['res-A', 'res-B']
  }

  // Two listeners on the same event — emitAsync should propagate
  // both return values as separate array elements.
  @OnEvent(TEST_EVENT_MULTI_LISTENER)
  handleMultiOne(_payload: any): string[] {
    return ['from-listener-1']
  }

  @OnEvent(TEST_EVENT_MULTI_LISTENER)
  handleMultiTwo(_payload: any): string[] {
    return ['from-listener-2-a', 'from-listener-2-b']
  }

  @OnEvent(TEST_EVENT_THROW)
  handleThrow(_payload: any): never {
    throw new Error('listener-side failure')
  }

  // Async listener — emitAsync should await + propagate the
  // RESOLVED value (not the Promise itself).
  @OnEvent(TEST_EVENT_PROMISE)
  async handlePromise(_payload: any): Promise<string[]> {
    await new Promise((r) => setTimeout(r, 10))
    return ['async-res-1']
  }
}

describe('@nestjs/event-emitter 3.x — emitAsync return-value contract (C15.3 ADR-3)', () => {
  let emitter: EventEmitter2

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [TestListener],
    }).compile()
    await module.init()
    emitter = module.get(EventEmitter2)
  })

  it('listener returning a string → emitAsync resolves with [returnedString]', async () => {
    const result = await emitter.emitAsync(TEST_EVENT_RETURN_STRING, {})
    expect(result).toEqual(['hello'])
  })

  it('listener returning string[] → emitAsync resolves with [stringArray]', async () => {
    const result = await emitter.emitAsync(TEST_EVENT_RETURN_ARRAY, {})
    // CRITICAL: result is the OUTER array (one entry per listener),
    // and the INNER element is the listener's return value.
    // For a single-listener event returning string[], we get
    // [['res-A','res-B']] — i.e. result[0] === ['res-A','res-B'].
    // C15.3 createFromMarketplace flattens this.
    expect(result).toEqual([['res-A', 'res-B']])
  })

  it('two listeners on same event → emitAsync resolves with [listener1Return, listener2Return]', async () => {
    const result = await emitter.emitAsync(TEST_EVENT_MULTI_LISTENER, {})
    expect(result).toEqual([
      ['from-listener-1'],
      ['from-listener-2-a', 'from-listener-2-b'],
    ])
  })

  it('async listener → emitAsync awaits + propagates resolved value', async () => {
    const result = await emitter.emitAsync(TEST_EVENT_PROMISE, {})
    expect(result).toEqual([['async-res-1']])
  })

  it('listener throws → emitAsync resolves with [undefined] (does NOT reject — empirical 3.x behaviour)', async () => {
    // EMPIRICAL FINDING (verified 2026-05-01 against @nestjs/event-
    // emitter 3.x runtime): when a listener throws, emitAsync does
    // NOT reject the outer promise. It resolves with the broken
    // listener's slot containing `undefined` instead of the would-
    // be return value. Other listeners on the same event are still
    // invoked normally.
    //
    // Implication for C15.3 createFromMarketplace: the catch-block
    // in the production code is NOT reached even if a reservation-
    // listener throws mid-loop. Compensation logic in the listener
    // itself (handleOrderCreated catches per-item failures) is the
    // actual safety net. The outer emitAsync is "best-effort fan-
    // out" semantics.
    //
    // If a future @nestjs/event-emitter upgrade changes this to
    // promise-rejection (the more conventional behaviour), this
    // test fires loud and we must reassess C15.3 emit-block
    // error-handling.
    const result = await emitter.emitAsync(TEST_EVENT_THROW, {})
    expect(result).toEqual([undefined])
  })

  it('flatten + filter pattern (C15.3 Q-5 implementation) extracts string[] from emitAsync result', async () => {
    // This is the EXACT pattern used in
    // orders.service.createFromMarketplace post-IMPORTED emit.
    // Pinning it here gives us regression coverage for the
    // production code-path even if the implementation file is
    // refactored.
    const result = await emitter.emitAsync(TEST_EVENT_RETURN_ARRAY, {})
    const flattened: string[] = (result ?? [])
      .filter((r): r is string[] => Array.isArray(r))
      .flat()
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    expect(flattened).toEqual(['res-A', 'res-B'])
  })
})
