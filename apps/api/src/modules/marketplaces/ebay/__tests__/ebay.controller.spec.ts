/**
 * EbayController — error envelope contract.
 *
 * Regression guard for the silent-error bug fixed in C18: previously
 * the controller returned error envelopes ({ok:false, statusCode:N, ...})
 * as HTTP 200 bodies, letting the frontend fetch() see res.ok=true and
 * fire onSuccess with a false "success" banner. Now we throw proper
 * HttpException / ForbiddenException — the browser sees real 4xx and
 * the mutation fires onError.
 */

import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { EbayController, SetPolicyIdsDto } from '../ebay.controller'
import {
  EbayNotConnectedError,
  EbayRefreshRevokedError,
} from '../ebay-auth.service'

// Minimal typed stubs — direct instantiate, no NestJS DI.
// Constructor order: (auth, sandbox, audit, listing, merchantLocation).
function makeController(overrides: {
  bootstrap?: jest.Mock
  publish?: jest.Mock
  authPatch?: jest.Mock
  audit?: { log: jest.Mock }
  merchantLocation?: jest.Mock
} = {}) {
  // Default audit.log returns a resolved promise so the controller's
  // `.catch(() => {})` chain doesn't crash on undefined.
  const audit = overrides.audit ?? { log: jest.fn().mockResolvedValue(undefined) }
  // Sub-Task 1: setPolicyIds calls auth.patchSettings — stub it.
  const auth = { patchSettings: overrides.authPatch ?? jest.fn().mockResolvedValue(undefined) } as any
  const sandbox = { bootstrapPolicies: overrides.bootstrap ?? jest.fn() } as any
  const listing = { publishPending: overrides.publish ?? jest.fn() } as any
  // Sub-Task 2: setupMerchantLocation calls merchantLocation.ensureAutonomously.
  const merchantLocation = {
    ensureAutonomously:
      overrides.merchantLocation ??
      jest.fn().mockResolvedValue({
        locationKey: 'malak-lager-berlin',
        alreadyExisted: false,
        wasDisabled: false,
      }),
  } as any
  const ctrl = new EbayController(auth, sandbox, audit as any, listing, merchantLocation)
  return Object.assign(ctrl, { __testHooks: { auth, audit, merchantLocation } })
}

const req = { user: { id: 'admin-1' } } as any

