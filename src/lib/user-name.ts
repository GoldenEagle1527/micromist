/** Site-wide display name. Lives in localStorage as `user_name` (not IndexedDB). */

export const USER_NAME_KEY = "user_name";
export const USER_NAME_MIN = 1;
export const USER_NAME_MAX = 20;

function codePoints(raw: string): string[] {
  return Array.from(raw);
}

export function normalizeUserName(raw: string): string | null {
  const trimmed = raw.trim();
  const points = codePoints(trimmed);
  if (points.length < USER_NAME_MIN || points.length > USER_NAME_MAX) return null;
  return points.join("");
}

export function readUserName(): string | null {
  try {
    return normalizeUserName(localStorage.getItem(USER_NAME_KEY) ?? "");
  } catch {
    return null;
  }
}

export function writeUserName(raw: string): string | null {
  const name = normalizeUserName(raw);
  if (!name) return null;
  try {
    localStorage.setItem(USER_NAME_KEY, name);
  } catch {
    return name;
  }
  return name;
}

export function userNameLength(raw: string): number {
  return codePoints(raw.trim()).length;
}
