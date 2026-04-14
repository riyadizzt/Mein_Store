import type { JSX } from 'react'
import { Package } from 'lucide-react'

type IconProps = { className?: string }

const baseProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
}

// ═══════════════════════════════════════════════════════════════
// TOPS
// ═══════════════════════════════════════════════════════════════

const TShirtIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 3l-5 3 2 4 2-1v11h10V9l2 1 2-4-5-3-2 2a3 3 0 0 1-4 0z" />
  </svg>
)

const PoloIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 3l-5 3 2 4 2-1v11h10V9l2 1 2-4-5-3-2 2a3 3 0 0 1-4 0z" />
    <path d="M10 5l2 2 2-2M12 7v3" />
  </svg>
)

const LongSleeveIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 3l-4 2 1 13h2V10l1-1v12h8V9l1 1v8h2l1-13-4-2-2 2a3 3 0 0 1-4 0z" />
  </svg>
)

const ShirtIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 3l-5 3 2 4 2-1v11h10V9l2 1 2-4-5-3-2 2a3 3 0 0 1-4 0z" />
    <path d="M12 5v4" />
  </svg>
)

const BlouseIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 3l-5 4 2 4 2-1v11h10V10l2 1 2-4-5-4-2 2a3 3 0 0 1-4 0z" />
    <path d="M10 12h4" />
  </svg>
)

const SweaterIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M7 3l-5 4 3 5 2-1v9h10v-9l2 1 3-5-5-4-2 2a4 4 0 0 1-6 0z" />
    <path d="M9 11v4M15 11v4" />
  </svg>
)

const HoodieIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M7 7l-4 3 2 4 2-1v8h10v-8l2 1 2-4-4-3" />
    <path d="M9 7a3 3 0 0 1 6 0" />
    <path d="M11 13h2v4h-2z" />
  </svg>
)

// ═══════════════════════════════════════════════════════════════
// BOTTOMS
// ═══════════════════════════════════════════════════════════════

const PantsIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M5 3h14l-1 8-1 10h-4l-1-10-1 10H7L6 11z" />
    <path d="M5 3h14" />
  </svg>
)

const JeansIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M5 3h14l-1 8-1 10h-4l-1-10-1 10H7L6 11z" />
    <path d="M5 3h14M7 6l2 2M17 6l-2 2" />
  </svg>
)

const JoggersIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M5 3h14l-1 8-2 9h-3l-1-9-1 9H8L6 11z" />
    <path d="M5 3h14M7 19h4M13 19h4" />
  </svg>
)

const ShortsIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M5 4h14l-1 6-1 6h-4l-1-6-1 6H7l-1-6z" />
    <path d="M5 4h14" />
  </svg>
)

// ═══════════════════════════════════════════════════════════════
// OUTERWEAR
// ═══════════════════════════════════════════════════════════════

const JacketIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M7 3l-4 3 2 5 2-1v11h10V10l2 1 2-5-4-3-3 3v12M9 6l3 2 3-2" />
    <path d="M12 8v13" />
  </svg>
)

const CoatIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M7 3l-4 3 2 5 2-1v13h10V10l2 1 2-5-4-3-3 3v15M9 6l3 2 3-2" />
    <path d="M12 8v15M10 13h4M10 17h4" />
  </svg>
)

const BlazerIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M6 3l-3 3 1 5 2-1v11h12V10l2 1 1-5-3-3" />
    <path d="M9 5l-1 6 4 4 4-4-1-6M12 15v6" />
  </svg>
)

const SuitIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M7 3l-4 3 2 5 2-1v11h10V10l2 1 2-5-4-3" />
    <path d="M10 5l2 2 2-2" />
    <path d="M11 7l-1 2 2 3 2-3-1-2M12 12v9" />
  </svg>
)

// ═══════════════════════════════════════════════════════════════
// FULL-BODY
// ═══════════════════════════════════════════════════════════════

const DressIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M9 3l-2 5 1 3-4 10h16l-4-10 1-3-2-5-2 2a3 3 0 0 1-4 0z" />
  </svg>
)

const SkirtIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 6h8l4 14H4z" />
    <path d="M8 6h8" />
  </svg>
)