describe('EbayController — error envelope contract', () => {
  describe('bootstrap-sandbox-policies', () => {
    it('throws ForbiddenException(403) with 3-lang message on EbayNotConnectedError', async () => {
      const err = new EbayNotConnectedError()
      const ctrl = makeController({ bootstrap: jest.fn().mockRejectedValue(err) })

      let caught: any
      try {
        await ctrl.bootstrapSandboxPolicies(req)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(ForbiddenException)
      expect(caught.getStatus()).toBe(403)
      const response: any = caught.getResponse()
      expect(response.error).toBe(err.code)
      expect(response.message).toEqual({
        de: expect.any(String),
        en: expect.any(String),
        ar: expect.any(String),
      })
    })

    it('throws ForbiddenException(403) on EbayRefreshRevokedError', async () => {
      const err = new EbayRefreshRevokedError()
      const ctrl = makeController({ bootstrap: jest.fn().mockRejectedValue(err) })

      let caught: any
      try {
        await ctrl.bootstrapSandboxPolicies(req)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(ForbiddenException)
      expect(caught.getStatus()).toBe(403)
      const response: any = caught.getResponse()
      expect(response.error).toBe(err.code)
    })

    it('throws HttpException(425) with EBAY_PROGRAM_OPT_IN_PROPAGATING on Business-Policy-not-eligible error', async () => {
      // Mimic what eBay returns during the 24h opt-in propagation window —
      // errorId 20403 is the documented eligibility error.
      const err: any = new Error('User is not eligible for Business Policy')
      err.ebayErrors = [{ errorId: 20403 }]
      const ctrl = makeController({ bootstrap: jest.fn().mockRejectedValue(err) })

      let caught: any
      try {
        await ctrl.bootstrapSandboxPolicies(req)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(HttpException)
      expect(caught.getStatus()).toBe(425)
      const response: any = caught.getResponse()
      expect(response.error).toBe('EBAY_PROGRAM_OPT_IN_PROPAGATING')
      expect(response.message).toEqual({
        de: expect.any(String),
        en: expect.any(String),
        ar: expect.any(String),
      })
      expect(response.message.de).toContain('Programm-Aktivierung')
    })

    it('returns BootstrapResult unchanged on happy path (HTTP 200)', async () => {
      const result = {
        fulfillmentPolicyId: 'F1',
        returnPolicyId: 'R1',
        paymentPolicyId: 'P1',
        alreadyExisted: { fulfillment: false, return: false, payment: false },
        programOptIn: { alreadyOptedIn: true },
        merchantLocation: { key: 'malak-lager-berlin', created: false, enabled: true },
      }
      const ctrl = makeController({ bootstrap: jest.fn().mockResolvedValue(result) })
      await expect(ctrl.bootstrapSandboxPolicies(req)).resolves.toEqual(result)
    })
  })

  describe('publish-pending', () => {
    it('throws ForbiddenException(403) with 3-lang message on EbayNotConnectedError', async () => {
      const err = new EbayNotConnectedError()
      const ctrl = makeController({ publish: jest.fn().mockRejectedValue(err) })

      let caught: any
      try {
        await ctrl.publishPending({}, req)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(ForbiddenException)
      expect(caught.getStatus()).toBe(403)
      const response: any = caught.getResponse()
      expect(response.error).toBe(err.code)
      expect(response.message).toEqual({
        de: expect.any(String),
        en: expect.any(String),
        ar: expect.any(String),
      })
    })

    it('returns summary unchanged on happy path (HTTP 200)', async () => {
      const summary = { requested: 3, published: 3, failed: 0, remaining: 0, results: [] }
      const ctrl = makeController({ publish: jest.fn().mockResolvedValue(summary) })
      await expect(ctrl.publishPending({}, req)).resolves.toEqual(summary)
    })
  })
})

describe('EbayController.setPolicyIds (Sub-Task 1 — production policies UI)', () => {
  const reqWithIp = { user: { id: 'admin-7' }, ip: '10.0.0.1' } as any

  it('persists all three policy IDs via auth.patchSettings + writes audit row', async () => {
    const ctrl = makeController()
    const hooks = (ctrl as any).__testHooks
    const dto = {
      fulfillmentPolicyId: '111111',
      returnPolicyId: '222222',
      paymentPolicyId: '333333',
    }

    const result = await ctrl.setPolicyIds(dto as any, reqWithIp)

    expect(result).toEqual({ ok: true })
    expect(hooks.auth.patchSettings).toHaveBeenCalledWith({
      policyIds: {
        fulfillmentPolicyId: '111111',
        returnPolicyId: '222222',
        paymentPolicyId: '333333',
      },
    })
    expect(hooks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-7',
        action: 'EBAY_POLICY_IDS_UPDATED',
        entityType: 'sales_channel_config',
        entityId: 'ebay',
        ipAddress: '10.0.0.1',
        changes: {
          after: {
            policyIds: {
              fulfillmentPolicyId: '111111',
              returnPolicyId: '222222',
              paymentPolicyId: '333333',
            },
          },
        },
      }),
    )
  })

  it('passes through optional merchantLocationKey when provided', async () => {
    const ctrl = makeController()
    const hooks = (ctrl as any).__testHooks
    const dto = {
      fulfillmentPolicyId: '111111',
      returnPolicyId: '222222',
      paymentPolicyId: '333333',
      merchantLocationKey: 'malak-lager-berlin',
    }
    await ctrl.setPolicyIds(dto as any, reqWithIp)
    expect(hooks.auth.patchSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        policyIds: expect.any(Object),
        merchantLocationKey: 'malak-lager-berlin',
      }),
    )
  })

  it('omits merchantLocationKey from patch when not provided in DTO', async () => {
    const ctrl = makeController()
    const hooks = (ctrl as any).__testHooks
    await ctrl.setPolicyIds(
      {
        fulfillmentPolicyId: '111111',
        returnPolicyId: '222222',
        paymentPolicyId: '333333',
      } as any,
      reqWithIp,
    )
    const patchArg = hooks.auth.patchSettings.mock.calls[0][0]
    expect(Object.keys(patchArg)).not.toContain('merchantLocationKey')
    expect(patchArg.policyIds).toBeDefined()
  })

  it('audit-log failure does NOT block the success response', async () => {
    const audit = { log: jest.fn().mockRejectedValue(new Error('audit DB down')) }
    const ctrl = makeController({ audit })
    await expect(
      ctrl.setPolicyIds(
        {
          fulfillmentPolicyId: '111111',
          returnPolicyId: '222222',
          paymentPolicyId: '333333',
        } as any,
        reqWithIp,
      ),
    ).resolves.toEqual({ ok: true })
  })

  it('falls back to "system" adminId when req.user is missing', async () => {
    const ctrl = makeController()
    const hooks = (ctrl as any).__testHooks
    await ctrl.setPolicyIds(
      {
        fulfillmentPolicyId: '111111',
        returnPolicyId: '222222',
        paymentPolicyId: '333333',
      } as any,
      { ip: '127.0.0.1' } as any,
    )
    expect(hooks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: 'system' }),
    )
  })
})

