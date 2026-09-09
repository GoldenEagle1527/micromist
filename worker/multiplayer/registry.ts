import type { AdapterFactory } from "./adapter";

const factories = new Map<string, AdapterFactory>();

export function registerGameAdapter(slug: string, factory: AdapterFactory): void {
  factories.set(slug.trim().toLowerCase(), factory);
}

export function getGameAdapterFactory(slug: string): AdapterFactory | null {
  return factories.get(slug.trim().toLowerCase()) ?? null;
}

export function listRegisteredGames(): string[] {
  return [...factories.keys()];
}
