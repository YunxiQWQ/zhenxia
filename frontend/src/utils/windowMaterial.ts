/** Legacy preference names use the same material as the current settings UI. */
export function windowMaterial(effect?: string): 'solid' | 'mica' | 'acrylic' {
  if (effect === 'mica' || effect === 'dark') return 'mica';
  if (effect === 'acrylic' || effect === 'mica_alt' || effect === 'auto') return 'acrylic';
  return 'solid';
}
