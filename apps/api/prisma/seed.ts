/**
 * Seed Script — Demo Users + Organization + Memberships
 * Run: npx ts-node --esm prisma/seed.ts  OR  npm run db:seed
 */
import { PrismaClient, UserRole } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Password123!";

const DEMO_ORG = {
  name: "Standard Greenhouse",
  slug: "standard-greenhouse",
  description: "Primary IoT greenhouse organization for Phase 7 demo",
};

const DEMO_USERS = [
  { email: "owner@example.com", name: "Greenhouse Owner", role: UserRole.OWNER },
  { email: "operator@example.com", name: "Greenhouse Operator", role: UserRole.OPERATOR },
  { email: "viewer@example.com", name: "Greenhouse Viewer", role: UserRole.VIEWER },
];

async function main() {
  console.log("Seeding demo data...");
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  const org = await prisma.organization.upsert({
    where: { slug: DEMO_ORG.slug },
    update: { name: DEMO_ORG.name, description: DEMO_ORG.description },
    create: { ...DEMO_ORG },
  });
  console.log(`Organization: "${org.name}" (${org.id})`);

  for (const demo of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: { name: demo.name, isActive: true, passwordHash },
      create: { email: demo.email, name: demo.name, passwordHash, isActive: true },
    });
    await prisma.organizationMembership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      update: { role: demo.role },
      create: { userId: user.id, organizationId: org.id, role: demo.role },
    });
    console.log(`  ${demo.email} -> ${demo.role}`);
  }
  console.log("Seed complete.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());