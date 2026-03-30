import { PrismaClient } from "@prisma/client";

import { getConfig } from "../config/env";
import { SecurityRepository } from "../modules/security/repository";
import { SecurityService } from "../modules/security/service";

export async function runSecurityRetentionJob(prisma?: PrismaClient) {
  const config = getConfig();
  const client = prisma ?? new PrismaClient();
  const securityRepository = new SecurityRepository(client);
  const securityService = new SecurityService(securityRepository);

  try {
    let clearedObservations = 0;

    while (true) {
      const clearedBatch = await securityService.purgeExpiredRawIpData(
        config.securityRetentionBatchSize
      );
      clearedObservations += clearedBatch;

      if (clearedBatch < config.securityRetentionBatchSize) {
        break;
      }
    }

    return {
      cleared_observations: clearedObservations,
      retention_batch_size: config.securityRetentionBatchSize
    };
  } finally {
    if (!prisma) {
      await client.$disconnect();
    }
  }
}

async function main(): Promise<void> {
  const result = await runSecurityRetentionJob();
  console.log(JSON.stringify(result, null, 2));
}

if (!process.env.VITEST && require.main === module) {
  void main().catch((error) => {
    console.error("Security retention job failed.", error);
    process.exit(1);
  });
}
