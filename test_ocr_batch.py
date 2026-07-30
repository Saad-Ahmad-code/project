"""Comprehensive OCR test: run ALL test images through scan API"""
import urllib.request, os, json, time, struct

test_dir = r"C:\Users\maqso\OneDrive\Desktop\project\test_menus"
API = "http://localhost:3000/api/scan/new"

results = []

def test_image(path):
    fname = os.path.basename(path)
    fsize = os.path.getsize(path)
    
    with open(path, 'rb') as f:
        img_data = f.read()
    
    boundary = "----" + str(int(time.time()*1000000))
    body = b"--" + boundary.encode() + b"\r\n"
    body += b'Content-Disposition: form-data; name="image"; filename="menu.jpg"\r\n'
    body += b"Content-Type: image/jpeg\r\n\r\n"
    body += img_data
    body += b"\r\n--" + boundary.encode() + b"--\r\n"
    
    req = urllib.request.Request(
        API, data=body,
        headers={"Content-Type": "multipart/form-data; boundary=" + boundary},
    )
    
    try:
        resp = urllib.request.urlopen(req, timeout=180)
        raw = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        return {"file": fname, "size": fsize, "error": str(e), "items": [], "raw_text": "", "layers": []}
    
    # Parse all events
    items = None
    errors = []
    layer = None
    raw_text_saved = ""
    
    for line in raw.split("\n"):
        if line.startswith("data:"):
            try:
                d = json.loads(line[5:])
                if "items" in d:
                    items = d["items"]
                    layer = d.get("ocr_layer", "")
                elif "error" in d:
                    errors.append(d.get("message", ""))
                elif "status" in d:
                    pass
            except:
                pass
    
    return {
        "file": fname,
        "size": fsize,
        "item_count": len(items) if items else 0,
        "items": items or [],
        "layer": layer or "none",
        "errors": errors,
        "raw_text_preview": raw[:300],
    }

# Run tests
image_files = sorted([os.path.join(test_dir, f) for f in os.listdir(test_dir) 
                      if f.endswith(('.jpg', '.jpeg', '.png'))])

print(f"Found {len(image_files)} test images\n")

for i, path in enumerate(image_files):
    print(f"[{i+1}/{len(image_files)}] Testing {os.path.basename(path)}...", end=" ", flush=True)
    
    t0 = time.time()
    result = test_image(path)
    elapsed = time.time() - t0
    
    print(f"{elapsed:.1f}s → {result['item_count']} items, layer={result['layer']}")
    
    if result['items']:
        for item in result['items'][:5]:
            p = f"${item.get('price','?')}" if item.get('price') else "no $"
            c = f"[{item.get('category','?')}]" if item.get('category') else ""
            print(f"    • {item['name'][:40]:<42} {p:>8} {c}")
        if len(result['items']) > 5:
            print(f"    ... and {len(result['items'])-5} more")
    elif result['errors']:
        print(f"    Errors: {result['errors'][:2]}")
    
    results.append(result)
    time.sleep(0.3)

# ── Summary ──
print("\n" + "="*70)
print(f"RESULTS SUMMARY ({len(results)} images)")
print("="*70)

total_items = sum(r['item_count'] for r in results)
total_with_items = sum(1 for r in results if r['item_count'] > 0)
total_errors = sum(1 for r in results if r['errors'])
total_empty = sum(1 for r in results if r['item_count'] == 0 and not r['errors'])

print(f"  Total items extracted: {total_items}")
print(f"  Images with items: {total_with_items}/{len(results)}")
print(f"  Images with errors: {total_errors}")
print(f"  Images empty (no items, no error): {total_empty}")

print(f"\n  Breakdown:")
for r in sorted(results, key=lambda x: x['item_count'], reverse=True):
    status = "✅" if r['item_count'] > 0 else "❌" if r['errors'] else "⚠️"
    names = ", ".join(item['name'][:25] for item in r['items'][:3])
    print(f"  {status} {r['file']:<30} {r['item_count']:>2} items  [{r['layer']}]  {names}")

# ── Analysis of failures ──
print("\n" + "="*70)
print("FAILURE ANALYSIS")
print("="*70)

for r in results:
    if r['item_count'] == 0:
        print(f"\n  ❌ {r['file']} ({r['size']} bytes)")
        print(f"     Layer: {r['layer']}")
        if r['errors']:
            for e in r['errors'][:2]:
                print(f"     Error: {e}")
        # Show raw text snippet
        txt = r.get('raw_text_preview', '')
        # Parse actual text from SSE
        for line in txt.split('\n'):
            if line.startswith('data:') and '"status"' not in line:
                print(f"     Raw: {line[:200]}")

print("\n✅ Testing complete")
