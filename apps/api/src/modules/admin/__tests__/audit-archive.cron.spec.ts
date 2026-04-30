/**
 * AuditArchiveCron (C15.1) unit tests.
 *
 * Pins down (C14 cron-spec pattern):
 *   - tick() delegates to runArchiveTick()
 *   - Cron tick method exists on the prototype
 *   - Service exception bubbles to SafeCron crash-event emitter
 */

import 'reflect-metadata'
import { AuditArchiveCron } from '../cron/audit-archive.cron'

function makeCron(tickImpl?: jest.Mock) {
  const archiveService = {
    runArchiveTick:
      tickImpl ??
      jest.fn().mockResolvedValue({
        ephemeralDeleted: 0,
        operationalArchived: 0,
        raceSkipped: 0,
        r2UploadOk: null,
        r2StorageKey: null,
        r2SizeBytes: null,
        r2Error: null,
        durationMs: 1,
      }),
  } as any
  return { cron: new AuditArchiveCron(archiveService), archiveService }
}

describe('AuditArchiveCron', () => {
  it('tick() delegates to runArchiveTick', async () => {
    const tick = jest.fn().mockResolvedValue({
      ephemeralDeleted: 100,
      operationalArchived: 0,
      raceSkipped: 0,
      r2UploadOk: null,
      r2StorageKey: null,
      r2SizeBytes: null,
      r2Error: null,
      durationMs: 5,
    })
    const { cron, archiveService } = makeCron(tick)
    await cron.tick()
    expect(archiveService.runArchiveTick).toHaveBeenCalledTimes(1)
  })

  it('cron tick method exists on the class prototype', () => {
    expect(typeof AuditArchiveCron.prototype.tick).toBe('function')
  })

  it('service throw bubbles up — SafeCron handles crash-event emission', async () => {
    const tick = jest.fn().mockRejectedValue(new Error('archive crash'))
    const { cron } = makeCron(tick)
    await expect(cron.tick()).rejects.toThrow(/archive crash/)
  })
})
