-- Migration: eBay Marketplace Account Deletion webhook
-- Added: 2026-04-24
-- Additive only. No touch on existing tables. Safe to deploy without
-- downtime. Can be reverted by dropping the table (no FK dependencies).

CREATE TABLE "ebay_deletion_notifications" (
  "id"                     TEXT NOT NULL,
  "notification_id"        TEXT NOT NULL,
  "ebay_user_id"           TEXT NOT NULL,
  "ebay_username"          TEXT NOT NULL,
  "eias_token"             TEXT NOT NULL,
  "event_date"             TIMESTAMP(3) NOT NULL,
  "publish_date"           TIMESTAMP(3) NOT NULL,
  "publish_attempt_count"  INTEGER NOT NULL,
  "received_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "data_found_in_db"       BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ebay_deletion_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ebay_deletion_notifications_notification_id_key"
  ON "ebay_deletion_notifications"("notification_id");
