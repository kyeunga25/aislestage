PRAGMA foreign_keys = ON;

ALTER TABLE generations
ADD COLUMN approved_revision INTEGER NOT NULL DEFAULT 0 CHECK(approved_revision >= 0);

ALTER TABLE generations
ADD COLUMN output_content_type TEXT;
