/**
 * loadCmsRoster.js
 *
 * Browser-side function that loads CMS-published fighter configs
 * from the public/fighters directory at runtime.
 *
 * FightScene can call this to dynamically add CMS characters to the roster.
 *
 * @param {string} [basePath='/fighters'] - Base URL path for fighter assets
 * @returns {Promise<object[]>} Array of CharacterConfig-shaped plain objects
 */
export async function loadCmsRoster(basePath = '/fighters') {
  try {
    const indexResponse = await fetch('/assets-index.json');
    if (!indexResponse.ok) return [];
    const index = await indexResponse.json();

    if (!index.fighters || typeof index.fighters !== 'object') return [];

    const configs = [];

    for (const [fighterId] of Object.entries(index.fighters)) {
      try {
        const configResponse = await fetch(`${basePath}/${fighterId}/config.json`);
        if (configResponse.ok) {
          const config = await configResponse.json();
          if (config && config.id) {
            configs.push(config);
          }
        }
      } catch {
        // Skip fighters without config.json or with fetch errors
      }
    }

    return configs;
  } catch {
    return [];
  }
}
