import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware'

export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest()
    return req.headers[CORRELATION_ID_HEADER] as string
  },
)
