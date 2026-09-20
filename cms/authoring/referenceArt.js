/** Use the current working branch, never the first concept found anywhere in
 * a character's historical asset inventory. New formats supersede old ones. */
export async function currentConceptAssetKey(repository, characterId, storage = repository.storage) {
  const root = await repository.workingAssetRoot?.(characterId) ?? `characters/${characterId}/assets`;
  const candidates = await Promise.all(['png', 'webp', 'jpg', 'svg'].map(async extension => {
    const key = `${root}/concept/concept_art.${extension}`;
    if (!await storage.exists(key)) return null;
    const metadata = await storage.getMetadata?.(key) ?? {};
    const timestamp = Date.parse(metadata.referenceGeneratedAt ?? metadata.uploadedAt ?? '');
    return { key, timestamp: Number.isFinite(timestamp) ? timestamp : 0 };
  }));
  return candidates.filter(Boolean).sort((a, b) => b.timestamp - a.timestamp)[0]?.key ?? null;
}
