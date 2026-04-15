// ── All permission keys ──────────────────────────────────────
export const PERMISSIONS = {
  // Orders
  ORDERS_VIEW: 'orders.view',
  ORDERS_EDIT: 'orders.edit',
  ORDERS_CANCEL: 'orders.cancel',

  // Products
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_EDIT: 'products.edit',
  PRODUCTS_DELETE: 'products.delete',

  // Inventory
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_INTAKE: 'inventory.intake',
  INVENTORY_TRANSFER: 'inventory.transfer',
  INVENTORY_STOCKTAKE: 'inventory.stocktake',

  // Scanner
  SCANNER_VIEW_PRICES: 'scanner.view_prices',

  // Customers
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_EDIT: 'customers.edit',
  CUSTOMERS_DELETE: 'customers.delete',
  CUSTOMERS_GDPR: 'customers.gdpr',

  // Finance
  FINANCE_REVENUE: 'finance.revenue',
  FINANCE_MARGINS: 'finance.margins',
  FINANCE_PURCHASE_PRICES: 'finance.purchase_prices',
  FINANCE_INVOICES: 'finance.invoices',
  FINANCE_VAT_REPORT: 'finance.vat_report',
  FINANCE_EXPORT: 'finance.export',

  // Returns
  RETURNS_VIEW: 'returns.view',
  RETURNS_EDIT: 'returns.edit',
  RETURNS_APPROVE: 'returns.approve',

  // Shipping
  SHIPPING_VIEW: 'shipping.view',
  SHIPPING_LABELS: 'shipping.labels',
  SHIPPING_STATUS: 'shipping.status',

  // Emails
  EMAILS_VIEW: 'emails.view',
  EMAILS_EDIT: 'emails.edit',
  EMAILS_TEST: 'emails.test',

  // Settings
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_EDIT: 'settings.edit',

  // Staff
  STAFF_VIEW: 'staff.view',
  STAFF_INVITE: 'staff.invite',
  STAFF_ROLES: 'staff.roles',
  STAFF_DEACTIVATE: 'staff.deactivate',

  // Audit
  AUDIT_VIEW: 'audit.view',

  // Dashboard
  DASHBOARD_VIEW: 'dashboard.view',

  // Categories
  CATEGORIES_VIEW: 'categories.view',
  CATEGORIES_EDIT: 'categories.edit',

  // Suppliers (nur super_admin / Inhaber)
  SUPPLIERS_VIEW: 'suppliers.view',
  SUPPLIERS_EDIT: 'suppliers.edit',
  SUPPLIERS_PAYMENTS: 'suppliers.payments',
  SUPPLIERS_RECEIVING: 'suppliers.receiving',
} as const

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS]

// ── All permission keys as flat array ────────────────────────
export const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS)

// ── Role presets ─────────────────────────────────────────────
export const ROLE_PRESETS: Record<string, string[]> = {
  seller: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ORDERS_VIEW, PERMISSIONS.ORDERS_EDIT,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.RETURNS_VIEW, PERMISSIONS.RETURNS_EDIT,
    PERMISSIONS.SHIPPING_VIEW, PERMISSIONS.SHIPPING_STATUS,
  ],

  warehouse: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_INTAKE,
    PERMISSIONS.INVENTORY_TRANSFER, PERMISSIONS.INVENTORY_STOCKTAKE,
    PERMISSIONS.SHIPPING_VIEW, PERMISSIONS.SHIPPING_LABELS,
    PERMISSIONS.CATEGORIES_VIEW,
  ],

  manager: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ORDERS_VIEW, PERMISSIONS.ORDERS_EDIT,
    PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.PRODUCTS_CREATE, PERMISSIONS.PRODUCTS_EDIT,
    PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_INTAKE, PERMISSIONS.INVENTORY_TRANSFER, PERMISSIONS.INVENTORY_STOCKTAKE,
    PERMISSIONS.SCANNER_VIEW_PRICES,
    PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_EDIT,
    PERMISSIONS.FINANCE_REVENUE, PERMISSIONS.FINANCE_MARGINS, PERMISSIONS.FINANCE_INVOICES, PERMISSIONS.FINANCE_VAT_REPORT, PERMISSIONS.FINANCE_EXPORT,
    PERMISSIONS.RETURNS_VIEW, PERMISSIONS.RETURNS_EDIT, PERMISSIONS.RETURNS_APPROVE,
    PERMISSIONS.SHIPPING_VIEW, PERMISSIONS.SHIPPING_LABELS, PERMISSIONS.SHIPPING_STATUS,
    PERMISSIONS.EMAILS_VIEW,
    PERMISSIONS.CATEGORIES_VIEW, PERMISSIONS.CATEGORIES_EDIT,
    PERMISSIONS.AUDIT_VIEW,
  ],

  full_access: [
    ...Object.values(PERMISSIONS).filter(
      (p) => !p.startsWith('staff.') && p !== PERMISSIONS.SETTINGS_EDIT,
    ),
    PERMISSIONS.STAFF_VIEW,
    PERMISSIONS.SETTINGS_VIEW,
  ],
}

