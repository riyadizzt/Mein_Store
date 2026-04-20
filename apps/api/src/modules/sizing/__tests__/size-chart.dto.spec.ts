/**
 * SizeChart DTO validation tests — Size-Charts Hardening C.
 *
 * Pre-hardening: the controller accepted any shape on POST /sizing/charts
 * and POST /sizing/charts/:id/entries. Garbage like { size: '', bust: -50 }
 * would write directly to the DB. Customers later saw nonsense rows in
 * the size guide.
 *
 * Post-hardening: class-validator DTOs run via the global ValidationPipe
 * (whitelist=true, forbidNonWhitelisted=true) reject malformed input
 * before any business logic runs. These tests prove the constraints fire.
 */

// reflect-metadata must load BEFORE class-validator/class-transformer can
// read decorator metadata. NestJS bootstraps it globally via main.ts but
// jest spec files don't go through that path — so we import it explicitly
// here. Without it, all decorator-based DTOs throw "Reflect.getMetadata is
// not a function" on import.
import 'reflect-metadata'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import {
  CreateSizeChartDto,
  SizeChartEntryDto,
  BulkUpsertEntriesDto,
} from '../dto/size-chart.dto'

describe('SizeChartEntryDto', () => {
  it('accepts a well-formed entry', async () => {
    const dto = plainToInstance(SizeChartEntryDto, {
      size: 'M',
      sortOrder: 1,
      bust: 92,
      waist: 76,
      hip: 100,
    })
    const errors = await validate(dto)
    expect(errors).toEqual([])
  })

  it('rejects empty size', async () => {
    const dto = plainToInstance(SizeChartEntryDto, { size: '' })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'size')).toBe(true)
  })

  it('rejects size with disallowed characters', async () => {
    // Backslash + emoji + non-printables — not allowed
    const dto = plainToInstance(SizeChartEntryDto, { size: 'M\\<script>' })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'size')).toBe(true)
  })

  it('rejects negative measurements', async () => {
    const dto = plainToInstance(SizeChartEntryDto, { size: 'M', bust: -10 })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'bust')).toBe(true)
  })

  it('rejects measurements above the 250cm sanity ceiling', async () => {
    const dto = plainToInstance(SizeChartEntryDto, { size: 'M', bust: 300 })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'bust')).toBe(true)
  })

  it('rejects measurements below the 10cm sanity floor', async () => {
    // Realistic floor — even baby clothes start above 10cm
    const dto = plainToInstance(SizeChartEntryDto, { size: 'XS', bust: 5 })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'bust')).toBe(true)
  })

  it('accepts size with allowed punctuation (slash, dot, dash)', async () => {
    // Real-world sizes: "M/L", "10.5", "EU-38"
    for (const size of ['M/L', '10.5', 'EU-38', '4-6', 'XL']) {
      const dto = plainToInstance(SizeChartEntryDto, { size })
      const errors = await validate(dto)
      expect(errors).toEqual([])
    }
  })
})

describe('CreateSizeChartDto', () => {
  it('accepts a minimal valid chart', async () => {
    const dto = plainToInstance(CreateSizeChartDto, {
      name: 'Damen Tops',
      chartType: 'tops',
    })
    const errors = await validate(dto)
    expect(errors).toEqual([])
  })

  it('rejects invalid chartType', async () => {
    const dto = plainToInstance(CreateSizeChartDto, {
      name: 'Test',
      chartType: 'random-junk',
    })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'chartType')).toBe(true)
  })

  it('rejects empty name', async () => {
    const dto = plainToInstance(CreateSizeChartDto, {
      name: '',
      chartType: 'tops',
    })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'name')).toBe(true)
  })

  it('rejects fitNote longer than 500 chars', async () => {
    const dto = plainToInstance(CreateSizeChartDto, {
      name: 'Test',
      chartType: 'tops',
      fitNote: 'x'.repeat(501),
    })
    const errors = await validate(dto)
    expect(errors.some((e) => e.property === 'fitNote')).toBe(true)
  })
})

describe('BulkUpsertEntriesDto', () => {
  it('rejects entry with bad size in array', async () => {
    const dto = plainToInstance(BulkUpsertEntriesDto, {
      entries: [
        { size: 'M', bust: 90 },
        { size: '', bust: 95 }, // bad
      ],
    })
    const errors = await validate(dto, { whitelist: true })
    // Nested validation should propagate up — at minimum the array errors
    // contain the bad child's error chain
    const flat = JSON.stringify(errors)
    expect(flat.toLowerCase()).toMatch(/size/)
  })
})
