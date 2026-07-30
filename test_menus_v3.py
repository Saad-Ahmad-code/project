"""Download real menu images and test OCR pipeline, reporting issues"""
import urllib.request, time, json, os, sys

BASE = r"C:\Users\maqso\OneDrive\Desktop\project"

# Find REAL menu images with readable text
# Wikipedia has actual menu photos with text
MENUS = [
    # Actual printed menus from Wikimedia Commons
    ("https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Cafe_Alto_Restaurant_Menu_2022.jpg/400px-Cafe_Alto_Restaurant_Menu_2022.jpg", "wiki_cafe_alto.jpg"),
    ("https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Food_Menu_in_New_York_City.jpg/400px-Food_Menu_in_New_York_City.jpg", "wiki_nyc_menu.jpg"),
    ("https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Menu_restaurant_Melbourne_2018.jpg/400px-Menu_restaurant_Melbourne_2018.jpg", "wiki_melbourne.jpg"),
    # Pexels - restaurant menus with text
    ("https://images.pexels.com/photos/1267320/pexels-photo-1267320.jpeg?auto=compress&cs=tinysrgb&w=400", "pexels_wine_menu.jpg"),
    ("https://images.pexels.com/photos/1586947/pexels-photo-1586947.jpeg?auto=compress&cs=tinysrgb&w=400", "pexels_outdoor_menu.jpg"),
    ("https://images.pexels.com/photos/262047/pexels-photo-262047.jpeg?auto=compress&cs=tinysrgb&w=400", "pexels_restaurant_table.jpg"),
    ("https://images.pexels.com/photos/349610/pexels-photo-349610.jpeg?auto=compress&cs=tinysrgb&w=400", "pexels_dinner_setup.jpg"),
    # Unsplash - menu board style
    ("https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400", "unsplash_restaurant.jpg"),
    ("https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=400", "unsplash_bar.jpg"),
]

def download(url, path):
    try:
        data = urllib.request.urlopen(url, timeout=15).read()
        if data[:2] == b'\xff\xd8' or data[:1] == b'\x89':
            with open(path, 'wb') as f:
                f.write(data)
            return True, len(data)
        return False, f"Not an image (first bytes: {data[:4].hex()})"
    except Exception as e:
        return False, str(e)

def test_scan(img_path, boundary_prefix=""):
    with open(img_path, 'rb') as f:
        img_data = f.read()
    boundary = f"----TestBoundary{int(time.time()*1000)}{boundary_prefix}"
    body = (b"--" + boundary.encode() + b"\r\n" +
            b'Content-Disposition: form-data; name="image"; filename="menu.jpg"\r\n' +
            b"Content-Type: image/jpeg\r\n\r\n" + img_data +
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
    layer = None
    raw_text = ""
    layers_tried = []
    
    for line in content.split("\n"):
        if line.startswith("data:"):
            try:
                d = json.loads(line[5:])
                if "items" in d:
                    items = d["items"]
                    layer = d.get("ocr_layer", "")
                    raw_text = d.get("raw_text", "")
                elif "status" in d:
                    s = d.get("status","")
                    if s not in layers_tried:
                        layers_tried.append(s)
                elif "error" in d:
                    errors.append(d.get("message",""))
            except:
                pass
    
    return {
        "items": items or [],
        "item_count": len(items) if items else 0,
        "item_names": [i.get("name","?") for i in (items or [])],
        "errors": errors,
        "layer": layer,
        "layers_used": layers_tried,
    }

# Download menus
print("="*70)
print("DOWNLOADING MENU IMAGES")
print("="*70)

downloaded = []
for url, fname in MENUS:
    path = os.path.join(BASE, fname)
    ok, result = download(url, path)
    if ok:
        print(f"  ✅ {fname} ({result} bytes)")
        downloaded.append(path)
    else:
        print(f"  ❌ {fname}: {result}")

# Test each
print("\n" + "="*70)
print("TESTING OCR ON REAL MENU IMAGES")
print("="*70)

results = []
for path in downloaded:
    fname = os.path.basename(path)
    print(f"\n{'─'*60}")
    print(f"📷 {fname}")
    
    result = test_scan(path, fname[:20])
    
    if "error" in result:
        print(f"  ❌ Request failed: {result['error']}")
        continue
    
    results.append((fname, result))
    
    print(f"  Items: {result['item_count']}")
    if result['item_names']:
        for name in result['item_names'][:8]:
            print(f"    • {name}")
        if result['item_count'] > 8:
            print(f"    ... and {result['item_count']-8} more")
    
    if result['errors']:
        print(f"  ⚠️ Errors: {result['errors'][:2]}")
    
    if result['item_count'] == 0:
        print(f"  ❌ NO DISHES EXTRACTED")
    
    time.sleep(0.5)

# Summary
print("\n" + "="*70)
print("SUMMARY")
print("="*70)
success = sum(1 for _, r in results if r['item_count'] > 0)
total = len(results)
print(f"Extracted dishes from {success}/{total} images")
if success < total:
    print(f"\nFailed images:")
    for fname, r in results:
        if r['item_count'] == 0:
            errors = r.get('errors', [])
            err_str = f" ({errors[0][:60]})" if errors else ""
            print(f"  ❌ {fname}{err_str}")

print("\nDone!")
