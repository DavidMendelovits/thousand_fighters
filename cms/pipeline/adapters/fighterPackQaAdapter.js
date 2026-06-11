import { normalizeManifest, validateManifestSchema } from '../manifestSchema.js';

const EXPECTED_SHEETS = ['base', 'punch', 'kick', 'special_1', 'special_2'];
const MIN_FRAME_COUNT = 4;
const MIN_SHEETS_WITH_ENOUGH_FRAMES = 4;
const MIN_ANCHOR_STABILITY_FRAMES = 3;

export class FighterPackQaAdapter {
  constructor({ storage, repository }) {
    this.storage = storage;
    this.repository = repository;
    this.id = 'fighter-pack-qa';
    this.provider = 'real';
    this.capabilities = ['fighter-pack-validation', 'metadata-qa', 'frame-qa', 'manifest-qa'];
  }

  async healthCheck() {
    return {
      status: 'ok',
      message: 'Real fighter pack QA adapter is available. Validates manifest, frameData, sprite files, and metadata consistency.',
    };
  }

  async validateFighterPack(request) {
    const characterId = requireField(request.characterId, 'characterId');
    const normalizedKey = requireField(request.normalizedKey, 'normalizedKey');
    const runId = request.runId ?? `run-${new Date().toISOString().replaceAll(':', '-')}`;
    const generatedAt = request.requestedAt ?? new Date().toISOString();

    const assetRoot = normalizedKey.replace(/\/manifest\.json$/, '');
    const checks = [];
    let manifest = null;
    let frameData = null;

    // Check 1: manifest-exists
    const manifestCheck = await this._checkManifestExists(assetRoot);
    checks.push(manifestCheck);
    if (manifestCheck.status !== 'error') {
      manifest = manifestCheck._data;
    }
    delete manifestCheck._data;

    // Check 1b: manifest-schema (canonical camelCase keys, counts consistent)
    if (manifest) {
      const schemaResult = validateManifestSchema(manifest);
      checks.push({
        id: 'manifest-schema',
        status: !schemaResult.valid ? 'error' : schemaResult.warnings.length ? 'warning' : 'pass',
        message: schemaResult.valid
          ? schemaResult.warnings[0] ?? 'manifest.json matches the canonical schema.'
          : `manifest.json schema errors: ${schemaResult.errors.join('; ')}`,
      });
      manifest = normalizeManifest(manifest, { id: characterId });
    }

    // Check 2: framedata-exists
    const frameDataCheck = await this._checkFrameDataExists(assetRoot);
    checks.push(frameDataCheck);
    if (frameDataCheck.status !== 'error') {
      frameData = frameDataCheck._data;
    }
    delete frameDataCheck._data;

    // Check 3: sheet-files-exist
    checks.push(await this._checkSheetFilesExist(assetRoot, manifest));

    // Check 4: sprite-files-exist
    const spriteCheck = await this._checkSpriteFilesExist(assetRoot, manifest);
    checks.push(spriteCheck);

    // Check 5: frame-count-consistency
    checks.push(this._checkFrameCountConsistency(manifest, frameData, spriteCheck._actualCounts));
    delete spriteCheck._actualCounts;

    // Check 6: framedata-dimensions
    checks.push(this._checkFrameDataDimensions(frameData));

    // Check 7: anchor-stability
    checks.push(this._checkAnchorStability(frameData));

    // Check 8: normalization-report-check
    checks.push(await this._checkNormalizationReport(assetRoot));

    // Check 9: projectile-assets
    checks.push(await this._checkProjectileAssets(assetRoot, manifest));

    // Check 10: minimum-frame-count
    checks.push(this._checkMinimumFrameCount(frameData, manifest));

    // Check 11: frame-height-consistency (all rows at the fighter's scale)
    checks.push(this._checkFrameHeightConsistency(frameData));

    // Check 12: wide-reach-sanity (wide-profile moves actually reach further)
    checks.push(await this._checkWideReachSanity(characterId, frameData));

    // Compute summary
    const errors = checks.filter((c) => c.status === 'error').length;
    const warnings = checks.filter((c) => c.status === 'warning').length;
    const passed = checks.filter((c) => c.status === 'pass').length;

    const sheetsChecked = frameData ? Object.keys(frameData.frames ?? {}).length : 0;
    const framesChecked = frameData
      ? Object.values(frameData.frames ?? {}).reduce((sum, arr) => sum + arr.length, 0)
      : 0;

    const projectilesChecked = manifest?.projectiles
      ? Object.keys(manifest.projectiles).length
      : 0;

    const overallStatus = errors > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass';

    const report = {
      status: overallStatus,
      characterId,
      normalizedKey,
      generatedAt,
      summary: {
        errors,
        warnings,
        passed,
        sheetsChecked,
        framesChecked,
        projectilesChecked,
      },
      checks,
    };

    const artifact = await this.repository.writeQaReport(characterId, runId, report);

    return {
      ...report,
      provider: 'real',
      reportKey: artifact.key,
      reportUrl: artifact.url,
    };
  }

