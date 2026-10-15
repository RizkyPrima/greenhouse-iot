-- Dedicated authority to manage RESEARCH_SOURCE_ADMIN grants.
-- This permission is distinct from both catalog administration and registry access.
ALTER TYPE "PlatformPermission" ADD VALUE 'RESEARCH_SOURCE_GRANT_ADMIN';
