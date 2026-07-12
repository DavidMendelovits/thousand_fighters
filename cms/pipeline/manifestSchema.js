/**
 * manifestSchema.js
 *
 * Canonical fighter manifest schema helpers.
 *
 * Canonical (game) format — all paths relative to the fighter root:
 *   {
 *     id, artSource, source, description, moveset, frameData,
 *     sheets:      { [sheetId]: "sheets/{sheetId}.png" },
 *     sprites:     { [sheetId]: ["sprites/{sheetId}/..._001.png", ...] },
 *     frameCounts: { [sheetId]: number },
 *     projectiles: { [name]: "projectiles/{name}.png" },
 *   }
 *
 * Legacy format (pre-standardization) used snake_case keys with absolute
 * paths: character_description, sheet_paths, sprite_paths, frame_counts.
 */

const LEGACY_KEYS = ['character_description', 'sheet_paths', 'sprite_paths', 'frame_counts'];

/** Strip a leading "/fighters/{id}/" (or any absolute) prefix to a fighter-root-relative path. */
function toRelativePath(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^\/fighters\/[^/]+(?:\/[^/]+)*?\/(sheets|sprites|projectiles|source|sounds)\//);
  if (match) {
    return value.slice(value.indexOf(`/${match[1]}/`) + 1);
  }
  return value.startsWith('/') ? value.slice(1) : value;
}

/** True when the manifest uses any legacy snake_case key. */
export function hasLegacyManifestKeys(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  return LEGACY_KEYS.some((key) => key in manifest);
}

/**
 * Normalize a manifest (canonical or legacy) into the canonical shape.
 * Always returns a new object; unknown keys are preserved.
 *
 * @param {object|null} manifest
 * @param {{ id?: string }} [options]
 * @returns {object|null}
 */
export function normalizeManifest(manifest, { id } = {}) {
  if (!manifest || typeof manifest !== 'object') return manifest ?? null;

  const normalized = { ...manifest };

  if (!normalized.id && id) normalized.id = id;

  if (!normalized.sheets && manifest.sheet_paths) {
    normalized.sheets = Object.fromEntries(
      Object.entries(manifest.sheet_paths).map(([sheetId, p]) => [sheetId, toRelativePath(p)]),
    );
  }
  if (!normalized.sprites && manifest.sprite_paths) {
    normalized.sprites = Object.fromEntries(
      Object.entries(manifest.sprite_paths).map(([sheetId, paths]) => [
        sheetId,
        (paths ?? []).map(toRelativePath),
      ]),
    );
  }
  if (!normalized.frameCounts && manifest.frame_counts) {
    normalized.frameCounts = { ...manifest.frame_counts };
  }
  if (!normalized.frameCounts && normalized.sprites) {
    normalized.frameCounts = Object.fromEntries(
      Object.entries(normalized.sprites).map(([sheetId, paths]) => [sheetId, (paths ?? []).length]),
    );
  }

  for (const key of LEGACY_KEYS) delete normalized[key];

  // Inline legacy description text is superseded by the description.txt file ref.
  if (typeof manifest.character_description === 'string' && !normalized.description) {
    normalized.description = 'description.txt';
  }

  // Legacy manifests held an inline moveset object; canonical is a file ref string.
  if (typeof normalized.moveset === 'object') delete normalized.moveset;

  return normalized;
}

/**
 * Validate that a manifest is in canonical shape.
 *
 * @param {object|null} manifest
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateManifestSchema(manifest) {
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['manifest is missing or not an object'], warnings };
  }

  if (hasLegacyManifestKeys(manifest)) {
    warnings.push(
      `manifest uses legacy snake_case keys (${LEGACY_KEYS.filter((k) => k in manifest).join(', ')}); ` +
        'regenerate with the current normalizer or run scripts/migrate_fighter_manifests.mjs',
    );
  }

  const normalized = normalizeManifest(manifest);
  if (!normalized.sheets || typeof normalized.sheets !== 'object' || !Object.keys(normalized.sheets).length) {
    errors.push('manifest.sheets is missing or empty');
  }
  if (!normalized.sprites || typeof normalized.sprites !== 'object' || !Object.keys(normalized.sprites).length) {
    errors.push('manifest.sprites is missing or empty');
  }
  if (!normalized.frameCounts || typeof normalized.frameCounts !== 'object') {
    errors.push('manifest.frameCounts is missing');
  }

  for (const [sheetId, paths] of Object.entries(normalized.sprites ?? {})) {
    const declared = normalized.frameCounts?.[sheetId];
    if (typeof declared === 'number' && Array.isArray(paths) && declared !== paths.length) {
      errors.push(`manifest.frameCounts.${sheetId} = ${declared} but manifest.sprites.${sheetId} lists ${paths.length} files`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
