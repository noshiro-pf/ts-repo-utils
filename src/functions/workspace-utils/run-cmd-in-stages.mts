#!/usr/bin/env tsx

import {
  executeStages,
  getWorkspacePackages,
} from './get-workspace-packages.mjs';

export const runCmdByStagesWorkspaces = async ({
  rootPackageJsonDir,
  cmd,
  filterWorkspacePattern,
}: Readonly<{
  rootPackageJsonDir: string;
  cmd: string;
  filterWorkspacePattern?: (packageName: string) => boolean;
}>): Promise<void> => {
  try {
    const packages = await getWorkspacePackages(rootPackageJsonDir);

    const filteredPackages =
      filterWorkspacePattern === undefined
        ? packages
        : packages.filter((pkg) => filterWorkspacePattern(pkg.name));

    await executeStages(filteredPackages, cmd);
    console.log(`\n✅ ${cmd} completed successfully`);
  } catch (err) {
    console.error(
      `\n❌ ${cmd} failed:`,
      err instanceof Error ? err.message : (err?.toString() ?? ''),
    );
    process.exit(1);
  }
};
