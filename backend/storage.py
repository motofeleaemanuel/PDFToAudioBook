"""
Supabase Storage Module
Handles uploading, listing, and deleting audiobook MP3 files in Supabase Storage.
Also stores metadata in the 'audiobooks' table.
"""

import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict
from supabase import create_client, Client


class AudiobookStorage:
    """Manages audiobook files in Supabase Storage + metadata in Supabase DB."""

    BUCKET_NAME = "audiobooks"
    TABLE_NAME = "audiobooks"

    _client: Optional[Client] = None

    @classmethod
    def _get_client(cls) -> Client:
        """Get or create Supabase client."""
        if cls._client is None:
            url = os.getenv("SUPABASE_URL")
            key = os.getenv("SUPABASE_KEY")
            if not url or not key:
                raise ValueError(
                    "SUPABASE_URL și SUPABASE_KEY trebuie setate în variabilele de mediu."
                )
            cls._client = create_client(url, key)
        return cls._client

    @classmethod
    def is_configured(cls) -> bool:
        """Check if Supabase credentials are set."""
        return bool(os.getenv("SUPABASE_URL")) and bool(os.getenv("SUPABASE_KEY"))

    @classmethod
    def upload_audiobook(
        cls,
        local_path: str,
        original_name: str,
        duration_minutes: float = 0,
        total_pages: int = 0,
    ) -> Dict:
        """
        Upload an MP3 file to Supabase Storage and save metadata.

        Args:
            local_path: Path to the local MP3 file
            original_name: Original PDF filename (used for display)
            duration_minutes: Estimated audio duration
            total_pages: Number of pages in the source PDF

        Returns:
            Dict with audiobook metadata including download URL
        """
        client = cls._get_client()

        # Generate unique storage path
        audiobook_id = str(uuid.uuid4())
        # Clean filename for storage
        safe_name = original_name.replace(" ", "_").replace("/", "_")
        if not safe_name.endswith(".mp3"):
            safe_name = os.path.splitext(safe_name)[0] + ".mp3"
        storage_path = f"{audiobook_id}/{safe_name}"

        # Get file size
        file_size = os.path.getsize(local_path)

        # Upload to Supabase Storage
        with open(local_path, "rb") as f:
            client.storage.from_(cls.BUCKET_NAME).upload(
                path=storage_path,
                file=f,
                file_options={"content-type": "audio/mpeg"},
            )

        # Get public URL
        public_url = client.storage.from_(cls.BUCKET_NAME).get_public_url(storage_path)

        # Save metadata to database
        metadata = {
            "id": audiobook_id,
            "filename": safe_name,
            "original_name": os.path.splitext(original_name)[0],
            "storage_path": storage_path,
            "size_bytes": file_size,
            "duration_minutes": round(duration_minutes, 1),
            "total_pages": total_pages,
            "public_url": public_url,
        }

        client.table(cls.TABLE_NAME).insert(metadata).execute()

        print(f"  ☁️ Audiobook uploadat în Supabase: {storage_path} ({file_size} bytes)")
        return metadata

    @classmethod
    def list_audiobooks(cls) -> List[Dict]:
        """List all audiobooks, newest first."""
        client = cls._get_client()

        response = (
            client.table(cls.TABLE_NAME)
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )

        return response.data or []

    @classmethod
    def get_storage_usage(cls) -> Dict:
        """Calculate total storage used (in bytes) and percentage out of 1GB."""
        client = cls._get_client()
        
        response = (
            client.table(cls.TABLE_NAME)
            .select("size_bytes")
            .execute()
        )
        
        total_bytes = sum(item.get("size_bytes", 0) for item in response.data or [])
        limit_bytes = 1000 * 1024 * 1024  # 1GB in bytes (Supabase free tier limit)
        
        return {
            "used_bytes": total_bytes,
            "limit_bytes": limit_bytes,
            "percentage": round((total_bytes / limit_bytes) * 100, 2)
        }

    @classmethod
    def get_audiobook(cls, audiobook_id: str) -> Optional[Dict]:
        """Get a single audiobook by ID."""
        client = cls._get_client()

        response = (
            client.table(cls.TABLE_NAME)
            .select("*")
            .eq("id", audiobook_id)
            .execute()
        )

        data = response.data
        return data[0] if data else None

    @classmethod
    def delete_audiobook(cls, audiobook_id: str) -> bool:
        """Delete an audiobook (file + metadata)."""
        client = cls._get_client()

        # Get metadata first
        audiobook = cls.get_audiobook(audiobook_id)
        if not audiobook:
            return False

        # Delete from storage
        try:
            client.storage.from_(cls.BUCKET_NAME).remove([audiobook["storage_path"]])
        except Exception as e:
            print(f"  ⚠️ Eroare la ștergerea din storage: {e}")

        # Delete metadata
        client.table(cls.TABLE_NAME).delete().eq("id", audiobook_id).execute()

        print(f"  🗑️ Audiobook șters: {audiobook['filename']}")
        return True
