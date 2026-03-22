"""
Romanian TTS Engine Module
Converts text to speech using OpenAI TTS API (high-quality, natural voices).
"""

import os
import io
import concurrent.futures
from typing import List, Optional, Callable
from openai import OpenAI

from text_processor import TextChunk


class TTSEngine:
    """Converts text chunks to a single MP3 audiobook using OpenAI TTS."""

    # OpenAI TTS settings
    MODEL = "tts-1-hd"  # High-definition model for best quality
    VOICE = "nova"       # Natural female voice, great for Romanian
    SPEED = 1.0          # Normal speed (0.25 to 4.0)

    # Available voices: alloy, echo, fable, onyx, nova, shimmer
    # 'nova' and 'shimmer' sound most natural for Romanian

    _client = None

    @classmethod
    def _get_client(cls) -> OpenAI:
        """Get or create OpenAI client."""
        if cls._client is None:
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError(
                    "OPENAI_API_KEY nu este setat. "
                    "Adaugă cheia în fișierul backend/.env"
                )
            cls._client = OpenAI(api_key=api_key)
        return cls._client

    @classmethod
    def convert_chunk_to_bytes(cls, chunk: TextChunk) -> bytes:
        """Convert a single text chunk to MP3 bytes using OpenAI TTS."""
        client = cls._get_client()

        response = client.audio.speech.create(
            model=cls.MODEL,
            voice=cls.VOICE,
            input=chunk.text,
            speed=cls.SPEED,
            response_format="mp3",
        )

        # Collect all bytes from the streaming response
        audio_bytes = b""
        for data in response.iter_bytes():
            audio_bytes += data

        return audio_bytes

    TTS_MAX_CHARS = 4096  # OpenAI TTS hard limit

    @classmethod
    def _split_oversized_chunk(cls, text: str) -> list:
        """Split text that exceeds TTS_MAX_CHARS at sentence boundaries."""
        if len(text) <= cls.TTS_MAX_CHARS:
            return [text]

        import re
        parts = []
        sentences = re.split(r'(?<=[.!?])\s+', text)
        current = ""
        for sentence in sentences:
            if len(current) + len(sentence) + 1 > cls.TTS_MAX_CHARS:
                if current:
                    parts.append(current.strip())
                current = sentence
            else:
                current += " " + sentence if current else sentence
        if current.strip():
            parts.append(current.strip())
        return parts if parts else [text[:cls.TTS_MAX_CHARS]]

    @classmethod
    def convert_to_audiobook(
        cls,
        chunks: List[TextChunk],
        output_path: str,
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> str:
        """
        Convert a list of text chunks into a single MP3 audiobook in parallel.

        Args:
            chunks: List of TextChunk objects to convert
            output_path: Path for the output MP3 file
            progress_callback: Optional callback(current, total, status_message)

        Returns:
            Path to the generated MP3 file
        """
        if not chunks:
            raise ValueError("Nu există text de convertit în audio.")

        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        # 1. Flatten into sub-chunks for precise ordered assembly
        flat_sub_chunks = []
        for i, chunk in enumerate(chunks):
            sub_texts = cls._split_oversized_chunk(chunk.text)
            for sub_text in sub_texts:
                flat_sub_chunks.append({
                    "original_index": i,
                    "sub_index": len(flat_sub_chunks),
                    "text": sub_text,
                    "chunk_obj": chunk
                })

        total_sub_chunks = len(flat_sub_chunks)
        results_bytes = {}
        completed = 0

        def process_audio(sub_info):
            sub_chunk = TextChunk(index=sub_info["chunk_obj"].index, text=sub_info["text"])
            return sub_info["sub_index"], sub_info["original_index"], cls.convert_chunk_to_bytes(sub_chunk)

        # 2. Parallel processing
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            future_to_info = {executor.submit(process_audio, info): info for info in flat_sub_chunks}

            for future in concurrent.futures.as_completed(future_to_info):
                info = future_to_info[future]
                try:
                    c_idx, orig_idx, mp3_bytes = future.result()
                    results_bytes[c_idx] = mp3_bytes
                except Exception as e:
                    print(f"Eroare la generare audio (chunk {info['original_index'] + 1}): {e}")
                    results_bytes[info["sub_index"]] = b""

                completed += 1
                if progress_callback:
                    progress_callback(
                        completed,
                        total_sub_chunks,
                        f"Conversie audio (paralelizată) - secțiunea {completed} din {total_sub_chunks}..."
                    )

        # 3. Assemble final MP3 File
        with open(output_path, "wb") as out_file:
            for c_idx in range(total_sub_chunks):
                if c_idx in results_bytes and results_bytes[c_idx]:
                    out_file.write(results_bytes[c_idx])

        # Verify we actually wrote something
        if os.path.getsize(output_path) == 0:
            os.remove(output_path)
            raise RuntimeError("Nu am reușit să generez niciun segment audio.")

        return output_path

    @classmethod
    def get_estimated_duration(cls, chunks: List[TextChunk]) -> float:
        """Estimate audio duration in minutes based on character count."""
        total_chars = sum(c.char_count for c in chunks)
        # Average Romanian speech: ~15 characters per second
        estimated_seconds = total_chars / 15
        return estimated_seconds / 60

    @classmethod
    def set_voice(cls, voice: str):
        """Change the TTS voice. Options: alloy, echo, fable, onyx, nova, shimmer"""
        valid_voices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
        if voice not in valid_voices:
            raise ValueError(f"Voce invalidă. Opțiuni: {', '.join(valid_voices)}")
        cls.VOICE = voice

    @classmethod
    def set_speed(cls, speed: float):
        """Set speech speed (0.25 to 4.0)."""
        if not 0.25 <= speed <= 4.0:
            cls.SPEED = max(0.25, min(4.0, speed))
        else:
            cls.SPEED = speed


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    test_chunks = [
        TextChunk(index=0, text="Bună ziua! Aceasta este o probă de conversie text în audio folosind inteligența artificială."),
        TextChunk(index=1, text="Limba română este o limbă frumoasă și melodioasă. Rata de succes este de 95 la sută."),
    ]

    def on_progress(current, total, message):
        print(f"  [{current}/{total}] {message}")

    print(f"Model: {TTSEngine.MODEL}")
    print(f"Voce: {TTSEngine.VOICE}")
    print(f"Estimare durată: {TTSEngine.get_estimated_duration(test_chunks):.1f} minute")
    print("Generez audiobook de test...")
    TTSEngine.convert_to_audiobook(
        test_chunks,
        "test_output.mp3",
        progress_callback=on_progress
    )
    print("✓ Fișierul test_output.mp3 a fost generat!")
