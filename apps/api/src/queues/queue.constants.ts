export const QUEUE_NAMES = {
  SHOPIFY_SYNC: 'shopify-sync',
  EMAIL: 'email',
  INVENTORY_SYNC: 'inventory-sync',
  ORDER_PROCESSING: 'order-processing',
} as const

export const JOB_NAMES = {
  // Shopify Sync
  PROCESS_WEBHOOK: 'process-webhook',
  RETRY_SYNC: 'retry-sync',
  FULL_INVENTORY_SYNC: 'full-inventory-sync',

  // Email
  SEND_ORDER_CONFIRMATION: 'send-order-confirmation',
  SEND_SHIPPING_NOTIFICATION: 'send-shipping-notification',
  SEND_PASSWORD_RESET: 'send-password-reset',
  SEND_WELCOME: 'send-welcome',

  // Inventory
  SYNC_TO_ALL_CHANNELS: 'sync-to-all-channels',
  CHECK_LOW_STOCK: 'check-low-stock',

  // Orders
  PROCESS_NEW_ORDER: 'process-new-order',
  GENERATE_INVOICE: 'generate-invoice',
} as const
