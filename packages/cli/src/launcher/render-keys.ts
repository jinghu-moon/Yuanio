export function createUniqueRenderKeys<T>(
  items: readonly T[],
  getBaseKey: (item: T, index: number) => string | null | undefined,
  prefix: string,
): string[] {
  const seen = new Map<string, number>();

  return items.map((item, index) => {
    const rawKey = getBaseKey(item, index);
    const normalizedKey = typeof rawKey === "string"
      ? rawKey.trim()
      : rawKey == null
        ? ""
        : String(rawKey).trim();
    const baseKey = normalizedKey ? `${prefix}:${normalizedKey}` : `${prefix}:item-${index}`;
    const duplicateCount = seen.get(baseKey) ?? 0;

    seen.set(baseKey, duplicateCount + 1);
    return duplicateCount === 0 ? baseKey : `${baseKey}#${duplicateCount}`;
  });
}
