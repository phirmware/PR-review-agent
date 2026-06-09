const INVISIBLE_FORMAT_CHARS = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const SAFE_ROOT_FILE = /^[A-Za-z0-9_.@+ -]+\.[A-Za-z0-9_.-]+$/;

export function normalizeSelectedFileText(value: string): string {
  return value
    .replace(INVISIBLE_FORMAT_CHARS, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^a\//, "")
    .replace(/^b\//, "")
    .replace(/\s+/g, " ");
}

export function resolveSelectedFilePath(selectedText: string, knownFiles: string[]): string | null {
  const selected = normalizeSelectedFileText(selectedText);
  if (!selected) {
    return null;
  }

  const exactMatch = knownFiles.find((file) => normalizeSelectedFileText(file) === selected);
  if (exactMatch) {
    return exactMatch;
  }

  const suffixMatch = knownFiles.find((file) => {
    const normalizedFile = normalizeSelectedFileText(file);
    return normalizedFile.endsWith(selected) || selected.endsWith(normalizedFile);
  });
  if (suffixMatch) {
    return suffixMatch;
  }

  if (selected.includes("/") || SAFE_ROOT_FILE.test(selected)) {
    return selected;
  }

  return null;
}
