PRAGMA foreign_keys = ON;

ALTER TABLE media_assets
ADD COLUMN width_px INTEGER
CHECK(
  width_px IS NULL
  OR (typeof(width_px) = 'integer' AND width_px BETWEEN 1 AND 8192)
);

ALTER TABLE media_assets
ADD COLUMN height_px INTEGER
CHECK(
  height_px IS NULL
  OR (typeof(height_px) = 'integer' AND height_px BETWEEN 1 AND 8192)
);

-- NULL/NULL keeps rows created before this migration readable during a
-- migration-first rolling deploy. New Worker uploads always write both values.
CREATE TRIGGER media_asset_dimensions_insert
BEFORE INSERT ON media_assets
WHEN (NEW.width_px IS NULL) <> (NEW.height_px IS NULL)
  OR (
    NEW.width_px IS NOT NULL
    AND NEW.height_px IS NOT NULL
    AND NEW.width_px * NEW.height_px > 32000000
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid media asset dimensions');
END;

CREATE TRIGGER media_asset_dimensions_update
BEFORE UPDATE OF width_px, height_px ON media_assets
WHEN (NEW.width_px IS NULL) <> (NEW.height_px IS NULL)
  OR (
    NEW.width_px IS NOT NULL
    AND NEW.height_px IS NOT NULL
    AND NEW.width_px * NEW.height_px > 32000000
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid media asset dimensions');
END;
