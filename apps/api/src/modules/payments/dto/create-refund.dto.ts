import { IsString, IsOptional, IsNumber, IsUUID, Min } from 'class-validator'

export class CreateRefundDto {
  @IsUUID()
  paymentId!: string

  @IsNumber()
  @Min(1)
  amount!: number // in cents

  @IsOptional()
  @IsString()
  reason?: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
