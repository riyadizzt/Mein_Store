import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { CategoriesService } from './categories.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { AuditService } from '../admin/services/audit.service'
import type { Request } from 'express'
import { Language } from '@omnichannel/types'

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Alle Kategorien (mit Unterkategorien)' })
  @ApiQuery({ name: 'lang', enum: ['ar', 'en', 'de'], required: false })
  findAll(@Query('lang') lang: Language = 'de') {
    return this.categoriesService.findAll(lang)
  }

  @Get('admin/:id/impact')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '[Admin] Dry-run: what dependencies would block an archive?',
  })
  getImpact(@Param('id') id: string) {
    return this.categoriesService.getImpact(id)
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Einzelne Kategorie nach Slug' })
  @ApiQuery({ name: 'lang', enum: ['ar', 'en', 'de'], required: false })
  findOne(@Param('slug') slug: string, @Query('lang') lang: Language = 'de') {
    return this.categoriesService.findOne(slug, lang)
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Kategorie erstellen' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto)
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Kategorie aktualisieren' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateCategoryDto>) {
    return this.categoriesService.update(id, dto)
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Kategorie deaktivieren (Soft Delete)' })
  async remove(@Param('id') id: string, @Req() req: Request) {
    const adminId = (req as any).user?.id ?? 'system'
    const ipAddress = req.ip
    try {
      const result = await this.categoriesService.remove(id)
      // Swallow audit failures — a failed audit-log write must never
      // mask a successful business operation.
      await this.audit
        .log({
          adminId,
          action: 'CATEGORY_ARCHIVED',
          entityType: 'category',
          entityId: id,
          changes: { after: { isActive: false, slug: result.slug } },
          ipAddress,
        })
        .catch(() => {
          /* intentional: audit failure is non-blocking */
        })
      return result
    } catch (e: any) {
      // Archive was blocked by attached resources — audit the attempt
      // so the admin has a record of what they tried AND what stopped
      // them. The ConflictException bubbles up as the actual HTTP 409.
      const response = e?.response
      if (response?.error === 'CategoryHasAttachedResources') {
        await this.audit
          .log({
            adminId,
            action: 'CATEGORY_ARCHIVE_BLOCKED',
            entityType: 'category',
            entityId: id,
            changes: { after: { blockers: response.data?.blockers } },
            ipAddress,
          })
          .catch(() => {
            /* intentional: audit failure is non-blocking */
          })
      }
      throw e
    }
  }
}
