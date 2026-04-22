/**
 * Sentry optional-loader.
 *
 * Loads @sentry/nestjs and @sentry/nestjs/setup via require() inside
 * try/catch so a missing module at runtime (e.g. pnpm-symlink-drop
 * across Docker stages — Railway incident 22.04.2026) cannot crash
 * container boot. When the package cannot be resolved we serve
 * null-object stubs so callers can keep their call-sites identical.
 *
 * Scope:
 *   - sentry.init.ts           — calls getSentry().init(...)
 *   - app.module.ts            — pulls SentryModule + SentryGlobalFilter
 *   - sentry-user-context.interceptor.ts — calls getSentry().getClient()
 *
 * Graceful-degradation contract:
 *   - If @sentry/nestjs IS available, behaviour is 100 % identical to
 *     a direct static import.
 *   - If it is NOT available, we log ONE warning line on startup and
 *     every Sentry call becomes a no-op. No rethrow, no crash.
 *   - The Nest framework itself MUST remain fully functional either
 *     way — this is a defence-in-depth net behind the Dockerfile fix,
 *     not a substitute.
 *
 * Philosophy: Sentry is telemetry. A telemetry outage is never worth
 * a container-boot loop. The underlying Docker-build fix remains the
 * primary remediation; this helper only prevents catastrophic
 * blast-radius if that fix ever regresses.
 */

type SentryModuleShape = typeof import('@sentry/nestjs')
type SentrySetupShape = typeof import('@sentry/nestjs/setup')

interface SentryOptional {
  available: boolean
  sentry: SentryModuleShape | null
  setup: SentrySetupShape | null
}

let cached: SentryOptional | null = null

function loadSentryOptional(): SentryOptional {
  if (cached) return cached

  let sentry: SentryModuleShape | null = null
  let setup: SentrySetupShape | null = null

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sentry = require('@sentry/nestjs') as SentryModuleShape
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(
      `[Sentry] @sentry/nestjs is not resolvable at runtime — telemetry disabled. ` +
      `This is safe for boot, but Sentry events will NOT be reported until the ` +
      `install-time fix is in place (see Dockerfile pnpm-deploy step). Error: ${e?.message ?? e}`,
    )
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    setup = require('@sentry/nestjs/setup') as SentrySetupShape
  } catch {
    // Silent — the main package failure above already logged the primary
    // cause. If the main package is present but /setup is not, same no-op
    // behaviour applies.
  }

  cached = {
    available: Boolean(sentry && setup),
    sentry,
    setup,
  }
  return cached
}

/**
 * True iff both @sentry/nestjs AND @sentry/nestjs/setup were
 * require-able at process-startup. Cached for the process lifetime.
 *
 * Consumers use this to decide whether to wire SentryModule into
 * the Nest app graph (app.module.ts) or skip it entirely.
 */
export function sentryAvailable(): boolean {
  return loadSentryOptional().available
}

/**
 * Return the real @sentry/nestjs module if resolvable, else null.
 * Call-sites either null-check or skip early via sentryAvailable().
 */
export function getSentryModule(): SentryModuleShape | null {
  return loadSentryOptional().sentry
}

/**
 * Return the real @sentry/nestjs/setup module (NestJS bindings) if
 * resolvable, else null.
 */
export function getSentrySetupModule(): SentrySetupShape | null {
  return loadSentryOptional().setup
}

// ──────────────────────────────────────────────────────────────
// NestJS-module-graph stubs
// ──────────────────────────────────────────────────────────────
//
// app.module.ts references SentryModule + SentryGlobalFilter directly
// in the @Module decorator — those symbols have to resolve at
// ES-import-evaluation time. When the real package is missing we
// substitute harmless stubs that produce a no-op Nest module and a
// pass-through exception filter.
//
// These stubs are NEVER exported individually — callers always go
// through resolveSentryNestModule() / resolveSentryGlobalFilter()
// so that a future @sentry/nestjs presence lights up instantly.

import { Module as NestModule, Injectable as NestInjectable, Catch, HttpException } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'

@NestModule({})
class StubSentryModule {
  static forRoot() {
    return { module: StubSentryModule }
  }
}

@NestInjectable()
@Catch()
class StubSentryGlobalFilter extends BaseExceptionFilter {
  // Nest default filter behaviour is inherited — HttpException
  // responses go through unchanged. We only lose the Sentry-capture
  // side effect, which is exactly the graceful-degrade contract.
  catch(exception: unknown, host: any): any {
    // Surface ONLY 5xx crashes to console.warn so operators know the
    // real Sentry integration isn't live; everything else delegates
    // cleanly to Nest's BaseExceptionFilter.
    const status = exception instanceof HttpException ? exception.getStatus() : 500
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.warn(
        '[Sentry stub] 5xx suppressed from telemetry (real @sentry/nestjs is not loaded):',
        (exception as any)?.message ?? exception,
      )
    }
    return super.catch(exception as any, host)
  }
}

/**
 * Return the real SentryModule class if @sentry/nestjs/setup is
 * present, else a stub Nest module whose `forRoot()` produces an
 * empty dynamic module. Callers treat both identically:
 *
 *     const SentryModule = resolveSentryNestModule()
 *     @Module({ imports: [ SentryModule.forRoot() ] })
 */
export function resolveSentryNestModule(): {
  forRoot: () => { module: any; providers?: any[]; exports?: any[] }
} {
  const setup = loadSentryOptional().setup
  if (setup && (setup as any).SentryModule) {
    return (setup as any).SentryModule as {
      forRoot: () => { module: any; providers?: any[]; exports?: any[] }
    }
  }
  return StubSentryModule as unknown as {
    forRoot: () => { module: any; providers?: any[]; exports?: any[] }
  }
}

/**
 * Return the real SentryGlobalFilter class if available, else the
 * no-op stub that still inherits BaseExceptionFilter so Nest's
 * default 500-response behaviour is preserved.
 */
export function resolveSentryGlobalFilter(): any {
  const setup = loadSentryOptional().setup
  if (setup && (setup as any).SentryGlobalFilter) {
    return (setup as any).SentryGlobalFilter
  }
  return StubSentryGlobalFilter
}
