PRAGMA foreign_keys = ON;

ALTER TABLE generations
ADD COLUMN output_sha256 TEXT
CHECK(output_sha256 IS NULL OR length(output_sha256) = 43);
