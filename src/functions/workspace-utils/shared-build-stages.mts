#!/usr/bin/env tsx

import {
  executeStages,
  filterPackagesByPattern,
  getWorkspacePackages,
} from './workspace-utils.mjs';

const main = async (): Promise<void> => {
  try {
    const packages = await getWorkspacePackages();
    const sharedPackages = filterPackagesByPattern(packages, '@shared/*');
    await executeStages(sharedPackages, 'build');
    console.log('\n✅ Shared build stages completed successfully');
  } catch (err) {
    console.error(
      '\n❌ Shared build stages failed:',
      err instanceof Error ? err.message : (err?.toString() ?? '')
    );
    process.exit(1);
  }
};

await main();
