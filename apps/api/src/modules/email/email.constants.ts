// ── Email Types ────────────────────────────────────────────────

export const EMAIL_TYPES = {
  WELCOME: 'welcome',
  EMAIL_VERIFICATION: 'email-verification',
  EMAIL_CHANGE: 'email-change',
  PASSWORD_RESET: 'password-reset',
  ORDER_CONFIRMATION: 'order-confirmation',
  ORDER_STATUS: 'order-status',
  ORDER_CANCELLATION: 'order-cancellation',
  RETURN_CONFIRMATION: 'return-confirmation',
  GUEST_INVITE: 'guest-invite',
} as const

export type EmailType = (typeof EMAIL_TYPES)[keyof typeof EMAIL_TYPES]

// ── Subjects per language ──────────────────────────────────────

export const EMAIL_SUBJECTS: Record<EmailType, Record<string, string>> = {
  [EMAIL_TYPES.WELCOME]: {
    de: 'Willkommen bei Malak Bekleidung!',
    en: 'Welcome to Malak Bekleidung!',
    ar: 'اهلا وسهلا فيك لدى ملبوسات ملك',
  },
  [EMAIL_TYPES.EMAIL_VERIFICATION]: {
    de: 'Bitte bestätigen Sie Ihre E-Mail-Adresse',
    en: 'Please verify your email address',
    ar: 'يرجى تأكيد عنوان بريدك الإلكتروني',
  },
  [EMAIL_TYPES.EMAIL_CHANGE]: {
    de: 'Bestätigung der neuen E-Mail-Adresse',
    en: 'Confirm your new email address',
    ar: 'تأكيد عنوان بريدك الإلكتروني الجديد',
  },
  [EMAIL_TYPES.PASSWORD_RESET]: {
    de: 'Passwort zurücksetzen',
    en: 'Reset your password',
    ar: 'إعادة تعيين كلمة المرور',
  },
  [EMAIL_TYPES.ORDER_CONFIRMATION]: {
    de: 'Bestellbestätigung — Bestellung #{orderNumber}',
    en: 'Order Confirmation — Order #{orderNumber}',
    ar: '#{orderNumber} تأكيد الطلب — رقم الطلب',
  },
  [EMAIL_TYPES.ORDER_STATUS]: {
    de: 'Status-Update für Bestellung #{orderNumber}',
    en: 'Status update for Order #{orderNumber}',
    ar: '#{orderNumber} تحديث حالة الطلب',
  },
  [EMAIL_TYPES.ORDER_CANCELLATION]: {
    de: 'Stornierung — Bestellung #{orderNumber}',
    en: 'Cancellation — Order #{orderNumber}',
    ar: '#{orderNumber} إلغاء الطلب',
  },
  [EMAIL_TYPES.RETURN_CONFIRMATION]: {
    de: 'Rücksendung bestätigt — Bestellung #{orderNumber}',
    en: 'Return confirmed — Order #{orderNumber}',
    ar: '#{orderNumber} تأكيد الإرجاع — الطلب',
  },
  [EMAIL_TYPES.GUEST_INVITE]: {
    de: 'Erstelle dein Konto — Malak Bekleidung',
    en: 'Create your account — Malak Bekleidung',
    ar: 'أنشئ حسابك لدى ملبوسات ملك',
  },
}

// ── From address mapping ───────────────────────────────────────

export const EMAIL_FROM_MAP: Record<EmailType, string> = {
  [EMAIL_TYPES.WELCOME]: 'EMAIL_FROM_NOREPLY',
  [EMAIL_TYPES.EMAIL_VERIFICATION]: 'EMAIL_FROM_NOREPLY',
  [EMAIL_TYPES.EMAIL_CHANGE]: 'EMAIL_FROM_NOREPLY',
  [EMAIL_TYPES.PASSWORD_RESET]: 'EMAIL_FROM_NOREPLY',
  [EMAIL_TYPES.ORDER_CONFIRMATION]: 'EMAIL_FROM_ORDERS',
  [EMAIL_TYPES.ORDER_STATUS]: 'EMAIL_FROM_ORDERS',
  [EMAIL_TYPES.ORDER_CANCELLATION]: 'EMAIL_FROM_ORDERS',
  [EMAIL_TYPES.RETURN_CONFIRMATION]: 'EMAIL_FROM_SUPPORT',
  [EMAIL_TYPES.GUEST_INVITE]: 'EMAIL_FROM_NOREPLY',
}
