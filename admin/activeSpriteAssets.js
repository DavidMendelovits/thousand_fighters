// Superseded PNGs stay in storage/history, but are not current animation frames.
export function activeSpriteAssets(draft, assets) {
  return assets.filter(asset=>{
    const match=asset.relativePath?.match(/(?:^|\/)sprites\/([^/]+)\/[^/]+\.png$/);
    if(!match)return true;
    const rows=[draft.sprite,...(draft.actors??[]).map(actor=>actor.sprite)].map(sprite=>sprite?.frames?.[match[1]]).filter(Array.isArray);
    if(!rows.length)return true; // Legacy packs may have only a manifest.
    const frames=rows.flat();
    return frames.some(frame=>asset.key.endsWith(`/${frame.file}`));
  });
}
