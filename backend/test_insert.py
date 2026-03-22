import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

client = create_client(url, key)

metadata = {
    "id": "test-id-1234",
    "filename": "test.mp3",
    "original_name": "test",
    "storage_path": "test-id-1234/test.mp3",
    "size_bytes": 1024,
    "duration_minutes": 1.5,
    "total_pages": 5,
    "public_url": "http://example.com/test.mp3"
}

try:
    print("Inserting...")
    res = client.table("audiobooks").insert(metadata).execute()
    print("Success:", res.data)
except Exception as e:
    print("Exception:", e)