// ═══════════════════════════════════════════════════════════════
// SHOES
// ═══════════════════════════════════════════════════════════════

const ShoeIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M2 17h18a2 2 0 0 0 2-2v-1a4 4 0 0 0-3-3.9l-4-1.1-3-4h-4l1 5H5a3 3 0 0 0-3 3v3z" />
    <path d="M6 14v1M10 14v1M14 14v1" />
  </svg>
)

const SneakerIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M2 17h20v-2l-2-1-3-4h-5l-3-3-3 1v6H2z" />
    <path d="M2 17h20M7 11l3 3" />
  </svg>
)

const BootIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 3h6v12h3l2 2v3H8z" />
    <path d="M8 3h6M8 15h9" />
  </svg>
)

const HeelsIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M3 10c4-3 9-4 15-3 2 0 3 2 3 4h-8l-2 3H3z" />
    <path d="M17 11v8h3" />
  </svg>
)

const SandalIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M4 17h16l1-3-2-2H5l-2 2z" />
    <path d="M7 9l4 3M12 7l4 5" />
  </svg>
)

const SlipperIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M3 14c3-3 7-4 12-4h5l1 2v3l-1 2H4c-1 0-1-1-1-3z" />
    <path d="M8 11v3" />
  </svg>
)

// ═══════════════════════════════════════════════════════════════
// UNDERWEAR / NIGHTWEAR
// ═══════════════════════════════════════════════════════════════

const UnderwearIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M3 8h18l-2 7-5-3h-4l-5 3z" />
  </svg>
)

const SocksIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M9 3h6v9l-2 3-3 2-3-2 2-3 2-2V5" />
    <path d="M9 3h6M8 17l-2 2" />
  </svg>
)

const SwimwearIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M3 8h18l-2 6c-1 2-3 3-5 3l-2-5-2 5c-2 0-4-1-5-3z" />
    <path d="M3 8h18" />
  </svg>
)

const PyjamaIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M21 13a8 8 0 1 1-9-9 6 6 0 0 0 9 9z" />
    <path d="M15 3l.5 1.5L17 5l-1.5.5L15 7l-.5-1.5L13 5l1.5-.5z" />
  </svg>
)

// ═══════════════════════════════════════════════════════════════
// ACCESSORIES
// ═══════════════════════════════════════════════════════════════

const BagIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M5 8h14v12H5z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
)

const WalletIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M3 8c0-2 1-3 3-3h12v3" />
    <path d="M3 8h17a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <circle cx="17" cy="13.5" r="1" />
  </svg>
)

const BeltIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M2 10h20v4H2z" />
    <path d="M9 10h6v4H9z" />
    <path d="M12 11v2" />
  </svg>
)

const HatIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M5 14c0-5 3-9 7-9s7 4 7 9" />
    <path d="M2 14h20" />
    <path d="M5 14c2 1 5 1.5 7 1.5s5-.5 7-1.5" />
  </svg>
)

const CapIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M4 14c0-5 4-8 8-8s8 3 8 8" />
    <path d="M4 14h17l1 2-2 1H4z" />
    <path d="M11 6V4h2v2" />
  </svg>
)

const ScarfIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 3h8l2 9-2 9h-2l-1-7-2 7h-2l-2-9z" />
    <path d="M8 3l-1 9M16 3l1 9" />
  </svg>
)

const SunglassesIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M2 10c0-2 2-3 4-3h2c2 0 4 1 4 3v2c0 2-2 3-4 3H6c-2 0-4-1-4-3z" />
    <path d="M14 10c0-2 2-3 4-3h2c0 0 2 1 2 3v2c0 2-2 3-2 3h-2c-2 0-4-1-4-3z" />
    <path d="M12 10h2" />
  </svg>
)

const WatchIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="5" />
    <path d="M9 7V4h6v3M9 17v3h6v-3" />
    <path d="M12 10v3l2 1" />
  </svg>
)

const TieIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M10 3h4l-1 3 2 3-3 12-3-12 2-3z" />
    <path d="M10 3h4" />
  </svg>
)

