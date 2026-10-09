-- =============================================================================
-- PostgreSQL Init Script — Greenhouse IoT Platform
-- =============================================================================
-- This script runs automatically when the PostgreSQL container is first created.
-- It sets up extensions and basic configuration.
-- Schema/tables will be created by Prisma migrations in Phase 2.
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto (for additional hashing utilities)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Set timezone to UTC
SET timezone = 'UTC';

-- Log init completion
DO $$
BEGIN
  RAISE NOTICE 'Greenhouse IoT Platform — PostgreSQL initialized successfully.';
  RAISE NOTICE 'Extensions: uuid-ossp, pgcrypto';
  RAISE NOTICE 'Timezone: UTC';
  RAISE NOTICE 'Database schema will be created by Prisma in Phase 2.';
END $$;
