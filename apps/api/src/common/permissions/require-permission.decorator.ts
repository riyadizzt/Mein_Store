import { SetMetadata } from '@nestjs/common'

export const PERMISSIONS_KEY = 'required_permissions'

/**
 * Decorator: @RequirePermission('orders.view', 'orders.edit')
 * User needs ALL listed permissions to access the endpoint.
 * super_admin bypasses all permission checks.
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions)
