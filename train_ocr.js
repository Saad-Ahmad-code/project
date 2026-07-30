/** Generate test menu images using sharp (already in project deps) */
const sharp = require('sharp');
const fs = require('fs');

function svgMenu(itemsByCategory, width = 800, height = 0) {
  // Calculate height from content
  let y = 30;
  const lines = [];
  
  function addLine(text, ypos, size = 20, bold = false, color = '#000', align = 'left') {
    const x = align === 'right' ? width - 40 : 40;
    const weight = bold ? 'bold' : 'normal';
    const anchor = align === 'right' ? 'end' : 'start';
    lines.push(`<text x="${x}" y="${ypos}" font-size="${size}" font-family="Arial, sans-serif" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escapeXml(text)}</text>`);
  }
  
  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  
  // Title
  addLine('MENU', y += 35, 28, true, '#333', 'center');
  y += 15;
  
  for (const [catName, dishes] of itemsByCategory) {
    // Separator line
    lines.push(`<line x1="40" y1="${y}" x2="${width-40}" y2="${y}" stroke="#ddd" stroke-width="1"/>`);
    
    // Category
    addLine(catName, y += 30, 22, true, '#c0392b', 'left');
    y += 10;
    
    // Dishes
    for (const [dishName, price] of dishes) {
      addLine(dishName, y += 30, 18, false, '#222', 'left');
      addLine(`$${Number(price).toFixed(2)}`, y, 18, false, '#222', 'right');
    }
    y += 20;
  }
  
  // Footer
  lines.push(`<line x1="40" y1="${y+10}" x2="${width-40}" y2="${y+10}" stroke="#eee" stroke-width="1"/>`);
  addLine('Thank you for dining with us!', y + 40, 14, false, '#999', 'center');
  addLine('www.restaurant.com', y + 60, 12, false, '#bbb', 'center');
  
  const totalHeight = y + 80;
  const svg = `<svg width="${width}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    ${lines.join('\n    ')}
  </svg>`;
  
  return { svg, width, height: totalHeight };
}

async function generate(name, itemsByCategory) {
  const { svg, width, height } = svgMenu(itemsByCategory);
  const outPath = `C:/Users/maqso/OneDrive/Desktop/project/${name}`;
  
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  const stat = fs.statSync(outPath);
  console.log(`  ✅ ${name} (${stat.size} bytes) - ${itemsByCategory.reduce((s, [,d]) => s + d.length, 0)} items`);
  return outPath;
}

async function testViaAPI(imgPath) {
  const http = require('http');
  const fs = require('fs');
  const img = fs.readFileSync(imgPath);
  const boundary = '----' + Date.now();
  
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="menu.png"\r\nContent-Type: image/png\r\n\r\n`),
    img,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/api/scan/new',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const items = [];
        const errors = [];
        for (const line of data.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const d = JSON.parse(line.slice(5));
            if (d.items) items.push(...d.items);
            if (d.error) errors.push(d.message);
          } catch {}
        }
        resolve({ items, count: items.length, errors, names: items.map(i => i.name) });
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

// ════════════════════════════════════════════
// GENERATE TEST MENUS
// ════════════════════════════════════════════

const menus = [
  ['test_standard.png', [
    ['PIZZA', [['Margherita', 9.99], ['Pepperoni', 11.99], ['BBQ Chicken', 12.99]]],
    ['BURGERS', [['Classic Burger', 8.99], ['Cheese Burger', 10.99], ['Bacon Burger', 12.99]]],
    ['DRINKS', [['Coca Cola', 2.99], ['Orange Juice', 3.99], ['Coffee', 2.50]]],
  ]],
  ['test_appetizers.png', [
    ['APPETIZERS', [['Spring Rolls', 5.99], ['Chicken Wings', 8.99], ['Nachos', 7.99]]],
    ['MAIN COURSE', [['Grilled Salmon', 22.99], ['Beef Steak', 28.99], ['Chicken Pasta', 16.99]]],
    ['DESSERTS', [['Tiramisu', 6.99], ['Ice Cream', 4.99]]],
  ]],
  ['test_flat.png', [
    ['', [['Chicken Burger', 8.99], ['Beef Burger', 10.99], ['French Fries', 4.99]]],
  ]],
  ['test_coffee.png', [
    ['COFFEE', [['Espresso', 2.50], ['Latte', 3.50], ['Cappuccino', 3.50]]],
    ['TEA', [['Green Tea', 2.50], ['Chai Latte', 3.50]]],
    ['PASTRIES', [['Croissant', 3.00], ['Muffin', 2.50]]],
  ]],
];

(async () => {
  console.log('=== Generating Test Menus ===');
  const paths = [];
  for (const [name, items] of menus) {
    paths.push(await generate(name, items));
  }
  
  console.log('\n=== Testing OCR Pipeline ===');
  for (const path of paths) {
    const fname = path.split('/').pop();
    console.log(`\n── ${fname} ──`);
    const r = await testViaAPI(path);
    if (r.error) { console.log(`  ❌ ${r.error}`); continue; }
    console.log(`  Items: ${r.count}`);
    for (const item of r.items.slice(0, 10)) {
      const p = item.price ? `$${item.price}` : 'no-price';
      const c = item.category ? `[${item.category}]` : '';
      console.log(`    • ${item.name.padEnd(35)} ${p.padStart(8)} ${c}`);
    }
  }
  
  console.log('\n✅ Done');
})();
