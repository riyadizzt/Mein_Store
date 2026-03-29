import { IsString, IsEnum, IsOptional, IsUUID } from 'class-validator'
import { PaymentMethod } from '@prisma/client'

export class CreatePaymentDto {
  @IsUUID()
  orderId!: string

  @IsEnum(PaymentMethod)
  method!: PaymentMethod

  @IsOptional()
  @IsString()
  idempotencyKey?: string

  @IsOptional()
  @IsString()
  returnUrl?: string
}
