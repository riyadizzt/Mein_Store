import {
  IsString, IsOptional, IsInt, IsBoolean, IsNumber, IsIn, IsArray,
  MinLength, MaxLength, Min, Max, ValidateNested, Matches,
} from 'class-validator'
import { Type } from 'class-transformer'

// Allowed chart types — must match SizeChartType enum in schema.prisma.
const CHART_TYPES = ['tops', 'bottoms', 'dresses', 'shoes', 'kids', 'accessories'] as const

// Body-measurement plausibility. Covers:
//   - children (bust 40–70 cm, bodyHeight 60–180 cm)
//   - adults (bust 70–180 cm, waist 50–200 cm, hip 60–200 cm)
//   - shoes (footLength 10–40 cm)
// Anything outside means a typo or unit mixup (cm vs mm). Rejecting
// early keeps the recommendation engine's `Math.abs(Σ delta)` math
// from producing nonsense scores on polluted data.
const MEASUREMENT_MIN = 10
const MEASUREMENT_MAX = 250

/**
 * Size-Chart ENTRY (one row per size). Measurements are optional
 * because not every chart-type uses every field (shoes don't need
 * bust; tops don't need footLength).
 */
export class SizeChartEntryDto {
  @IsString()
  @MinLength(1, { message: 'size label must not be empty' })
  @MaxLength(20, { message: 'size label must be 1–20 characters' })
  @Matches(/^[A-Za-z0-9\- /.]+$/, {
    message: 'size label may only contain letters, digits, dash, slash, dot, space',
  })
    size!: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
    sortOrder?: number

  @IsOptional() @IsNumber() @Min(MEASUREMENT_MIN) @Max(MEASUREMENT_MAX)
    bust?: number

  @IsOptional() @IsNumber() @Min(MEASUREMENT_MIN) @Max(MEASUREMENT_MAX)
    waist?: number

  @IsOptional() @IsNumber() @Min(MEASUREMENT_MIN) @Max(MEASUREMENT_MAX)
    hip?: number

  @IsOptional() @IsNumber() @Min(MEASUREMENT_MIN) @Max(MEASUREMENT_MAX)
    length?: number

  @IsOptional() @IsNumber() @Min(MEASUREMENT_MIN) @Max(MEASUREMENT_MAX)
    inseam?: number

  @IsOptional() @IsNumber() @Min(MEASUREMENT_MIN) @Max(MEASUREMENT_MAX)
    shoulder?: number

  @IsOptional() @IsNumber() @Min(MEASUREMENT_MIN) @Max(MEASUREMENT_MAX)
    sleeve?: number

  @IsOptional() @IsNumber() @Min(MEASUREMENT_MIN) @Max(MEASUREMENT_MAX)
    footLength?: number

  @IsOptional() @IsNumber() @Min(MEASUREMENT_MIN) @Max(MEASUREMENT_MAX)
    bodyHeight?: number

  @IsOptional() @IsString() @MaxLength(10)
    euSize?: string
}

export class CreateSizeChartDto {
  @IsString()
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(255)
    name!: string

  @IsOptional() @IsString()
    supplierId?: string

  @IsOptional() @IsString()
    categoryId?: string

  @IsString()
  @IsIn(CHART_TYPES as unknown as string[], {
    message: `chartType must be one of: ${CHART_TYPES.join(', ')}`,
  })
    chartType!: string

  @IsOptional() @IsString() @MaxLength(500)
    fitNote?: string

  @IsOptional() @IsString() @MaxLength(500)
    fitNoteAr?: string

  @IsOptional() @IsString() @MaxLength(500)
    fitNoteEn?: string

  @IsOptional() @IsBoolean()
    isDefault?: boolean

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SizeChartEntryDto)
    entries?: SizeChartEntryDto[]
}

export class UpdateSizeChartDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255)
    name?: string

  @IsOptional() @IsString()
    supplierId?: string

  @IsOptional() @IsString()
    categoryId?: string

  @IsOptional() @IsString()
  @IsIn(CHART_TYPES as unknown as string[])
    chartType?: string

  @IsOptional() @IsString() @MaxLength(500)
    fitNote?: string

  @IsOptional() @IsString() @MaxLength(500)
    fitNoteAr?: string

  @IsOptional() @IsString() @MaxLength(500)
    fitNoteEn?: string

  @IsOptional() @IsBoolean()
    isDefault?: boolean
}

export class BulkUpsertEntriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SizeChartEntryDto)
    entries!: SizeChartEntryDto[]
}