// ═══════════════════════════════════════════════════════════════
// BABY
// ═══════════════════════════════════════════════════════════════

const BabyRomperIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 3l-3 3 1 4 2-1v8a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3v-8l2 1 1-4-3-3-2 2a3 3 0 0 1-4 0z" />
    <circle cx="12" cy="14" r="1" />
  </svg>
)

const BabyBodyIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 4l-4 2 1 3 2-1v7c0 2 1 3 3 3h4c2 0 3-1 3-3v-7l2 1 1-3-4-2-2 2a3 3 0 0 1-4 0z" />
    <path d="M10 18h4" />
  </svg>
)

const SleepsuitIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M8 3l-4 3 1 3 2-1v10c0 1 1 2 2 2h1l1-7 1 7h1c1 0 2-1 2-2V8l2 1 1-3-4-3-2 2a3 3 0 0 1-4 0z" />
    <path d="M8 21h3M13 21h3" />
  </svg>
)

const FirstShoeIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M3 14c0-3 3-5 7-5h4c2 0 4 1 5 3l2 3v2H3z" />
    <path d="M7 13v2M11 13v2M15 13v2" />
  </svg>
)

const GiftIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <rect x="4" y="10" width="16" height="10" rx="1" />
    <path d="M3 7h18v3H3z" />
    <path d="M12 7v13" />
    <path d="M8 7c0-2 2-3 4-1M16 7c0-2-2-3-4-1" />
  </svg>
)

const BlanketIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M4 5h16v14H4z" />
    <path d="M4 9h16M4 13h16M4 17h16" />
  </svg>
)

const BottleIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <path d="M10 3h4v2h-1v2c2 0 3 1 3 3v9c0 2-1 3-3 3h-2c-2 0-3-1-3-3v-9c0-2 1-3 3-3V5h-1z" />
    <path d="M9 11h6M9 15h6" />
  </svg>
)

const TeddyIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <circle cx="12" cy="14" r="6" />
    <circle cx="7" cy="8" r="2.5" />
    <circle cx="17" cy="8" r="2.5" />
    <path d="M10 13v1M14 13v1" />
    <path d="M10.5 17c.5.8 2.5.8 3 0" />
  </svg>
)

// ═══════════════════════════════════════════════════════════════
// MISC
// ═══════════════════════════════════════════════════════════════

const GridIcon = ({ className }: IconProps) => (
  <svg {...baseProps} className={className} aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)

type IconComponent = (props: IconProps) => JSX.Element

