import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'
import { EmailService } from '../../email/email.service'

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly emailService: EmailService,
  ) {}

  // ── LIST ───────────────────────────────────────────────────

  async findAll(query: {
    search?: string
    filter?: string       // registered | guest | active | blocked | vip
    lang?: string         // de | en | ar
    ordersMin?: number
    ordersMax?: number
    revenueMin?: number
    revenueMax?: number
    dateFrom?: string
    dateTo?: string
    tag?: string
    sortBy?: string       // revenue | orders | date | name
    sortDir?: string      // asc | desc
    limit?: number
    offset?: number
  }) {
    const limit = Math.min(query.limit ?? 25, 100)
    const offset = query.offset ?? 0
    const where: any = { deletedAt: null, anonymizedAt: null, role: 'customer' }

    // Search: name, email, phone, order number
    if (query.search) {
      const s = query.search
      where.OR = [
        { email: { contains: s, mode: 'insensitive' } },
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { orders: { some: { orderNumber: { contains: s, mode: 'insensitive' } } } },
      ]
    }

    // Filters
    if (query.filter === 'blocked') where.isBlocked = true
    else if (query.filter === 'active') { where.isBlocked = false; where.isActive = true }
    else if (query.filter === 'registered') where.passwordHash = { not: null }
    else if (query.filter === 'vip') where.tags = { array_contains: ['VIP'] }
    // guest handled post-fetch

    if (query.lang) where.preferredLang = query.lang

    // Date range
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {}
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom)
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo)
    }

    // Tag filter
    if (query.tag) where.tags = { array_contains: [query.tag] }

    // Sorting
    const dir = query.sortDir === 'asc' ? 'asc' : 'desc'
    let orderBy: any = { createdAt: dir }
    if (query.sortBy === 'orders') orderBy = { orders: { _count: dir } }
    else if (query.sortBy === 'name') orderBy = [{ firstName: dir }, { lastName: dir }]

    const needPostSort = query.sortBy === 'revenue' || query.ordersMin != null || query.ordersMax != null || query.revenueMin != null || query.revenueMax != null || query.filter === 'guest'
    const fetchLimit = needPostSort ? 1000 : limit
    const fetchOffset = needPostSort ? 0 : offset

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, firstName: true, lastName: true, phone: true,
          role: true, isActive: true, isBlocked: true, isVerified: true,
          preferredLang: true, passwordHash: true, profileImageUrl: true,
          tags: true, createdAt: true, lastLoginAt: true,
          _count: { select: { orders: true, wishlistItems: true, reviews: true } },
        },
        orderBy: needPostSort ? undefined : orderBy,
        take: fetchLimit,
        skip: fetchOffset,
      }),
      this.prisma.user.count({ where }),
    ])

    // Revenue per user
    const userIds = users.map((u) => u.id)
    const revenues = userIds.length > 0 ? await this.prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, status: { notIn: ['cancelled', 'refunded'] }, deletedAt: null },
      _sum: { totalAmount: true },
    }) : []
    const revenueMap = new Map<string, number>()
    for (const r of revenues) { if (r.userId) revenueMap.set(r.userId, Number(r._sum.totalAmount ?? 0)) }

    let result = users.map((u) => ({
      id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName,
      phone: u.phone, role: u.role, isActive: u.isActive, isBlocked: u.isBlocked,
      isVerified: u.isVerified, preferredLang: u.preferredLang,
      isGuest: !u.passwordHash, profileImageUrl: u.profileImageUrl,
      tags: (u.tags as string[]) ?? [],
      createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      ordersCount: u._count.orders, wishlistCount: u._count.wishlistItems,
      reviewsCount: u._count.reviews,
      totalRevenue: revenueMap.get(u.id) ?? 0,
    }))

    // Post-fetch filters
    if (query.filter === 'guest') result = result.filter((u) => u.isGuest)
    if (query.ordersMin != null) result = result.filter((u) => u.ordersCount >= query.ordersMin!)
    if (query.ordersMax != null) result = result.filter((u) => u.ordersCount <= query.ordersMax!)
    if (query.revenueMin != null) result = result.filter((u) => u.totalRevenue >= query.revenueMin!)
    if (query.revenueMax != null) result = result.filter((u) => u.totalRevenue <= query.revenueMax!)

    // Revenue sort
    if (query.sortBy === 'revenue') {
      result.sort((a, b) => dir === 'desc' ? b.totalRevenue - a.totalRevenue : a.totalRevenue - b.totalRevenue)
    }

    const filteredTotal = needPostSort ? result.length : total
    if (needPostSort) result = result.slice(offset, offset + limit)

    return { data: result, meta: { total: filteredTotal, limit, offset } }
  }

  // ── DETAIL ─────────────────────────────────────────────────

  async findOne(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        orders: {
          where: { deletedAt: null },
          select: {
            id: true, orderNumber: true, status: true, totalAmount: true,
            channel: true, currency: true, createdAt: true,
            items: { select: { id: true } },
          },
          orderBy: { createdAt: 'desc' }, take: 50,
        },
        addresses: { where: { deletedAt: null }, orderBy: { isDefaultShipping: 'desc' } },
        wishlistItems: {
          include: {
            product: {
              select: {
                id: true, slug: true, basePrice: true, salePrice: true,
                translations: { select: { name: true, language: true } },
                images: { select: { url: true, isPrimary: true }, take: 1, orderBy: { isPrimary: 'desc' } },
              },
            },
          },
        },
        customerNotes: { orderBy: { createdAt: 'desc' } },
        _count: { select: { orders: true, reviews: true, wishlistItems: true } },
      },
    })
    if (!user) throw new NotFoundException('User not found')

    // Revenue + avg
    const revenueAgg = await this.prisma.order.aggregate({
      where: { userId, status: { notIn: ['cancelled', 'refunded'] }, deletedAt: null },
      _sum: { totalAmount: true }, _avg: { totalAmount: true }, _count: true,
    })

    // Last order date
    const lastOrder = user.orders[0]
    const lastActivity = [user.lastLoginAt, lastOrder?.createdAt].filter(Boolean)
      .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0] ?? user.createdAt

    // Admin names for notes
    const adminIds = [...new Set(user.customerNotes.map((n) => n.adminId))]
    const admins = adminIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, firstName: true, lastName: true } })
      : []
    const adminMap = new Map(admins.map((a) => [a.id, `${a.firstName} ${a.lastName}`]))

    return {
      id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
      phone: user.phone, preferredLang: user.preferredLang, role: user.role,
      isActive: user.isActive, isBlocked: user.isBlocked, isVerified: user.isVerified,
      isGuest: !user.passwordHash, profileImageUrl: user.profileImageUrl,
      tags: (user.tags as string[]) ?? [],
      blockReason: user.blockReason, blockedAt: user.blockedAt,
      createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, lastActivity,
      orders: user.orders.map((o) => ({ ...o, totalAmount: Number(o.totalAmount), itemsCount: o.items.length })),
      addresses: user.addresses,
      wishlist: user.wishlistItems.map((w) => ({
        id: w.id, productId: w.product.id, slug: w.product.slug,
        basePrice: Number(w.product.basePrice), salePrice: w.product.salePrice ? Number(w.product.salePrice) : null,
        translations: w.product.translations,
        image: w.product.images[0]?.url ?? null, addedAt: w.createdAt,
      })),
      notes: user.customerNotes.map((n) => ({
        id: n.id, content: n.content, adminName: adminMap.get(n.adminId) ?? 'Admin', createdAt: n.createdAt,
      })),
      stats: {
        ordersCount: user._count.orders, reviewsCount: user._count.reviews,
        wishlistCount: user._count.wishlistItems,
        totalRevenue: Number(revenueAgg._sum.totalAmount ?? 0),
        avgOrderValue: Number(revenueAgg._avg.totalAmount ?? 0),
        paidOrdersCount: revenueAgg._count,
      },
    }
  }

  // ── CREATE ─────────────────────────────────────────────────

  async createCustomer(data: {
    email: string; firstName: string; lastName: string;
    phone?: string; lang?: string; notes?: string; tags?: string[];
  }, adminId: string, ipAddress: string) {
    // Check duplicate email
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } })
    if (existing) {
      throw new BadRequestException({
        statusCode: 400, error: 'EmailExists',
        message: { de: 'E-Mail existiert bereits.', en: 'Email already exists.', ar: 'البريد الإلكتروني موجود بالفعل.' },
      })
    }

    const user = await this.prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone?.trim() || null,
        preferredLang: (data.lang as any) ?? 'de',
        tags: data.tags ?? [],
        role: 'customer',
        isVerified: true, // admin-created = trusted
      },
    })

    // Add note if provided
    if (data.notes?.trim()) {
      await this.prisma.customerNote.create({
        data: { userId: user.id, adminId, content: data.notes.trim() },
      })
    }

    // Activity log
    await this.logActivity(user.id, 'registered', { source: 'admin', adminId })

    await this.audit.log({
      adminId, action: 'CUSTOMER_CREATED', entityType: 'user', entityId: user.id,
      changes: { after: { email: user.email, firstName: user.firstName, lastName: user.lastName } },
      ipAddress,
    })

    return user
  }

  // ── UPDATE ─────────────────────────────────────────────────

  async updateCustomer(userId: string, data: {
    firstName?: string; lastName?: string; phone?: string; preferredLang?: string; tags?: string[];
  }, adminId: string, ipAddress: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!user) throw new NotFoundException('User not found')

    const updateData: any = {}
    if (data.firstName !== undefined) updateData.firstName = data.firstName.trim()
    if (data.lastName !== undefined) updateData.lastName = data.lastName.trim()
    if (data.phone !== undefined) updateData.phone = data.phone.trim() || null
    if (data.preferredLang !== undefined) updateData.preferredLang = data.preferredLang
    if (data.tags !== undefined) updateData.tags = data.tags

    const updated = await this.prisma.user.update({ where: { id: userId }, data: updateData })

    await this.audit.log({
      adminId, action: 'CUSTOMER_UPDATED', entityType: 'user', entityId: userId,
      changes: { before: { firstName: user.firstName, lastName: user.lastName }, after: updateData },
      ipAddress,
    })

    return updated
  }

  // ── DELETE (GDPR Anonymize) ────────────────────────────────

  async deleteCustomer(userId: string, adminId: string, ipAddress: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!user) throw new NotFoundException('User not found')

    const hash = require('crypto').createHash('sha256').update(user.email).digest('hex').slice(0, 12)

    await this.prisma.$transaction([
      // Anonymize user data — orders stay for GoBD
      this.prisma.user.update({
        where: { id: userId },
        data: {
          firstName: 'Gelöscht',
          lastName: 'Gelöscht',
          email: `${hash}@deleted.local`,
          phone: null,
          profileImageUrl: null,
          anonymizedAt: new Date(),
          deletedAt: new Date(),
          isActive: false,
          tags: [],
        },
      }),
      // Remove addresses
      this.prisma.address.updateMany({ where: { userId }, data: { deletedAt: new Date() } }),
      // Revoke tokens
      this.prisma.refreshToken.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } }),
      // Remove wishlist
      this.prisma.wishlistItem.deleteMany({ where: { userId } }),
      // Remove GDPR consents
      this.prisma.gdprConsent.deleteMany({ where: { userId } }),
    ])

    await this.audit.log({
      adminId, action: 'CUSTOMER_DELETED_GDPR', entityType: 'user', entityId: userId,
      changes: { after: { anonymized: true, originalEmail: user.email } },
      ipAddress,
    })

    return { anonymized: true }
  }

  // ── GDPR DATA EXPORT ──────────────────────────────────────

  async exportCustomerData(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        addresses: { where: { deletedAt: null } },
        orders: { where: { deletedAt: null }, include: { items: true, payment: true, shipment: true } },
        wishlistItems: { include: { product: { select: { translations: true } } } },
        gdprConsents: true,
        reviews: true,
      },
    })
    if (!user) throw new NotFoundException('User not found')

    await this.logActivity(userId, 'data_exported', { source: 'admin' })

    return {
      personalData: {
        firstName: user.firstName, lastName: user.lastName, email: user.email,
        phone: user.phone, preferredLang: user.preferredLang, createdAt: user.createdAt,
      },
      addresses: user.addresses,
      orders: user.orders.map((o: any) => ({
        orderNumber: o.orderNumber, status: o.status, totalAmount: Number(o.totalAmount),
        createdAt: o.createdAt, items: o.items, payment: o.payment, shipment: o.shipment,
      })),
      wishlist: user.wishlistItems,
      consents: user.gdprConsents,
      reviews: user.reviews,
      exportedAt: new Date().toISOString(),
    }
  }

  // ── NOTES ──────────────────────────────────────────────────

  async addNote(userId: string, content: string, adminId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!user) throw new NotFoundException('User not found')
    if (!content?.trim()) {
      throw new BadRequestException({ statusCode: 400, error: 'ContentRequired',
        message: { de: 'Notiz darf nicht leer sein.', en: 'Note cannot be empty.', ar: 'لا يمكن أن تكون الملاحظة فارغة.' } })
    }
    const note = await this.prisma.customerNote.create({ data: { userId, adminId, content: content.trim() } })
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { firstName: true, lastName: true } })
    return { id: note.id, content: note.content, adminName: admin ? `${admin.firstName} ${admin.lastName}` : 'Admin', createdAt: note.createdAt }
  }

  async updateNote(noteId: string, content: string) {
    const note = await this.prisma.customerNote.findUnique({ where: { id: noteId } })
    if (!note) throw new NotFoundException('Note not found')
    if (!content?.trim()) {
      throw new BadRequestException({ statusCode: 400, error: 'ContentRequired',
        message: { de: 'Notiz darf nicht leer sein.', en: 'Note cannot be empty.', ar: 'لا يمكن أن تكون الملاحظة فارغة.' } })
    }
    return this.prisma.customerNote.update({ where: { id: noteId }, data: { content: content.trim() } })
  }

  async deleteNote(noteId: string) {
    const note = await this.prisma.customerNote.findUnique({ where: { id: noteId } })
    if (!note) throw new NotFoundException('Note not found')
    await this.prisma.customerNote.delete({ where: { id: noteId } })
    return { deleted: true }
  }

  // ── TAGS ───────────────────────────────────────────────────

  async setTags(userId: string, tags: string[], adminId: string, ipAddress: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!user) throw new NotFoundException('User not found')

    const oldTags = (user.tags as string[]) ?? []
    await this.prisma.user.update({ where: { id: userId }, data: { tags } })
    await this.logActivity(userId, 'tag_changed', { oldTags, newTags: tags, adminId })

    await this.audit.log({
      adminId, action: 'CUSTOMER_TAGS_CHANGED', entityType: 'user', entityId: userId,
      changes: { before: { tags: oldTags }, after: { tags } }, ipAddress,
    })

    return { tags }
  }

  async bulkTag(userIds: string[], tags: string[], adminId: string, ipAddress: string) {
    for (const userId of userIds) {
      const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
      if (!user) continue
      const existing = (user.tags as string[]) ?? []
      const merged = [...new Set([...existing, ...tags])]
      await this.prisma.user.update({ where: { id: userId }, data: { tags: merged } })
    }
    await this.audit.log({
      adminId, action: 'CUSTOMER_BULK_TAGGED', entityType: 'user',
      changes: { after: { userIds, tags } }, ipAddress,
    })
    return { updated: userIds.length }
  }

  // ── BLOCK / UNBLOCK ────────────────────────────────────────

  async blockUser(userId: string, reason: string, adminId: string, ipAddress: string) {
    if (!reason?.trim()) {
      throw new BadRequestException({ statusCode: 400, error: 'ReasonRequired',
        message: { de: 'Begründung ist Pflicht.', en: 'Reason is required.', ar: 'السبب مطلوب.' } })
    }
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!user) throw new NotFoundException('User not found')

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { isBlocked: true, blockedAt: new Date(), blockReason: reason, blockedBy: adminId } }),
      this.prisma.refreshToken.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } }),
    ])
    await this.logActivity(userId, 'blocked', { reason, adminId })
    await this.audit.log({ adminId, action: 'USER_BLOCKED', entityType: 'user', entityId: userId, changes: { before: { isBlocked: false }, after: { isBlocked: true, reason } }, ipAddress })
  }

  async unblockUser(userId: string, adminId: string, ipAddress: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, isBlocked: true } })
    if (!user) throw new NotFoundException('User not found or not blocked')

    await this.prisma.user.update({ where: { id: userId }, data: { isBlocked: false, blockedAt: null, blockReason: null, blockedBy: null } })
    await this.logActivity(userId, 'unblocked', { adminId })
    await this.audit.log({ adminId, action: 'USER_UNBLOCKED', entityType: 'user', entityId: userId, changes: { before: { isBlocked: true }, after: { isBlocked: false } }, ipAddress })
  }

  async bulkBlock(userIds: string[], reason: string, adminId: string, ipAddress: string) {
    for (const userId of userIds) {
      try { await this.blockUser(userId, reason, adminId, ipAddress) } catch {}
    }
    return { blocked: userIds.length }
  }

  async bulkUnblock(userIds: string[], adminId: string, ipAddress: string) {
    for (const userId of userIds) {
      try { await this.unblockUser(userId, adminId, ipAddress) } catch {}
    }
    return { unblocked: userIds.length }
  }

  // ── EMAIL ──────────────────────────────────────────────────

  async sendEmail(userId: string, subject: string, body: string, adminId: string, ipAddress: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!user) throw new NotFoundException('User not found')
    if (!subject?.trim() || !body?.trim()) {
      throw new BadRequestException({ statusCode: 400, error: 'SubjectAndBodyRequired',
        message: { de: 'Betreff und Nachricht sind Pflicht.', en: 'Subject and body are required.', ar: 'الموضوع والرسالة مطلوبان.' } })
    }

    // Log email
    const log = await this.prisma.emailLog.create({
      data: { userId: user.id, toEmail: user.email, subject: subject.trim(), template: 'admin-custom', status: 'queued' },
    })

    try {
      await this.emailService.enqueue({
        to: user.email, type: 'admin-custom' as any, lang: user.preferredLang ?? 'de',
        data: { firstName: user.firstName, subject: subject.trim(), body: body.trim() },
      })
      await this.prisma.emailLog.update({ where: { id: log.id }, data: { status: 'sent', sentAt: new Date() } })
    } catch (err: any) {
      await this.prisma.emailLog.update({ where: { id: log.id }, data: { status: 'failed', errorMsg: err?.message } })
    }

    await this.logActivity(userId, 'email_sent', { subject, adminId })
    await this.audit.log({ adminId, action: 'CUSTOMER_EMAIL_SENT', entityType: 'user', entityId: userId, changes: { after: { subject, to: user.email } }, ipAddress })
    return { sent: true, to: user.email }
  }

  async bulkEmail(userIds: string[], subject: string, body: string, adminId: string, ipAddress: string) {
    let sent = 0
    for (const userId of userIds) {
      try { await this.sendEmail(userId, subject, body, adminId, ipAddress); sent++ } catch {}
    }
    return { sent, total: userIds.length }
  }

  async getEmailHistory(userId: string) {
    return this.prisma.emailLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  // ── ACTIVITY TIMELINE ──────────────────────────────────────

  async getActivity(userId: string) {
    // Combine: activities + orders + returns for a full timeline
    const [activities, orders, returns] = await Promise.all([
      this.prisma.customerActivity.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.order.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, orderNumber: true, status: true, totalAmount: true, createdAt: true },
        orderBy: { createdAt: 'desc' }, take: 50,
      }),
      this.prisma.return.findMany({
        where: { order: { userId } },
        select: { id: true, reason: true, status: true, createdAt: true, order: { select: { orderNumber: true } } },
        orderBy: { createdAt: 'desc' }, take: 20,
      }),
    ])

    // Build unified timeline
    const timeline: any[] = []

    for (const a of activities) {
      timeline.push({ id: a.id, type: a.type, metadata: a.metadata, createdAt: a.createdAt })
    }
    for (const o of orders) {
      timeline.push({ id: `order-${o.id}`, type: 'order_placed', metadata: { orderId: o.id, orderNumber: o.orderNumber, amount: Number(o.totalAmount), status: o.status }, createdAt: o.createdAt })
    }
    for (const r of returns) {
      timeline.push({ id: `return-${r.id}`, type: 'return_requested', metadata: { returnId: r.id, orderNumber: r.order?.orderNumber, reason: r.reason, status: r.status }, createdAt: r.createdAt })
    }

    // Sort desc, deduplicate by type+timestamp proximity
    timeline.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return timeline.slice(0, 100)
  }

  // ── ABANDONED CARTS ────────────────────────────────────────

  async getAbandonedCarts(userId: string) {
    return this.prisma.abandonedCart.findMany({
      where: { userId, recoveredAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
  }

  async sendCartReminder(cartId: string, _adminId: string) {
    const cart = await this.prisma.abandonedCart.findUnique({ where: { id: cartId } })
    if (!cart || !cart.userId) throw new NotFoundException('Cart not found')

    const user = await this.prisma.user.findUnique({ where: { id: cart.userId } })
    if (!user) throw new NotFoundException('User not found')

    await this.emailService.enqueue({
      to: user.email, type: 'cart-reminder' as any, lang: user.preferredLang ?? 'de',
      data: { firstName: user.firstName, items: cart.items, totalAmount: Number(cart.totalAmount) },
    })

    await this.prisma.abandonedCart.update({ where: { id: cartId }, data: { reminderSentAt: new Date() } })
    return { sent: true }
  }

  // ── STATS ──────────────────────────────────────────────────

  async getCustomerStats() {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)

    const baseWhere = { deletedAt: null, anonymizedAt: null, role: 'customer' as any }

    const [total, active, blocked, guests, newThisMonth, newLastMonth, newThisWeek] = await Promise.all([
      this.prisma.user.count({ where: baseWhere }),
      this.prisma.user.count({ where: { ...baseWhere, isBlocked: false, isActive: true } }),
      this.prisma.user.count({ where: { ...baseWhere, isBlocked: true } }),
      this.prisma.user.count({ where: { ...baseWhere, passwordHash: null } }),
      this.prisma.user.count({ where: { ...baseWhere, createdAt: { gte: startOfMonth } } }),
      this.prisma.user.count({ where: { ...baseWhere, createdAt: { gte: startOfLastMonth, lt: startOfMonth } } }),
      this.prisma.user.count({ where: { ...baseWhere, createdAt: { gte: startOfWeek } } }),
    ])

    // Average order value
    const avgOrder = await this.prisma.order.aggregate({
      where: { status: { notIn: ['cancelled', 'refunded'] }, deletedAt: null },
      _avg: { totalAmount: true },
    })

    // Returning customers (>1 order)
    const returningRaw = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { deletedAt: null, userId: { not: null } },
      _count: true,
    })
    const returningCount = returningRaw.filter((r) => r._count > 1).length
    const totalWithOrders = returningRaw.length
    const returningPercent = totalWithOrders > 0 ? Math.round((returningCount / totalWithOrders) * 100) : 0

    // Monthly trend
    const monthlyTrend = newLastMonth > 0 ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100) : newThisMonth > 0 ? 100 : 0

    // All unique tags
    const allUsers = await this.prisma.user.findMany({
      where: { ...baseWhere, tags: { not: '[]' } },
      select: { tags: true },
    })
    const allTags = new Set<string>()
    for (const u of allUsers) {
      for (const tag of (u.tags as string[]) ?? []) allTags.add(tag)
    }

    return {
      total, active, blocked, guests, registered: total - guests,
      newThisMonth, newThisWeek, newLastMonth, monthlyTrend,
      avgOrderValue: Number(avgOrder._avg.totalAmount ?? 0),
      returningPercent,
      allTags: [...allTags].sort(),
    }
  }

  // ── CSV EXPORT ─────────────────────────────────────────────

  async exportCsv(query: { filter?: string; tag?: string; search?: string }) {
    const result = await this.findAll({ ...query, limit: 5000, offset: 0 })
    const header = 'Name;E-Mail;Telefon;Sprache;Bestellungen;Umsatz;Status;Tags;Registriert\n'
    const rows = result.data.map((u) =>
      `${u.firstName} ${u.lastName};${u.email};${u.phone ?? ''};${u.preferredLang};${u.ordersCount};${u.totalRevenue.toFixed(2)};${u.isBlocked ? 'Gesperrt' : 'Aktiv'};${u.tags.join(', ')};${new Date(u.createdAt).toLocaleDateString('de-DE')}`
    ).join('\n')
    return header + rows
  }

  // ── HELPERS ────────────────────────────────────────────────

  private async logActivity(userId: string, type: string, metadata?: any) {
    try {
      await this.prisma.customerActivity.create({ data: { userId, type, metadata } })
    } catch (err) {
      this.logger.warn(`Failed to log activity for user ${userId}: ${err}`)
    }
  }
}