// ── Permission labels (for UI) ───────────────────────────────
export const PERMISSION_GROUPS: { key: string; label: { de: string; en: string; ar: string }; permissions: { key: string; label: { de: string; en: string; ar: string } }[] }[] = [
  {
    key: 'dashboard', label: { de: 'Dashboard', en: 'Dashboard', ar: 'لوحة التحكم' },
    permissions: [
      { key: PERMISSIONS.DASHBOARD_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
    ],
  },
  {
    key: 'orders', label: { de: 'Bestellungen', en: 'Orders', ar: 'الطلبات' },
    permissions: [
      { key: PERMISSIONS.ORDERS_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.ORDERS_EDIT, label: { de: 'Status ändern', en: 'Edit status', ar: 'تعديل الحالة' } },
      { key: PERMISSIONS.ORDERS_CANCEL, label: { de: 'Stornieren', en: 'Cancel', ar: 'إلغاء' } },
    ],
  },
  {
    key: 'products', label: { de: 'Produkte', en: 'Products', ar: 'المنتجات' },
    permissions: [
      { key: PERMISSIONS.PRODUCTS_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.PRODUCTS_CREATE, label: { de: 'Erstellen', en: 'Create', ar: 'إنشاء' } },
      { key: PERMISSIONS.PRODUCTS_EDIT, label: { de: 'Bearbeiten', en: 'Edit', ar: 'تعديل' } },
      { key: PERMISSIONS.PRODUCTS_DELETE, label: { de: 'Löschen', en: 'Delete', ar: 'حذف' } },
    ],
  },
  {
    key: 'categories', label: { de: 'Kategorien', en: 'Categories', ar: 'الفئات' },
    permissions: [
      { key: PERMISSIONS.CATEGORIES_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.CATEGORIES_EDIT, label: { de: 'Bearbeiten', en: 'Edit', ar: 'تعديل' } },
    ],
  },
  {
    key: 'inventory', label: { de: 'Lager / Inventar', en: 'Inventory', ar: 'المخزون' },
    permissions: [
      { key: PERMISSIONS.INVENTORY_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.INVENTORY_INTAKE, label: { de: 'Wareneingang', en: 'Intake', ar: 'استلام بضاعة' } },
      { key: PERMISSIONS.INVENTORY_TRANSFER, label: { de: 'Transfer', en: 'Transfer', ar: 'نقل' } },
      { key: PERMISSIONS.INVENTORY_STOCKTAKE, label: { de: 'Inventur', en: 'Stocktake', ar: 'جرد' } },
      { key: PERMISSIONS.SCANNER_VIEW_PRICES, label: { de: 'Preise im Scanner', en: 'View prices in scanner', ar: 'عرض الأسعار في الماسح' } },
    ],
  },
  {
    key: 'customers', label: { de: 'Kunden', en: 'Customers', ar: 'العملاء' },
    permissions: [
      { key: PERMISSIONS.CUSTOMERS_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.CUSTOMERS_EDIT, label: { de: 'Bearbeiten', en: 'Edit', ar: 'تعديل' } },
      { key: PERMISSIONS.CUSTOMERS_DELETE, label: { de: 'Löschen', en: 'Delete', ar: 'حذف' } },
      { key: PERMISSIONS.CUSTOMERS_GDPR, label: { de: 'DSGVO-Export', en: 'GDPR Export', ar: 'تصدير GDPR' } },
    ],
  },
  {
    key: 'finance', label: { de: 'Finanzen', en: 'Finance', ar: 'المالية' },
    permissions: [
      { key: PERMISSIONS.FINANCE_REVENUE, label: { de: 'Umsätze', en: 'Revenue', ar: 'الإيرادات' } },
      { key: PERMISSIONS.FINANCE_MARGINS, label: { de: 'Gewinnmargen', en: 'Margins', ar: 'هوامش الربح' } },
      { key: PERMISSIONS.FINANCE_PURCHASE_PRICES, label: { de: 'Einkaufspreise', en: 'Purchase prices', ar: 'أسعار الشراء' } },
      { key: PERMISSIONS.FINANCE_INVOICES, label: { de: 'Rechnungen', en: 'Invoices', ar: 'الفواتير' } },
      { key: PERMISSIONS.FINANCE_VAT_REPORT, label: { de: 'MwSt-Bericht', en: 'VAT Report', ar: 'تقرير الضريبة' } },
      { key: PERMISSIONS.FINANCE_EXPORT, label: { de: 'Export (PDF/CSV)', en: 'Export (PDF/CSV)', ar: 'تصدير (PDF/CSV)' } },
    ],
  },
  {
    key: 'returns', label: { de: 'Retouren', en: 'Returns', ar: 'المرتجعات' },
    permissions: [
      { key: PERMISSIONS.RETURNS_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.RETURNS_EDIT, label: { de: 'Bearbeiten', en: 'Edit', ar: 'تعديل' } },
      { key: PERMISSIONS.RETURNS_APPROVE, label: { de: 'Genehmigen', en: 'Approve', ar: 'موافقة' } },
    ],
  },
  {
    key: 'shipping', label: { de: 'Versand', en: 'Shipping', ar: 'الشحن' },
    permissions: [
      { key: PERMISSIONS.SHIPPING_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.SHIPPING_LABELS, label: { de: 'Labels erstellen', en: 'Create labels', ar: 'إنشاء ملصقات' } },
      { key: PERMISSIONS.SHIPPING_STATUS, label: { de: 'Status ändern', en: 'Change status', ar: 'تغيير الحالة' } },
    ],
  },
  {
    key: 'suppliers', label: { de: 'Lieferanten', en: 'Suppliers', ar: 'الموردون' },
    permissions: [
      { key: PERMISSIONS.SUPPLIERS_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.SUPPLIERS_EDIT, label: { de: 'Bearbeiten', en: 'Edit', ar: 'تعديل' } },
      { key: PERMISSIONS.SUPPLIERS_RECEIVING, label: { de: 'Wareneingang', en: 'Receiving', ar: 'استلام بضاعة' } },
      { key: PERMISSIONS.SUPPLIERS_PAYMENTS, label: { de: 'Zahlungen', en: 'Payments', ar: 'المدفوعات' } },
    ],
  },
  {
    key: 'emails', label: { de: 'E-Mails', en: 'Emails', ar: 'البريد' },
    permissions: [
      { key: PERMISSIONS.EMAILS_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.EMAILS_EDIT, label: { de: 'Bearbeiten', en: 'Edit', ar: 'تعديل' } },
      { key: PERMISSIONS.EMAILS_TEST, label: { de: 'Test senden', en: 'Send test', ar: 'إرسال تجريبي' } },
    ],
  },
  {
    key: 'settings', label: { de: 'Einstellungen', en: 'Settings', ar: 'الإعدادات' },
    permissions: [
      { key: PERMISSIONS.SETTINGS_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.SETTINGS_EDIT, label: { de: 'Bearbeiten', en: 'Edit', ar: 'تعديل' } },
    ],
  },
  {
    key: 'staff', label: { de: 'Mitarbeiter', en: 'Staff', ar: 'الموظفون' },
    permissions: [
      { key: PERMISSIONS.STAFF_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
      { key: PERMISSIONS.STAFF_INVITE, label: { de: 'Einladen', en: 'Invite', ar: 'دعوة' } },
      { key: PERMISSIONS.STAFF_ROLES, label: { de: 'Rollen ändern', en: 'Change roles', ar: 'تغيير الأدوار' } },
      { key: PERMISSIONS.STAFF_DEACTIVATE, label: { de: 'Deaktivieren', en: 'Deactivate', ar: 'تعطيل' } },
    ],
  },
  {
    key: 'audit', label: { de: 'Audit-Log', en: 'Audit Log', ar: 'سجل المراجعة' },
    permissions: [
      { key: PERMISSIONS.AUDIT_VIEW, label: { de: 'Ansehen', en: 'View', ar: 'عرض' } },
    ],
  },
]
