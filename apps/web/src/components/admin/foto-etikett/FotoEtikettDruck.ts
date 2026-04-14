/**
 * Foto-Etikett (Photo Label) print page generator
 * Creates A4 sheets with product photo stickers for boxes/packaging
 */

export interface FotoEtikettData {
  productName: string
  color: string
  colorHex: string
  size: string
  sku: string
  price: number
  imageUrl: string | null
  categoryStripe: 'herren' | 'damen' | 'kinder' | 'unisex'
}

export interface FotoEtikettConfig {
  size: 'klein' | 'mittel' | 'gross'
  copies: number
}

const SIZE_CONFIG = {
  klein:  { w: 30, h: 30,  cols: 6, rows: 9, perPage: 54, label: '30\u00d730mm' },
  mittel: { w: 50, h: 35,  cols: 4, rows: 8, perPage: 32, label: '50\u00d735mm' },
  gross:  { w: 50, h: 50,  cols: 4, rows: 5, perPage: 20, label: '50\u00d750mm' },
}

const STRIPE_COLORS: Record<string, string> = {
  herren: '#DC2626',
  damen: '#2563EB',
  kinder: '#16A34A',
  unisex: '#6B7280',
}

function getPlaceholder(_color: string, colorHex: string, name: string): string {
  const initial = name.charAt(0).toUpperCase()
  return `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f5f5f5;">
    <div style="width:60%;aspect-ratio:1;border-radius:50%;background:${colorHex || '#ccc'};display:flex;align-items:center;justify-content:center;">
      <span style="font-size:14pt;font-weight:700;color:white;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${initial}</span>
    </div>
  </div>`
}

function generateKlein(d: FotoEtikettData): string {
  const stripe = STRIPE_COLORS[d.categoryStripe] || STRIPE_COLORS.unisex
  const photo = d.imageUrl
    ? `<img src="${d.imageUrl}" style="width:100%;height:14mm;object-fit:cover;display:block;">`
    : `<div style="width:100%;height:14mm;">${getPlaceholder(d.color, d.colorHex, d.productName)}</div>`
  return `<div class="etikett klein" style="border-left:2mm solid ${stripe};">
    ${photo}
    <div style="padding:0.5mm 1mm;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.3mm;overflow:hidden;">
      <div style="font-size:5.5pt;font-weight:700;line-height:1.1;">${d.color}</div>
      <div style="font-size:7pt;font-weight:800;">${d.size}</div>
    </div>
    <div style="width:80%;margin:0 auto 1mm;overflow:hidden;max-height:6mm;">
      <svg class="jsbarcode" data-value="${esc(d.sku)}" data-height="5"></svg>
    </div>
  </div>`
}

function generateMittel(d: FotoEtikettData): string {
  const stripe = STRIPE_COLORS[d.categoryStripe] || STRIPE_COLORS.unisex
  const photo = d.imageUrl
    ? `<img src="${d.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block;">`
    : getPlaceholder(d.color, d.colorHex, d.productName)
  return `<div class="etikett mittel" style="border-left:2mm solid ${stripe};overflow:hidden;">
    <div style="width:40%;height:100%;overflow:hidden;flex-shrink:0;">${photo}</div>
    <div style="flex:1;padding:1mm 1.5mm;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:0.3mm;overflow:hidden;min-width:0;">
      <div style="font-size:7pt;font-weight:800;line-height:1.1;text-align:center;">${d.color}</div>
      <div style="font-size:11pt;font-weight:900;text-align:center;">${d.size}</div>
      <div style="width:90%;overflow:hidden;max-height:8mm;">
        <svg class="jsbarcode" data-value="${esc(d.sku)}" data-height="7"></svg>
      </div>
      <div style="font-family:monospace;font-size:4pt;color:#888;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${esc(d.sku)}</div>
    </div>
  </div>`
}

