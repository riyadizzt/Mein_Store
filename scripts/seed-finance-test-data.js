/**
 * Seed Finance Test Data
 * Creates ~30 realistic test orders spread across the last 60 days
 * for the finance dashboard.
 *
 * Usage: node scripts/seed-finance-test-data.js
 * Requires: DATABASE_URL in apps/api/.env
 */

const path = require('path');
const fs = require('fs');

// Load .env from the api app (manual parse, no dotenv dependency)
const envPath = path.resolve(__dirname, '../apps/api/.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
  console.log('Loaded environment from apps/api/.env');
} else {
  console.warn('WARNING: No .env file found at', envPath);
}

const { PrismaClient } = require('../apps/api/node_modules/@prisma/client');

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(days, hoursOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hoursOffset);
  d.setMinutes(randomInt(0, 59));
  d.setSeconds(randomInt(0, 59));
  return d;
}

function generateOrderNumber() {
  const digits = String(randomInt(100000, 999999));
  return `MAL-${digits}`;
}

function generateProviderPaymentId(provider) {
  const rand = Array.from({ length: 24 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[randomInt(0, 35)]
  ).join('');
  switch (provider) {
    case 'STRIPE':
      return `pi_test_${rand}`;
    case 'PAYPAL':
      return `PAY-${rand.toUpperCase().slice(0, 20)}`;
    case 'KLARNA':
      return `kp_test_${rand}`;
    default:
      return `pay_${rand}`;
  }
}

// Map providers to their payment methods
const PROVIDER_METHOD_MAP = {
  STRIPE: 'stripe_card',
  KLARNA: 'klarna_pay_now',
  PAYPAL: 'paypal',
};

// Distribution of days ago for ~30 orders spread over 60 days
// Some today/yesterday, some this week, spread over last 2 months
const DAY_OFFSETS = [
  0, 0, 0,           // 3 today
  1, 1,               // 2 yesterday
  2, 3, 4, 5, 6,     // 5 this week
  8, 10, 12, 14,     // 4 last ~2 weeks
  18, 21, 24, 27,    // 4 around 3-4 weeks ago
  30, 33, 35, 38,    // 4 around 1 month ago
  40, 43, 45, 48,    // 4 around 6-7 weeks ago
  50, 53, 56, 58,    // 4 around 2 months ago
];

const ORDER_STATUSES = [
  'delivered', 'delivered', 'delivered', 'delivered', 'delivered',
  'delivered', 'delivered', 'delivered', 'delivered', 'delivered',
  'shipped', 'shipped', 'shipped', 'shipped', 'shipped',
  'confirmed', 'confirmed', 'confirmed',
  'processing', 'processing',
];

const PRODUCT_NAMES_DE = [
  'Premium Leder Sneaker',
  'Eleganter Wollmantel',
  'Slim Fit Jeans',
  'Baumwoll T-Shirt Basic',
  'Sportliche Jogginghose',
  'Klassisches Hemd',
  'Winter Stiefel',
  'Leichte Sommerjacke',
  'Business Anzughose',
  'Kaschmir Pullover',
  'Laufschuhe Pro',
  'Seiden Bluse',
  'Cargo Shorts',
  'Abendkleid Elegant',
  'Daunenjacke Warm',
];

// ── Main Seed Function ──────────────────────────────────────

async function main() {
  console.log('Starting finance test data seed...\n');

  // 1. Fetch existing users and variants
  const users = await prisma.user.findMany({
    where: { deletedAt: null, role: 'customer' },
    select: { id: true, firstName: true, lastName: true },
    take: 50,
  });

  if (users.length === 0) {
    // Fallback: get any users
    const anyUsers = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      take: 50,
    });
    if (anyUsers.length === 0) {
      console.error('ERROR: No users found in database. Cannot create orders without users.');
      process.exit(1);
    }
    users.push(...anyUsers);
  }
  console.log(`Found ${users.length} user(s)`);

  const variants = await prisma.productVariant.findMany({
    where: { isActive: true },
    select: {
      id: true,
      sku: true,
      priceModifier: true,
      product: {
        select: {
          basePrice: true,
          salePrice: true,
          translations: {
            where: { language: 'de' },
            select: { name: true },
            take: 1,
          },
        },
      },
    },
    take: 100,
  });

  if (variants.length === 0) {
    console.error('ERROR: No active product variants found in database.');
    process.exit(1);
  }
  console.log(`Found ${variants.length} variant(s)\n`);

  // 2. Generate orders
  const orderCount = DAY_OFFSETS.length; // ~30
  let createdOrders = 0;
  let createdItems = 0;
  let createdPayments = 0;

  for (let i = 0; i < orderCount; i++) {
    const daysBack = DAY_OFFSETS[i];
    const orderDate = daysAgo(daysBack, randomInt(0, 12));
    const orderNumber = generateOrderNumber();
    const user = randomElement(users);
    const channel = randomElement(['website', 'mobile']);
    const status = randomElement(ORDER_STATUSES);
    const provider = randomElement(['STRIPE', 'KLARNA', 'PAYPAL']);
    const method = PROVIDER_METHOD_MAP[provider];

    // Generate 1-4 order items
    const itemCount = randomInt(1, 4);
    const items = [];
    let subtotal = 0;

    for (let j = 0; j < itemCount; j++) {
      const variant = randomElement(variants);
      const quantity = randomInt(1, 3);

      // Calculate unit price from product base price + variant modifier
      const basePrice = parseFloat(variant.product.basePrice || '0');
      const modifier = parseFloat(variant.priceModifier || '0');
      let unitPrice = basePrice + modifier;

      // If no real price, use a random price
      if (unitPrice <= 0) {
        unitPrice = randomFloat(15, 80);
      }

      // Sometimes use sale price
      if (variant.product.salePrice && Math.random() > 0.6) {
        unitPrice = parseFloat(variant.product.salePrice);
      }

      unitPrice = parseFloat(unitPrice.toFixed(2));
      const totalPrice = parseFloat((unitPrice * quantity).toFixed(2));
      subtotal += totalPrice;

      // Get product name from translation or use fallback
      const productName =
        variant.product.translations?.[0]?.name ||
        randomElement(PRODUCT_NAMES_DE);

      items.push({
        variantId: variant.id,
        quantity,
        unitPrice,
        taxRate: 19.0,
        totalPrice,
        snapshotName: productName,
        snapshotSku: variant.sku,
        createdAt: orderDate,
      });
    }

    subtotal = parseFloat(subtotal.toFixed(2));

    // Shipping: free above 100 EUR, otherwise 4.90
    const shippingCost = subtotal >= 100 ? 0 : 4.9;

    // Tax: 19% MwSt on subtotal
    const taxAmount = parseFloat((subtotal * 0.19).toFixed(2));

    // Discount: ~20% of orders get a small discount
    let discountAmount = 0;
    if (Math.random() < 0.2) {
      discountAmount = parseFloat(randomFloat(5, 20).toFixed(2));
      // Don't let discount exceed subtotal
      if (discountAmount > subtotal * 0.3) {
        discountAmount = parseFloat((subtotal * 0.1).toFixed(2));
      }
    }

    const totalAmount = parseFloat(
      (subtotal + shippingCost + taxAmount - discountAmount).toFixed(2)
    );

    const couponCode = discountAmount > 0 ? randomElement(['WELCOME10', 'SPRING20', 'VIP15', 'MALAK10']) : null;

    // Payment date: a few minutes after order
    const paidAt = new Date(orderDate.getTime() + randomInt(1, 10) * 60 * 1000);

    try {
      // Create order with items and payment in a transaction
      const order = await prisma.order.create({
        data: {
          orderNumber,
          userId: user.id,
          channel,
          status,
          subtotal,
          shippingCost,
          taxAmount,
          discountAmount,
          totalAmount,
          currency: 'EUR',
          couponCode,
          notes: null,
          createdAt: orderDate,
          updatedAt: orderDate,
          items: {
            create: items,
          },
          payment: {
            create: {
              provider,
              method,
              status: 'captured',
              amount: totalAmount,
              currency: 'EUR',
              providerPaymentId: generateProviderPaymentId(provider),
              paidAt,
              createdAt: orderDate,
              updatedAt: orderDate,
            },
          },
        },
        include: {
          items: true,
          payment: true,
        },
      });

      createdOrders++;
      createdItems += order.items.length;
      if (order.payment) createdPayments++;

      const dateStr = orderDate.toISOString().slice(0, 10);
      console.log(
        `  [${String(i + 1).padStart(2)}] ${order.orderNumber} | ${dateStr} | ${String(status).padEnd(10)} | ${channel.padEnd(7)} | ${provider.padEnd(6)} | ${items.length} items | EUR ${totalAmount.toFixed(2)}`
      );
    } catch (err) {
      // If order number collision, try again with a new number (unlikely)
      if (err.code === 'P2002' && err.meta?.target?.includes('order_number')) {
        console.log(`  [${i + 1}] Order number collision, skipping...`);
        continue;
      }
      throw err;
    }
  }

  console.log('\n────────────────────────────────────────────');
  console.log(`Created: ${createdOrders} orders, ${createdItems} items, ${createdPayments} payments`);
  console.log('Finance test data seeded successfully!');
}

// ── Run ──────────────────────────────────────────────────────

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
