PRAGMA foreign_keys = ON;

ALTER TABLE generations
ADD COLUMN processing_attempt INTEGER NOT NULL DEFAULT 0 CHECK(processing_attempt >= 0);
