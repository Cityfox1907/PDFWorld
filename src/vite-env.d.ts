/// <reference types="vite/client" />

/**
 * EyeDropper API (Chromium). Used by the colour picker to let the user sample any
 * colour straight from the rendered document. Optional everywhere — the picker
 * hides the tool when `window.EyeDropper` is absent (Safari/Firefox).
 */
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropper {
  open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult>;
}
interface Window {
  EyeDropper?: { new (): EyeDropper };
}