describe('SetPolicyIdsDto — validation contract (Sub-Task 1 regression)', () => {
  // Regression for the empty-string bug: frontend form sends
  // merchantLocationKey: "" by default → @IsOptional() did not skip
  // because class-validator only treats null/undefined as "absent".
  // Fix: ValidateIf with truthy-check skips ALL subsequent validators
  // when value is falsy.
  async function validateDto(input: any) {
    const dto = plainToInstance(SetPolicyIdsDto, input)
    return validate(dto)
  }

  it('accepts empty-string merchantLocationKey (skips validators)', async () => {
    const errors = await validateDto({
      fulfillmentPolicyId: '111111',
      returnPolicyId: '222222',
      paymentPolicyId: '333333',
      merchantLocationKey: '',
    })
    expect(errors).toHaveLength(0)
  })

  it('accepts missing merchantLocationKey field', async () => {
    const errors = await validateDto({
      fulfillmentPolicyId: '111111',
      returnPolicyId: '222222',
      paymentPolicyId: '333333',
    })
    expect(errors).toHaveLength(0)
  })

  it('accepts a valid merchantLocationKey', async () => {
    const errors = await validateDto({
      fulfillmentPolicyId: '111111',
      returnPolicyId: '222222',
      paymentPolicyId: '333333',
      merchantLocationKey: 'malak-lager-berlin',
    })
    expect(errors).toHaveLength(0)
  })

  it('rejects merchantLocationKey with invalid characters', async () => {
    const errors = await validateDto({
      fulfillmentPolicyId: '111111',
      returnPolicyId: '222222',
      paymentPolicyId: '333333',
      merchantLocationKey: 'invalid!chars',
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].property).toBe('merchantLocationKey')
  })

  it('rejects non-numeric fulfillmentPolicyId regardless of merchantLocationKey', async () => {
    const errors = await validateDto({
      fulfillmentPolicyId: 'abc',
      returnPolicyId: '222222',
      paymentPolicyId: '333333',
      merchantLocationKey: '',
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].property).toBe('fulfillmentPolicyId')
  })
})

describe('EbayController.setupMerchantLocation (Sub-Task 2)', () => {
  const reqWithIp = { user: { id: 'admin-7' }, ip: '10.0.0.1' } as any
  const ORIG_ENV = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIG_ENV }
  })

  it('production happy path: calls ensureAutonomously + audits + returns merged result', async () => {
    process.env.EBAY_ENV = 'production'
    const merchantLocation = jest.fn().mockResolvedValue({
      locationKey: 'malak-lager-berlin',
      alreadyExisted: false,
      wasDisabled: false,
    })
    const ctrl = makeController({ merchantLocation })
    const hooks = (ctrl as any).__testHooks

    const result = await ctrl.setupMerchantLocation(reqWithIp)

    expect(result).toEqual({
      ok: true,
      locationKey: 'malak-lager-berlin',
      alreadyExisted: false,
      wasDisabled: false,
    })
    expect(hooks.merchantLocation.ensureAutonomously).toHaveBeenCalledTimes(1)
    expect(hooks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EBAY_MERCHANT_LOCATION_ENSURED',
        entityType: 'sales_channel_config',
        entityId: 'ebay',
        adminId: 'admin-7',
        ipAddress: '10.0.0.1',
        changes: {
          after: expect.objectContaining({
            locationKey: 'malak-lager-berlin',
            alreadyExisted: false,
            wasDisabled: false,
          }),
        },
      }),
    )
  })

  it('sandbox-mode → 400 BadRequestException with 3-lang message; service NOT called', async () => {
    process.env.EBAY_ENV = 'sandbox'
    const ctrl = makeController()
    const hooks = (ctrl as any).__testHooks

    let caught: any = null
    try {
      await ctrl.setupMerchantLocation(reqWithIp)
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(BadRequestException)
    expect(caught.getStatus()).toBe(400)
    const response: any = caught.getResponse()
    expect(response.error).toBe('SandboxModeNotAllowed')
    expect(response.message).toEqual({
      de: expect.any(String),
      en: expect.any(String),
      ar: expect.any(String),
    })
    expect(hooks.merchantLocation.ensureAutonomously).not.toHaveBeenCalled()
    expect(hooks.audit.log).not.toHaveBeenCalled()
  })

  it('EbayNotConnectedError → 403 ForbiddenException with 3-lang message', async () => {
    process.env.EBAY_ENV = 'production'
    const err = new EbayNotConnectedError()
    const merchantLocation = jest.fn().mockRejectedValue(err)
    const ctrl = makeController({ merchantLocation })

    let caught: any = null
    try {
      await ctrl.setupMerchantLocation(reqWithIp)
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(ForbiddenException)
    expect(caught.getStatus()).toBe(403)
    const response: any = caught.getResponse()
    expect(response.error).toBe(err.code)
    expect(response.message).toEqual({
      de: expect.any(String),
      en: expect.any(String),
      ar: expect.any(String),
    })
  })

  it('audit-log failure does NOT block the success response', async () => {
    process.env.EBAY_ENV = 'production'
    const audit = { log: jest.fn().mockRejectedValue(new Error('audit DB down')) }
    const ctrl = makeController({ audit })

    await expect(ctrl.setupMerchantLocation(reqWithIp)).resolves.toEqual(
      expect.objectContaining({ ok: true, locationKey: 'malak-lager-berlin' }),
    )
  })
})
