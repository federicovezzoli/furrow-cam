import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need a direct (non-pooled) connection on Neon (ADR-0005).
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});
