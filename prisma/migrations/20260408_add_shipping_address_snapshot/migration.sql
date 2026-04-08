-- AlterTable: Add shipping_address_snapshot (JSON) to orders table
-- This field stores the full shipping address as a JSON snapshot for guest orders
-- that don't have a linked Address record via shipping_address_id.

ALTER TABLE "orders" ADD COLUMN "shipping_address_snapshot" JSONB;
