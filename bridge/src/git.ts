import { execFile } from "node:child_process";
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
