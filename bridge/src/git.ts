import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "./errors.js";

const execFileAsync = promisify(execFile);

function formatCommandForError(command: string, args: string[]): string {
  const safeArgs = args.map((arg) => {
    if (arg.length <= 80) {
      return arg;
    }

    return `${arg.slice(0, 77)}...`;
  });
  const formatted = [command, ...safeArgs].join(" ");
  return formatted.length <= 240 ? formatted : `${formatted.slice(0, 237)}...`;
}

export interface CommandOptions {
  cwd?: string;
  timeoutMs?: number;
  allowNonZeroExit?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface StreamingCommandOptions extends CommandOptions {
  onStdoutChunk?(chunk: string): void;
  onStderrChunk?(chunk: string): void;
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 30_000,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });

    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      exitCode: 0
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
      signal?: string;
      killed?: boolean;
    };

    if (execError.code === "ENOENT") {
      throw new AppError(`Required command is unavailable: ${command}`, 500);
    }

    if (execError.signal === "SIGTERM" || execError.killed) {
      throw new AppError(`Command timed out: ${formatCommandForError(command, args)}`, 504, {
        command,
        argCount: args.length
      });
    }

    const exitCode = typeof execError.code === "number" ? execError.code : 1;
    const result = {
      stdout: execError.stdout?.trim() ?? "",
      stderr: execError.stderr?.trim() ?? "",
      exitCode
    };

    if (options.allowNonZeroExit) {
      return result;
    }

    throw new AppError(result.stderr || result.stdout || `Command failed: ${command}`, 500, {
      command,
      args,
      exitCode
    });
  }
}

export async function runStreamingCommand(
  command: string,
  args: string[],
  options: StreamingCommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 30_000);

    function finishWithError(error: unknown): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      options.onStdoutChunk?.(chunk);
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        finishWithError(new AppError(`Required command is unavailable: ${command}`, 500));
        return;
      }

      finishWithError(error);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (signal === "SIGTERM") {
        reject(new AppError(`Command timed out: ${formatCommandForError(command, args)}`, 504, {
          command,
          argCount: args.length
        }));
        return;
      }

      const exitCode = code ?? 1;
      const result = {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode
      };

      if (exitCode !== 0 && !options.allowNonZeroExit) {
        reject(new AppError(result.stderr || result.stdout || `Command failed: ${command}`, 500, {
          command,
          args,
          exitCode
        }));
        return;
      }

      resolve(result);
    });
  });
}

export function parseNumstatOutput(output: string): Array<{ file: string; additions: number; deletions: number }> {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [additionsRaw, deletionsRaw, ...fileParts] = line.split("\t");
      const file = fileParts.join("\t");

      return {
        file,
        additions: additionsRaw === "-" ? 0 : Number(additionsRaw),
        deletions: deletionsRaw === "-" ? 0 : Number(deletionsRaw)
      };
    });
}