function generateGross(d: FotoEtikettData): string {
  const stripe = STRIPE_COLORS[d.categoryStripe] || STRIPE_COLORS.unisex
  const price = d.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
  const photo = d.imageUrl
    ? `<img src="${d.imageUrl}" style="width:100%;height:100%;object-fit:cover;display:block;">`
    : getPlaceholder(d.color, d.colorHex, d.productName)
  return `<div class="etikett gross" style="border-left:2.5mm solid ${stripe};overflow:hidden;">
    <div style="width:100%;height:50%;overflow:hidden;">${photo}</div>
    <div style="padding:1mm 2mm;text-align:center;flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:0.3mm;overflow:hidden;">
      <div style="font-size:8pt;font-weight:800;">${d.color} &middot; ${d.size}</div>
      <div style="width:80%;overflow:hidden;max-height:10mm;">
        <svg class="jsbarcode" data-value="${esc(d.sku)}" data-height="9"></svg>
      </div>
      <div style="font-family:monospace;font-size:4pt;color:#888;">${esc(d.sku)}</div>
      <div style="font-size:11pt;font-weight:900;">${price}</div>
    </div>
  </div>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const GENERATORS = { klein: generateKlein, mittel: generateMittel, gross: generateGross }

export function openFotoEtikettPrintWindow(data: FotoEtikettData, config: FotoEtikettConfig): void {
  const cfg = SIZE_CONFIG[config.size]
  const gen = GENERATORS[config.size]
  const total = config.copies
  const totalPages = Math.ceil(total / cfg.perPage)

  let pages = ''
  let idx = 0
  for (let p = 0; p < totalPages; p++) {
    const count = Math.min(cfg.perPage, total - idx)
    let cards = ''
    for (let c = 0; c < count; c++) { cards += gen(data); idx++ }
    pages += `<div class="page ${config.size}">${cards}</div>`
  }

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>Foto-Etikett \u2014 ${esc(data.sku)}</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#f0f0f0;font-family:Arial,sans-serif;}
@media print{body{background:white;}.no-print{display:none!important;}@page{margin:3mm;}}
.no-print{position:fixed;top:0;left:0;right:0;z-index:100;background:#1a1a2e;color:white;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;font-size:14px;}
.no-print button{background:#d4a853;color:white;border:none;padding:8px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;}
.no-print button:hover{background:#c49943;}
.no-print button.cancel{background:transparent;border:1px solid rgba(255,255,255,0.3);}
.no-print button.cancel:hover{background:rgba(255,255,255,0.1);}

.page{width:210mm;min-height:297mm;padding:3mm;display:grid;gap:1mm;align-content:start;background:white;margin:50px auto 20px;box-shadow:0 2px 20px rgba(0,0,0,0.1);page-break-after:always;}
.page:first-of-type{margin-top:70px;}
.page.klein{grid-template-columns:repeat(6,30mm);grid-auto-rows:30mm;}
.page.mittel{grid-template-columns:repeat(4,50mm);grid-auto-rows:35mm;}
.page.gross{grid-template-columns:repeat(4,50mm);grid-auto-rows:50mm;}

.etikett{border:0.5px solid #ddd;border-radius:1.5mm;overflow:hidden;background:white;display:flex;flex-direction:column;}
.etikett.mittel{flex-direction:row;}
.etikett img{display:block;}
.jsbarcode{display:block;max-width:100%;height:auto;}
</style></head><body>
<div class="no-print">
  <span>${total} Etiketten &middot; ${totalPages} Seite(n) &middot; ${cfg.label}</span>
  <div style="display:flex;gap:8px;">
    <button class="cancel" onclick="window.close()">Schlie\u00dfen</button>
    <button onclick="window.print()">Drucken</button>
  </div>
</div>
${pages}
<script>
document.querySelectorAll('.jsbarcode').forEach(function(svg){
  try{JsBarcode(svg,svg.dataset.value,{format:'CODE128',width:1,height:parseInt(svg.dataset.height)||10,displayValue:false,margin:0});}
  catch(e){svg.outerHTML='<span style="font-family:monospace;font-size:6pt;">'+svg.dataset.value+'</span>';}
});
<\/script></body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}

export function openBatchFotoEtikettPrintWindow(items: FotoEtikettData[], config: { size: 'klein' | 'mittel' | 'gross' }): void {
  const cfg = SIZE_CONFIG[config.size]
  const gen = GENERATORS[config.size]
  const sorted = [...items].sort((a, b) => a.productName.localeCompare(b.productName) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size))
  const total = sorted.length
  const totalPages = Math.ceil(total / cfg.perPage)

  let pages = ''
  let idx = 0
  for (let p = 0; p < totalPages; p++) {
    const count = Math.min(cfg.perPage, total - idx)
    let cards = ''
    for (let c = 0; c < count; c++) { cards += gen(sorted[idx]); idx++ }
    pages += `<div class="page ${config.size}">${cards}</div>`
  }

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>Foto-Etiketten Batch \u2014 ${total} St\u00fcck</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#f0f0f0;font-family:Arial,sans-serif;}
@media print{body{background:white;}.no-print{display:none!important;}@page{margin:3mm;}}
.no-print{position:fixed;top:0;left:0;right:0;z-index:100;background:#1a1a2e;color:white;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;font-size:14px;}
.no-print button{background:#d4a853;color:white;border:none;padding:8px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;}
.no-print button:hover{background:#c49943;}
.no-print button.cancel{background:transparent;border:1px solid rgba(255,255,255,0.3);}
.no-print button.cancel:hover{background:rgba(255,255,255,0.1);}
.page{width:210mm;min-height:297mm;padding:3mm;display:grid;gap:1mm;align-content:start;background:white;margin:50px auto 20px;box-shadow:0 2px 20px rgba(0,0,0,0.1);page-break-after:always;}
.page:first-of-type{margin-top:70px;}
.page.klein{grid-template-columns:repeat(6,30mm);grid-auto-rows:30mm;}
.page.mittel{grid-template-columns:repeat(4,50mm);grid-auto-rows:35mm;}
.page.gross{grid-template-columns:repeat(4,50mm);grid-auto-rows:50mm;}
.etikett{border:0.5px solid #ddd;border-radius:1.5mm;overflow:hidden;background:white;display:flex;flex-direction:column;}
.etikett.mittel{flex-direction:row;}
.etikett img{display:block;}
.jsbarcode{display:block;max-width:100%;height:auto;}
</style></head><body>
<div class="no-print">
  <span>${total} Etiketten &middot; ${totalPages} Seite(n) &middot; ${cfg.label}</span>
  <div style="display:flex;gap:8px;">
    <button class="cancel" onclick="window.close()">Schlie\u00dfen</button>
    <button onclick="window.print()">Drucken</button>
  </div>
</div>
${pages}
<script>
document.querySelectorAll('.jsbarcode').forEach(function(svg){
  try{JsBarcode(svg,svg.dataset.value,{format:'CODE128',width:1,height:parseInt(svg.dataset.height)||10,displayValue:false,margin:0});}
  catch(e){svg.outerHTML='<span style="font-family:monospace;font-size:6pt;">'+svg.dataset.value+'</span>';}
});
<\/script></body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}

export { SIZE_CONFIG }
