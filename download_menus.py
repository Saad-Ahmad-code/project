"""Download real menu images for OCR testing (multiple sources)"""
import urllib.request, os, time, ssl

# Disable SSL verification for some hosts
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

test_dir = r"C:\Users\maqso\OneDrive\Desktop\project\test_menus"
os.makedirs(test_dir, exist_ok=True)

# Mix of sources
menus = [
    # Unsplash (use raw/ direct format)
    ("https://images.unsplash.com/photo-1559329007-40df8a9345d8?w=600", "unsplash_menu1.jpg"),
    ("https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=600", "unsplash_menu2.jpg"),
    ("https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600", "unsplash_restaurant.jpg"),
    ("https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600", "unsplash_dining1.jpg"),
    ("https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600", "unsplash_dining2.jpg"),
    ("https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=600", "unsplash_kitchen.jpg"),
    ("https://images.unsplash.com/photo-1559339352-11d035aa65de?w=600", "unsplash_blackboard.jpg"),
    ("https://images.unsplash.com/photo-1550966871-3ed3cdb51f3a?w=600", "unsplash_restaurant2.jpg"),
    ("https://images.unsplash.com/photo-1549488344-1f9b8d2bd1f3?w=600", "unsplash_menu3.jpg"),
    ("https://images.unsplash.com/photo-1600891964092-4316c288032e?w=600", "unsplash_plate.jpg"),
    # Food photos often in menu contexts
    ("https://images.unsplash.com/photo-1552566626-52f8b828add9?w=600", "unsplash_cafe.jpg"),
    ("https://images.unsplash.com/photo-1592861956120-e524fc2bae1e?w=600", "unsplash_coffee.jpg"),
]

downloaded = 0
for url, fname in menus:
    path = os.path.join(test_dir, fname)
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        data = urllib.request.urlopen(req, timeout=20, context=ctx).read()
        if data[:2] == b'\xff\xd8' or data[:8] == b'\x89PNG\r\n':
            with open(path, 'wb') as f:
                f.write(data)
            print(f"  ✅ {fname} ({len(data)} bytes)")
            downloaded += 1
        else:
            print(f"  ❌ {fname}: not an image ({data[:20].hex()})")
    except Exception as e:
        print(f"  ❌ {fname}: {str(e)[:50]}")
    time.sleep(0.5)

print(f"\nDownloaded {downloaded}/{len(menus)} images to {test_dir}")
print(f"Total test images available: {len(os.listdir(test_dir))}")
