PRAGMA foreign_keys = ON;

ALTER TABLE media_assets
ADD COLUMN content_sha256 TEXT
CHECK(content_sha256 IS NULL OR length(content_sha256) = 43);
