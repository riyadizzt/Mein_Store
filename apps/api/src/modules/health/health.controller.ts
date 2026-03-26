import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { PrismaService } from '../../prisma/prisma.service'

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'System Health Check' })
  async check() {
    const checks = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unknown',
        api: 'ok',
      },
    }

    try {
      await this.prisma.$queryRaw`SELECT 1`
      checks.services.database = 'ok'
    } catch {
      checks.services.database = 'error'
      checks.status = 'degraded'
    }

    return checks
  }
}
