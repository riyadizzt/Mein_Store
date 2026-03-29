import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import * as crypto from 'crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'

@Injectable()
export class AdminStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: { search?: string }) {
    const where: any = { role: { in: ['admin', 'super_admin'] }, deletedAt: null }
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
        role: true, lastLoginAt: true, isActive: true, isBlocked: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

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
        gdprConsents: { create: { consentType: 'data_processing' as any, isGranted: true, grantedAt: new Date(), consentVersion: '1.0', ipAddress: ip, source: 'registration' as any } },
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    })

    await this.audit.log({ adminId, action: 'STAFF_CREATED', entityType: 'user', entityId: user.id, changes: { after: { email: data.email, role: data.role } }, ipAddress: ip })
    return user
  }

  async updateRole(userId: string, newRole: 'admin' | 'super_admin', adminId: string, ip: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: { in: ['admin', 'super_admin'] }, deletedAt: null } })
    if (!user) throw new NotFoundException('Staff member not found')
    if (user.id === adminId) throw new BadRequestException({ message: { de: 'Eigene Rolle kann nicht geändert werden', en: 'Cannot change own role', ar: 'لا يمكن تغيير دورك الخاص' } })

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
      select: { id: true, email: true, role: true },
    })

    await this.audit.log({ adminId, action: 'STAFF_ROLE_CHANGED', entityType: 'user', entityId: userId, changes: { before: { role: user.role }, after: { role: newRole } }, ipAddress: ip })
    return updated
  }

  async toggleActive(userId: string, activate: boolean, adminId: string, ip: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: { in: ['admin', 'super_admin'] }, deletedAt: null } })
    if (!user) throw new NotFoundException('Staff member not found')
    if (user.id === adminId) throw new BadRequestException({ message: { de: 'Eigenes Konto kann nicht deaktiviert werden', en: 'Cannot deactivate own account', ar: 'لا يمكن تعطيل حسابك الخاص' } })

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: activate, ...(activate ? { isBlocked: false, blockedAt: null, blockReason: null } : {}) },
      select: { id: true, email: true, isActive: true },
    })

    // Revoke all sessions when deactivating
    if (!activate) {
      await this.prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } })
    }

    await this.audit.log({ adminId, action: activate ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED', entityType: 'user', entityId: userId, ipAddress: ip })
    return updated
  }

  async resetPassword(userId: string, adminId: string, ip: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, role: { in: ['admin', 'super_admin'] }, deletedAt: null } })
    if (!user) throw new NotFoundException('Staff member not found')

    // Generate a temporary password
    const tempPassword = crypto.randomBytes(6).toString('hex') // 12 chars
    const passwordHash = await bcrypt.hash(tempPassword, 12)

    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } })
    // Revoke all sessions
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } })

    await this.audit.log({ adminId, action: 'STAFF_PASSWORD_RESET', entityType: 'user', entityId: userId, ipAddress: ip })
    return { tempPassword, email: user.email }
  }

  async getActivity(userId: string) {
    return this.prisma.adminAuditLog.findMany({
      where: { adminId: userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, ipAddress: true },
    })
  }
}
