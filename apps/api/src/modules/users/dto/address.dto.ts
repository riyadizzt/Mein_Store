import { IsString, IsOptional, IsBoolean, IsIn, MaxLength, MinLength } from 'class-validator'

// Country whitelist — must correspond to active ShippingZones
export const ALLOWED_COUNTRIES = ['DE', 'AT', 'CH', 'NL', 'BE', 'LU', 'FR', 'PL']

// Per-country PLZ validation patterns
const PLZ_PATTERNS: Record<string, RegExp> = {
  DE: /^\d{5}$/,
  AT: /^\d{4}$/,
  CH: /^\d{4}$/,
  NL: /^\d{4}\s?[A-Z]{2}$/i,
  BE: /^\d{4}$/,
  LU: /^\d{4}$/,
  FR: /^\d{5}$/,
  PL: /^\d{2}-\d{3}$/,
}

export function validatePostalCode(postalCode: string, country: string): boolean {
  const pattern = PLZ_PATTERNS[country]
  if (!pattern) return true // unknown country — skip validation
  return pattern.test(postalCode)
}

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string

  @IsString()
  @MaxLength(50)
  firstName!: string

  @IsString()
  @MaxLength(50)
  lastName!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  company?: string

  @IsString()
  @MaxLength(100)
  street!: string

  @IsString()
  @MaxLength(20)
  houseNumber!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressLine2?: string

  @IsString()
  @MaxLength(100)
  city!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string

  @IsString()
  @MinLength(3)
  @MaxLength(12)
  postalCode!: string

  @IsIn(ALLOWED_COUNTRIES)
  country!: string

  @IsOptional()
  @IsBoolean()
  isDefaultShipping?: boolean

  @IsOptional()
  @IsBoolean()
  isDefaultBilling?: boolean
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  company?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  street?: string

  @IsOptional()
  @IsString()
  @MaxLength(20)
  houseNumber?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressLine2?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(12)
  postalCode?: string

  @IsOptional()
  @IsIn(ALLOWED_COUNTRIES)
  country?: string

  @IsOptional()
  @IsBoolean()
  isDefaultShipping?: boolean

  @IsOptional()
  @IsBoolean()
  isDefaultBilling?: boolean
}
