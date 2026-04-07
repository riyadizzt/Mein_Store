import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common'
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiQuery, ApiParam,
} from '@nestjs/swagger'
import { ProductsService } from './products.service'
import { CreateProductDto } from './dto/create-product.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { Language } from '@omnichannel/types'

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // ── Public ──────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Produktliste (gefiltert, paginiert)' })
  @ApiQuery({ name: 'lang', enum: ['ar', 'en', 'de'], required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'gender', enum: ['men', 'women', 'kids', 'unisex'], required: false })
  @ApiQuery({ name: 'brand', required: false })
  @ApiQuery({ name: 'minPrice', required: false, type: Number })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number })
  @ApiQuery({ name: 'isFeatured', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @Query('lang') lang: Language = 'de',
    @Query('categoryId') categoryId?: string,
    @Query('gender') gender?: string,
    @Query('brand') brand?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('isFeatured') isFeatured?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productsService.findAll({
      lang,
      categoryId,
      gender,
      brand,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      isFeatured: isFeatured !== undefined ? isFeatured === 'true' : undefined,
      sort,
      page: page ? Number(page) : 1,
      limit: limit ? Math.min(Number(limit), 100) : 20,
    })
  }

  @Get('search')
  @ApiOperation({ summary: 'Volltextsuche (AR/EN/DE)' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'lang', enum: ['ar', 'en', 'de'], required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  search(
    @Query('q') query: string,
    @Query('lang') lang: Language = 'de',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productsService.search(
      query,
      lang,
      page ? Number(page) : 1,
      limit ? Math.min(Number(limit), 100) : 20,
    )
  }

  @Post('stock-check')
  @ApiOperation({ summary: 'Stock availability for variant IDs' })
  @HttpCode(HttpStatus.OK)
  async stockCheck(@Body('variantIds') variantIds: string[]) {
    if (!variantIds?.length || !Array.isArray(variantIds)) return {}
    // Sanitize: only strings, max 50, max 36 chars each (UUID length)
    const clean = variantIds.filter((id) => typeof id === 'string' && id.length <= 36).slice(0, 50)
    if (clean.length === 0) return {}
    return this.productsService.checkStock(clean)
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Einzelnes Produkt nach Slug' })
  @ApiParam({ name: 'slug', example: 'klassische-lederjacke' })
  @ApiQuery({ name: 'lang', enum: ['ar', 'en', 'de'], required: false })
  findOne(
    @Param('slug') slug: string,
    @Query('lang') lang: Language = 'de',
  ) {
    return this.productsService.findOne(slug, lang)
  }

  // ── Admin ────────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Produkt erstellen' })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto)
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Produkt aktualisieren' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateProductDto>) {
    return this.productsService.update(id, dto)
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Produkt deaktivieren (Soft Delete)' })
  remove(@Param('id') id: string) {
    return this.productsService.remove(id)
  }
}
