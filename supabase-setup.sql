-- =============================================
-- Recipe Vault — Supabase Database Setup
-- =============================================
-- Run this in your Supabase SQL Editor:
--   1. Go to your Supabase project dashboard
--   2. Click "SQL Editor" in the left sidebar
--   3. Paste this entire script and click "Run"
-- =============================================

-- Create the recipes table (no auth — single user)
CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  cuisine TEXT,
  source TEXT,
  ingredients TEXT[] DEFAULT '{}',
  instructions TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'want' CHECK (status IN ('tried', 'want')),
  rating INTEGER DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Disable Row Level Security (no auth needed)
ALTER TABLE recipes DISABLE ROW LEVEL SECURITY;

-- Done! Your database is ready for Recipe Vault.
