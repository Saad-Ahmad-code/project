"""Generate realistic menu images with proper text for Tesseract testing.
Uses block-letter rendering with large enough characters for Tesseract to read."""
import struct, zlib, os, sys

def create_test_menu(filename, items_by_category, width=1200, height=1600, footer_text=None):
    """Generate a PNG menu image with block letters."""
    W, H = width, height
    pixels = bytearray([255]) * (W * H * 3)
    
    def rect(y1, y2, x1, x2, r, g, b):
        y1,y2,x1,x2 = max(0,int(y1)),min(H,int(y2)),max(0,int(x1)),min(W,int(x2))
        for y in range(y1, y2):
            base = (y * W) * 3
            for x in range(x1, x2):
                i = base + x * 3
                pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b
    
    def draw_text(text, x, y, size, r=0, g=0, b=0):
        """Draw chunky block text."""
        xp = x
        for ch in text.upper():
            if ch == ' ': xp += size // 2; continue
            lw = int(size * 0.55)
            if ch in 'MW': lw = int(size * 0.7)
            elif ch in 'I': lw = max(2, int(size * 0.25))
            elif ch == '$': lw = int(size * 0.4)
            elif ch == '.': lw = max(2, int(size * 0.2))
            # Outer dark block
            rect(y, y+size, xp, xp+lw, r, g, b)
            # Inner lighter area (creates letter-like appearance)
            ins = max(1, int(size * 0.15))
            if ch not in '.$':
                rect(y+ins, y+size-ins, xp+ins, xp+lw-ins, 255, 255, 255)
            xp += lw + max(1, int(size * 0.2))
    
    y = 30
    # Draw title
    if len(items_by_category) > 0:
        draw_text("MENU", W//2-80, y, 36, 0, 0, 0)
        y += 60
    
    # Draw each category
    for cat_name, dishes in items_by_category:
        # Category separator
        y += 15
        rect(y-5, y-2, 40, W-40, 180, 180, 180)
        y += 5
        
        # Category header
        draw_text(cat_name.upper(), 50, y, 28, 180, 50, 50)
        y += 40
        
        # Dishes
        for dish_name, price in dishes:
            draw_text(str(dish_name).upper(), 80, y, 20, 30, 30, 30)
            # Price right-aligned
            price_str = f"${price:.2f}" if isinstance(price, (int, float)) else str(price)
            draw_text(price_str, W-200, y, 20, 30, 30, 30)
            y += 50
        
        y += 10
    
    # Footer
    if footer_text:
        y = H - 60
        draw_text(footer_text, W//2 - len(footer_text)*6, y, 14, 160, 160, 160)
    
    # Write PNG
    def pchunk(t, data):
        c = t + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    
    raw = b''
    for ry in range(H):
        raw += b'\x00'
        raw += bytes(pixels[ry*W*3:(ry+1)*W*3])
    
    png = (b'\x89PNG\r\n\x1a\n' +
           pchunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)) +
           pchunk(b'IDAT', zlib.compress(raw)) +
           pchunk(b'IEND', b''))
    
    path = os.path.join(r"C:\Users\maqso\OneDrive\Desktop\project", filename)
    with open(path, 'wb') as f:
        f.write(png)
    print(f"  ✅ {filename} ({len(png)} bytes) — {sum(len(d) for _,d in items_by_category)} items")
    return path

def test_via_api(img_path):
    import urllib.request, json, time
    
    with open(img_path, 'rb') as f:
        img_data = f.read()
    
    boundary = f"----{int(time.time()*1000)}"
    body = (b"--" + boundary.encode() + b"\r\n" +
            b'Content-Disposition: form-data; name="image"; filename="menu.jpg"\r\n' +
            b"Content-Type: image/png\r\n\r\n" + img_data +
            b"\r\n--" + boundary.encode() + b"--\r\n")
    
    try:
        resp = urllib.request.urlopen(
            urllib.request.Request("http://localhost:3000/api/scan/new", data=body,
            headers={"Content-Type": "multipart/form-data; boundary=" + boundary}),
            timeout=120)
        content = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        return {"error": str(e)}
    
    items = None
    errors = []
    for line in content.split("\n"):
        if line.startswith("data:"):
            try:
                d = json.loads(line[5:])
                if "items" in d: items = d["items"]
                elif "error" in d: errors.append(d.get("message",""))
            except: pass
    
    return {"items": items or [], "item_count": len(items) if items else 0, "errors": errors}

