// Final OCR test via runLocalOCR
import * as fs from 'fs';
import { createHash } from 'crypto';

async function main() {
  const cachePath = 'src/lib/ocr/.ocrCache.json';
  if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  
  const inputBuffer = fs.readFileSync('C:/Users/maqso/Downloads/Elegant Menu Template for Any Occasion.jpg');
  const blob = new Blob([inputBuffer], { type: 'image/jpeg' });
  const file = new File([blob], 'menu.jpg', { type: 'image/jpeg' });
  
  const { runLocalOCR } = await import('./src/lib/ocr/local');
  
  console.log('Running OCR...');
  const t0 = Date.now();
  const result = await runLocalOCR(file);
  console.log('Done in', Date.now() - t0, 'ms');
  
  console.log('\n=== ITEMS (' + result.items.length + '/15) ===');
  for (const i of result.items) {
    console.log(`  ${i.name} → ₹${i.price || '?'} (${i.category})`);
  }
  
  // Expected dishes with prices
  const expected: Record<string, number> = {
    'Cheeseburger': 200, 'Cheese Sandwich': 250, 'Chicken Burgers': 300,
    'Spicy Chicken': 350, 'Hot Dog': 350, 'Fruit Salad': 100, 'Cocktail': 200,
    'Nuggets': 300, 'Sandwich': 100, 'French Fries': 250, 'Milk Shake': 50,
    'Iced Tea': 60, 'Orange Juice': 70, 'Lemon Tea': 20, 'Coffee': 90,
  };
  
  console.log('\n=== MATCH CHECK ===');
  let correct = 0;
  for (const [name, price] of Object.entries(expected)) {
    const found = result.items.find(i => 
      i.name.toLowerCase().includes(name.toLowerCase()) || 
      name.toLowerCase().includes(i.name.toLowerCase().replace(/[^a-z]/g, ''))
    );
    if (found) {
      const match = found.price === price;
      if (match) correct++;
      console.log(`  ${match ? '✓' : '✗'} ${name} (₹${price}) → found as "${found.name}" ₹${found.price || '?'} ${match ? '' : 'MISMATCH'}`);
    } else {
      console.log(`  ✗ ${name} (₹${price}) → NOT FOUND`);
    }
  }
  console.log(`\n${correct}/15 correct`);
}

main().catch(e => console.error('ERROR:', e));
