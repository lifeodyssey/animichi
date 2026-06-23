-- Add city column to points table for area-based filtering.
-- Populated by reverse-geocoder during write-through enrichment.
-- Values are English city names from GeoNames (e.g. "Tokyo", "Takayama", "Uji").

ALTER TABLE points ADD COLUMN IF NOT EXISTS city TEXT;
