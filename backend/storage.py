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
    _admin_client: Optional[Client] = None

    @classmethod
    def _get_client(cls) -> Client:
        """Get or create Supabase client (anon key — subject to RLS)."""
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
    def _get_admin_client(cls) -> Client:
        """Get or create Supabase admin client (service_role key — bypasses RLS).
        Falls back to anon client if SUPABASE_SERVICE_KEY is not set."""
        if cls._admin_client is None:
            url = os.getenv("SUPABASE_URL")
            service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            if url and service_key:
                cls._admin_client = create_client(url, service_key)
            else:
                print("  ⚠️ SUPABASE_SERVICE_KEY not set — falling back to anon key (RLS applies!)")
                cls._admin_client = cls._get_client()
        return cls._admin_client

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
        user_id: str = None,
    ) -> Dict:
        """
        Upload an MP3 file to Supabase Storage and save metadata.

        Args:
            local_path: Path to the local MP3 file
            original_name: Original PDF filename (used for display)
            duration_minutes: Estimated audio duration
            total_pages: Number of pages in the source PDF
            user_id: Supabase user ID for ownership

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

        if user_id and user_id != "legacy":
            metadata["user_id"] = user_id

        client.table(cls.TABLE_NAME).insert(metadata).execute()

        print(f"  ☁️ Audiobook uploadat în Supabase: {storage_path} ({file_size} bytes)")
        return metadata

    CHUNK_SIZE = 45 * 1024 * 1024  # 45 MB per part (under 50 MB Supabase limit)

    @classmethod
    def upload_audiobook_chunked(
        cls,
        local_path: str,
        original_name: str,
        duration_minutes: float = 0,
        total_pages: int = 0,
        user_id: str = None,
    ) -> Dict:
        """
        Smart upload: if file <= 45MB, upload normally.
        If larger, split into ~45MB parts and upload each as Part 1, Part 2, etc.
        Returns metadata dict with public_url of first part (or single file).
        """
        file_size = os.path.getsize(local_path)

        # Small file — normal upload
        if file_size <= cls.CHUNK_SIZE:
            return cls.upload_audiobook(
                local_path=local_path,
                original_name=original_name,
                duration_minutes=duration_minutes,
                total_pages=total_pages,
                user_id=user_id,
            )

        # Large file — split and upload parts
        client = cls._get_client()
        base_name = os.path.splitext(original_name)[0]
        safe_base = base_name.replace(" ", "_").replace("/", "_")
        group_id = str(uuid.uuid4())  # Groups all parts together

        num_parts = (file_size + cls.CHUNK_SIZE - 1) // cls.CHUNK_SIZE
        all_public_urls = []
        total_uploaded = 0

        with open(local_path, "rb") as f:
            for part_num in range(1, num_parts + 1):
                chunk_data = f.read(cls.CHUNK_SIZE)
                if not chunk_data:
                    break

                part_id = str(uuid.uuid4())
                part_filename = f"{safe_base}_Part{part_num}.mp3"
                storage_path = f"{group_id}/{part_filename}"
                chunk_size = len(chunk_data)

                # Upload chunk
                client.storage.from_(cls.BUCKET_NAME).upload(
                    path=storage_path,
                    file=chunk_data,
                    file_options={"content-type": "audio/mpeg"},
                )

                public_url = client.storage.from_(cls.BUCKET_NAME).get_public_url(storage_path)
                all_public_urls.append(public_url)

                # Estimate duration proportionally
                part_duration = round(duration_minutes * (chunk_size / file_size), 1)

                metadata = {
                    "id": part_id,
                    "filename": part_filename,
                    "original_name": f"{base_name} - Part {part_num}",
                    "storage_path": storage_path,
                    "size_bytes": chunk_size,
                    "duration_minutes": part_duration,
                    "total_pages": total_pages if part_num == 1 else 0,
                    "public_url": public_url,
                }
                
                if user_id and user_id != "legacy":
                    metadata["user_id"] = user_id

                client.table(cls.TABLE_NAME).insert(metadata).execute()
                total_uploaded += chunk_size
                print(f"  ☁️ Part {part_num}/{num_parts} uploadat: {part_filename} ({chunk_size} bytes)")

        print(f"  ✅ Total uploadat: {num_parts} părți, {total_uploaded} bytes")
        return {
            "id": group_id,
            "public_url": all_public_urls[0] if all_public_urls else "",
            "all_public_urls": all_public_urls,
            "parts": num_parts,
        }

    @classmethod
    def list_audiobooks(cls, user_id: str = None) -> List[Dict]:
        """List all audiobooks, newest first."""
        if not user_id or user_id == "legacy":
            return []

        client = cls._get_client()
        query = client.table(cls.TABLE_NAME).select("*").eq("user_id", user_id)
            
        response = query.order("created_at", desc=True).execute()

        return response.data or []

    @classmethod
    def get_storage_usage(cls, user_id: str = None) -> Dict:
        """Calculate total storage used (in bytes) and percentage out of 1GB."""
        if not user_id or user_id == "legacy":
            return {"used_bytes": 0, "limit_bytes": 1024 * 1024 * 1024, "percentage": 0}

        client = cls._get_client()
        query = client.table(cls.TABLE_NAME).select("size_bytes").eq("user_id", user_id)
        response = query.execute()
        
        total_bytes = sum(item.get("size_bytes", 0) for item in response.data or [])
        limit_bytes = 1024 * 1024 * 1024  # 1GB true GiB limit to trigger GB formatting
        
        return {
            "used_bytes": total_bytes,
            "limit_bytes": limit_bytes,
            "percentage": round((total_bytes / limit_bytes) * 100, 2)
        }

    @classmethod
    def get_audiobook(cls, audiobook_id: str, user_id: Optional[str] = None) -> Optional[Dict]:
        """Get a single audiobook by ID and owner."""
        if not user_id or user_id == "legacy":
            return None

        client = cls._get_client()

        response = (
            client.table(cls.TABLE_NAME)
            .select("*")
            .eq("id", audiobook_id)
            .eq("user_id", user_id)
            .execute()
        )

        data = response.data
        return data[0] if data else None

    @classmethod
    def delete_audiobook(cls, audiobook_id: str, user_id: Optional[str] = None) -> bool:
        """Delete an audiobook (file + metadata) strictly enforcing owner ID limits."""
        if not user_id or user_id == "legacy":
            return False

        client = cls._get_client()

        # Get metadata first to strictly verify ownership
        audiobook = cls.get_audiobook(audiobook_id, user_id=user_id)
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
