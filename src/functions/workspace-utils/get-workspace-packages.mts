#!/usr/bin/env tsx

import { spawn } from 'child_process';
import { hasKey, isNotUndefined, isRecord, isString } from 'ts-data-forge';
import '../../node-global.mjs';

const DEBUG = false as boolean;

// Get all workspace packages
type Package = Readonly<{
  name: string;
  path: string;
  packageJson: JsonValue;
  dependencies: ReadonlyRecord<string, string>;
}>;

export const getWorkspacePackages = async (
  rootPackageJsonDir: string,
): Promise<readonly Package[]> => {
  // Read root package.json
  const rootPackageJson = JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.readFile(path.join(rootPackageJsonDir, 'package.json'), 'utf8'),
  );

  const workspacePatterns: readonly string[] = getStrArrayFromJsonValue(
    rootPackageJson,
    'workspaces',
  );

  const packagePromises = workspacePatterns.map(async (pattern) => {
    const matches = await glob(pattern, {
      cwd: rootPackageJsonDir,
      ignore: ['**/node_modules/**'],
    });

    const packageJsons: readonly (readonly [string, JsonValue] | undefined)[] =
      await Promise.all(
        matches.map(async (match) => {
          const packagePath = path.join(rootPackageJsonDir, match);
          try {
            const packageJson = JSON.parse(
              // eslint-disable-next-line security/detect-non-literal-fs-filename
              await fs.readFile(path.join(packagePath, 'package.json'), 'utf8'),
            ) as JsonValue;

            return [packagePath, packageJson];
          } catch {
            // Skip directories without package.json
            return undefined;
          }
        }),
      );

    const packageInfos: readonly Package[] = await Promise.all(
      packageJsons.filter(isNotUndefined).map(([packagePath, packageJson]) => {
        return {
          name: getStrFromJsonValue(packageJson, 'name'),
          path: packagePath,
          packageJson,
          dependencies: {
            ...getKeyValueRecordFromJsonValue(packageJson, 'dependencies'),
            ...getKeyValueRecordFromJsonValue(packageJson, 'devDependencies'),
            ...getKeyValueRecordFromJsonValue(packageJson, 'peerDependencies'),
          },
        };
      }),
    );

    return packageInfos;
  });

  const allPackageArrays = await Promise.all(packagePromises);
  const finalPackages = allPackageArrays.flat();

  return finalPackages;
};

const getStrFromJsonValue = (value: JsonValue, key: string): string =>
  isRecord(value) && hasKey(value, key) && isString(value[key])
    ? value[key]
    : '';

const getStrArrayFromJsonValue = (
  value: JsonValue,
  key: string,
): readonly string[] =>
  isRecord(value) &&
  hasKey(value, key) &&
  Array.isArray(value[key]) &&
  value[key].every(isString)
    ? value[key]
    : [];

const getKeyValueRecordFromJsonValue = (
  value: JsonValue,
  key: string,
): ReadonlyRecord<string, string> => {
  if (!isRecord(value) || !hasKey(value, key)) {
    return {};
  }
  const obj = value[key];
  if (!isRecord(obj)) {
    return {};
  }
  const entries = Object.entries(obj).filter(
    (entry): entry is [string, string] => isString(entry[1]),
  );
  return Object.fromEntries(entries);
};

// Build dependency graph
export const buildDependencyGraph = (
  packages: readonly Package[],
): ReadonlyMap<string, readonly string[]> => {
  const packageMap = new Map(packages.map((p) => [p.name, p]));
  const graph = new Map<string, string[]>();

  for (const pkg of packages) {
    const deps = Object.keys(pkg.dependencies).filter((depName) =>
      packageMap.has(depName),
    );
    graph.set(pkg.name, deps);
  }

  return graph;
};

// Topological sort for dependency order
export const topologicalSort = (
  packages: readonly Package[],
): readonly (Package | undefined)[] => {
  const graph = buildDependencyGraph(packages);
  const visited = new Set<string>();
  const result: string[] = [];

  const packageMap = new Map(packages.map((p) => [p.name, p]));

  const visit = (pkgName: string): void => {
    if (visited.has(pkgName)) return;
    visited.add(pkgName);

    const deps = graph.get(pkgName) ?? [];
    for (const dep of deps) {
      visit(dep);
    }

    // eslint-disable-next-line functional/immutable-data
    result.push(pkgName);
  };

  for (const pkg of packages) {
    visit(pkg.name);
  }

  return result.map((pkgName) => packageMap.get(pkgName));
};

