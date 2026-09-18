export function pixelArtDirection() {
  return [
    'STYLE: authentic hand-drawn 16-bit 2D arcade pixel art matching the supplied sprite.',
    'Use crisp square pixel clusters, 1-pixel stair-step edges, limited colors, flat cel shading, and low native resolution.',
    'NO 3D, CGI, action figure, toy, plastic, clay, photograph, smooth vector art, anti-aliasing, gradients, depth of field, or cinematic lighting.',
  ].join(' ');
}

export function characterArtDirection(style) {
  if(style==='watercolor')return 'STYLE: hand-painted 2D watercolor animation. Preserve translucent pigment washes, subtle paper grain INSIDE the silhouette, indigo brush contours and readable anatomy. No 3D, plastic, photography or vector gradients. The background remains a perfectly flat key color, not paper.';
  return pixelArtDirection();
}