  // -------------------------------------------------------------------
  // Check implementations
  // -------------------------------------------------------------------

  async _checkManifestExists(assetRoot) {
    const key = `${assetRoot}/manifest.json`;
    try {
      const exists = await this.storage.exists(key);
      if (!exists) {
        return {
          id: 'manifest-exists',
          status: 'error',
          message: `manifest.json not found at storage key: ${key}`,
        };
      }
      let parsed;
      try {
        parsed = await this.storage.getJson(key);
      } catch (err) {
        return {
          id: 'manifest-exists',
          status: 'error',
          message: `manifest.json exists but failed to parse as JSON: ${err.message}`,
        };
      }
      return {
        id: 'manifest-exists',
        status: 'pass',
        message: 'manifest.json exists and is valid JSON.',
        _data: parsed,
      };
    } catch (err) {
      return {
        id: 'manifest-exists',
        status: 'error',
        message: `Error reading manifest.json: ${err.message}`,
      };
    }
  }

  async _checkFrameDataExists(assetRoot) {
    const key = `${assetRoot}/frameData.json`;
    try {
      const exists = await this.storage.exists(key);
      if (!exists) {
        return {
          id: 'framedata-exists',
          status: 'error',
          message: `frameData.json not found at storage key: ${key}`,
        };
      }
      let parsed;
      try {
        parsed = await this.storage.getJson(key);
      } catch (err) {
        return {
          id: 'framedata-exists',
          status: 'error',
          message: `frameData.json exists but failed to parse as JSON: ${err.message}`,
        };
      }
      if (!parsed?.frames || typeof parsed.frames !== 'object') {
        return {
          id: 'framedata-exists',
          status: 'error',
          message: 'frameData.json is missing the required "frames" object.',
          _data: parsed,
        };
      }
      const foundSheets = Object.keys(parsed.frames);
      const missingSheets = EXPECTED_SHEETS.filter((s) => !foundSheets.includes(s));
      if (missingSheets.length > 0) {
        return {
          id: 'framedata-exists',
          status: 'warning',
          message: `frameData.json is missing expected sheet keys: ${missingSheets.join(', ')}. Found: ${foundSheets.join(', ')}.`,
          _data: parsed,
        };
      }
      return {
        id: 'framedata-exists',
        status: 'pass',
        message: `frameData.json exists, is valid JSON, and has all expected sheet keys (${foundSheets.join(', ')}).`,
        _data: parsed,
      };
    } catch (err) {
      return {
        id: 'framedata-exists',
        status: 'error',
        message: `Error reading frameData.json: ${err.message}`,
      };
    }
  }

  async _checkSheetFilesExist(assetRoot, manifest) {
    if (!manifest) {
      return {
        id: 'sheet-files-exist',
        status: 'warning',
        message: 'Skipped: manifest.json could not be loaded.',
      };
    }

    const sheetPaths = manifest.sheet_paths ?? manifest.sheets ?? {};
    if (Object.keys(sheetPaths).length === 0) {
      return {
        id: 'sheet-files-exist',
        status: 'warning',
        message: 'manifest.json has no sheet_paths or sheets entries to check.',
      };
    }

    const missing = [];
    for (const [sheetId, sheetPath] of Object.entries(sheetPaths)) {
      // sheetPath may be an absolute web path like /fighters/janitor/sheets/base.png
      // or a relative path like sheets/base.png
      const relativePath = stripLeadingSlash(sheetPath);
      // The path in manifest may be web-absolute. We need to resolve relative to assetRoot.
      const key = resolveAssetPath(assetRoot, relativePath, sheetPath);
      const exists = await this.storage.exists(key).catch(() => false);
      if (!exists) {
        missing.push(sheetId);
      }
    }

    if (missing.length > 0) {
      return {
        id: 'sheet-files-exist',
        status: 'error',
        message: `Missing sheet files for: ${missing.join(', ')}.`,
      };
    }

    return {
      id: 'sheet-files-exist',
      status: 'pass',
      message: `All ${Object.keys(sheetPaths).length} sheet files exist.`,
    };
  }

