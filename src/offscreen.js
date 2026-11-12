export const isOffscreen = ['1', 'true'].includes(String(process.env.OFFSCREEN).toLowerCase());

export const offscreenWindowOptions = isOffscreen
  ? { x: -4000, y: 0, width: 1400, height: 900, skipTaskbar: true }
  : {};

export const offscreenSwitches = isOffscreen
  ? [
    ['disable-features', 'CalculateNativeWinOcclusion'],
    ['disable-backgrounding-occluded-windows'],
    ['disable-renderer-backgrounding'],
  ]
  : [];
