ALTER TABLE daemons ADD COLUMN first_session_at INTEGER;
ALTER TABLE daemons ADD COLUMN last_active_at INTEGER;
CREATE INDEX daemons_last_active ON daemons (last_active_at);

-- Existing identities have no historical first-session evidence. This marks
-- the observation boundary; first_session_at is never backdated to enrollment.
CREATE TABLE conversion_tracking (id INTEGER PRIMARY KEY CHECK (id = 1), started_at INTEGER NOT NULL);
INSERT INTO conversion_tracking VALUES (1, unixepoch() * 1000);