  async _checkSpriteFilesExist(assetRoot, manifest) {
    if (!manifest) {
      return {
        id: 'sprite-files-exist',
        status: 'warning',
        message: 'Skipped: manifest.json could not be loaded.',
        _actualCounts: {},
      };
    }

    const spritePaths = manifest.sprite_paths ?? manifest.sprites ?? {};
    if (Object.keys(spritePaths).length === 0) {
      return {
        id: 'sprite-files-exist',
        status: 'warning',
        message: 'manifest.json has no sprite_paths or sprites entries to check.',
        _actualCounts: {},
      };
    }

    const missing = [];
    const actualCounts = {};

    for (const [sheetId, sprites] of Object.entries(spritePaths)) {
      const spriteList = Array.isArray(sprites) ? sprites : [];
      actualCounts[sheetId] = 0;
      for (const spritePath of spriteList) {
        const key = resolveAssetPath(assetRoot, stripLeadingSlash(spritePath), spritePath);
        const exists = await this.storage.exists(key).catch(() => false);
        if (exists) {
          actualCounts[sheetId] += 1;
        } else {
          missing.push(spritePath);
        }
      }
    }

    if (missing.length > 0) {
      return {
        id: 'sprite-files-exist',
        status: 'error',
        message: `${missing.length} sprite file(s) missing. First missing: ${missing[0]}.`,
        _actualCounts: actualCounts,
      };
    }

    const total = Object.values(actualCounts).reduce((sum, n) => sum + n, 0);
    return {
      id: 'sprite-files-exist',
      status: 'pass',
      message: `All ${total} sprite files exist across ${Object.keys(actualCounts).length} sheets.`,
      _actualCounts: actualCounts,
    };
  }

  _checkFrameCountConsistency(manifest, frameData, actualSpriteCounts = {}) {
    if (!manifest || !frameData) {
      return {
        id: 'frame-count-consistency',
        status: 'warning',
        message: 'Skipped: manifest.json or frameData.json could not be loaded.',
      };
    }

    const frameDataSheets = frameData.frames ?? {};
    const manifestCounts = manifest.frameCounts ?? manifest.frame_counts ?? {};
    const spritePaths = manifest.sprites ?? manifest.sprite_paths ?? {};
    const mismatches = [];

    for (const sheet of EXPECTED_SHEETS) {
      const frameDataCount = Array.isArray(frameDataSheets[sheet]) ? frameDataSheets[sheet].length : null;
      const manifestCount = typeof manifestCounts[sheet] === 'number' ? manifestCounts[sheet] : null;
      const spriteFileCount = actualSpriteCounts[sheet] ?? (Array.isArray(spritePaths[sheet]) ? spritePaths[sheet].length : null);

      if (frameDataCount !== null && manifestCount !== null && frameDataCount !== manifestCount) {
        mismatches.push(`${sheet}: frameData has ${frameDataCount} frames but manifest.frameCounts says ${manifestCount}`);
      }

      if (frameDataCount !== null && spriteFileCount !== null && frameDataCount !== spriteFileCount) {
        mismatches.push(`${sheet}: frameData has ${frameDataCount} frames but ${spriteFileCount} sprite files exist`);
      }
    }

    if (mismatches.length > 0) {
      return {
        id: 'frame-count-consistency',
        status: 'error',
        message: `Frame count mismatches found: ${mismatches.join('; ')}.`,
      };
    }

    return {
      id: 'frame-count-consistency',
      status: 'pass',
      message: 'Frame counts are consistent between manifest, frameData, and sprite files.',
    };
  }

