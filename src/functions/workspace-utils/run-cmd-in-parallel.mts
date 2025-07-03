#!/usr/bin/env tsx

import {
  executeParallel,
  getWorkspacePackages,
} from './get-workspace-packages.mjs';

export const runCmdInParallelAcrossWorkspaces = async ({
  rootPackageJsonDir,
  cmd,
  concurrency = 3,
  filterWorkspacePattern,
}: Readonly<{
  rootPackageJsonDir: string;
  cmd: string;
  concurrency?: number;
  filterWorkspacePattern?: (packageName: string) => boolean;
}>): Promise<void> => {
  try {
    const packages = await getWorkspacePackages(rootPackageJsonDir);

    const filteredPackages =
      filterWorkspacePattern === undefined
        ? packages
        : packages.filter((pkg) => filterWorkspacePattern(pkg.name));

    await executeParallel(filteredPackages, cmd, concurrency);
    console.log(`\n✅ ${cmd} completed successfully`);
  } catch (err) {
    console.error(
      `\n❌ ${cmd} failed:`,
      err instanceof Error ? err.message : (err?.toString() ?? ''),
    );
    process.exit(1);
  }
};
