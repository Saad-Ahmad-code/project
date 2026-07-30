/** Generate test menus with Euro signs (Tesseract reads Euro better than $) */
const sharp = require('sharp');
const fs = require('fs');

function svgMenu(itemsByCategory, label, currency = '€') {
  let y = 25;
  const lines = [];
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function txt(text, ypos, size, bold, color, anchor, x) {
    lines.push(`<text x="${x||'40'}" y="${ypos}" font-size="${size}" font-family="Arial, sans-serif" font-weight="${bold?'bold':'normal'}" fill="${color||'#000'}" text-anchor="${anchor||'start'}">${esc(text)}</text>`);
  }
  
  if (label) txt(label, y += 30, 24, true, '#222', 'middle', '400');
  
  for (const [cat, dishes] of itemsByCategory) {
    lines.push(`<line x1="40" y1="${y+8}" x2="760" y2="${y+8}" stroke="#ddd" stroke-width="1"/>`);
    txt(cat, y += 28, 20, true, '#c0392b');
    for (const [name, price] of dishes) {
      txt(name, y += 28, 16, false, '#222');
      // Use just number without currency symbol to avoid OCR artifacts
      const priceStr = `${currency}${Number(price).toFixed(2)}`;
      txt(priceStr, y, 16, false, '#222', 'end', '760');
    }
    y += 10;
  }
  
  lines.push(`<line x1="40" y1="${y+15}" x2="760" y2="${y+15}" stroke="#eee" stroke-width="1"/>`);
  txt('Thank you!', y + 40, 14, false, '#999', 'middle', '400');
  txt('www.restaurant.com', y + 58, 12, false, '#bbb', 'middle', '400');
  
  const svg = `<svg width="800" height="${y+80}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    ${lines.join('\n    ')}
  </svg>`;
  return { svg, height: y + 80 };
}

const menus = [
  ['test_standard.png', 'RESTAURANT', [
    ['PIZZA', [['Margherita', 9.99], ['Pepperoni', 11.99], ['BBQ Chicken', 12.99]]],
    ['BURGERS', [['Classic Burger', 8.99], ['Cheese Burger', 10.99]]],
    ['DRINKS', [['Coca Cola', 2.99], ['Orange Juice', 3.99]]],
  ]],
  ['test_appetizers.png', 'RESTAURANT', [
    ['APPETIZERS', [['Spring Rolls', 5.99], ['Chicken Wings', 8.99]]],
    ['MAIN COURSE', [['Grilled Salmon', 22.99], ['Beef Steak', 28.99]]],
  ]],
  ['test_flat.png', '', [
    ['', [['Chicken Burger', 8.99], ['Beef Burger', 10.99], ['French Fries', 4.99]]],
  ]],
  ['test_coffee.png', 'CAFE', [
    ['COFFEE', [['Espresso', 2.50], ['Latte', 3.50], ['Cappuccino', 3.50]]],
    ['TEA', [['Green Tea', 2.50], ['Chai Latte', 3.50]]],
  ]],
];

(async () => {
  console.log('Generating test menus...');
  for (const [name, label, items] of menus) {
    const { svg } = svgMenu(items, label);
    const out = `C:/Users/maqso/OneDrive/Desktop/project/${name}`;
    await sharp(Buffer.from(svg)).png().toFile(out);
    const s = fs.statSync(out);
    console.log(`  ${name} (${s.size} bytes) - ${items.reduce((a,[,d]) => a+d.length, 0)} items`);
  }
  
  console.log('\nTesting OCR...');
  const http = require('http');
  
  for (const [name] of menus) {
    const path = `C:/Users/maqso/OneDrive/Desktop/project/${name}`;
    const img = fs.readFileSync(path);
    const boundary = '--B' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="menu.png"\r\nContent-Type: image/png\r\n\r\n`),
      img,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    
    const result = await new Promise(resolve => {
      const req = http.request({
        hostname: 'localhost', port: 3000, path: '/api/scan/new', method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
        timeout: 120000,
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          const items = []; const errs = [];
          for (const l of d.split('\n')) {
            if (!l.startsWith('data:')) continue;
            try { const j = JSON.parse(l.slice(5)); if (j.items) items.push(...j.items); if (j.error) errs.push(j.message); } catch {}
          }
          resolve({ items, errs, count: items.length });
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.write(body); req.end();
    });
    
    console.log(`\n── ${name} ──`);
    if (result.error) { console.log(`  ERROR: ${result.error}`); continue; }
    console.log(`  Items: ${result.count}`);
    for (const item of result.items.slice(0, 10)) {
      const p = item.price != null ? `€${item.price}` : 'no-price';
      const c = item.category ? `[${item.category || ''}]` : '';
      console.log(`  • ${item.name.padEnd(35)} ${p.padStart(10)} ${c}`);
    }
    if (result.errs.length) console.log(`  ⚠ ${result.errs.slice(0, 2).join(' | ')}`);
  }
  console.log('\n✅ Done');
})();
