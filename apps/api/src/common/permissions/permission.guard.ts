import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PERMISSIONS_KEY } from './require-permission.decorator'
import { ROLE_PRESETS } from './permission.constants'

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // No @RequirePermission decorator → allow (fall back to RolesGuard)
    if (!requiredPermissions || requiredPermissions.length === 0) return true

    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (!user) throw new ForbiddenException('Nicht authentifiziert')

    // super_admin bypasses ALL permission checks
    if (user.role === 'super_admin') return true

    // Get user's effective permissions
    const userPermissions = this.getUserPermissions(user)

    // Check if user has ALL required permissions
    const hasAll = requiredPermissions.every((p) => userPermissions.includes(p))

    if (!hasAll) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: {
          de: 'Sie haben keine Berechtigung für diese Aktion',
          en: 'You do not have permission for this action',
          ar: 'ليس لديك صلاحية لهذا الإجراء',
        },
        requiredPermissions,
      })
    }

    return true
  }

  private getUserPermissions(user: any): string[] {
    // 1. If user has custom permissions stored in DB, use those
    if (user.permissions && Array.isArray(user.permissions) && user.permissions.length > 0) {
      return user.permissions
    }

    // 2. If user has a staffRole, use the preset
    if (user.staffRole && ROLE_PRESETS[user.staffRole]) {
      return ROLE_PRESETS[user.staffRole]
    }

    // 3. Legacy: admin role without staffRole = full access
    if (user.role === 'admin') {
      return ROLE_PRESETS.full_access ?? []
    }

    // 4. warehouse_staff without staffRole = warehouse preset
    if (user.role === 'warehouse_staff') {
      return ROLE_PRESETS.warehouse ?? []
    }

    return []
  }
}