// ── Canonical icon keys (source of truth for the admin picker) ────────
// Order here is the order shown in the admin picker — grouped by category type.
export const CATEGORY_ICONS: ReadonlyArray<{
  key: string
  Component: IconComponent
  labels: { de: string; en: string; ar: string }
}> = [
  // Oberteile
  { key: 'tshirt',      Component: TShirtIcon,      labels: { de: 'T-Shirt',       en: 'T-Shirt',       ar: 'تي شيرت' } },
  { key: 'polo',        Component: PoloIcon,        labels: { de: 'Polo',          en: 'Polo',          ar: 'بولو' } },
  { key: 'longsleeve',  Component: LongSleeveIcon,  labels: { de: 'Langarm',       en: 'Long Sleeve',   ar: 'كم طويل' } },
  { key: 'shirt',       Component: ShirtIcon,       labels: { de: 'Hemd',          en: 'Shirt',         ar: 'قميص' } },
  { key: 'blouse',      Component: BlouseIcon,      labels: { de: 'Bluse',         en: 'Blouse',        ar: 'بلوزة' } },
  { key: 'sweater',     Component: SweaterIcon,     labels: { de: 'Pullover',      en: 'Sweater',       ar: 'كنزة' } },
  { key: 'hoodie',      Component: HoodieIcon,      labels: { de: 'Hoodie',        en: 'Hoodie',        ar: 'هودي' } },
  // Hosen
  { key: 'pants',       Component: PantsIcon,       labels: { de: 'Hose',          en: 'Pants',         ar: 'بنطلون' } },
  { key: 'jeans',       Component: JeansIcon,       labels: { de: 'Jeans',         en: 'Jeans',         ar: 'جينز' } },
  { key: 'joggers',     Component: JoggersIcon,     labels: { de: 'Jogger',        en: 'Joggers',       ar: 'جوجر' } },
  { key: 'shorts',      Component: ShortsIcon,      labels: { de: 'Shorts',        en: 'Shorts',        ar: 'شورت' } },
  // Jacken
  { key: 'jacket',      Component: JacketIcon,      labels: { de: 'Jacke',         en: 'Jacket',        ar: 'جاكيت' } },
  { key: 'coat',        Component: CoatIcon,        labels: { de: 'Mantel',        en: 'Coat',          ar: 'معطف' } },
  { key: 'blazer',      Component: BlazerIcon,      labels: { de: 'Blazer',        en: 'Blazer',        ar: 'بليزر' } },
  { key: 'suit',        Component: SuitIcon,        labels: { de: 'Anzug',         en: 'Suit',          ar: 'بدلة' } },
  // Kleider
  { key: 'dress',       Component: DressIcon,       labels: { de: 'Kleid',         en: 'Dress',         ar: 'فستان' } },
  { key: 'skirt',       Component: SkirtIcon,       labels: { de: 'Rock',          en: 'Skirt',         ar: 'تنورة' } },
  // Schuhe
  { key: 'shoe',        Component: ShoeIcon,        labels: { de: 'Schuhe',        en: 'Shoes',         ar: 'أحذية' } },
  { key: 'sneaker',     Component: SneakerIcon,     labels: { de: 'Sneaker',       en: 'Sneaker',       ar: 'حذاء رياضي' } },
  { key: 'boot',        Component: BootIcon,        labels: { de: 'Stiefel',       en: 'Boot',          ar: 'بوت' } },
  { key: 'heels',       Component: HeelsIcon,       labels: { de: 'Absatzschuh',   en: 'Heels',         ar: 'كعب' } },
  { key: 'sandal',      Component: SandalIcon,      labels: { de: 'Sandale',       en: 'Sandal',        ar: 'صندل' } },
  { key: 'slipper',     Component: SlipperIcon,     labels: { de: 'Hausschuh',     en: 'Slipper',       ar: 'شبشب' } },
  // Unterwäsche
  { key: 'underwear',   Component: UnderwearIcon,   labels: { de: 'Unterwäsche',   en: 'Underwear',     ar: 'ملابس داخلية' } },
  { key: 'socks',       Component: SocksIcon,       labels: { de: 'Socken',        en: 'Socks',         ar: 'جوارب' } },
  { key: 'swimwear',    Component: SwimwearIcon,    labels: { de: 'Bademode',      en: 'Swimwear',      ar: 'ملابس سباحة' } },
  { key: 'pyjama',      Component: PyjamaIcon,      labels: { de: 'Pyjama',        en: 'Pyjama',        ar: 'بيجاما' } },
  // Accessoires
  { key: 'bag',         Component: BagIcon,         labels: { de: 'Tasche',        en: 'Bag',           ar: 'حقيبة' } },
  { key: 'wallet',      Component: WalletIcon,      labels: { de: 'Geldbörse',     en: 'Wallet',        ar: 'محفظة' } },
  { key: 'belt',        Component: BeltIcon,        labels: { de: 'Gürtel',        en: 'Belt',          ar: 'حزام' } },
  { key: 'hat',         Component: HatIcon,         labels: { de: 'Hut',           en: 'Hat',           ar: 'قبعة' } },
  { key: 'cap',         Component: CapIcon,         labels: { de: 'Cap',           en: 'Cap',           ar: 'كاب' } },
  { key: 'scarf',       Component: ScarfIcon,       labels: { de: 'Schal',         en: 'Scarf',         ar: 'وشاح' } },
  { key: 'sunglasses',  Component: SunglassesIcon,  labels: { de: 'Sonnenbrille',  en: 'Sunglasses',    ar: 'نظارة شمسية' } },
  { key: 'watch',       Component: WatchIcon,       labels: { de: 'Uhr',           en: 'Watch',         ar: 'ساعة' } },
  { key: 'tie',         Component: TieIcon,         labels: { de: 'Krawatte',      en: 'Tie',           ar: 'ربطة عنق' } },
  // Baby
  { key: 'baby',        Component: BabyRomperIcon,  labels: { de: 'Strampler',     en: 'Romper',        ar: 'طفل' } },
  { key: 'body',        Component: BabyBodyIcon,    labels: { de: 'Body',          en: 'Bodysuit',      ar: 'بادي' } },
  { key: 'sleepsuit',   Component: SleepsuitIcon,   labels: { de: 'Einteiler',     en: 'Sleepsuit',     ar: 'بيجاما كاملة' } },
  { key: 'firstshoe',   Component: FirstShoeIcon,   labels: { de: 'Lauflernschuh', en: 'First Shoe',    ar: 'حذاء أول خطوات' } },
  { key: 'gift',        Component: GiftIcon,        labels: { de: 'Geschenk',      en: 'Gift',          ar: 'هدية' } },
  { key: 'blanket',     Component: BlanketIcon,     labels: { de: 'Decke',         en: 'Blanket',       ar: 'بطانية' } },
  { key: 'bottle',      Component: BottleIcon,      labels: { de: 'Babyflasche',   en: 'Baby Bottle',   ar: 'ببرونة' } },
  { key: 'teddy',       Component: TeddyIcon,       labels: { de: 'Spielzeug',     en: 'Toy',           ar: 'لعبة' } },
  // Sonstige
  { key: 'grid',        Component: GridIcon,        labels: { de: 'Alle / Übersicht', en: 'All / Overview', ar: 'الكل' } },
]

