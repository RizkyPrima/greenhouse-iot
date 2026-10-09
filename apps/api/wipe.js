import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.telemetryRecord.deleteMany();
  console.log("Telemetry records wiped");
}
main().catch(console.error).finally(() => prisma.$disconnect());