  _checkFrameDataDimensions(frameData) {
    if (!frameData) {
      return {
        id: 'framedata-dimensions',
        status: 'warning',
        message: 'Skipped: frameData.json could not be loaded.',
      };
    }

    const issues = [];
    const framesObj = frameData.frames ?? {};

    for (const [sheet, frames] of Object.entries(framesObj)) {
      if (!Array.isArray(frames)) continue;
      frames.forEach((frame, index) => {
        const label = `${sheet}[${index}]`;
        if (typeof frame.width !== 'number' || frame.width <= 0) {
          issues.push(`${label}: invalid width ${frame.width}`);
        }
        if (typeof frame.height !== 'number' || frame.height <= 0) {
          issues.push(`${label}: invalid height ${frame.height}`);
        }
        if (frame.anchor) {
          const { x, y } = frame.anchor;
          if (typeof x !== 'number' || x < 0 || (frame.width > 0 && x > frame.width)) {
            issues.push(`${label}: anchor.x ${x} is out of bounds [0, ${frame.width}]`);
          }
          if (typeof y !== 'number' || y < 0 || (frame.height > 0 && y > frame.height)) {
            issues.push(`${label}: anchor.y ${y} is out of bounds [0, ${frame.height}]`);
          }
        }
      });
    }

    if (issues.length > 0) {
      return {
        id: 'framedata-dimensions',
        status: 'error',
        message: `${issues.length} dimension/anchor issue(s) found. First: ${issues[0]}.`,
      };
    }

    const totalFrames = Object.values(framesObj).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    return {
      id: 'framedata-dimensions',
      status: 'pass',
      message: `All ${totalFrames} frames have valid dimensions and anchor positions.`,
    };
  }

  _checkAnchorStability(frameData) {
    if (!frameData) {
      return {
        id: 'anchor-stability',
        status: 'warning',
        message: 'Skipped: frameData.json could not be loaded.',
      };
    }

    const warnings = [];
    const framesObj = frameData.frames ?? {};

    for (const [sheet, frames] of Object.entries(framesObj)) {
      if (!Array.isArray(frames) || frames.length < MIN_ANCHOR_STABILITY_FRAMES) continue;

      const anchors = frames.map((f) => f.anchor).filter(Boolean);
      if (anchors.length < MIN_ANCHOR_STABILITY_FRAMES) continue;

      const ys = anchors.map((a) => a.y);
      const heights = frames.map((f) => f.height).filter((h) => typeof h === 'number' && h > 0);
      if (heights.length === 0) continue;

      const meanHeight = heights.reduce((sum, h) => sum + h, 0) / heights.length;
      const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
      const variance = ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0) / ys.length;
      const stdDev = Math.sqrt(variance);

      const threshold = meanHeight * 0.20; // 20% of mean frame height
      if (stdDev > threshold) {
        warnings.push(
          `${sheet}: anchor Y standard deviation ${stdDev.toFixed(1)}px exceeds 20% of mean frame height (${threshold.toFixed(1)}px) — possible misalignment.`,
        );
      }
    }

    if (warnings.length > 0) {
      return {
        id: 'anchor-stability',
        status: 'warning',
        message: `Anchor instability detected in ${warnings.length} sheet(s): ${warnings.join('; ')}.`,
      };
    }

