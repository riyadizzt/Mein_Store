import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcrypt'
import * as crypto from 'crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'
import { EmailService } from '../../email/email.service'
import { ROLE_PRESETS, ALL_PERMISSIONS, PERMISSION_GROUPS } from '../../../common/permissions/permission.constants'

@Injectable()
export class AdminStaffService {
  private readonly logger = new Logger(AdminStaffService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ── List all staff ──────────────────────────────────────────

  async findAll(query: { search?: string }) {
    const where: any = { role: { in: ['admin', 'super_admin', 'warehouse_staff'] }, deletedAt: null }
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ]
    }
    return this.prisma.user.findMany({
      where,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, staffRole: true, permissions: true,
        lastLoginAt: true, isActive: true, isBlocked: true,
        profileImageUrl: true, createdAt: true, invitedBy: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  // ── Get single staff with activity ──────────────────────────

  async findOne(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: { in: ['admin', 'super_admin', 'warehouse_staff'] }, deletedAt: null },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, staffRole: true, permissions: true,
        lastLoginAt: true, isActive: true, isBlocked: true,
        profileImageUrl: true, createdAt: true, invitedBy: true,
        lockedUntil: true, loginAttempts: true,
      },
    })
    if (!user) throw new NotFoundException('Staff member not found')
    return user
  }

  // ── Invite new staff member ─────────────────────────────────

  async invite(
    data: { email: string; staffRole: string; customPermissions?: string[] },
    adminId: string,
    ip: string,
  ) {
    // Validate staffRole
    const validRoles = ['seller', 'warehouse', 'manager', 'full_access', 'custom']
    if (!validRoles.includes(data.staffRole)) throw new BadRequestException('Invalid staff role')

    const permissions = data.staffRole === 'custom'
      ? (data.customPermissions ?? []).filter((p) => ALL_PERMISSIONS.includes(p))
      : ROLE_PRESETS[data.staffRole] ?? []

    const inviteToken = crypto.randomBytes(32).toString('hex')
    const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const role = data.staffRole === 'warehouse' ? 'warehouse_staff' : 'admin'

    const existing = await this.prisma.user.findUnique({ where: { email: data.email.toLowerCase() } })

    let user: any
    if (existing) {
      // If already a staff member → reject
      if (['admin', 'super_admin', 'warehouse_staff'].includes(existing.role) && !existing.deletedAt) {
        throw new ConflictException({ message: { de: 'Bereits als Mitarbeiter registriert', en: 'Already registered as staff', ar: 'مسجل بالفعل كموظف' } })
      }
      // Existing customer → upgrade to staff
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          role: role as any,
          staffRole: data.staffRole as any,
          permissions,
          inviteToken,
          inviteExpiresAt,
          invitedBy: adminId,
          deletedAt: null,
          isActive: existing.passwordHash ? true : false, // if they have a password, activate immediately
          isVerified: existing.isVerified,
        },
        select: { id: true, email: true, staffRole: true },
      })
      this.logger.log(`Customer ${existing.email} upgraded to staff: ${data.staffRole}`)
    } else {
      // New user
      user = await this.prisma.user.create({
        data: {
          email: data.email.toLowerCase().trim(),
          firstName: '',
          lastName: '',
          role: role as any,
          staffRole: data.staffRole as any,
          permissions,
          isActive: false,
          isVerified: false,
          inviteToken,
          inviteExpiresAt,
          invitedBy: adminId,
        },
        select: { id: true, email: true, staffRole: true },
      })
    }

    // Send invite email
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { firstName: true } })
    const frontendUrl = this.config.get('FRONTEND_URL') ?? 'http://localhost:3000'
    const inviteUrl = `${frontendUrl}/de/admin/accept-invite?token=${inviteToken}`

    await this.emailService.queueAdminAlert(
      data.email,
      'de',
      `${admin?.firstName ?? 'Admin'} hat Sie als Mitarbeiter bei Malak Bekleidung eingeladen. Klicken Sie hier um Ihr Konto einzurichten: ${inviteUrl}`,
    ).catch(() => {})

    this.logger.log(`Staff invite sent: ${data.email} as ${data.staffRole} | token: ${inviteToken}`)

    await this.audit.log({
      adminId, action: 'STAFF_INVITED', entityType: 'user', entityId: user.id,
      changes: { after: { email: data.email, staffRole: data.staffRole, permissions } },
      ipAddress: ip,
    })

    return { ...user, inviteUrl }
  }

  // ── Accept invite ───────────────────────────────────────────

  async acceptInvite(token: string, data: { firstName: string; lastName: string; password: string }) {
    const user = await this.prisma.user.findFirst({
      where: { inviteToken: token, inviteExpiresAt: { gt: new Date() } },
    })

    if (!user) throw new NotFoundException({ message: { de: 'Einladungslink ungültig oder abgelaufen', en: 'Invite link invalid or expired', ar: 'رابط الدعوة غير صالح أو منتهي' } })

    if (user.passwordHash) throw new BadRequestException('Invite already accepted')

    const passwordHash = await bcrypt.hash(data.password, 12)

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        passwordHash,
        isActive: true,
        isVerified: true,
        inviteToken: null,
        inviteExpiresAt: null,
      },
    })

    this.logger.log(`Staff invite accepted: ${user.email}`)
    return { success: true, email: user.email }
  }

  // ── Legacy: create with password (kept for backward compat) ─

  async create(
    data: { email: string; firstName: string; lastName: string; role: 'admin' | 'super_admin'; password: string },
    adminId: string,
    ip: string,
  ) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } })
    if (existing) throw new ConflictException({ message: { de: 'E-Mail bereits vergeben', en: 'Email already in use', ar: 'البريد مستخدم بالفعل' } })

    const passwordHash = await bcrypt.hash(data.password, 12)
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        passwordHash,
        isVerified: true,
        staffRole: data.role === 'super_admin' ? null : 'full_access' as any,
        gdprConsents: { create: { consentType: 'data_processing' as any, isGranted: true, grantedAt: new Date(), consentVersion: '1.0', ipAddress: ip, source: 'registration' as any } },
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    })

    await this.audit.log({ adminId, action: 'STAFF_CREATED', entityType: 'user', entityId: user.id, changes: { after: { email: data.email, role: data.role } }, ipAddress: ip })
    return user
  }

  // ── Update role + permissions ───────────────────────────────

  async updateRole(
    userId: string,
    data: { staffRole?: string; customPermissions?: string[]; role?: string },
    adminId: string,
    ip: string,
  ) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: { in: ['admin', 'super_admin', 'warehouse_staff'] }, deletedAt: null } })
    if (!user) throw new NotFoundException('Staff member not found')
    if (user.id === adminId) throw new BadRequestException({ message: { de: 'Eigene Rolle kann nicht geändert werden', en: 'Cannot change own role', ar: 'لا يمكن تغيير دورك الخاص' } })
    if (user.role === 'super_admin') throw new ForbiddenException({ message: { de: 'Super-Admin Rolle kann nicht geändert werden', en: 'Cannot change super admin role', ar: 'لا يمكن تغيير دور المدير العام' } })

    const updateData: any = {}

    if (data.staffRole) {
      updateData.staffRole = data.staffRole
      // Set permissions based on role preset (unless custom)
      if (data.staffRole !== 'custom') {
        updateData.permissions = ROLE_PRESETS[data.staffRole] ?? []
      }
      // Update base role
      updateData.role = data.staffRole === 'warehouse' ? 'warehouse_staff' : 'admin'
    }

    if (data.staffRole === 'custom' && data.customPermissions) {
      updateData.permissions = data.customPermissions.filter((p) => ALL_PERMISSIONS.includes(p))
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, email: true, role: true, staffRole: true, permissions: true },
    })

    await this.audit.log({
      adminId, action: 'STAFF_ROLE_CHANGED', entityType: 'user', entityId: userId,
      changes: { before: { staffRole: user.staffRole, role: user.role }, after: { staffRole: updated.staffRole, role: updated.role } },
      ipAddress: ip,
    })

    return updated
  }

  // ── Toggle active ───────────────────────────────────────────

  async toggleActive(userId: string, activate: boolean, adminId: string, ip: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: { in: ['admin', 'super_admin', 'warehouse_staff'] }, deletedAt: null } })
    if (!user) throw new NotFoundException('Staff member not found')
    if (user.id === adminId) throw new BadRequestException({ message: { de: 'Eigenes Konto kann nicht deaktiviert werden', en: 'Cannot deactivate own account', ar: 'لا يمكن تعطيل حسابك الخاص' } })
    if (user.role === 'super_admin' && !activate) throw new ForbiddenException({ message: { de: 'Super-Admin kann nicht deaktiviert werden', en: 'Cannot deactivate super admin', ar: 'لا يمكن تعطيل المدير العام' } })

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: activate, ...(activate ? { isBlocked: false, blockedAt: null, blockReason: null, loginAttempts: 0, lockedUntil: null } : {}) },
      select: { id: true, email: true, isActive: true },
    })

    if (!activate) {
      await this.prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } })
    }

    await this.audit.log({ adminId, action: activate ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED', entityType: 'user', entityId: userId, ipAddress: ip })
    return updated
  }

  // ── Reset password ──────────────────────────────────────────

  async resetPassword(userId: string, adminId: string, ip: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: { in: ['admin', 'super_admin', 'warehouse_staff'] }, deletedAt: null } })
    if (!user) throw new NotFoundException('Staff member not found')

    const tempPassword = crypto.randomBytes(6).toString('hex')
    const passwordHash = await bcrypt.hash(tempPassword, 12)

    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash, loginAttempts: 0, lockedUntil: null } })
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } })

    await this.audit.log({ adminId, action: 'STAFF_PASSWORD_RESET', entityType: 'user', entityId: userId, ipAddress: ip })
    return { tempPassword, email: user.email }
  }

  // ── Soft delete (remove from list, keep data) ───────────────

  async softDelete(userId: string, adminId: string, ip: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: { in: ['admin', 'warehouse_staff'] }, deletedAt: null } })
    if (!user) throw new NotFoundException('Staff member not found')
    if (user.id === adminId) throw new BadRequestException({ message: { de: 'Eigenes Konto kann nicht gelöscht werden', en: 'Cannot delete own account', ar: 'لا يمكن حذف حسابك الخاص' } })
    if (user.role === 'super_admin') throw new ForbiddenException({ message: { de: 'Super-Admin kann nicht gelöscht werden', en: 'Cannot delete super admin', ar: 'لا يمكن حذف المدير العام' } })

    await this.prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date(), isActive: false } })
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } })

    await this.audit.log({ adminId, action: 'STAFF_DELETED', entityType: 'user', entityId: userId, changes: { before: { email: user.email, role: user.role } }, ipAddress: ip })
    this.logger.log(`Staff soft-deleted: ${user.email} by ${adminId}`)
    return { success: true }
  }

  // ── Get activity log ────────────────────────────────────────

  async getActivity(userId: string) {
    return this.prisma.adminAuditLog.findMany({
      where: { adminId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, ipAddress: true, changes: true },
    })
  }

  // ── Get permission definitions (for frontend UI) ────────────

  getPermissionDefinitions() {
    return { groups: PERMISSION_GROUPS, presets: ROLE_PRESETS }
  }
}