# ═══════════════════════════════════════════════
# CREATE TEST MENUS WITH VARYING FORMATS
# ═══════════════════════════════════════════════

menus = []

# Menu 1: Standard with categories
menus.append(("test_standard.png", [
    ("PIZZA", [("Margherita", 9.99), ("Pepperoni", 11.99), ("BBQ Chicken", 12.99)]),
    ("BURGERS", [("Classic Burger", 8.99), ("Cheese Burger", 10.99), ("Bacon Burger", 12.99)]),
    ("DRINKS", [("Coca Cola", 2.99), ("Orange Juice", 3.99), ("Coffee", 2.50)]),
], "www.restaurant.com"))

# Menu 2: Different category names
menus.append(("test_appetizers.png", [
    ("APPETIZERS", [("Spring Rolls", 5.99), ("Chicken Wings", 8.99), ("Nachos", 7.99)]),
    ("MAIN COURSE", [("Grilled Salmon", 22.99), ("Beef Steak", 28.99), ("Chicken Pasta", 16.99)]),
    ("DESSERTS", [("Tiramisu", 6.99), ("Ice Cream", 4.99)]),
]))

# Menu 3: Single column, no categories
menus.append(("test_flat.png", [
    ("", [("Chicken Burger", 8.99), ("Beef Burger", 10.99), ("French Fries", 4.99), ("Onion Rings", 5.99)]),
]))

# Menu 4: With menu name and footer
menus.append(("test_cafe.png", [
    ("COFFEE", [("Espresso", 2.50), ("Latte", 3.50), ("Cappuccino", 3.50), ("Mocha", 4.00)]),
    ("TEA", [("Green Tea", 2.50), ("Chai Latte", 3.50), ("English Breakfast", 2.50)]),
    ("PASTRIES", [("Croissant", 3.00), ("Muffin", 2.50), ("Scone", 2.75)]),
], "The Garden Cafe - Est. 2015"))

# Menu 5: Larger variety
menus.append(("test_variety.png", [
    ("SALADS", [("Caesar Salad", 8.99), ("Greek Salad", 9.99), ("Garden Salad", 6.99)]),
    ("PIZZA", [("Margherita", 9.99), ("Pepperoni", 11.99), ("Hawaiian", 12.99), ("Vegetarian", 10.99)]),
    ("BURGERS", [("Classic Burger", 8.99), ("Cheese Burger", 10.99)]),
    ("SIDES", [("French Fries", 3.99), ("Onion Rings", 4.99)]),
], "Thank you for dining!"))

# Generate all
created = []
for fname, items, *footer in menus:
    ft = footer[0] if footer else None
    path = create_test_menu(fname, items, footer_text=ft)
    created.append(path)

# Test all via API
print(f"\n{'='*70}")
print("TESTING OCR PIPELINE")
print(f"{'='*70}")

for path in created:
    fname = os.path.basename(path)
    print(f"\n{'─'*60}")
    print(f"📷 {fname}")
    
    result = test_via_api(path)
    
    if "error" in result:
        print(f"  ❌ API Error: {result['error']}")
        continue
    
    items = result["items"]
    errors = result["errors"]
    
    print(f"  Items extracted: {result['item_count']}")
    
    if items:
        for item in items[:10]:
            p = f"${item.get('price','?')}" if item.get('price') else "no-price"
            c = f"[{item.get('category','?')}]" if item.get('category') else ""
            print(f"    • {item['name']:<35} {p:>8} {c}")
    else:
        print(f"  ❌ No dishes extracted")
    
    if errors:
        print(f"  Errors: {errors[:3]}")

print(f"\n{'='*70}")
print("DONE")
