/**
 * eBay Category Matcher — admin HTTP surface.
 *
 * Behind JwtAuthGuard + PermissionGuard(SETTINGS_EDIT). Write-heavy
 * page semantically (taxonomy maintenance), not read-only — so the
 * same permission both the GET and POST require `settings.edit`.
 */

import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import type { Request } from 'express'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { PermissionGuard } from '../../../common/permissions/permission.guard'
import { RequirePermission } from '../../../common/permissions/require-permission.decorator'
import { PERMISSIONS } from '../../../common/permissions/permission.constants'
import { EbayCategoryMatcherService } from './ebay-category-matcher.service'

@ApiTags('eBay Category Matcher')
@Controller('admin/ebay/category-mapping')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EbayCategoryMatcherController {
  constructor(private readonly matcher: EbayCategoryMatcherService) {}

  @Get()
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Fetch eBay suggestions for all active categories' })
  async getAllMappings() {
    return this.matcher.fetchSuggestionsForAllActive()
  }

  @Post()
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Batch-save ebayCategoryId for multiple categories' })
  async saveMappings(
    @Body()
    body: { mappings?: Array<{ categoryId: string; ebayCategoryId: string | null }> },
    @Req() req: Request,
  ) {
    if (!Array.isArray(body?.mappings)) {
      throw new BadRequestException({
        error: 'InvalidBody',
        message: {
          de: 'Body muss ein Objekt mit `mappings`-Array enthalten.',
          en: 'Body must be an object with a `mappings` array.',
          ar: 'يجب أن يحتوي الجسم على كائن يحتوي على مصفوفة `mappings`.',
        },
      })
    }
    const adminId = (req as any).user?.id ?? 'system'
    return this.matcher.saveMappings(body.mappings, adminId)
  }
}
