import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { CategoriesService } from './categories.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { Language } from '@omnichannel/types'

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Alle Kategorien (mit Unterkategorien)' })
  @ApiQuery({ name: 'lang', enum: ['ar', 'en', 'de'], required: false })
  findAll(@Query('lang') lang: Language = 'de') {
    return this.categoriesService.findAll(lang)
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
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id)
  }
}
