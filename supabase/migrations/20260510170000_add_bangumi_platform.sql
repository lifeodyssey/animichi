-- Add platform column to bangumi table.
-- Values: "TV", "剧场版", "OVA", "Web", NULL (unknown).
-- Source: Bangumi v0 API subject.platform field.

ALTER TABLE bangumi ADD COLUMN IF NOT EXISTS platform TEXT;
