-- Command Center: per-profile avatar (absolute image path the Commander picks).
-- Rendered via cc_read_image (data URL) so it works from any location.
ALTER TABLE cc_profiles ADD COLUMN avatar_path TEXT NOT NULL DEFAULT '';