    return {
      id: 'anchor-stability',
      status: 'pass',
      message: 'Anchor positions are stable (Y variance within 20% of frame height) across all sheets.',
    };
  }

  async _checkNormalizationReport(assetRoot) {
    const key = `${assetRoot}/normalization-report.json`;
    try {
      const exists = await this.storage.exists(key);
      if (!exists) {
        return {
          id: 'normalization-report-check',
          status: 'warning',
          message: 'normalization-report.json not found. Normalization may not have run.',
        };
      }

      let report;
      try {
        report = await this.storage.getJson(key);
      } catch (err) {
        return {
          id: 'normalization-report-check',
          status: 'warning',
          message: `normalization-report.json could not be parsed: ${err.message}`,
        };
      }

      const reportWarnings = Array.isArray(report.warnings) ? report.warnings : [];
      if (reportWarnings.length > 0) {
        return {
          id: 'normalization-report-check',
          status: 'warning',
          message: `normalization-report.json has ${reportWarnings.length} warning(s): ${reportWarnings.slice(0, 3).join('; ')}${reportWarnings.length > 3 ? ' ...' : ''}.`,
        };
      }

      return {
        id: 'normalization-report-check',
        status: 'pass',
        message: 'normalization-report.json exists with no warnings.',
      };
    } catch (err) {
      return {
        id: 'normalization-report-check',
        status: 'warning',
        message: `Error reading normalization-report.json: ${err.message}`,
      };
    }
  }

  async _checkProjectileAssets(assetRoot, manifest) {
    if (!manifest) {
      return {
        id: 'projectile-assets',
        status: 'warning',
        message: 'Skipped: manifest.json could not be loaded.',
      };
    }

    const projectiles = manifest.projectiles;
    if (!projectiles || Object.keys(projectiles).length === 0) {
      return {
        id: 'projectile-assets',
        status: 'pass',
        message: 'No projectiles declared in manifest — check skipped.',
      };
    }

    const missing = [];
    const projectileEntries = typeof projectiles === 'object' ? Object.entries(projectiles) : [];

    for (const [projectileId, projectilePath] of projectileEntries) {
      const pathValue = typeof projectilePath === 'string' ? projectilePath : projectilePath?.file ?? projectilePath?.path;
      if (!pathValue) continue;
      const key = resolveAssetPath(assetRoot, stripLeadingSlash(pathValue), pathValue);
      const exists = await this.storage.exists(key).catch(() => false);
      if (!exists) {
        missing.push(projectileId);
      }
    }

    if (missing.length > 0) {
      return {
        id: 'projectile-assets',
        status: 'warning',
        message: `${missing.length} projectile file(s) missing: ${missing.join(', ')}.`,
      };
    }

    return {
      id: 'projectile-assets',
      status: 'pass',
      message: `All ${projectileEntries.length} projectile asset(s) exist.`,
    };
  }

  _checkFrameHeightConsistency(frameData) {
    const sheets = frameData?.frames ?? {};
    const medianHeight = (frames) => {
      const heights = (frames ?? [])
        .map((frame) => frame.silhouetteHeight)
        .filter((value) => typeof value === 'number' && value > 0)
        .sort((a, b) => a - b);
      return heights.length ? heights[Math.floor(heights.length / 2)] : null;
    };

    const baseHeight = medianHeight(sheets.base);
    if (!baseHeight) {
      return {
        id: 'frame-height-consistency',
        status: 'pass',
        message: 'Skipped: base frames carry no silhouetteHeight (legacy pack predates the row normalizer).',
      };
    }

    const problems = [];
    let worst = 0;
    for (const [sheetId, frames] of Object.entries(sheets)) {
      if (sheetId === 'base') continue;
      const height = medianHeight(frames);
      if (!height) continue;
      const deviation = Math.abs(height - baseHeight) / baseHeight;
      worst = Math.max(worst, deviation);
      if (deviation > 0.15) {
        problems.push(`${sheetId}: median silhouette ${height}px vs base ${baseHeight}px (${(deviation * 100).toFixed(0)}% off)`);
      }
    }

    if (problems.length > 0) {
      return {
        id: 'frame-height-consistency',
        status: worst > 0.25 ? 'error' : 'warning',
        message: `Character scale drifts between move rows: ${problems.join('; ')}. Re-extract with the base row present so rescaling applies.`,
      };
    }
    return {
      id: 'frame-height-consistency',
      status: 'pass',
      message: `All move rows are within 15% of the base silhouette height (${baseHeight}px).`,
    };
  }

  async _checkWideReachSanity(characterId, frameData) {
    const sheets = frameData?.frames ?? {};
    let draft = null;
    try {
      draft = await this.repository.getDraft(characterId);
    } catch {
      // no draft — skip
    }
    const wideSheets = [...new Set(
      (draft?.moves ?? [])
        .filter((move) => move.spriteProfile === 'wide')
        .map((move) => move.animation ?? move.sheet)
        .filter(Boolean),
    )];
    if (wideSheets.length === 0) {
      return {
        id: 'wide-reach-sanity',
        status: 'pass',
        message: 'Skipped: no wide-profile moves declared in the draft.',
      };
    }

    const maxReach = (frames) => Math.max(0, ...(frames ?? [])
      .map((frame) => frame.reachX)
      .filter((value) => typeof value === 'number'));
    const baseReach = maxReach(sheets.base);
    const failures = [];
    for (const sheetId of wideSheets) {
      const reach = maxReach(sheets[sheetId]);
      if (!reach) {
        failures.push(`${sheetId}: no reachX data (re-extract with the current normalizer)`);
      } else if (baseReach && reach <= baseReach) {
        failures.push(`${sheetId}: max reach ${reach}px does not exceed base reach ${baseReach}px — the wide generation did not extend`);
      }
    }

    if (failures.length > 0) {
      return {
        id: 'wide-reach-sanity',
        status: 'warning',
        message: `Wide-profile reach check: ${failures.join('; ')}.`,
      };
    }
    return {
      id: 'wide-reach-sanity',
      status: 'pass',
      message: `Wide-profile move(s) ${wideSheets.join(', ')} reach beyond the base silhouette.`,
    };
  }

  _checkMinimumFrameCount(frameData, manifest) {
    const framesSource = frameData?.frames ?? manifest?.frameCounts ?? manifest?.frame_counts ?? null;

    if (!framesSource) {
      return {
        id: 'minimum-frame-count',
        status: 'warning',
        message: 'Skipped: neither frameData.json nor manifest frame_counts are available.',
      };
    }

    const sheetWarnings = [];
    let sheetsWithEnoughFrames = 0;
    const sheets = Object.entries(framesSource);

    for (const [sheet, framesOrCount] of sheets) {
      const count = Array.isArray(framesOrCount) ? framesOrCount.length : (typeof framesOrCount === 'number' ? framesOrCount : 0);
      if (count >= 6) {
        sheetsWithEnoughFrames += 1;
      } else if (count < MIN_FRAME_COUNT) {
        sheetWarnings.push(`${sheet}: only ${count} frame(s) (minimum recommended: ${MIN_FRAME_COUNT})`);
      }
    }

    const messages = [];
    if (sheetsWithEnoughFrames < MIN_SHEETS_WITH_ENOUGH_FRAMES) {
      messages.push(`Only ${sheetsWithEnoughFrames}/${sheets.length} sheets have 6+ frames (need at least ${MIN_SHEETS_WITH_ENOUGH_FRAMES}).`);
    }
    if (sheetWarnings.length > 0) {
      messages.push(...sheetWarnings);
    }

    if (messages.length > 0) {
      return {
        id: 'minimum-frame-count',
        status: 'warning',
        message: messages.join(' '),
      };
    }

    return {
      id: 'minimum-frame-count',
      status: 'pass',
      message: `All sheets meet the minimum frame count requirements (${sheetsWithEnoughFrames} sheets with 6+ frames).`,
    };
  }
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function requireField(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required field: ${name}`);
  }
  return value;
}

function stripLeadingSlash(filePath) {
  return typeof filePath === 'string' ? filePath.replace(/^\/+/, '') : filePath;
}

/**
 * Resolve a manifest path to a CMS storage key.
 *
 * Manifest paths can look like:
 *   - "/fighters/janitor/sheets/base.png"  (absolute web path)
 *   - "sheets/base.png"                    (relative to assetRoot)
 *
 * For absolute web paths we try to reconstruct the storage key by stripping
 * a leading "public/" segment or just using assetRoot as the resolver base.
 * For relative paths we join with assetRoot directly.
 */
function resolveAssetPath(assetRoot, relPath, originalPath) {
  // If the originalPath starts with '/', it's an absolute web path.
  // The assetRoot looks like "characters/janitor/assets/fighter-pack".
  // Sprite paths in the fixture manifest are like "/fighters/janitor/sprites/base/base_001.png".
  // These are served from public/, so we can't resolve them relative to assetRoot.
  // When the local normalizer copies fixture files, it writes them under assetRoot.
  // So we strip the fighter-specific prefix and join with assetRoot instead.
  if (typeof originalPath === 'string' && originalPath.startsWith('/')) {
    // Extract just the filename portion after the last known directory name
    // e.g. "/fighters/janitor/sprites/base/base_001.png" -> "sprites/base/base_001.png"
    const match = originalPath.match(/\/(sheets|sprites|projectiles)\/.+$/);
    if (match) {
      return `${assetRoot}${match[0]}`;
    }
    // For sheet paths like "/fighters/janitor/sheets/base.png"
    // Fall through to try as relative
  }

  return `${assetRoot}/${relPath}`;
}
