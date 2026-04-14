/**
 * Inline CODE128 barcode SVG generator
 * Uses JsBarcode (already installed) via dynamic import
 */

export function generateBarcodeSVG(value: string, width: number, height: number): string {
  // Generate a placeholder SVG that will be replaced by JsBarcode in the print window
  const escapedValue = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<svg class="jsbarcode" data-value="${escapedValue}" data-width="${width}" data-height="${height}"></svg>`
}
