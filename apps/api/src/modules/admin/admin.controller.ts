import {
  Controller,
  Get,
  Post,
  Put,
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
  NotFoundException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PermissionGuard } from '../../common/permissions/permission.guard'
import { RequirePermission } from '../../common/permissions/require-permission.decorator'
import { PERMISSIONS } from '../../common/permissions/permission.constants'
import { Roles } from '../../common/decorators/roles.decorator'
import { DashboardService } from './services/dashboard.service'
import { AdminOrdersService } from './services/admin-orders.service'
import { AdminUsersService } from './services/admin-users.service'
import { AdminProductsService } from './services/admin-products.service'
import { AdminInventoryService } from './services/admin-inventory.service'
import { AdminReturnsService } from './services/admin-returns.service'
import { AdminStaffService } from './services/admin-staff.service'
import { AuditService } from './services/audit.service'
import { FinanceReportsService } from './services/finance-reports.service'
import { EmailService } from '../email/email.service'
import { InvoiceService } from '../payments/invoice.service'
import { AdminMarketingService } from './services/admin-marketing.service'
import { NotificationService } from './services/notification.service'
import { StorageService } from '../../common/services/storage.service'
import { PrismaService } from '../../prisma/prisma.service'
import { Response } from 'express'

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Roles('admin', 'super_admin', 'warehouse_staff')
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
    private readonly finance: FinanceReportsService,
    private readonly invoiceService: InvoiceService,
    private readonly marketing: AdminMarketingService,
    private readonly notificationService: NotificationService,
  ) {}

  // ── Dashboard ─────────────────────────────────────────────

  @Get('dashboard')
  @RequirePermission(PERMISSIONS.DASHBOARD_VIEW)
  getDashboard() {
    return this.dashboard.getOverview()
  }

  // ── Notifications (DB-based) ──────────────────────────────
  @Get('notifications')
  @RequirePermission(PERMISSIONS.DASHBOARD_VIEW)
  async getNotifications(@Query('limit') limit?: string, @Query('offset') offset?: string, @Query('isRead') isRead?: string, @Query('type') type?: string) {
    return this.notificationService.findForAdmin({
      limit: parseInt(limit ?? '20'),
      offset: parseInt(offset ?? '0'),
      isRead: isRead === 'true' ? true : isRead === 'false' ? false : undefined,
      type: type || undefined,
    })
  }

  @Get('notifications/unread')
  @RequirePermission(PERMISSIONS.DASHBOARD_VIEW)
  async getUnreadCount() {
    return this.notificationService.getUnreadCount('admin')
  }

  @Post('notifications/read/:id')
  @RequirePermission(PERMISSIONS.DASHBOARD_VIEW)
  @HttpCode(HttpStatus.OK)
  async markAsRead(@Param('id') id: string) {
    await this.notificationService.markAsRead(id)
    return { success: true }
  }

  @Post('notifications/read-all')
  @RequirePermission(PERMISSIONS.DASHBOARD_VIEW)
  @HttpCode(HttpStatus.OK)
  async markAllAsRead() {
    await this.notificationService.markAllAsRead('admin')
    return { success: true }
  }

  @Delete('notifications/:id')
  @RequirePermission(PERMISSIONS.DASHBOARD_VIEW)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteNotification(@Param('id') id: string) {
    await this.prisma.notification.delete({ where: { id } }).catch(() => {})
  }

  // ── Orders ────────────────────────────────────────────────

  @Get('orders')
  @RequirePermission(PERMISSIONS.ORDERS_VIEW)
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
  @RequirePermission(PERMISSIONS.ORDERS_VIEW)
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
  @RequirePermission(PERMISSIONS.ORDERS_VIEW)
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findOne(id)
  }

  @Patch('orders/:id/status')
  @RequirePermission(PERMISSIONS.ORDERS_EDIT)
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
  @RequirePermission(PERMISSIONS.ORDERS_CANCEL)
  @HttpCode(HttpStatus.OK)
  cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.orders.cancelWithRefund(id, reason, req.user.id, ip)
  }

  @Post('orders/:id/cancel-items')
  @RequirePermission(PERMISSIONS.ORDERS_CANCEL)
  @HttpCode(HttpStatus.OK)
  cancelOrderItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('itemIds') itemIds: string[],
    @Body('reason') reason: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.orders.cancelItems(id, itemIds, reason, req.user.id, ip)
  }

  @Post('orders/:id/notes')
  @RequirePermission(PERMISSIONS.ORDERS_EDIT)
  @HttpCode(HttpStatus.CREATED)
  addOrderNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('content') content: string,
    @Req() req: any,
  ) {
    return this.orders.addNote(id, content, req.user.id)
  }

  @Patch('orders/:id/fulfillment')
  @RequirePermission(PERMISSIONS.ORDERS_EDIT)
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
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
  getCustomerStats() {
    return this.users.getCustomerStats()
  }

  @Get('customers/export')
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
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
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
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
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.CREATED)
  createCustomer(
    @Body() body: { email: string; firstName: string; lastName: string; phone?: string; lang?: string; notes?: string; tags?: string[] },
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.users.createCustomer(body, req.user.id, ip)
  }

  @Get('customers/:id')
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
  getCustomer(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id)
  }

  @Patch('customers/:id')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  updateCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { firstName?: string; lastName?: string; phone?: string; preferredLang?: string; tags?: string[] },
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.users.updateCustomer(id, body, req.user.id, ip)
  }

  @Delete('customers/:id')
  @RequirePermission(PERMISSIONS.CUSTOMERS_DELETE)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  deleteCustomer(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.users.deleteCustomer(id, req.user.id, ip)
  }

  @Get('customers/:id/activity')
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
  getCustomerActivity(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getActivity(id)
  }

  @Get('customers/:id/emails')
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
  getCustomerEmails(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getEmailHistory(id)
  }

  @Get('customers/:id/cart')
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
  getCustomerCart(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getAbandonedCarts(id)
  }

  @Get('customers/:id/export')
  @RequirePermission(PERMISSIONS.CUSTOMERS_VIEW)
  exportCustomerData(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.exportCustomerData(id)
  }

  @Post('customers/:id/notes')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.CREATED)
  addCustomerNote(@Param('id', ParseUUIDPipe) id: string, @Body('content') content: string, @Req() req: any) {
    return this.users.addNote(id, content, req.user.id)
  }

  @Patch('customers/:id/notes/:noteId')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  updateCustomerNote(@Param('noteId', ParseUUIDPipe) noteId: string, @Body('content') content: string) {
    return this.users.updateNote(noteId, content)
  }

  @Delete('customers/:id/notes/:noteId')
  @HttpCode(HttpStatus.OK)
  deleteCustomerNote(@Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.users.deleteNote(noteId)
  }

  @Post('customers/:id/email')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
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
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.OK)
  blockCustomer(@Param('id', ParseUUIDPipe) id: string, @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.users.blockUser(id, reason, req.user.id, ip)
  }

  @Post('customers/:id/unblock')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.OK)
  unblockCustomer(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.users.unblockUser(id, req.user.id, ip)
  }

  @Post('customers/:id/tags')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.OK)
  setCustomerTags(@Param('id', ParseUUIDPipe) id: string, @Body('tags') tags: string[], @Req() req: any, @Ip() ip: string) {
    return this.users.setTags(id, tags, req.user.id, ip)
  }

  @Post('customers/bulk-email')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.OK)
  bulkEmail(@Body('userIds') userIds: string[], @Body('subject') subject: string, @Body('body') body: string, @Req() req: any, @Ip() ip: string) {
    return this.users.bulkEmail(userIds, subject, body, req.user.id, ip)
  }

  @Post('customers/bulk-tag')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.OK)
  bulkTag(@Body('userIds') userIds: string[], @Body('tags') tags: string[], @Req() req: any, @Ip() ip: string) {
    return this.users.bulkTag(userIds, tags, req.user.id, ip)
  }

  @Post('customers/bulk-block')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.OK)
  bulkBlock(@Body('userIds') userIds: string[], @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.users.bulkBlock(userIds, reason, req.user.id, ip)
  }

  @Post('customers/bulk-unblock')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.OK)
  bulkUnblock(@Body('userIds') userIds: string[], @Req() req: any, @Ip() ip: string) {
    return this.users.bulkUnblock(userIds, req.user.id, ip)
  }

  @Post('customers/:id/cart/:cartId/reminder')
  @RequirePermission(PERMISSIONS.CUSTOMERS_EDIT)
  @HttpCode(HttpStatus.OK)
  sendCartReminder(@Param('cartId', ParseUUIDPipe) cartId: string, @Req() req: any) {
    return this.users.sendCartReminder(cartId, req.user.id)
  }

  // Keep legacy /admin/users endpoints for backward compat
  @Get('users')
  @RequirePermission(PERMISSIONS.STAFF_VIEW)
  getUsers(
    @Query('search') search?: string, @Query('filter') filter?: string,
    @Query('sortBy') sortBy?: string, @Query('sortDir') sortDir?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.users.findAll({ search, filter, sortBy, sortDir, limit: limit ? +limit : 25, offset: offset ? +offset : 0 })
  }

  @Get('users/:id')
  @RequirePermission(PERMISSIONS.STAFF_VIEW)
  getUser(@Param('id', ParseUUIDPipe) id: string) { return this.users.findOne(id) }

  // ── Products ──────────────────────────────────────────────

  @Get('products/export')
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  async exportProductsCsv(@Res({ passthrough: true }) res: any) {
    const csv = await this.products.exportCsv()
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=produkte.csv' })
    return csv
  }

  @Get('products/check-duplicate')
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  checkDuplicate(
    @Query('name') name?: string, @Query('sku') sku?: string,
    @Query('barcode') barcode?: string, @Query('excludeId') excludeId?: string,
  ) {
    return this.products.checkDuplicate({ name, sku, barcode, excludeId })
  }

  @Get('products/next-sku')
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  getNextSku(@Query('prefix') prefix: string) {
    return this.products.getNextSku(prefix).then((sku) => ({ sku }))
  }

  @Get('products')
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
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
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  getProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(id)
  }

  @Put('products/:id')
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
  async updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { basePrice?: number; salePrice?: number | null; translations?: { language: string; name: string; description?: string; metaTitle?: string; metaDesc?: string }[] },
  ) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } })
    if (!product) throw new NotFoundException('Product not found')

    const data: any = {}
    if (body.basePrice !== undefined) data.basePrice = body.basePrice
    if (body.salePrice !== undefined) data.salePrice = body.salePrice

    await this.prisma.product.update({ where: { id }, data })

    if (body.translations?.length) {
      for (const t of body.translations) {
        await this.prisma.productTranslation.upsert({
          where: { productId_language: { productId: id, language: t.language as any } },
          create: { productId: id, language: t.language as any, name: t.name, description: t.description ?? '' },
          update: { name: t.name, description: t.description ?? undefined, metaTitle: t.metaTitle ?? undefined, metaDesc: t.metaDesc ?? undefined },
        })
      }
    }

    return this.products.findOne(id)
  }

  @Patch('products/:id/price')
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
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
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
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
  @RequirePermission(PERMISSIONS.PRODUCTS_DELETE)
  @HttpCode(HttpStatus.OK)
  bulkDeleteProducts(
    @Body('productIds') productIds: string[],
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.products.bulkDelete(productIds, req.user.id, ip)
  }

  @Post('products/:id/duplicate')
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
  @HttpCode(HttpStatus.CREATED)
  duplicateProduct(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.products.duplicate(id, req.user.id, ip)
  }

  @Get('products/:id/variant-options')
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  getVariantOptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.getProductVariantOptions(id)
  }

  @Get('products/:id/images')
  @RequirePermission(PERMISSIONS.PRODUCTS_VIEW)
  getProductImages(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.getProductImages(id)
  }

  @Post('products/:id/images')
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
  @HttpCode(HttpStatus.CREATED)
  addProductImage(@Param('id', ParseUUIDPipe) id: string, @Body('url') url: string, @Body('colorName') colorName?: string) {
    return this.products.addImageUrl(id, url, colorName)
  }

  @Post('products/:id/images/upload')
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
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
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
  assignImageColor(@Param('imageId', ParseUUIDPipe) imageId: string, @Body('colorName') colorName: string | null) {
    return this.products.assignImageToColor(imageId, colorName)
  }

  @Delete('products/images/:imageId')
  @RequirePermission(PERMISSIONS.PRODUCTS_DELETE)
  @HttpCode(HttpStatus.OK)
  deleteProductImage(@Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.prisma.productImage.delete({ where: { id: imageId } }).then(() => ({ deleted: true }))
  }

  @Post('products/:id/variants/add-color')
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
  @HttpCode(HttpStatus.CREATED)
  addColor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { color: string; colorHex: string; sizes: string[]; priceModifier?: number; stock?: Record<string, number>; barcode?: string },
    @Req() req: any, @Ip() ip: string,
  ) {
    return this.products.addColor(id, body, req.user.id, ip)
  }

  @Post('products/:id/variants/add-size')
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
  @HttpCode(HttpStatus.CREATED)
  addSize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { size: string; colors: string[]; priceModifier?: number; stock?: Record<string, number> },
    @Req() req: any, @Ip() ip: string,
  ) {
    return this.products.addSize(id, body, req.user.id, ip)
  }

  @Patch('products/variants/:variantId')
  @RequirePermission(PERMISSIONS.PRODUCTS_EDIT)
  updateVariant(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: { priceModifier?: number; barcode?: string; purchasePrice?: number },
    @Req() req: any, @Ip() ip: string,
  ) {
    return this.products.updateVariant(variantId, body, req.user.id, ip)
  }

  @Delete('products/:id/variants/:variantId')
  @RequirePermission(PERMISSIONS.PRODUCTS_DELETE)
  @HttpCode(HttpStatus.OK)
  deleteVariant(@Param('id', ParseUUIDPipe) id: string, @Param('variantId', ParseUUIDPipe) variantId: string, @Req() req: any, @Ip() ip: string) {
    return this.products.deleteVariant(id, variantId, req.user.id, ip)
  }

  // ── Inventory ─────────────────────────────────────────────

  @Get('inventory/stats')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  getInventoryStats(@Query('warehouseId') warehouseId?: string) { return this.inventory.getStats(warehouseId) }

  @Get('inventory/grouped')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
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
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  getInventorySummary(@Query('warehouseId') warehouseId?: string) { return this.inventory.getDepartmentSummary(warehouseId) }

  @Get('inventory/export')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  async exportInventoryCsv(
    @Query('warehouseId') warehouseId?: string, @Query('categoryId') categoryId?: string,
    @Query('status') status?: string, @Res({ passthrough: true }) res?: any,
  ) {
    const csv = await this.inventory.exportCsv({ warehouseId, categoryId, status })
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=bestand.csv' })
    return csv
  }

  @Get('inventory/barcode/:code')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  lookupBarcode(@Param('code') code: string) { return this.inventory.lookupBarcode(code) }

  @Post('inventory/return-scan/:code')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.OK)
  processReturnScan(@Param('code') code: string, @Req() req: any) {
    return this.inventory.processReturnScan(code, req.user.id)
  }

  @Get('inventory')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
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
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  getWarehouses() {
    return this.prisma.warehouse.findMany({
      select: { id: true, name: true, type: true, isDefault: true, address: true, isActive: true },
      orderBy: { isDefault: 'desc' },
    })
  }

  @Post('warehouses')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.CREATED)
  createWarehouse(@Body() body: { name: string; type?: string; address?: string }) {
    return this.prisma.warehouse.create({
      data: { name: body.name, type: (body.type as any) ?? 'WAREHOUSE', address: body.address },
    })
  }

  @Patch('warehouses/:id')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  updateWarehouse(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name?: string; type?: string; address?: string; isActive?: boolean }) {
    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.type !== undefined) data.type = body.type
    if (body.address !== undefined) data.address = body.address
    if (body.isActive !== undefined) data.isActive = body.isActive
    return this.prisma.warehouse.update({ where: { id }, data })
  }

  @Delete('warehouses/:id')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
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
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  adjustStock(@Param('id', ParseUUIDPipe) id: string, @Body('quantity') quantity: number, @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.inventory.adjustStock(id, quantity, reason, req.user.id, ip)
  }

  @Patch('inventory/:id/quick')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  quickAdjust(@Param('id', ParseUUIDPipe) id: string, @Body('delta') delta: number, @Req() req: any, @Ip() ip: string) {
    return this.inventory.quickAdjust(id, delta, req.user.id, ip)
  }

  @Patch('inventory/:id/min-max')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  updateMinMax(@Param('id', ParseUUIDPipe) id: string, @Body('reorderPoint') reorderPoint?: number, @Body('maxStock') maxStock?: number) {
    return this.inventory.updateMinMax(id, reorderPoint, maxStock)
  }

  @Post('inventory/intake')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.OK)
  stockIntake(@Body('items') items: { inventoryId: string; quantity: number }[], @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.inventory.intake(items, reason, req.user.id, ip)
  }

  @Post('inventory/intake-csv')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.OK)
  stockIntakeBySku(@Body('items') items: { sku: string; quantity: number }[], @Body('reason') reason: string, @Body('warehouseId') warehouseId: string | undefined, @Req() req: any, @Ip() ip: string) {
    return this.inventory.intakeBySku(items, reason, req.user.id, ip, warehouseId)
  }

  @Post('inventory/:id/output')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.OK)
  stockOutput(@Param('id', ParseUUIDPipe) id: string, @Body('quantity') quantity: number, @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.inventory.output(id, quantity, reason, req.user.id, ip)
  }

  @Post('inventory/:id/transfer')
  @RequirePermission(PERMISSIONS.INVENTORY_TRANSFER)
  @HttpCode(HttpStatus.OK)
  transferStock(@Param('id', ParseUUIDPipe) id: string, @Body('toWarehouseId') toWarehouseId: string, @Body('quantity') quantity: number, @Req() req: any, @Ip() ip: string) {
    return this.inventory.transfer(id, toWarehouseId, quantity, req.user.id, ip)
  }

  @Post('inventory/bulk-adjust')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.OK)
  bulkAdjust(@Body('items') items: { inventoryId: string; quantity: number }[], @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.inventory.bulkAdjust(items, reason, req.user.id, ip)
  }

  @Post('inventory/bulk-min-stock')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.OK)
  bulkSetMinStock(@Body('inventoryIds') ids: string[], @Body('reorderPoint') reorderPoint: number) {
    return this.inventory.bulkSetMinStock(ids, reorderPoint)
  }

  @Post('inventory/bulk-location')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.OK)
  bulkSetLocation(@Body('inventoryIds') ids: string[], @Body('locationId') locationId: string) {
    return this.inventory.bulkSetLocation(ids, locationId)
  }

  @Get('inventory/movements')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  getMovementLog(
    @Query('warehouseId') warehouseId?: string, @Query('type') type?: string,
    @Query('search') search?: string, @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.inventory.getMovementLog({ warehouseId, type, search, limit: limit ? +limit : 50, offset: offset ? +offset : 0 })
  }

  @Get('inventory/:variantId/:warehouseId/history')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  getInventoryHistory(@Param('variantId', ParseUUIDPipe) variantId: string, @Param('warehouseId', ParseUUIDPipe) warehouseId: string) {
    return this.inventory.getHistory(variantId, warehouseId)
  }

  // Locations
  @Get('inventory/locations')
  @RequirePermission(PERMISSIONS.INVENTORY_VIEW)
  getLocations(@Query('warehouseId') warehouseId?: string) { return this.inventory.getLocations(warehouseId) }

  @Post('inventory/locations')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.CREATED)
  createLocation(@Body() body: { warehouseId: string; name: string; description?: string }, @Req() req: any) {
    return this.inventory.createLocation(body, req.user.id)
  }

  @Patch('inventory/locations/:id')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  updateLocation(@Param('id', ParseUUIDPipe) id: string, @Body() body: { name?: string; description?: string }) {
    return this.inventory.updateLocation(id, body)
  }

  @Delete('inventory/locations/:id')
  @RequirePermission(PERMISSIONS.INVENTORY_INTAKE)
  @HttpCode(HttpStatus.OK)
  deleteLocation(@Param('id', ParseUUIDPipe) id: string) { return this.inventory.deleteLocation(id) }

  // Stocktake
  @Get('stocktakes')
  @RequirePermission(PERMISSIONS.INVENTORY_STOCKTAKE)
  getStocktakes() { return this.inventory.getStocktakes() }

  @Post('stocktakes')
  @RequirePermission(PERMISSIONS.INVENTORY_STOCKTAKE)
  @HttpCode(HttpStatus.CREATED)
  startStocktake(@Body('warehouseId') warehouseId: string, @Body('categoryId') categoryId: string | null, @Req() req: any) {
    return this.inventory.startStocktake(warehouseId, categoryId, req.user.id)
  }

  @Get('stocktakes/:id')
  @RequirePermission(PERMISSIONS.INVENTORY_STOCKTAKE)
  getStocktake(@Param('id', ParseUUIDPipe) id: string) { return this.inventory.getStocktake(id) }

  @Patch('stocktakes/items/:itemId')
  @RequirePermission(PERMISSIONS.INVENTORY_STOCKTAKE)
  updateStocktakeItem(@Param('itemId', ParseUUIDPipe) itemId: string, @Body('actualQty') actualQty: number) {
    return this.inventory.updateStocktakeItem(itemId, actualQty)
  }

  @Post('stocktakes/:id/complete')
  @RequirePermission(PERMISSIONS.INVENTORY_STOCKTAKE)
  @HttpCode(HttpStatus.OK)
  completeStocktake(@Param('id', ParseUUIDPipe) id: string, @Body('applyChanges') applyChanges: boolean, @Req() req: any, @Ip() ip: string) {
    return this.inventory.completeStocktake(id, applyChanges, req.user.id, ip)
  }

  // ── Audit Log ─────────────────────────────────────────────

  @Get('audit-log')
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
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
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  @Roles('super_admin')
  getAuditAdmins() {
    return this.audit.getAdmins()
  }

  @Get('audit-log/actions')
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  @Roles('super_admin')
  getAuditActions() {
    return this.audit.getActionTypes()
  }

  // ── Returns ───────────────────────────────────────────

  @Get('returns')
  @RequirePermission(PERMISSIONS.RETURNS_VIEW)
  getReturns(@Query('status') status?: string, @Query('search') search?: string, @Query('limit') limit?: string) {
    return this.returns.findAll({ status, search, limit: limit ? +limit : 50 })
  }

  @Get('returns/stats')
  @RequirePermission(PERMISSIONS.RETURNS_VIEW)
  getReturnStats() {
    return this.returns.getStats()
  }

  @Get('returns/:id')
  @RequirePermission(PERMISSIONS.RETURNS_VIEW)
  getReturn(@Param('id', ParseUUIDPipe) id: string) {
    return this.returns.findOne(id)
  }

  @Post('returns/:id/approve')
  @RequirePermission(PERMISSIONS.RETURNS_APPROVE)
  @HttpCode(HttpStatus.OK)
  approveReturn(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.returns.approve(id, req.user.id, ip)
  }

  @Post('returns/:id/reject')
  @RequirePermission(PERMISSIONS.RETURNS_APPROVE)
  @HttpCode(HttpStatus.OK)
  rejectReturn(@Param('id', ParseUUIDPipe) id: string, @Body('reason') reason: string, @Req() req: any, @Ip() ip: string) {
    return this.returns.reject(id, reason, req.user.id, ip)
  }

  @Post('returns/:id/received')
  @RequirePermission(PERMISSIONS.RETURNS_EDIT)
  @HttpCode(HttpStatus.OK)
  markReturnReceived(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.returns.markReceived(id, req.user.id, ip)
  }

  @Post('returns/:id/inspect')
  @RequirePermission(PERMISSIONS.RETURNS_EDIT)
  @HttpCode(HttpStatus.OK)
  inspectReturn(@Param('id', ParseUUIDPipe) id: string, @Body('items') items: any[], @Req() req: any, @Ip() ip: string) {
    return this.returns.inspect(id, items, req.user.id, ip)
  }

  @Post('returns/:id/refund')
  @RequirePermission(PERMISSIONS.RETURNS_APPROVE)
  @HttpCode(HttpStatus.OK)
  processReturnRefund(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.returns.processRefund(id, req.user.id, ip)
  }

  @Get('returns/:id/label')
  @RequirePermission(PERMISSIONS.RETURNS_VIEW)
  async downloadReturnLabel(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const buffer = await this.returns.generateReturnLabel(id)
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="return-label.pdf"`, 'Content-Length': buffer.length.toString() })
    res.end(buffer)
  }

  // ── Shipments ─────────────────────────────────────────

  @Get('shipments')
  @RequirePermission(PERMISSIONS.SHIPPING_VIEW)
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
  @RequirePermission(PERMISSIONS.SHIPPING_VIEW)
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
  @RequirePermission(PERMISSIONS.SHIPPING_STATUS)
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
  @RequirePermission(PERMISSIONS.SHIPPING_STATUS)
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
  @RequirePermission(PERMISSIONS.SHIPPING_STATUS)
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
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
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
      companyRegister: db.companyRegister ?? process.env.COMPANY_REGISTER ?? '',
      logoUrl: db.logoUrl ?? '',
      bankName: db.bankName ?? '',
      bankIban: db.bankIban ?? '',
      bankBic: db.bankBic ?? '',
      stripeEnabled: db.stripeEnabled === 'true' || !!process.env.STRIPE_SECRET_KEY,
      klarnaEnabled: db.klarnaEnabled === 'true',
      paypalEnabled: db.paypalEnabled === 'true',
      dhlConfigured: !!process.env.DHL_API_KEY,
      emailFrom: process.env.EMAIL_FROM_NOREPLY ?? '',
      freeShippingThreshold: db.freeShippingThreshold ?? '100',
    }
  }

  @Patch('settings')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @Roles('super_admin')
  async updateSettings(@Body() body: Record<string, string>, @Req() req: any, @Ip() ip: string) {
    const allowed = [
      // Company
      'companyName', 'companyAddress', 'companyVatId', 'companyCeo',
      'companyPhone', 'companyEmail', 'companyRegister', 'logoUrl', 'faviconUrl',
      // Bank details (for invoices)
      'bankName', 'bankIban', 'bankBic',
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
      // Marketing
      'welcomePopupEnabled', 'welcomeDiscountPercent',
      // Returns
      'returnsEnabled',
      // Notifications
      'notif_email_new_order', 'notif_email_low_stock', 'notif_sound_enabled',
      'notif_daily_summary', 'notif_daily_summary_email',
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
  @RequirePermission(PERMISSIONS.STAFF_VIEW)
  @Roles('super_admin')
  getStaff(@Query('search') search?: string) {
    return this.staff.findAll({ search })
  }

  @Get('staff/permissions')
  @RequirePermission(PERMISSIONS.STAFF_VIEW)
  @Roles('super_admin')
  getPermissionDefinitions() {
    return this.staff.getPermissionDefinitions()
  }

  @Post('staff/invite')
  @RequirePermission(PERMISSIONS.STAFF_INVITE)
  @Roles('super_admin')
  @HttpCode(HttpStatus.CREATED)
  inviteStaff(
    @Body() body: { email: string; staffRole: string; customPermissions?: string[] },
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.staff.invite(body, req.user.id, ip)
  }

  @Post('staff')
  @RequirePermission(PERMISSIONS.STAFF_INVITE)
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

  @Get('staff/:id')
  @RequirePermission(PERMISSIONS.STAFF_VIEW)
  @Roles('super_admin')
  getStaffMember(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.findOne(id)
  }

  @Patch('staff/:id/role')
  @RequirePermission(PERMISSIONS.STAFF_ROLES)
  @Roles('super_admin')
  updateStaffRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { staffRole?: string; customPermissions?: string[]; role?: string },
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.staff.updateRole(id, body, req.user.id, ip)
  }

  @Post('staff/:id/activate')
  @RequirePermission(PERMISSIONS.STAFF_DEACTIVATE)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  activateStaff(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.staff.toggleActive(id, true, req.user.id, ip)
  }

  @Post('staff/:id/deactivate')
  @RequirePermission(PERMISSIONS.STAFF_DEACTIVATE)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  deactivateStaff(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.staff.toggleActive(id, false, req.user.id, ip)
  }

  @Post('staff/:id/reset-password')
  @RequirePermission(PERMISSIONS.STAFF_DEACTIVATE)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  resetStaffPassword(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.staff.resetPassword(id, req.user.id, ip)
  }

  @Get('staff/:id/activity')
  @RequirePermission(PERMISSIONS.STAFF_VIEW)
  @Roles('super_admin')
  getStaffActivity(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.getActivity(id)
  }

  @Patch('staff/:id/profile')
  @RequirePermission(PERMISSIONS.STAFF_ROLES)
  @Roles('super_admin')
  updateStaffProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { firstName?: string; lastName?: string },
  ) {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(body.firstName !== undefined ? { firstName: body.firstName.trim() } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName.trim() } : {}),
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
  }

  @Delete('staff/:id')
  @RequirePermission(PERMISSIONS.STAFF_DEACTIVATE)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  deleteStaff(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Ip() ip: string) {
    return this.staff.softDelete(id, req.user.id, ip)
  }

  // ── Emails ────────────────────────────────────────────

  @Get('emails/templates')
  @RequirePermission(PERMISSIONS.EMAILS_VIEW)
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
  @RequirePermission(PERMISSIONS.EMAILS_VIEW)
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
  @RequirePermission(PERMISSIONS.EMAILS_TEST)
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
  @RequirePermission(PERMISSIONS.CATEGORIES_VIEW)
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

  // ══════════════════════════════════════════════════════════
  // ██ FINANCE REPORTS
  // ══════════════════════════════════════════════════════════

  @Get('finance/daily')
  @RequirePermission(PERMISSIONS.FINANCE_REVENUE)
  getDailyReport(@Query('date') date?: string) {
    return this.finance.getDailyReport(date)
  }

  @Get('finance/monthly')
  @RequirePermission(PERMISSIONS.FINANCE_REVENUE)
  getMonthlyReport(@Query('year') year: string, @Query('month') month: string) {
    return this.finance.getMonthlyReport(parseInt(year) || new Date().getFullYear(), parseInt(month) || new Date().getMonth() + 1)
  }

  @Get('finance/profit')
  @RequirePermission(PERMISSIONS.FINANCE_MARGINS)
  getProfitReport(@Query('from') from: string, @Query('to') to: string) {
    const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const dateTo = to || new Date().toISOString().slice(0, 10)
    return this.finance.getProfitReport(dateFrom, dateTo)
  }

  @Get('finance/vat')
  @RequirePermission(PERMISSIONS.FINANCE_VAT_REPORT)
  getVatReport(@Query('from') from: string, @Query('to') to: string) {
    const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const dateTo = to || new Date().toISOString().slice(0, 10)
    return this.finance.getVatReport(dateFrom, dateTo)
  }

  @Get('finance/bestsellers')
  @RequirePermission(PERMISSIONS.FINANCE_REVENUE)
  getBestsellersReport(@Query('from') from: string, @Query('to') to: string, @Query('limit') limit?: string) {
    const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const dateTo = to || new Date().toISOString().slice(0, 10)
    return this.finance.getBestsellersReport(dateFrom, dateTo, parseInt(limit ?? '20'))
  }

  @Get('finance/customers')
  @RequirePermission(PERMISSIONS.FINANCE_REVENUE)
  getCustomerReport(@Query('from') from: string, @Query('to') to: string) {
    const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const dateTo = to || new Date().toISOString().slice(0, 10)
    return this.finance.getCustomerReport(dateFrom, dateTo)
  }

  // ══════════════════════════════════════════════════════════
  // ██ INVOICES MANAGEMENT
  // ══════════════════════════════════════════════════════════

  @Get('invoices')
  @RequirePermission(PERMISSIONS.FINANCE_INVOICES)
  async listInvoices(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const take = Math.min(parseInt(limit ?? '50'), 200)
    const skip = parseInt(offset ?? '0')
    const where: any = {}

    if (type) where.type = type
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(`${from}T00:00:00.000Z`)
      if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999Z`)
    }
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          order: {
            select: {
              orderNumber: true,
              user: { select: { firstName: true, lastName: true, email: true } },
              guestEmail: true,
            },
          },
          originalInvoice: { select: { invoiceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.invoice.count({ where }),
    ])

    return {
      data: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        type: inv.type,
        orderNumber: inv.order.orderNumber,
        customerName: inv.order.user ? `${inv.order.user.firstName} ${inv.order.user.lastName}` : inv.order.guestEmail ?? '—',
        customerEmail: inv.order.user?.email ?? inv.order.guestEmail ?? '',
        originalInvoiceNumber: inv.originalInvoice?.invoiceNumber ?? null,
        netAmount: Number(inv.netAmount),
        taxAmount: Number(inv.taxAmount),
        grossAmount: Number(inv.grossAmount),
        createdAt: inv.createdAt,
      })),
      meta: { total, limit: take, offset: skip },
    }
  }

  @Get('invoices/:id/download')
  @RequirePermission(PERMISSIONS.FINANCE_INVOICES)
  async downloadInvoice(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { buffer, filename } = await this.invoiceService.getInvoicePdfById(id)
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length.toString(),
    })
    res.end(buffer)
  }

  @Get('orders/:id/delivery-note')
  @RequirePermission(PERMISSIONS.ORDERS_VIEW)
  async downloadDeliveryNote(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const buffer = await this.invoiceService.generateDeliveryNote(id)
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Lieferschein-${id.slice(0, 8)}.pdf"`,
      'Content-Length': buffer.length.toString(),
    })
    res.end(buffer)
  }

  @Get('invoices/export/csv')
  @RequirePermission(PERMISSIONS.FINANCE_EXPORT)
  async exportInvoicesCsv(@Query('from') from?: string, @Query('to') to?: string, @Res() res?: Response) {
    const where: any = {}
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(`${from}T00:00:00.000Z`)
      if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999Z`)
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: { order: { select: { orderNumber: true } } },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    })

    const csv = this.finance.exportReportCsv(
      invoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        type: inv.type,
        orderNumber: inv.order.orderNumber,
        netAmount: Number(inv.netAmount).toFixed(2),
        taxAmount: Number(inv.taxAmount).toFixed(2),
        grossAmount: Number(inv.grossAmount).toFixed(2),
        date: inv.createdAt.toISOString().slice(0, 10),
      })),
      [
        { key: 'invoiceNumber', label: 'Rechnungsnummer' },
        { key: 'type', label: 'Typ' },
        { key: 'orderNumber', label: 'Bestellnummer' },
        { key: 'netAmount', label: 'Netto (EUR)' },
        { key: 'taxAmount', label: 'MwSt (EUR)' },
        { key: 'grossAmount', label: 'Brutto (EUR)' },
        { key: 'date', label: 'Datum' },
      ],
    )

    res!.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="Rechnungen-${from ?? 'alle'}-${to ?? 'heute'}.csv"`,
    })
    res!.send(csv)
  }

  // ══════════════════════════════════════════════════════════
  // ██ MARKETING — COUPONS
  // ══════════════════════════════════════════════════════════

  @Get('marketing/coupons')
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
  listCoupons(@Query('search') search?: string, @Query('isActive') isActive?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.marketing.findAllCoupons({
      search: search || undefined,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      limit: parseInt(limit ?? '50'),
      offset: parseInt(offset ?? '0'),
    })
  }

  @Post('marketing/coupons')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @HttpCode(HttpStatus.CREATED)
  createCoupon(@Body() body: any) {
    return this.marketing.createCoupon(body)
  }

  @Patch('marketing/coupons/:id')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  updateCoupon(@Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.marketing.updateCoupon(id, body)
  }

  @Patch('marketing/coupons/:id/toggle')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  toggleCoupon(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketing.toggleCoupon(id)
  }

  @Delete('marketing/coupons/:id')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCoupon(@Param('id', ParseUUIDPipe) id: string) {
    // Delete usages first, then coupon
    await this.prisma.couponUsage.deleteMany({ where: { couponId: id } })
    await this.prisma.coupon.delete({ where: { id } })
  }

  @Get('marketing/coupons/:id/stats')
  @RequirePermission(PERMISSIONS.FINANCE_REVENUE)
  getCouponStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketing.getCouponStats(id)
  }

  // ══════════════════════════════════════════════════════════
  // ██ MARKETING — PROMOTIONS
  // ══════════════════════════════════════════════════════════

  @Get('marketing/promotions')
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
  listPromotions(@Query('isActive') isActive?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.marketing.findAllPromotions({
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      limit: parseInt(limit ?? '50'),
      offset: parseInt(offset ?? '0'),
    })
  }

  @Post('marketing/promotions')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @HttpCode(HttpStatus.CREATED)
  createPromotion(@Body() body: any) {
    return this.marketing.createPromotion(body)
  }

  @Patch('marketing/promotions/:id')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  updatePromotion(@Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.marketing.updatePromotion(id, body)
  }

  @Patch('marketing/promotions/:id/toggle')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  togglePromotion(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketing.togglePromotion(id)
  }

  @Get('marketing/promotions/active')
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
  getActivePromotions() {
    return this.marketing.getActivePromotions()
  }

  // ══════════════════════════════════════════════════════════
  // ██ MARKETING — NEWSLETTER SUBSCRIBERS
  // ══════════════════════════════════════════════════════════

  @Get('marketing/newsletter')
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
  async getNewsletterSubscribers(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const take = Math.min(parseInt(limit ?? '50'), 200)
    const skip = parseInt(offset ?? '0')

    const [coupons, total] = await Promise.all([
      this.prisma.coupon.findMany({
        where: { code: { startsWith: 'WELCOME-' } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: { id: true, code: true, description: true, usedCount: true, isActive: true, expiresAt: true, createdAt: true },
      }),
      this.prisma.coupon.count({ where: { code: { startsWith: 'WELCOME-' } } }),
    ])

    return {
      data: coupons.map((c) => {
        // Extract email from description [email@example.com]
        const match = c.description?.match(/\[([^\]]+)\]/)
        return {
          id: c.id,
          email: match?.[1] ?? '—',
          couponCode: c.code,
          used: c.usedCount > 0,
          isActive: c.isActive,
          expiresAt: c.expiresAt,
          subscribedAt: c.createdAt,
        }
      }),
      meta: { total, limit: take, offset: skip },
    }
  }
}