// Execute script in package
export const executeScript = (
  pkg: Package,
  scriptName: string,
  { prefix = true }: Readonly<{ prefix?: boolean }> = {},
): Promise<{ code?: number; skipped?: boolean }> =>
  new Promise((resolve, reject) => {
    const packageJsonScripts =
      isRecord(pkg.packageJson) && isRecord(pkg.packageJson['scripts'])
        ? pkg.packageJson['scripts']
        : {};
    const hasScript = hasKey(packageJsonScripts, scriptName);
    if (!hasScript) {
      resolve({ skipped: true });
      return;
    }

    const prefixStr = prefix ? `[${pkg.name}] ` : '';
    const proc = spawn('npm', ['run', scriptName], {
      cwd: pkg.path,
      shell: true,
      stdio: 'pipe',
    });

    proc.stdout.on('data', (data: Readonly<Buffer>) => {
      process.stdout.write(prefixStr + data.toString());
    });

    proc.stderr.on('data', (data: Readonly<Buffer>) => {
      process.stderr.write(prefixStr + data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ code });
      } else {
        reject(new Error(`${pkg.name} exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });

// Execute scripts in parallel with concurrency limit
export const executeParallel = async (
  packages: readonly Package[],
  scriptName: string,
  concurrency: number = 3,
): Promise<DeepReadonly<{ code?: number; skipped?: boolean }[]>> => {
  const mut_results: Promise<Readonly<{ code?: number; skipped?: boolean }>>[] =
    [];

  const executing = new Set<Promise<unknown>>();

  for (const pkg of packages) {
    const promise = executeScript(pkg, scriptName).catch((err) => {
      const errorMessage =
        err instanceof Error
          ? err.message
          : isRecord(err) && hasKey(err, 'message')
            ? (err.message?.toString() ?? 'Unknown error message')
            : 'Unknown error';

      console.error(`\nError in ${pkg.name}:`, errorMessage);
      throw err instanceof Error ? err : new Error(errorMessage);
    });

    // eslint-disable-next-line functional/immutable-data
    mut_results.push(promise);

    const wrappedPromise = promise.finally(() => {
      executing.delete(wrappedPromise);
      if (DEBUG) {
        console.debug('executing size', executing.size);
      }
    });

    executing.add(wrappedPromise);

    if (DEBUG) {
      console.debug('executing size', executing.size);
    }

    // If we reach concurrency limit, wait for one to finish
    if (executing.size >= concurrency) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.race(executing);
    }
  }

  return Promise.all(mut_results);
};

// Execute scripts in stages (dependency order)
export const executeStages = async (
  packages: readonly Package[],
  scriptName: string,
): Promise<void> => {
  const sorted = topologicalSort(packages).filter(
    (pkg): pkg is Package => pkg !== undefined,
  );
  const stages: Package[][] = [];
  const completed = new Set<string>();

  while (completed.size < sorted.length) {
    const stage: Package[] = [];

    for (const pkg of sorted) {
      if (completed.has(pkg.name)) continue;

      const deps = buildDependencyGraph(packages).get(pkg.name) ?? [];
      const depsCompleted = deps.every((dep) => completed.has(dep));

      if (depsCompleted) {
        // eslint-disable-next-line functional/immutable-data
        stage.push(pkg);
      }
    }

    if (stage.length === 0) {
      throw new Error('Circular dependency detected');
    }

    // eslint-disable-next-line functional/immutable-data
    stages.push(stage);
    for (const pkg of stage) completed.add(pkg.name);
  }

  console.log(`\nExecuting ${scriptName} in ${stages.length} stages...\n`);

  for (const [i, stage] of stages.entries()) {
    if (stage.length > 0) {
      console.log(`Stage ${i + 1}: ${stage.map((p) => p.name).join(', ')}`);
      // eslint-disable-next-line no-await-in-loop
      await executeParallel(stage, scriptName, 5);
    }
  }
};

// Filter packages by pattern
export const filterPackagesByPattern = (
  packages: readonly Package[],
  pattern: string,
): readonly Package[] =>
  packages.filter((pkg) => {
    if (pattern.includes('*')) {
      // eslint-disable-next-line security/detect-non-literal-regexp
      const regex = new RegExp(`^${pattern.replaceAll('*', '.*')}$`, 'u');
      return regex.test(pkg.name);
    }
    return pkg.name === pattern;
  });
