import path from "path";

/**
 * Resolve the project root directory.
 * Priority: CLI argument > process.cwd()
 */
export function getProjectRoot(): string {
  return process.argv[2] || process.cwd();
}

export function getMemoryDir(): string {
  return path.resolve(getProjectRoot(), ".memorize");
}
