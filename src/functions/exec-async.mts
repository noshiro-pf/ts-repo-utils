import { exec, type ExecException, type ExecOptions } from 'node:child_process';
import { Result } from 'ts-data-forge';

type ExecOptionsWithSilent = DeepReadonly<ExecOptions & { silent?: boolean }>;

/**
 * Executes a shell command asynchronously.
 *
 * @param cmd - The command to execute.
 * @param options - Optional configuration for command execution.
 * @returns A promise that resolves with the command result.
 */
export function $(
  cmd: string,
  options: ExecOptionsWithSilent & Readonly<{ encoding: 'buffer' | null }>,
): Promise<Result<Readonly<{ stdout: Buffer; stderr: Buffer }>, ExecException>>;

/**
 * Executes a shell command asynchronously.
 *
 * @param cmd - The command to execute.
 * @param options - Optional configuration for command execution.
 * @returns A promise that resolves with the command result.
 */
export function $(
  cmd: string,
  options?: ExecOptionsWithSilent,
): Promise<Result<Readonly<{ stdout: string; stderr: string }>, ExecException>>;

export function $(
  cmd: string,
  options: ExecOptionsWithSilent = {},
): Promise<
  Result<
    Readonly<{ stdout: string | Buffer; stderr: string | Buffer }>,
    ExecException
  >
> {
  const { silent = false, timeout = 30000, ...execOptions } = options;

  if (!silent) {
    echo(`$ ${cmd}`);
  }

  return new Promise((resolve) => {
    const finalExecOptions = {
      timeout,
      encoding: (options as any).encoding || 'utf8',
      ...execOptions,
    };

    // eslint-disable-next-line security/detect-child-process
    exec(cmd, finalExecOptions, (error, stdout, stderr) => {
      if (!silent) {
        const stdoutStr = Buffer.isBuffer(stdout) ? stdout.toString() : stdout;
        const stderrStr = Buffer.isBuffer(stderr) ? stderr.toString() : stderr;

        if (stdoutStr !== '') {
          echo(stdoutStr);
        }
        if (stderrStr !== '') {
          console.error(stderrStr);
        }
      }

      if (error !== null) {
        resolve(Result.err(error));
      } else {
        resolve(Result.ok({ stdout, stderr }));
      }
    });
  });
}
