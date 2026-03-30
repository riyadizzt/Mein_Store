import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Ip,
  Res,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { DashboardService } from './services/dashboard.service'
import { AdminOrdersService } from './services/admin-orders.service'
import { AdminUsersService } from './services/admin-users.service'
import { AdminProductsService } from './services/admin-products.service'
import { AdminInventoryService } from './services/admin-inventory.service'
import { AdminReturnsService } from './services/admin-returns.service'
import { AdminStaffService } from './services/admin-staff.service'
import { AuditService } from './services/audit.service'
import { EmailService } from '../email/email.service'
import { StorageService } from '../../common/services/storage.service'
import { PrismaService } from '../../prisma/prisma.service'

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class AdminController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly orders: AdminOrdersService,
    private readonly users: AdminUsersService,
    private readonly products: AdminProductsService,
    private readonly inventory: AdminInventoryService,
    private readonly returns: AdminReturnsService,
    private readonly staff: AdminStaffService,
    private readonly audit: AuditService,
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ── Dashboard ─────────────────────────────────────────────

  @Get('dashboard')
  getDashboard() {
    return this.dashboard.getOverview()
  }

  // ── Notifications ────────────────────────────────────────
  @Get('notifications')
  async getNotifications() {
    const [newOrders, disputes, lowStock, pendingReturns, failedPayments] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: { in: ['pending', 'confirmed'] }, deletedAt: null, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        select: { id: true, orderNumber: true, totalAmount: true, createdAt: true, user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' }, take: 10,
      }),
      this.prisma.order.findMany({
        where: { status: 'disputed', deletedAt: null },
        select: { id: true, orderNumber: true, totalAmount: true, createdAt: true, user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' }, take: 5,
      }),
      this.prisma.inventory.findMany({
        where: { quantityOnHand: { lte: 5 } },
        select: { id: true, quantityOnHand: true, quantityReserved: true, reorderPoint: true,
          variant: { select: { sku: true, color: true, size: true, product: { select: { translations: { select: { name: true, language: true } } } } } } },
        take: 10,
      }),
      this.prisma.return.findMany({
        where: { status: { in: ['requested', 'in_transit'] } },
        select: { id: true, reason: true, createdAt: true, order: { select: { orderNumber: true, user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'desc' }, take: 5,
      }),
      this.prisma.payment.findMany({
        where: { status: 'failed', createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
        select: { id: true, orderId: true, provider: true, createdAt: true, order: { select: { orderNumber: true } } },
        orderBy: { createdAt: 'desc' }, take: 5,
      }),
    ])

    const items: any[] = []

    for (const o of newOrders) {
      items.push({
        id: `order-${o.id}`, type: 'new_order', entityType: 'order', entityId: o.id, createdAt: o.createdAt,
        orderNumber: o.orderNumber, amount: Number(o.totalAmount).toFixed(2),
        customer: `${o.user?.firstName ?? ''} ${o.user?.lastName ?? ''}`.trim(),
      })
    }
    for (const d of disputes) {
      items.push({
        id: `dispute-${d.id}`, type: 'dispute', entityType: 'order', entityId: d.id, createdAt: d.createdAt,
        orderNumber: d.orderNumber, amount: Number(d.totalAmount).toFixed(2),
        customer: `${d.user?.firstName ?? ''} ${d.user?.lastName ?? ''}`.trim(),
      })
    }
    for (const inv of lowStock) {
      const avail = inv.quantityOnHand - inv.quantityReserved
      if (avail <= inv.reorderPoint) {
        const names: Record<string, string> = {}
        for (const t of inv.variant?.product?.translations ?? []) names[t.language] = t.name
        items.push({
          id: `stock-${inv.id}`, type: 'low_stock', entityType: 'inventory', entityId: inv.id, createdAt: new Date(),
          productName: names, available: avail, color: inv.variant?.color, size: inv.variant?.size,
        })
      }
    }
    for (const r of pendingReturns) {
      items.push({
        id: `return-${r.id}`, type: 'return', entityType: 'return', entityId: r.id, createdAt: r.createdAt,
        orderNumber: r.order?.orderNumber, reason: r.reason,
        customer: `${r.order?.user?.firstName ?? ''} ${r.order?.user?.lastName ?? ''}`.trim(),
      })
    }
    for (const p of failedPayments) {
      items.push({
        id: `payment-${p.id}`, type: 'payment_failed', entityType: 'order', entityId: p.orderId, createdAt: p.createdAt,
        orderNumber: p.order?.orderNumber, provider: p.provider,
      })
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return { items: items.slice(0, 20), total: items.length }
  }

  // ── Orders ────────────────────────────────────────────────

  @Get('orders')
  getOrders(
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.orders.findAll({ status, dateFrom, dateTo, search, limit: limit ? +limit : 20 })
  }

  @Get('orders/export/csv')
  async exportOrdersCsv(@Res({ passthrough: true }) res: any) {
    const orders = await this.orders.findAll({ limit: 1000 })
    const header = 'Bestellnummer;Datum;Kunde;E-Mail;Status;Netto;MwSt;Brutto;Zahlungsart;Versand\n'
    const rows = (orders ?? []).map((o: any) =>
      `${o.orderNumber};${new Date(o.createdAt).toLocaleDateString('de-DE')};${o.user?.firstName ?? ''} ${o.user?.lastName ?? ''};${o.user?.email ?? ''};${o.status};${o.subtotal};${o.taxAmount};${o.totalAmount};${o.payment?.provider ?? ''};${o.shipment?.trackingNumber ?? ''}`
    ).join('\n')
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=bestellungen.csv' })
    return header + rows
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findOne(id)
  }

  @Patch('orders/:id/status')
  updateOrderStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
    @Body('notes') notes: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.orders.updateStatus(id, status, notes, req.user.id, ip)
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.orders.cancelWithRefund(id, reason, req.user.id, ip)
  }

  @Post('orders/:id/notes')
  @HttpCode(HttpStatus.CREATED)
  addOrderNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('content') content: string,
    @Req() req: any,
  ) {
    return this.orders.addNote(id, content, req.user.id)
  }

  @Patch('orders/:id/fulfillment')
  changeFulfillment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('warehouseId') warehouseId: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.orders.changeFulfillmentWarehouse(id, warehouseId, req.user.id, ip)
  }

  // ── Customers / Users ──────────────────────────────────────

  @Get('customers/stats')
  getCustomerStats() {
    return this.users.getCustomerStats()
  }

  @Get('customers/export')
  async exportCustomersCsv(
    @Query('filter') filter?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
    @Res({ passthrough: true }) res?: any,
  ) {
    const csv = await this.users.exportCsv({ filter, tag, search })
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=kunden.csv' })
    return csv
  }

  @Get('customers')
  getCustomers(
    @Query('search') search?: string,
    @Query('filter') filter?: string,
    @Query('lang') lang?: string,
    @Query('tag') tag?: string,
    @Query('ordersMin') ordersMin?: string,
    @Query('ordersMax') ordersMax?: string,
    @Query('revenueMin') revenueMin?: string,
    @Query('revenueMax') revenueMax?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.users.findAll({
      search, filter, lang, tag,
      ordersMin: ordersMin ? +ordersMin : undefined,
      ordersMax: ordersMax ? +ordersMax : undefined,
      revenueMin: revenueMin ? +revenueMin : undefined,
      revenueMax: revenueMax ? +revenueMax : undefined,
      dateFrom, dateTo, sortBy, sortDir,
      limit: limit ? +limit : 25,
      offset: offset ? +offset : 0,
    })
  }

  @Post('customers')
  @HttpCode(HttpStatus.CREATED)
  createCustomer(
    @Body() body: { email: string; firstName: string; lastName: string; phone?: string; lang?: string; notes?: string; tags?: string[] },
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.users.createCustomer(body, req.user.id, ip)
  }

  @Get('customers/:id')
  getCustomer(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id)
  }

  @Patch('customers/:id')
  updateCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { firstName?: string; lastName?: string; phone?: string; preferredLang?: string; tags?: string[] },
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.users.updateCustomer(id, body, req.user.id, ip)
  }

  @Delete('customers/:id')
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  deleteCustomer(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.users.deleteCustomer(id, req.user.id, ip)
  }

  @Get('customers/:id/activity')
  getCustomerActivity(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getActivity(id)
  }

  @Get('customers/:id/emails')
  getCustomerEmails(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getEmailHistory(id)
  }

  @Get('customers/:id/cart')
  getCustomerCart(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getAbandonedCarts(id)
  }

  @Get('customers/:id/export')
  exportCustomerData(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.exportCustomerData(id)
  }

  @Post('customers/:id/notes')
  @HttpCode(HttpStatus.CREATED)
  addCustomerNote(@Param('id', ParseUUIDPipe) id: string, @Body('content') content: string, @Req() req: any) {
    return this.users.addNote(id, content, req.user.id)
  }

  @Patch('customers/:id/notes/:noteId')
  updateCustomerNote(@Param('noteId', ParseUUIDPipe) noteId: string, @Body('content') content: string) {
    return this.users.updateNote(noteId, content)
  }

  @Delete('customers/:id/notes/:noteId')
  @HttpCode(HttpStatus.OK)
  deleteCustomerNote(@Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.users.deleteNote(noteId)
  }

  @Post('customers/:id/email')
  @HttpCode(HttpStatus.OK)
  sendCustomerEmail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('subject') subject: string,
    @Body('body') body: string,
    @Req() req: any, @Ip() ip: string,
  ) {
    return this.users.sendEmail(id, subject, body, req.user.id, ip)
  }

  @Post('customers/:id/block')
  @HttpCode(HttpStatus.OK)
  blockCustomer(@Param('id', ParseUUIDPipe) id: string, @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.users.blockUser(id, reason, req.user.id, ip)
  }

  @Post('customers/:id/unblock')
  @HttpCode(HttpStatus.OK)
  unblockCustomer(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.users.unblockUser(id, req.user.id, ip)
  }

  @Post('customers/:id/tags')
  @HttpCode(HttpStatus.OK)
  setCustomerTags(@Param('id', ParseUUIDPipe) id: string, @Body('tags') tags: string[], @Req() req: any, @Ip() ip: string) {
    return this.users.setTags(id, tags, req.user.id, ip)
  }

  @Post('customers/bulk-email')
  @HttpCode(HttpStatus.OK)
  bulkEmail(@Body('userIds') userIds: string[], @Body('subject') subject: string, @Body('body') body: string, @Req() req: any, @Ip() ip: string) {
    return this.users.bulkEmail(userIds, subject, body, req.user.id, ip)
  }

  @Post('customers/bulk-tag')
  @HttpCode(HttpStatus.OK)
  bulkTag(@Body('userIds') userIds: string[], @Body('tags') tags: string[], @Req() req: any, @Ip() ip: string) {
    return this.users.bulkTag(userIds, tags, req.user.id, ip)
  }

  @Post('customers/bulk-block')
  @HttpCode(HttpStatus.OK)
  bulkBlock(@Body('userIds') userIds: string[], @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.users.bulkBlock(userIds, reason, req.user.id, ip)
  }

  @Post('customers/bulk-unblock')
  @HttpCode(HttpStatus.OK)
  bulkUnblock(@Body('userIds') userIds: string[], @Req() req: any, @Ip() ip: string) {
    return this.users.bulkUnblock(userIds, req.user.id, ip)
  }

  @Post('customers/:id/cart/:cartId/reminder')
  @HttpCode(HttpStatus.OK)
  sendCartReminder(@Param('cartId', ParseUUIDPipe) cartId: string, @Req() req: any) {
    return this.users.sendCartReminder(cartId, req.user.id)
  }

  // Keep legacy /admin/users endpoints for backward compat
  @Get('users')
  getUsers(
    @Query('search') search?: string, @Query('filter') filter?: string,
    @Query('sortBy') sortBy?: string, @Query('sortDir') sortDir?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.users.findAll({ search, filter, sortBy, sortDir, limit: limit ? +limit : 25, offset: offset ? +offset : 0 })
  }

  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string) { return this.users.findOne(id) }

  // ── Products ──────────────────────────────────────────────

  @Get('products/export')
  async exportProductsCsv(@Res({ passthrough: true }) res: any) {
    const csv = await this.products.exportCsv()
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=produkte.csv' })
    return csv
  }

  @Get('products/check-duplicate')
  checkDuplicate(
    @Query('name') name?: string, @Query('sku') sku?: string,
    @Query('barcode') barcode?: string, @Query('excludeId') excludeId?: string,
  ) {
    return this.products.checkDuplicate({ name, sku, barcode, excludeId })
  }

  @Get('products/next-sku')
  getNextSku(@Query('prefix') prefix: string) {
    return this.products.getNextSku(prefix).then((sku) => ({ sku }))
  }

  @Get('products')
  getProducts(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('categoryId') categoryId?: string,
    @Query('parentCategoryId') parentCategoryId?: string,
    @Query('stockStatus') stockStatus?: string,
    @Query('priceMin') priceMin?: string,
    @Query('priceMax') priceMax?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.products.findAll({
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      categoryId, parentCategoryId, stockStatus,
      priceMin: priceMin ? +priceMin : undefined,
      priceMax: priceMax ? +priceMax : undefined,
      sortBy, sortDir,
      limit: limit ? +limit : 25,
      offset: offset ? +offset : 0,
    })
  }

  @Get('products/:id')
  getProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(id)
  }

  @Patch('products/:id/price')
  updateProductPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('basePrice') basePrice: number,
    @Body('salePrice') salePrice: number | null,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.products.updatePrice(id, basePrice, salePrice, req.user.id, ip)
  }

  @Post('products/bulk/status')
  @HttpCode(HttpStatus.OK)
  bulkUpdateProductStatus(
    @Body('productIds') productIds: string[],
    @Body('isActive') isActive: boolean,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.products.bulkUpdateStatus(productIds, isActive, req.user.id, ip)
  }

  @Delete('products/bulk')
  @HttpCode(HttpStatus.OK)
  bulkDeleteProducts(
    @Body('productIds') productIds: string[],
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.products.bulkDelete(productIds, req.user.id, ip)
  }

  @Post('products/:id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  duplicateProduct(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.products.duplicate(id, req.user.id, ip)
  }

  @Get('products/:id/variant-options')
  getVariantOptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.getProductVariantOptions(id)
  }

  @Get('products/:id/images')
  getProductImages(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.getProductImages(id)
  }

  @Post('products/:id/images')
  @HttpCode(HttpStatus.CREATED)
  addProductImage(@Param('id', ParseUUIDPipe) id: string, @Body('url') url: string, @Body('colorName') colorName?: string) {
    return this.products.addImageUrl(id, url, colorName)
  }

  @Post('products/:id/images/upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'), false)
      cb(null, true)
    },
  }))
  async uploadProductImage(
    @Param('id', ParseUUIDPipe) productId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('colorName') colorName?: string,
  ) {
    // Upload to Supabase Storage (optimized WebP + thumbnail)
    const { url } = await this.storage.uploadProductImage(
      productId, file.buffer, file.originalname, colorName || undefined,
    )

    // Save to DB
    return this.products.addImageUrl(productId, url, colorName || undefined)
  }

  @Patch('products/images/:imageId/color')
  assignImageColor(@Param('imageId', ParseUUIDPipe) imageId: string, @Body('colorName') colorName: string | null) {
    return this.products.assignImageToColor(imageId, colorName)
  }

  @Delete('products/images/:imageId')
  @HttpCode(HttpStatus.OK)
  deleteProductImage(@Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.prisma.productImage.delete({ where: { id: imageId } }).then(() => ({ deleted: true }))
  }

  @Post('products/:id/variants/add-color')
  @HttpCode(HttpStatus.CREATED)
  addColor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { color: string; colorHex: string; sizes: string[]; priceModifier?: number; stock?: Record<string, number>; barcode?: string },
    @Req() req: any, @Ip() ip: string,
  ) {
    return this.products.addColor(id, body, req.user.id, ip)
  }

  @Post('products/:id/variants/add-size')
  @HttpCode(HttpStatus.CREATED)
  addSize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { size: string; colors: string[]; priceModifier?: number; stock?: Record<string, number> },
    @Req() req: any, @Ip() ip: string,
  ) {
    return this.products.addSize(id, body, req.user.id, ip)
  }

  @Patch('products/variants/:variantId')
  updateVariant(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: { priceModifier?: number; barcode?: string; purchasePrice?: number },
    @Req() req: any, @Ip() ip: string,
  ) {
    return this.products.updateVariant(variantId, body, req.user.id, ip)
  }

  @Delete('products/:id/variants/:variantId')
  @HttpCode(HttpStatus.OK)
  deleteVariant(@Param('id', ParseUUIDPipe) id: string, @Param('variantId', ParseUUIDPipe) variantId: string, @Req() req: any, @Ip() ip: string) {
    return this.products.deleteVariant(id, variantId, req.user.id, ip)
  }

  // ── Inventory ─────────────────────────────────────────────

  @Get('inventory/stats')
  getInventoryStats(@Query('warehouseId') warehouseId?: string) { return this.inventory.getStats(warehouseId) }

  @Get('inventory/grouped')
  getInventoryGrouped(
    @Query('warehouseId') warehouseId?: string, @Query('search') search?: string,
    @Query('parentCategoryId') parentCategoryId?: string, @Query('status') status?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.inventory.findAllGrouped({
      warehouseId, search, parentCategoryId, status,
      limit: limit ? +limit : 50, offset: offset ? +offset : 0,
    })
  }

  @Get('inventory/summary')
  getInventorySummary(@Query('warehouseId') warehouseId?: string) { return this.inventory.getDepartmentSummary(warehouseId) }

  @Get('inventory/export')
  async exportInventoryCsv(
    @Query('warehouseId') warehouseId?: string, @Query('categoryId') categoryId?: string,
    @Query('status') status?: string, @Res({ passthrough: true }) res?: any,
  ) {
    const csv = await this.inventory.exportCsv({ warehouseId, categoryId, status })
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=bestand.csv' })
    return csv
  }

  @Get('inventory/barcode/:code')
  lookupBarcode(@Param('code') code: string) { return this.inventory.lookupBarcode(code) }

  @Get('inventory')
  getInventory(
    @Query('warehouseId') warehouseId?: string, @Query('search') search?: string,
    @Query('categoryId') categoryId?: string, @Query('parentCategoryId') parentCategoryId?: string,
    @Query('status') status?: string, @Query('locationId') locationId?: string,
    @Query('priceMin') priceMin?: string, @Query('priceMax') priceMax?: string,
    @Query('outOfStockOnly') outOfStockOnly?: string,
    @Query('sortBy') sortBy?: string, @Query('sortDir') sortDir?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.inventory.findAll({
      warehouseId, search, categoryId, parentCategoryId, status, locationId,
      priceMin: priceMin ? +priceMin : undefined, priceMax: priceMax ? +priceMax : undefined,
      outOfStockOnly: outOfStockOnly === 'true', sortBy, sortDir,
      limit: limit ? +limit : 50, offset: offset ? +offset : 0,
    })
  }

  @Get('warehouses')
  getWarehouses() {
    return this.prisma.warehouse.findMany({
      select: { id: true, name: true, type: true, isDefault: true, address: true, isActive: true },
      orderBy: { isDefault: 'desc' },
    })
  }

  @Post('warehouses')
  @HttpCode(HttpStatus.CREATED)
  createWarehouse(@Body() body: { name: string; type?: string; address?: string }) {
    return this.prisma.warehouse.create({
      data: { name: body.name, type: (body.type as any) ?? 'WAREHOUSE', address: body.address },
    })
  }

  @Patch('warehouses/:id')
  updateWarehouse(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name?: string; type?: string; address?: string; isActive?: boolean }) {
    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.type !== undefined) data.type = body.type
    if (body.address !== undefined) data.address = body.address
    if (body.isActive !== undefined) data.isActive = body.isActive
    return this.prisma.warehouse.update({ where: { id }, data })
  }

  @Delete('warehouses/:id')
  @HttpCode(HttpStatus.OK)
  async deleteWarehouse(@Param('id', ParseUUIDPipe) id: string) {
    // Check if warehouse has inventory
    const count = await this.prisma.inventory.count({ where: { warehouseId: id, quantityOnHand: { gt: 0 } } })
    if (count > 0) {
      return { deleted: false, error: 'warehouse_has_stock', message: { de: `Dieses Lager hat noch ${count} Artikel mit Bestand. Bitte zuerst den Bestand transferieren.`, en: `This warehouse has ${count} items with stock. Please transfer stock first.`, ar: `هذا الموقع يحتوي على ${count} منتج في المخزون. يرجى نقل المخزون أولاً.` } }
    }
    // Don't delete default warehouse
    const wh = await this.prisma.warehouse.findUnique({ where: { id } })
    if (wh?.isDefault) {
      return { deleted: false, error: 'is_default', message: { de: 'Standard-Lager kann nicht gelöscht werden.', en: 'Default warehouse cannot be deleted.', ar: 'لا يمكن حذف الموقع الافتراضي.' } }
    }
    await this.prisma.warehouse.delete({ where: { id } })
    return { deleted: true }
  }

  @Patch('inventory/:id/adjust')
  adjustStock(@Param('id', ParseUUIDPipe) id: string, @Body('quantity') quantity: number, @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.inventory.adjustStock(id, quantity, reason, req.user.id, ip)
  }

  @Patch('inventory/:id/quick')
  quickAdjust(@Param('id', ParseUUIDPipe) id: string, @Body('delta') delta: number, @Req() req: any, @Ip() ip: string) {
    return this.inventory.quickAdjust(id, delta, req.user.id, ip)
  }

  @Patch('inventory/:id/min-max')
  updateMinMax(@Param('id', ParseUUIDPipe) id: string, @Body('reorderPoint') reorderPoint?: number, @Body('maxStock') maxStock?: number) {
    return this.inventory.updateMinMax(id, reorderPoint, maxStock)
  }

  @Post('inventory/intake')
  @HttpCode(HttpStatus.OK)
  stockIntake(@Body('items') items: { inventoryId: string; quantity: number }[], @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.inventory.intake(items, reason, req.user.id, ip)
  }

  @Post('inventory/intake-csv')
  @HttpCode(HttpStatus.OK)
  stockIntakeBySku(@Body('items') items: { sku: string; quantity: number }[], @Body('reason') reason: string, @Body('warehouseId') warehouseId: string | undefined, @Req() req: any, @Ip() ip: string) {
    return this.inventory.intakeBySku(items, reason, req.user.id, ip, warehouseId)
  }

  @Post('inventory/:id/output')
  @HttpCode(HttpStatus.OK)
  stockOutput(@Param('id', ParseUUIDPipe) id: string, @Body('quantity') quantity: number, @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.inventory.output(id, quantity, reason, req.user.id, ip)
  }

  @Post('inventory/:id/transfer')
  @HttpCode(HttpStatus.OK)
  transferStock(@Param('id', ParseUUIDPipe) id: string, @Body('toWarehouseId') toWarehouseId: string, @Body('quantity') quantity: number, @Req() req: any, @Ip() ip: string) {
    return this.inventory.transfer(id, toWarehouseId, quantity, req.user.id, ip)
  }

  @Post('inventory/bulk-adjust')
  @HttpCode(HttpStatus.OK)
  bulkAdjust(@Body('items') items: { inventoryId: string; quantity: number }[], @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.inventory.bulkAdjust(items, reason, req.user.id, ip)
  }

  @Post('inventory/bulk-min-stock')
  @HttpCode(HttpStatus.OK)
  bulkSetMinStock(@Body('inventoryIds') ids: string[], @Body('reorderPoint') reorderPoint: number) {
    return this.inventory.bulkSetMinStock(ids, reorderPoint)
  }

  @Post('inventory/bulk-location')
  @HttpCode(HttpStatus.OK)
  bulkSetLocation(@Body('inventoryIds') ids: string[], @Body('locationId') locationId: string) {
    return this.inventory.bulkSetLocation(ids, locationId)
  }

  @Get('inventory/movements')
  getMovementLog(
    @Query('warehouseId') warehouseId?: string, @Query('type') type?: string,
    @Query('search') search?: string, @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.inventory.getMovementLog({ warehouseId, type, search, limit: limit ? +limit : 50, offset: offset ? +offset : 0 })
  }

  @Get('inventory/:variantId/:warehouseId/history')
  getInventoryHistory(@Param('variantId', ParseUUIDPipe) variantId: string, @Param('warehouseId', ParseUUIDPipe) warehouseId: string) {
    return this.inventory.getHistory(variantId, warehouseId)
  }

  // Locations
  @Get('inventory/locations')
  getLocations(@Query('warehouseId') warehouseId?: string) { return this.inventory.getLocations(warehouseId) }

  @Post('inventory/locations')
  @HttpCode(HttpStatus.CREATED)
  createLocation(@Body() body: { warehouseId: string; name: string; description?: string }, @Req() req: any) {
    return this.inventory.createLocation(body, req.user.id)
  }

  @Patch('inventory/locations/:id')
  updateLocation(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name?: string; description?: string }) {
    return this.inventory.updateLocation(id, body)
  }

  @Delete('inventory/locations/:id')
  @HttpCode(HttpStatus.OK)
  deleteLocation(@Param('id', ParseUUIDPipe) id: string) { return this.inventory.deleteLocation(id) }

  // Stocktake
  @Get('stocktakes')
  getStocktakes() { return this.inventory.getStocktakes() }

  @Post('stocktakes')
  @HttpCode(HttpStatus.CREATED)
  startStocktake(@Body('warehouseId') warehouseId: string, @Body('categoryId') categoryId: string | null, @Req() req: any) {
    return this.inventory.startStocktake(warehouseId, categoryId, req.user.id)
  }

  @Get('stocktakes/:id')
  getStocktake(@Param('id', ParseUUIDPipe) id: string) { return this.inventory.getStocktake(id) }

  @Patch('stocktakes/items/:itemId')
  updateStocktakeItem(@Param('itemId', ParseUUIDPipe) itemId: string, @Body('actualQty') actualQty: number) {
    return this.inventory.updateStocktakeItem(itemId, actualQty)
  }

  @Post('stocktakes/:id/complete')
  @HttpCode(HttpStatus.OK)
  completeStocktake(@Param('id', ParseUUIDPipe) id: string, @Body('applyChanges') applyChanges: boolean, @Req() req: any, @Ip() ip: string) {
    return this.inventory.completeStocktake(id, applyChanges, req.user.id, ip)
  }

  // ── Audit Log ─────────────────────────────────────────────

  @Get('audit-log')
  @Roles('super_admin')
  getAuditLog(
    @Query('adminId') adminId?: string,
    @Query('action') action?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.findAll({
      adminId,
      action,
      page: page ? +page : 1,
      limit: limit ? +limit : 50,
    })
  }

  @Get('audit-log/admins')
  @Roles('super_admin')
  getAuditAdmins() {
    return this.audit.getAdmins()
  }

  @Get('audit-log/actions')
  @Roles('super_admin')
  getAuditActions() {
    return this.audit.getActionTypes()
  }

  // ── Returns ───────────────────────────────────────────

  @Get('returns')
  getReturns(@Query('status') status?: string, @Query('search') search?: string, @Query('limit') limit?: string) {
    return this.returns.findAll({ status, search, limit: limit ? +limit : 50 })
  }

  @Get('returns/:id')
  getReturn(@Param('id', ParseUUIDPipe) id: string) {
    return this.returns.findOne(id)
  }

  @Patch('returns/:id/status')
  updateReturnStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
    @Body('notes') notes: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.returns.updateStatus(id, status, notes, req.user.id, ip)
  }

  @Patch('returns/:id/label')
  updateReturnLabel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('returnTrackingNumber') trackingNumber: string,
    @Body('returnLabelUrl') labelUrl: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.returns.updateLabel(id, trackingNumber, labelUrl, req.user.id, ip)
  }

  // ── Shipments ─────────────────────────────────────────

  @Get('shipments')
  async getShipments(
    @Query('status') status?: string,
    @Query('carrier') carrier?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    const where: any = {}
    if (status) where.status = status
    if (carrier) where.carrier = carrier
    if (search) {
      where.OR = [
        { trackingNumber: { contains: search, mode: 'insensitive' } },
        { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
        { order: { user: { OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ] } } },
      ]
    }
    return this.prisma.shipment.findMany({
      where,
      include: {
        order: {
          select: {
            id: true, orderNumber: true, totalAmount: true, status: true,
            user: { select: { firstName: true, lastName: true, email: true } },
            shippingAddress: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit ? +limit : 50,
    })
  }

  @Get('shipments/:id')
  async getShipment(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.shipment.findUniqueOrThrow({
      where: { id },
      include: {
        order: {
          select: {
            id: true, orderNumber: true, totalAmount: true, status: true, subtotal: true,
            shippingCost: true, taxAmount: true,
            items: { select: { snapshotName: true, snapshotSku: true, quantity: true, unitPrice: true, totalPrice: true,
              variant: { select: { color: true, size: true } } } },
            user: { select: { firstName: true, lastName: true, email: true, phone: true } },
            shippingAddress: true,
          },
        },
      },
    })
  }

  @Patch('shipments/:id/status')
  async updateShipmentStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
    @Body('notes') notes: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    const shipment = await this.prisma.shipment.findUniqueOrThrow({ where: { id } })

    const data: any = { status }
    if (status === 'in_transit' || status === 'picked_up') data.shippedAt = shipment.shippedAt ?? new Date()
    if (status === 'delivered') data.deliveredAt = new Date()

    // Also update order status
    const orderStatusMap: Record<string, string> = {
      in_transit: 'shipped', delivered: 'delivered',
    }

    const updated = await this.prisma.shipment.update({ where: { id }, data })

    if (orderStatusMap[status]) {
      await this.prisma.order.update({
        where: { id: shipment.orderId },
        data: { status: orderStatusMap[status] as any },
      })
    }

    await this.audit.log({
      adminId: req.user.id,
      action: `SHIPMENT_STATUS_${status.toUpperCase()}`,
      entityType: 'shipment', entityId: id,
      changes: { before: { status: shipment.status }, after: { status, notes } },
      ipAddress: ip,
    })
    return updated
  }

  @Patch('shipments/:id/tracking')
  async updateShipmentTracking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('trackingNumber') trackingNumber: string,
    @Body('trackingUrl') trackingUrl: string,
    @Body('labelUrl') labelUrl: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    const data: any = {}
    if (trackingNumber !== undefined) data.trackingNumber = trackingNumber
    if (trackingUrl !== undefined) data.trackingUrl = trackingUrl
    if (labelUrl !== undefined) data.labelUrl = labelUrl
    if (!data.trackingUrl && data.trackingNumber) {
      data.trackingUrl = `https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=${data.trackingNumber}`
    }

    const updated = await this.prisma.shipment.update({ where: { id }, data })
    await this.audit.log({
      adminId: req.user.id, action: 'SHIPMENT_TRACKING_UPDATED',
      entityType: 'shipment', entityId: id,
      changes: { after: data }, ipAddress: ip,
    })
    return updated
  }

  @Post('shipments/batch')
  @HttpCode(HttpStatus.OK)
  async batchCreateShipments(@Req() req: any, @Ip() ip: string) {
    // Find all orders ready to ship (confirmed or processing, no shipment yet)
    const readyOrders = await this.prisma.order.findMany({
      where: {
        status: { in: ['confirmed', 'processing'] },
        shipment: null,
      },
      select: { id: true, orderNumber: true },
      take: 50,
    })

    const results = []
    for (const order of readyOrders) {
      try {
        const shipment = await this.prisma.shipment.create({
          data: { orderId: order.id, carrier: 'dhl', status: 'pending' },
        })
        await this.prisma.order.update({ where: { id: order.id }, data: { status: 'processing' as any } })
        results.push({ orderId: order.id, orderNumber: order.orderNumber, shipmentId: shipment.id, status: 'created' })
      } catch {
        results.push({ orderId: order.id, orderNumber: order.orderNumber, status: 'error' })
      }
    }

    await this.audit.log({
      adminId: req.user.id, action: 'SHIPMENTS_BATCH_CREATED',
      entityType: 'shipment', entityId: 'batch',
      changes: { after: { count: results.filter((r) => r.status === 'created').length } },
      ipAddress: ip,
    })

    return { total: readyOrders.length, created: results.filter((r) => r.status === 'created').length, results }
  }

  // ── Settings ──────────────────────────────────────────

  @Get('settings')
  async getSettings() {
    const rows = await this.prisma.shopSetting.findMany()
    const db: Record<string, string> = {}
    for (const r of rows) db[r.key] = r.value

    return {
      companyName: db.companyName ?? process.env.COMPANY_NAME ?? '',
      companyAddress: db.companyAddress ?? process.env.COMPANY_ADDRESS ?? '',
      companyVatId: db.companyVatId ?? process.env.COMPANY_VAT_ID ?? '',
      companyCeo: db.companyCeo ?? process.env.COMPANY_CEO ?? '',
      companyPhone: db.companyPhone ?? process.env.COMPANY_PHONE ?? '',
      companyEmail: db.companyEmail ?? process.env.COMPANY_CONTACT_EMAIL ?? '',
      logoUrl: db.logoUrl ?? '',
      stripeEnabled: db.stripeEnabled === 'true' || !!process.env.STRIPE_SECRET_KEY,
      klarnaEnabled: db.klarnaEnabled === 'true',
      paypalEnabled: db.paypalEnabled === 'true',
      dhlConfigured: !!process.env.DHL_API_KEY,
      emailFrom: process.env.EMAIL_FROM_NOREPLY ?? '',
      freeShippingThreshold: db.freeShippingThreshold ?? '100',
    }
  }

  @Patch('settings')
  @Roles('super_admin')
  async updateSettings(@Body() body: Record<string, string>, @Req() req: any, @Ip() ip: string) {
    const allowed = [
      // Company
      'companyName', 'companyAddress', 'companyVatId', 'companyCeo',
      'companyPhone', 'companyEmail', 'logoUrl', 'faviconUrl',
      // Payments
      'stripeEnabled', 'klarnaEnabled', 'paypalEnabled',
      // Shipping
      'freeShippingThreshold', 'minOrderValue', 'minOrderEnabled',
      // Tax
      'taxRate', 'currency',
      // Appearance
      'brandName', 'accentColor',
      'heroBannerImage', 'heroBannerTitle_de', 'heroBannerTitle_en', 'heroBannerTitle_ar',
      'heroBannerSubtitle_de', 'heroBannerSubtitle_en', 'heroBannerSubtitle_ar',
      'heroBannerCta_de', 'heroBannerCta_en', 'heroBannerCta_ar', 'heroBannerCtaLink',
      // Footer
      'instagramUrl', 'facebookUrl', 'tiktokUrl',
      // Legal pages (stored as HTML)
      'impressum_de', 'impressum_en', 'impressum_ar',
      'agb_de', 'agb_en', 'agb_ar',
      'datenschutz_de', 'datenschutz_en', 'datenschutz_ar',
      'widerruf_de', 'widerruf_en', 'widerruf_ar',
      // Contact
      'contactEmail', 'contactPhone', 'contactAddress', 'contactHours',
      // Email
      'orderConfirmationEnabled',
    ]
    const entries = Object.entries(body).filter(([k]) => allowed.includes(k))

    for (const [key, value] of entries) {
      await this.prisma.shopSetting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      })
    }

    await this.audit.log({
      adminId: req.user.id,
      action: 'SETTINGS_UPDATED',
      entityType: 'settings',
      changes: { after: Object.fromEntries(entries) },
      ipAddress: ip,
    })

    return { success: true, updated: entries.length }
  }

  // ── Staff (SUPER_ADMIN only) ──────────────────────────

  @Get('staff')
  @Roles('super_admin')
  getStaff(@Query('search') search?: string) {
    return this.staff.findAll({ search })
  }

  @Post('staff')
  @Roles('super_admin')
  @HttpCode(HttpStatus.CREATED)
  createStaff(
    @Body('email') email: string,
    @Body('firstName') firstName: string,
    @Body('lastName') lastName: string,
    @Body('role') role: 'admin' | 'super_admin',
    @Body('password') password: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.staff.create({ email, firstName, lastName, role, password }, req.user.id, ip)
  }

  @Patch('staff/:id/role')
  @Roles('super_admin')
  updateStaffRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('role') role: 'admin' | 'super_admin',
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.staff.updateRole(id, role, req.user.id, ip)
  }

  @Post('staff/:id/activate')
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  activateStaff(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.staff.toggleActive(id, true, req.user.id, ip)
  }

  @Post('staff/:id/deactivate')
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  deactivateStaff(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.staff.toggleActive(id, false, req.user.id, ip)
  }

  @Post('staff/:id/reset-password')
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  resetStaffPassword(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.staff.resetPassword(id, req.user.id, ip)
  }

  @Get('staff/:id/activity')
  @Roles('super_admin')
  getStaffActivity(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.getActivity(id)
  }

  // ── Emails ────────────────────────────────────────────

  @Get('emails/templates')
  getEmailTemplates() {
    const templates = [
      { key: 'welcome', name: { de: 'Willkommen', en: 'Welcome', ar: 'مرحباً' }, languages: ['de', 'en'] },
      { key: 'email-verification', name: { de: 'E-Mail-Bestätigung', en: 'Email Verification', ar: 'تأكيد البريد' }, languages: ['de', 'en'] },
      { key: 'email-change', name: { de: 'E-Mail-Änderung', en: 'Email Change', ar: 'تغيير البريد' }, languages: ['de', 'en'] },
      { key: 'password-reset', name: { de: 'Passwort-Reset', en: 'Password Reset', ar: 'إعادة تعيين كلمة المرور' }, languages: ['de', 'en'] },
      { key: 'order-confirmation', name: { de: 'Bestellbestätigung', en: 'Order Confirmation', ar: 'تأكيد الطلب' }, languages: ['de', 'en'] },
      { key: 'order-status', name: { de: 'Status-Update', en: 'Status Update', ar: 'تحديث الحالة' }, languages: ['de', 'en'] },
      { key: 'order-cancellation', name: { de: 'Stornierung', en: 'Cancellation', ar: 'إلغاء' }, languages: ['de', 'en'] },
      { key: 'return-confirmation', name: { de: 'Rücksendung', en: 'Return Confirmation', ar: 'تأكيد الإرجاع' }, languages: ['de', 'en'] },
    ]
    // Check which languages actually have templates
    for (const t of templates) {
      for (const lang of ['ar']) {
        if (this.emailService.templateExists(t.key, lang) && !t.languages.includes(lang)) {
          t.languages.push(lang)
        }
      }
    }
    return templates
  }

  @Get('emails/preview/:key')
  previewEmail(@Param('key') key: string, @Query('lang') lang: string = 'de') {
    const sampleData: Record<string, unknown> = {
      firstName: 'Max',
      lastName: 'Mustermann',
      orderNumber: 'ORD-20260327-000001',
      statusLabel: 'Versendet',
      trackingNumber: '00340434161094042557',
      trackingUrl: 'https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=00340434161094042557',
      carrier: 'DHL',
      subtotal: '89.97',
      shippingCost: '0.00',
      taxAmount: '14.37',
      totalAmount: '89.97',
      currency: 'EUR',
      token: 'sample-token-12345',
      verifyUrl: 'https://malak-bekleidung.com/verify?token=sample',
      resetUrl: 'https://malak-bekleidung.com/reset?token=sample',
      cancelReason: 'Kundenanfrage',
      returnLabelUrl: 'https://dhl.de/label/return.pdf',
      items: [
        { name: 'Winterjacke Classic', sku: 'MAL-001-SCH-M', color: 'Schwarz', size: 'M', quantity: 1, unitPrice: '59.99', totalPrice: '59.99', imageUrl: '' },
        { name: 'T-Shirt Basic', sku: 'MAL-026-WEI-L', color: 'Weiß', size: 'L', quantity: 2, unitPrice: '14.99', totalPrice: '29.98', imageUrl: '' },
      ],
      address: { firstName: 'Max', lastName: 'Mustermann', street: 'Hauptstr.', houseNumber: '1', postalCode: '10115', city: 'Berlin', country: 'DE' },
      appUrl: process.env.APP_URL || 'https://malak-bekleidung.com',
    }

    try {
      const { html, subject } = this.emailService.renderEmail(key as any, lang, sampleData)
      return { html, subject, lang }
    } catch {
      return { html: `<p>Template "${key}" not available in "${lang}"</p>`, subject: key, lang }
    }
  }

  @Post('emails/test-send')
  @HttpCode(HttpStatus.OK)
  async testSendEmail(
    @Body('templateKey') templateKey: string,
    @Body('lang') lang: string,
    @Req() req: any,
  ) {
    const adminEmail = req.user.email
    try {
      await this.emailService.enqueue({ to: adminEmail, type: templateKey as any, lang, data: {
        firstName: req.user.firstName ?? 'Admin',
        orderNumber: 'ORD-TEST-000001',
        statusLabel: 'Test',
        trackingNumber: 'TEST-TRACKING',
      } })
      return { success: true, sentTo: adminEmail }
    } catch {
      return { success: false, error: 'Failed to queue email' }
    }
  }

  // ── Categories CRUD ───────────────────────────────────

  @Get('categories')
  async getAdminCategories() {
    const all = await this.prisma.category.findMany({
      where: { isActive: true },
      include: { translations: true, _count: { select: { products: true } } },
      orderBy: { sortOrder: 'asc' },
    })
    // Build tree: top-level + nested children
    const parents = all.filter((c) => !c.parentId)
    return parents.map((p) => ({
      ...p,
      children: all
        .filter((c) => c.parentId === p.id)
        .map((c) => ({ ...c, children: all.filter((gc) => gc.parentId === c.id) })),
    }))
  }
}
