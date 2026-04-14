import { IsOptional, IsString, IsInt, IsIn, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class OrderHistoryQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string // base64(JSON{id, createdAt})

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20

  // Bucket partition for the account page:
  //   - 'active'          → confirmed and later (normal order history)
  //   - 'waiting_payment' → pending / pending_payment (customer has not paid yet)
  //   - 'all'             → everything (default, backward-compatible)
  @IsOptional()
  @IsIn(['active', 'waiting_payment', 'all'])
  bucket?: 'active' | 'waiting_payment' | 'all' = 'all'
}
