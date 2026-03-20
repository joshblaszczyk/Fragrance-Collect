-- Migration to add shipping cost column to user_favorites table
-- Add shipping cost column to existing user_favorites table
ALTER TABLE user_favorites ADD COLUMN shippingCost REAL;

