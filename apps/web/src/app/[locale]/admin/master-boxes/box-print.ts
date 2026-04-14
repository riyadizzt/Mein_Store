/**
 * Box A4 Print — Master-Inhaltsliste zum Aufkleben auf den Karton
 * Header + Produkttabelle + großer Master-Barcode
 */

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function openBoxPrintWindow(box: any): void {
  const dateStr = new Date(box.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const seasonLabel = { winter: 'Winter', spring: 'Frühjahr', summer: 'Sommer', autumn: 'Herbst' }[box.season as string] ?? box.season

  const rows = (box.items ?? []).map((item: any) => `
    <tr>
      <td style="padding:6px 4px;text-align:center;width:38px;">
        ${item.imageUrl
          ? `<img src="${item.imageUrl}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:3px;">`
          : `<div style="width:32px;height:32px;background:#f5f5f5;border-radius:3px;"></div>`}
      </td>
      <td style="padding:6px 8px;font-size:10pt;font-weight:600;">${esc(item.name)}</td>
      <td style="padding:6px 8px;font-size:9pt;">${esc(item.color)}</td>
      <td style="padding:6px 8px;font-size:9pt;text-align:center;">${esc(item.size)}</td>
      <td style="padding:6px 8px;font-size:11pt;font-weight:700;text-align:center;">${item.quantity}</td>
      <td style="padding:6px 8px;font-size:6pt;color:#888;font-family:monospace;">${esc(item.sku)}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>${esc(box.boxNumber)}</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#f0f0f0; font-family:Arial,sans-serif; color:#1a1a2e; }
  @media print {
    body { background:white; }
    .no-print { display:none !important; }
    @page { margin:10mm; }
  }
  .no-print {
    position:fixed; top:0; left:0; right:0; z-index:100;
    background:#1a1a2e; color:white; padding:12px 24px;
    display:flex; align-items:center; justify-content:space-between; font-size:14px;
  }
  .no-print button {
    background:#d4a853; color:white; border:none; padding:8px 20px;
    border-radius:8px; font-weight:600; cursor:pointer; font-size:14px;
  }
  .no-print button.cancel { background:transparent; border:1px solid rgba(255,255,255,0.3); }
  .page {
    width:210mm; min-height:297mm; padding:15mm; background:white;
    margin:70px auto 20px; box-shadow:0 2px 20px rgba(0,0,0,0.1);
    display:flex; flex-direction:column;
  }
  .header {
    border-bottom:3px solid #d4a853; padding-bottom:15px; margin-bottom:20px;
    display:flex; justify-content:space-between; align-items:start;
  }
  .brand { font-family:Georgia,serif; font-size:14pt; font-weight:700; letter-spacing:2px; }
  .brand .sub { font-size:8pt; color:#666; letter-spacing:3px; margin-top:2px; }
  .box-info { text-align:right; }
  .box-number { font-family:monospace; font-size:20pt; font-weight:900; color:#d4a853; letter-spacing:1px; }
  .season-badge {
    display:inline-block; background:#1a1a2e; color:#d4a853;
    padding:4px 12px; border-radius:16px; font-size:10pt; font-weight:700;
    margin-top:4px;
  }
  .meta {
    display:grid; grid-template-columns:repeat(3,1fr); gap:12px;
    background:#f9fafb; padding:12px 16px; border-radius:8px; margin-bottom:20px;
  }
  .meta-item .label { font-size:8pt; color:#666; text-transform:uppercase; letter-spacing:1px; margin-bottom:2px; }
  .meta-item .value { font-size:11pt; font-weight:700; }
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  thead { background:#1a1a2e; color:white; }
  thead th { padding:8px; font-size:9pt; text-align:left; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; }
  tbody tr { border-bottom:1px solid #eee; }
  tbody tr:nth-child(even) { background:#fafafa; }
  .total-row { background:#d4a853 !important; color:white; font-weight:800; }
  .total-row td { padding:10px 8px; font-size:11pt; }
  .footer {
    margin-top:auto; padding-top:20px; border-top:2px dashed #ccc;
    text-align:center;
  }
  .footer-label { font-size:10pt; color:#666; margin-bottom:8px; text-transform:uppercase; letter-spacing:1px; }
  .barcode-container { display:inline-block; background:white; padding:10px; }
  .barcode-hint { font-size:8pt; color:#888; margin-top:8px; }
</style>
</head><body>
<div class="no-print">
  <span>${esc(box.boxNumber)} &middot; ${esc(box.name)} &middot; ${box.totalItems ?? 0} Varianten</span>
  <div style="display:flex;gap:8px;">
    <button class="cancel" onclick="window.close()">Schlie&szlig;en</button>
    <button onclick="window.print()">Drucken</button>
  </div>
</div>

<div class="page">
  <div class="header">
    <div class="brand">
      <div>MALAK</div>
      <div class="sub">BEKLEIDUNG</div>
    </div>
    <div class="box-info">
      <div class="box-number">${esc(box.boxNumber)}</div>
      <div class="season-badge">${esc(seasonLabel)} ${box.year}</div>
    </div>
  </div>

  <h1 style="font-size:18pt; margin-bottom:8px;">${esc(box.name)}</h1>

  <div class="meta">
    <div class="meta-item">
      <div class="label">Standort</div>
      <div class="value">${esc(box.warehouse?.name ?? '—')}</div>
    </div>
    <div class="meta-item">
      <div class="label">Datum</div>
      <div class="value">${esc(dateStr)}</div>
    </div>
    <div class="meta-item">
      <div class="label">Artikel gesamt</div>
      <div class="value">${box.totalQuantity ?? 0} St&uuml;ck</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:38px;"></th>
        <th>Produkt</th>
        <th>Farbe</th>
        <th style="text-align:center;">Gr&ouml;&szlig;e</th>
        <th style="text-align:center;">Menge</th>
        <th>SKU</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td colspan="4" style="text-align:right;">GESAMT:</td>
        <td style="text-align:center;">${box.totalQuantity ?? 0}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <div class="footer-label">Master-Barcode</div>
    <div class="barcode-container">
      <svg id="master-barcode"></svg>
    </div>
    <div class="barcode-hint">Scan &rarr; &Ouml;ffnet Karton-Detail im Dashboard</div>
  </div>
</div>

<script>
  try {
    JsBarcode('#master-barcode', '${esc(box.boxNumber)}', {
      format: 'CODE128',
      width: 3,
      height: 80,
      displayValue: true,
      fontSize: 16,
      margin: 10,
    });
  } catch(e) { console.error(e); }
<\/script>
</body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}
