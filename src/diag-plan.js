// What the diagnostics button does. Claude edits this file between conversations: the person only clicks the button.
export const APP_BUILD = 'v66';
export const PLAN = {
  id: '2026-10-21-a',
  asks: 'Calibrate on real screens: does the app find the panels, read names/levels/prices, and how long does each step take?',
  frames: 2,          // frames grabbed from the shared window, one after the other
  frameGapMs: 1500,
  kSweep: [1.0, 1.25, 1.5, 2.0],   // full-screen reading at several scales: time vs panels found
  cropWidth: 900,     // pixels, JPEG crops of the detected panels
  cropQuality: 0.55,
};