const ICON_COMPONENTS: Record<string, IconComponent> = Object.fromEntries(
  CATEGORY_ICONS.map((i) => [i.key, i.Component]),
)

// ── Slug-token → canonical-key fallback (used when iconKey is not set) ──
// Every existing category in prod has iconKey=null, so this keeps the
// dropdown icons working without a backfill. Admin picks override this.
const SLUG_ALIASES: Record<string, string> = {
  // tops
  't-shirt': 'tshirt', 't-shirts': 'tshirt', tshirts: 'tshirt', tshirt: 'tshirt',
  polo: 'polo', polos: 'polo', poloshirt: 'polo', poloshirts: 'polo',
  langarm: 'longsleeve', longsleeve: 'longsleeve', langarmshirt: 'longsleeve',
  hemden: 'shirt', shirts: 'shirt', hemd: 'shirt',
  blusen: 'blouse', blouses: 'blouse', bluse: 'blouse',
  pullover: 'sweater', sweatshirts: 'sweater', sweater: 'sweater', strickwaren: 'sweater',
  hoodies: 'hoodie', hoodie: 'hoodie', kapuzenpullover: 'hoodie',
  // bottoms
  hosen: 'pants', pants: 'pants', leggings: 'pants', hose: 'pants',
  jeans: 'jeans', denim: 'jeans',
  jogger: 'joggers', joggers: 'joggers', trainingshose: 'joggers', trainingsanzug: 'joggers',
  shorts: 'shorts', kurze: 'shorts', bermudas: 'shorts',
  // outerwear
  jacken: 'jacket', jackets: 'jacket', jacket: 'jacket', jacke: 'jacket',
  mantel: 'coat', maentel: 'coat', coats: 'coat', coat: 'coat', uebergangsjacken: 'coat',
  blazer: 'blazer', sakko: 'blazer', sakkos: 'blazer',
  anzug: 'suit', anzuege: 'suit', suit: 'suit', suits: 'suit',
  // dresses
  kleider: 'dress', dresses: 'dress', dress: 'dress', kleid: 'dress',
  roecke: 'skirt', skirts: 'skirt', skirt: 'skirt', rock: 'skirt',
  // shoes
  schuhe: 'shoe', shoes: 'shoe', schuh: 'shoe',
  sneaker: 'sneaker', sneakers: 'sneaker',
  boot: 'boot', boots: 'boot', stiefel: 'boot', stiefeletten: 'boot',
  heels: 'heels', absatz: 'heels', absatzschuhe: 'heels',
  sandale: 'sandal', sandalen: 'sandal', sandals: 'sandal',
  hausschuhe: 'slipper', slipper: 'slipper', slippers: 'slipper', pantoffeln: 'slipper',
  // underwear
  unterwaesche: 'underwear', underwear: 'underwear', unterhemd: 'underwear',
  socken: 'socks', socks: 'socks',
  bademode: 'swimwear', swimwear: 'swimwear', badeanzug: 'swimwear', bikini: 'swimwear',
  pyjamas: 'pyjama', nightwear: 'pyjama', pyjama: 'pyjama', schlafanzug: 'pyjama',
  // accessories
  taschen: 'bag', bags: 'bag', bag: 'bag', tasche: 'bag',
  geldboersen: 'wallet', wallets: 'wallet', wallet: 'wallet', portemonnaies: 'wallet',
  guertel: 'belt', belts: 'belt', belt: 'belt',
  hut: 'hat', huete: 'hat', hats: 'hat', hat: 'hat',
  cap: 'cap', caps: 'cap', muetze: 'cap', muetzen: 'cap', basecap: 'cap',
  schal: 'scarf', schals: 'scarf', scarf: 'scarf', scarves: 'scarf',
  sonnenbrille: 'sunglasses', sonnenbrillen: 'sunglasses', sunglasses: 'sunglasses', brille: 'sunglasses',
  uhr: 'watch', uhren: 'watch', watch: 'watch', watches: 'watch',
  krawatte: 'tie', krawatten: 'tie', tie: 'tie', ties: 'tie',
  // generic accessoires catch-all
  accessoires: 'bag', accessories: 'bag',
  // baby
  strampler: 'baby', rompers: 'baby', baby: 'baby', babys: 'baby',
  body: 'body', bodys: 'body', bodysuit: 'body',
  einteiler: 'sleepsuit', sleepsuit: 'sleepsuit', overall: 'sleepsuit', overalls: 'sleepsuit',
  lauflernschuh: 'firstshoe', lauflernschuhe: 'firstshoe', lauflern: 'firstshoe', firstshoe: 'firstshoe', krabbelschuhe: 'firstshoe',
  geschenk: 'gift', geschenke: 'gift', gift: 'gift', gifts: 'gift', geburt: 'gift',
  decke: 'blanket', decken: 'blanket', blanket: 'blanket', blankets: 'blanket',
  flasche: 'bottle', flaschen: 'bottle', babyflasche: 'bottle', bottle: 'bottle', fuettern: 'bottle', fuetterung: 'bottle', stillen: 'bottle', milk: 'bottle', baden: 'bottle', wickeln: 'bottle',
  spielzeug: 'teddy', spielzeuge: 'teddy', toy: 'teddy', toys: 'teddy', teddy: 'teddy', plueschtier: 'teddy',
  // misc
  alles: 'grid', all: 'grid', uebersicht: 'grid', overview: 'grid',
}

function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

function resolveFromSlug(slug: string): IconComponent | null {
  const normalized = normalizeToken(slug)
  const tokens = normalized.split('-').filter(Boolean)
  for (let i = tokens.length - 1; i >= 0; i--) {
    const key = SLUG_ALIASES[tokens[i]]
    if (key) return ICON_COMPONENTS[key]
  }
  for (const aliasKey of Object.keys(SLUG_ALIASES)) {
    if (normalized.includes(aliasKey)) return ICON_COMPONENTS[SLUG_ALIASES[aliasKey]]
  }
  return null
}

export function CategoryIcon({
  iconKey,
  slug,
  className = 'h-4 w-4',
}: {
  iconKey?: string | null
  slug?: string | null
  className?: string
}) {
  // 1. Explicit admin pick wins
  if (iconKey && ICON_COMPONENTS[iconKey]) {
    const Comp = ICON_COMPONENTS[iconKey]
    return <Comp className={className} />
  }
  // 2. Slug-based legacy fallback
  if (slug) {
    const Comp = resolveFromSlug(slug)
    if (Comp) return <Comp className={className} />
  }
  // 3. Generic
  return <Package className={className} aria-hidden="true" />
}
