import { spawn } from 'child_process';
import {
  createPromise,
  hasKey,
  isNotUndefined,
  isRecord,
  pipe,
  Result,
} from 'ts-data-forge';
import '../../node-global.mjs';
import { type Package } from './types.mjs';

const DEBUG = false as boolean;

/**
 * Executes a npm script across multiple packages in parallel with a concurrency limit.
 * @param packages - Array of Package objects to execute the script in
 * @param scriptName - The name of the npm script to execute
 * @param concurrency - Maximum number of packages to process simultaneously (default: 3)
 * @returns A promise that resolves to an array of execution results
 */
export const executeParallel = async (
  packages: readonly Package[],
  scriptName: string,
  concurrency: number = 3,
): Promise<
  readonly Result<Readonly<{ code?: number; skipped?: boolean }>, Error>[]
> => {
  const mut_resultPromises: Promise<
    Result<Readonly<{ code?: number; skipped?: boolean }>, Error>
  >[] = [];

  const executing = new Set<Promise<unknown>>();

  for (const pkg of packages) {
    const promise = executeScript(pkg, scriptName);

    mut_resultPromises.push(promise);

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

  return Promise.all(mut_resultPromises);
};

/**
 * Executes a npm script across packages in dependency order stages.
 * Packages are grouped into stages where each stage contains packages whose
 * dependencies have been completed in previous stages.
 * @param packages - Array of Package objects to execute the script in
 * @param scriptName - The name of the npm script to execute
 * @param concurrency - Maximum number of packages to process simultaneously within each stage (default: 3)
 * @returns A promise that resolves when all stages are complete
 */
export const executeStages = async (
  packages: readonly Package[],
  scriptName: string,
  concurrency: number = 3,
): Promise<void> => {
  const dependencyGraph = buildDependencyGraph(packages);

  const sorted = topologicalSortPackages(packages, dependencyGraph);

  const stages: (readonly Package[])[] = [];
  const completed = new Set<string>();

  while (completed.size < sorted.length) {
    const stage: Package[] = [];

    for (const pkg of sorted) {
      if (completed.has(pkg.name)) continue;

      const deps = dependencyGraph.get(pkg.name) ?? [];
      const depsCompleted = deps.every((dep) => completed.has(dep));

      if (depsCompleted) {
        stage.push(pkg);
      }
    }

    if (stage.length === 0) {
      throw new Error('Circular dependency detected');
    }

    stages.push(stage);
    for (const pkg of stage) completed.add(pkg.name);
  }

  console.log(`\nExecuting ${scriptName} in ${stages.length} stages...\n`);

  for (const [i, stage] of stages.entries()) {
    if (stage.length > 0) {
      console.log(`Stage ${i + 1}: ${stage.map((p) => p.name).join(', ')}`);
      // eslint-disable-next-line no-await-in-loop
      await executeParallel(stage, scriptName, concurrency);
    }
  }
};

/**
 * Executes a npm script in a specific package directory.
 * @param pkg - The package object containing path and metadata
 * @param scriptName - The name of the npm script to execute
 * @param options - Configuration options
 * @param options.prefix - Whether to prefix output with package name (default: true)
 * @returns A promise that resolves to execution result with exit code or skipped flag
 */
const executeScript = (
  pkg: Package,
  scriptName: string,
  { prefix = true }: Readonly<{ prefix?: boolean }> = {},
): Promise<Result<Readonly<{ code?: number; skipped?: boolean }>, Error>> =>
  pipe(
    createPromise(
      (
        resolve: (
          value: Readonly<{ code?: number; skipped?: boolean }>,
        ) => void,
        reject: (reason: unknown) => void,
      ) => {
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

        proc.on('close', (code: number | null) => {
          if (code === 0) {
            resolve({ code });
          } else {
            reject(new Error(`${pkg.name} exited with code ${code}`));
          }
        });

        proc.on('error', reject);
      },
    ),
  ).map((result) =>
    result.then(
      Result.mapErr((err) => {
        const errorMessage: string =
          err instanceof Error
            ? err.message
            : isRecord(err) && hasKey(err, 'message')
              ? (err.message?.toString() ?? 'Unknown error message')
              : 'Unknown error';

        console.error(`\nError in ${pkg.name}:`, errorMessage);
        return err instanceof Error ? err : new Error(errorMessage);
      }),
    ),
  ).value;

/**
 * Performs a topological sort on packages based on their dependencies,
 * ensuring dependencies are ordered before their dependents.
 * @param packages - Array of Package objects to sort
 * @returns An array of packages in dependency order (dependencies first)
 */
const topologicalSortPackages = (
  packages: readonly Package[],
  dependencyGraph: ReadonlyMap<string, readonly string[]>,
): readonly Package[] => {
  const visited = new Set<string>();
  const result: string[] = [];

  const packageMap = new Map(packages.map((p) => [p.name, p]));

  const visit = (pkgName: string): void => {
    if (visited.has(pkgName)) return;
    visited.add(pkgName);

    const deps = dependencyGraph.get(pkgName) ?? [];
    for (const dep of deps) {
      visit(dep);
    }

    result.push(pkgName);
  };

  for (const pkg of packages) {
    visit(pkg.name);
  }

  return result
    .map((pkgName) => packageMap.get(pkgName))
    .filter(isNotUndefined);
};

/**
 * Builds a dependency graph from the given packages, mapping each package name
 * to its internal workspace dependencies.
 * @param packages - Array of Package objects to analyze
 * @returns A readonly map where keys are package names and values are arrays of their dependency package names
 */
const buildDependencyGraph = (
  packages: readonly Package[],
): ReadonlyMap<string, readonly string[]> => {
  const packageMap = new Map(packages.map((p) => [p.name, p]));
  const graph = new Map<string, readonly string[]>();

  for (const pkg of packages) {
    const deps = Object.keys(pkg.dependencies).filter((depName) =>
      packageMap.has(depName),
    );
    graph.set(pkg.name, deps);
  }

  return graph;
};
