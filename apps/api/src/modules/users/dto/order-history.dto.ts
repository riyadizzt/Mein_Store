import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator'
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
}
