/**
 * Batch Hängetikett print — multiple different variants on minimal A4 pages.
 * DOES NOT modify existing HaengetikettenDruck.ts — completely separate file.
 * Reuses the same card design but accepts an array of items.
 */

interface HangTagItem {
  productName: string
  color: string
  size: string
  sku: string
  price: number
}

export const HANG_TAG_SIZE_CONFIG = {
  klein:  { w: 40,  h: 70,  cols: 4, rows: 4, perPage: 16, label: '40\u00d770mm' },
  mittel: { w: 55,  h: 90,  cols: 3, rows: 3, perPage: 9,  label: '55\u00d790mm' },
  gross:  { w: 60,  h: 100, cols: 3, rows: 2, perPage: 6,  label: '60\u00d7100mm' },
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function generateCard(data: HangTagItem, sizeKey: 'klein' | 'mittel' | 'gross'): string {
  const cfg = HANG_TAG_SIZE_CONFIG[sizeKey]
  const brandSize = sizeKey === 'klein' ? '8pt' : sizeKey === 'mittel' ? '10pt' : '11pt'
  const priceFontSize = sizeKey === 'klein' ? '12pt' : sizeKey === 'mittel' ? '14pt' : '16pt'
  const nameFontSize = sizeKey === 'klein' ? '6.5pt' : sizeKey === 'mittel' ? '8pt' : '9pt'
  const variantFontSize = sizeKey === 'klein' ? '6pt' : '7pt'
  const skuFontSize = sizeKey === 'klein' ? '5pt' : '5.5pt'
  const barcodeH = sizeKey === 'klein' ? 10 : sizeKey === 'mittel' ? 14 : 16
  const lochSize = sizeKey === 'klein' ? '4mm' : '6mm'
  const priceFormatted = data.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

  return `
    <div class="karte" style="width:${cfg.w}mm; height:${cfg.h}mm;">
      <div class="loch" style="width:${lochSize};height:${lochSize};"></div>
      <div class="vorderseite" style="font-size:${brandSize};">
        <div>
          <div style="letter-spacing:2px;">MALAK</div>
          <div style="font-size:0.7em;letter-spacing:3px;margin-top:1mm;color:#555;">BEKLEIDUNG</div>
        </div>
      </div>
      <div class="trenner"><span style="background:white;padding:0 2mm;">&#9986;</span></div>
      <div class="rueckseite">
        <div class="produktname" style="font-size:${nameFontSize};">${esc(data.productName)}</div>
        <div class="variante" style="font-size:${variantFontSize};">${data.color} &middot; ${data.size}</div>
        <div style="width:100%;padding:1mm 0;">
          <svg class="jsbarcode" data-value="${esc(data.sku)}" data-height="${barcodeH}"></svg>
        </div>
        <div class="sku" style="font-size:${skuFontSize};">${esc(data.sku)}</div>
        <div class="preis" style="font-size:${priceFontSize};">${priceFormatted}</div>
      </div>
    </div>`
}

export function openBatchHangTagPrintWindow(items: HangTagItem[], config: { size: 'klein' | 'mittel' | 'gross' }): void {
  const cfg = HANG_TAG_SIZE_CONFIG[config.size]
  const sorted = [...items].sort((a, b) => a.productName.localeCompare(b.productName) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size))
  const total = sorted.length
  const totalPages = Math.ceil(total / cfg.perPage)

  let pages = ''
  let idx = 0
  for (let p = 0; p < totalPages; p++) {
    const count = Math.min(cfg.perPage, total - idx)
    let cards = ''
    for (let c = 0; c < count; c++) { cards += generateCard(sorted[idx], config.size); idx++ }
    pages += `<div class="page ${config.size}">${cards}</div>`
  }

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>H\u00e4ngetiketten Batch \u2014 ${total} St\u00fcck</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#f0f0f0;font-family:Arial,sans-serif;}
@media print{body{background:white;}.no-print{display:none!important;}@page{margin:5mm;}}
.no-print{position:fixed;top:0;left:0;right:0;z-index:100;background:#1a1a2e;color:white;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;font-size:14px;}
.no-print button{background:#d4a853;color:white;border:none;padding:8px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;}
.no-print button:hover{background:#c49943;}
.no-print button.cancel{background:transparent;border:1px solid rgba(255,255,255,0.3);}
.no-print button.cancel:hover{background:rgba(255,255,255,0.1);}
.page{width:210mm;min-height:297mm;padding:5mm;display:grid;gap:2mm;align-content:start;background:white;margin:50px auto 20px;box-shadow:0 2px 20px rgba(0,0,0,0.1);page-break-after:always;}
.page:first-of-type{margin-top:70px;}
.page.klein{grid-template-columns:repeat(4,40mm);}
.page.mittel{grid-template-columns:repeat(3,55mm);}
.page.gross{grid-template-columns:repeat(3,60mm);}
.karte{border:1px dashed #bbb;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;background:white;color:black;font-family:Arial,sans-serif;padding:2.5mm 2mm;break-inside:avoid;overflow:hidden;}
.loch{border:1px dashed #aaa;border-radius:50%;flex-shrink:0;}
.vorderseite{font-family:'Playfair Display',Georgia,serif;text-align:center;flex:1;display:flex;align-items:center;justify-content:center;font-weight:600;}
.trenner{width:100%;border-top:1px dashed #bbb;font-size:7pt;color:#aaa;text-align:center;margin:1.5mm 0;line-height:0;}
.trenner span{position:relative;top:-0.5em;}
.rueckseite{width:100%;text-align:center;display:flex;flex-direction:column;align-items:center;flex:1;justify-content:center;gap:0.5mm;}
.produktname{font-weight:700;line-height:1.2;}
.variante{color:#555;}
.preis{font-weight:800;}
.sku{font-family:'Courier New',monospace;color:#888;}
.jsbarcode{display:block;max-width:100%;height:auto;}
</style>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&display=swap" rel="stylesheet">
</head><body>
<div class="no-print">
  <span>${total} H\u00e4ngetiketten &middot; ${totalPages} Seite(n) &middot; ${cfg.label}</span>
  <div style="display:flex;gap:8px;">
    <button class="cancel" onclick="window.close()">Schlie\u00dfen</button>
    <button onclick="window.print()">Drucken</button>
  </div>
</div>
${pages}
<script>
document.querySelectorAll('.jsbarcode').forEach(function(svg){
  try{JsBarcode(svg,svg.dataset.value,{format:'CODE128',width:1.2,height:parseInt(svg.dataset.height)||12,displayValue:false,margin:0});}
  catch(e){svg.outerHTML='<span style="font-family:monospace;font-size:8pt;">'+svg.dataset.value+'</span>';}
});
<\/script></body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}
