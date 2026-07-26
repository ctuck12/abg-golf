-- Skins payout mode: 'per_hole' (each skin pays out immediately, legacy) or
-- 'pot' (everyone antes skins_amount; most skins takes the pot, ties split).
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS skins_mode TEXT NOT NULL DEFAULT 'per_hole';
