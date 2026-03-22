"""
Text Refiner Module
Uses OpenAI GPT to refine extracted text for natural audiobook reading.
Ensures fluency, proper Romanian, handles symbols, and preserves all information.
"""

import os
from typing import List, Optional, Callable
from openai import OpenAI

from text_processor import TextChunk


SYSTEM_PROMPT = """Ești un editor profesionist de audiobook-uri în limba română. 
Primești un fragment de text extras dintr-un PDF care urmează să fie citit cu voce tare într-un audiobook.

Sarcina ta este să rafinezi textul pentru a fi PERFECT pentru ascultare audio:

1. **Păstrează ABSOLUT TOATE informațiile** — FIECARE cifră, FIECARE nume, FIECARE dată, FIECARE detaliu trebuie să rămână în text. Nu omite NIMIC.
2. **Fă textul fluent** — reformulează DOAR propozițiile care sună ciudat când sunt citite cu voce tare
3. **Simboluri și caractere speciale** — convertește-le în cuvinte (% → "la sută", € → "euro", § → "paragraful", & → "și", etc.)
4. **Numere** — scrie-le așa cum ar fi citite natural ("2024" → "două mii douăzeci și patru" dacă e un an)
5. **Formatare PDF** — elimină DOAR artefacte evidente de formatare (headere/footere repetitive, numere de pagină izolate)
6. **Abrevieri** — expandează-le natural (nr. → numărul, art. → articolul, etc.)
7. **Titluri și subtitluri** — păstrează-le și adaugă o pauză naturală (punct) după ele
8. **Tabele** — descrie datele într-un mod narativ, NU încerca să "citești" o tabelă, dar PĂSTREAZĂ toate valorile
9. **Referințe** — păstrează referințele legale/academice integral, doar fă-le ușor de citit cu voce tare
10. **Semnele de punctuație** — asigură-te că sunt corecte pentru pauze naturale de citire

⚠️ REGULI ABSOLUTE — ÎNCĂLCAREA LOR ESTE INACCEPTABILĂ:
- NU omite NICIODATĂ informații din textul original — aceasta este regula cea mai importantă
- NU adăuga informații noi care nu există în textul original
- NU rezuma și NU comprima textul — păstrează TOTUL
- Dacă nu ești sigur dacă ceva e important, PĂSTREAZĂ-L
- Răspunde DOAR cu textul rafinat, fără explicații, comentarii sau prefixuri
- Textul trebuie să sune natural când este citit cu voce tare de un vorbitor nativ de română"""


class TextRefiner:
    """Refines text chunks using OpenAI GPT for natural audiobook reading."""

    MODEL = "gpt-4o-mini"  # Cost-effective, fast, great for text refinement

    _client = None

    @classmethod
    def _get_client(cls) -> OpenAI:
        """Get or create OpenAI client."""
        if cls._client is None:
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY nu este setat.")
            cls._client = OpenAI(api_key=api_key)
        return cls._client

    @classmethod
    def refine_chunk(cls, chunk: TextChunk) -> TextChunk:
        """
        Refine a single text chunk using GPT.
        Returns a new TextChunk with refined text.
        """
        client = cls._get_client()

        response = client.chat.completions.create(
            model=cls.MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": chunk.text}
            ],
            temperature=0.3,  # Low temp for faithful refinement
            max_tokens=len(chunk.text) * 2,  # Allow some expansion
        )

        refined_text = response.choices[0].message.content.strip()

        return TextChunk(
            index=chunk.index,
            text=refined_text
        )

    @classmethod
    def refine_all(
        cls,
        chunks: List[TextChunk],
        progress_callback: Optional[Callable[[int, int, str], None]] = None
    ) -> List[TextChunk]:
        """
        Refine all text chunks using GPT.

        Args:
            chunks: List of TextChunk objects to refine
            progress_callback: Optional callback(current, total, message)

        Returns:
            List of refined TextChunk objects
        """
        refined_chunks = []
        total = len(chunks)

        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(
                    i + 1,
                    total,
                    f"Rafinare AI secțiunea {i + 1} din {total}..."
                )

            try:
                refined = cls.refine_chunk(chunk)
                refined_chunks.append(refined)
            except Exception as e:
                print(f"Eroare rafinare chunk {i + 1}: {e}")
                # Fallback: use original chunk if refinement fails
                refined_chunks.append(chunk)

        return refined_chunks


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    test_chunks = [
        TextChunk(index=0, text=(
            "Cap. III - art. 15 alin. 3. "
            "Rata de succes este de 85%. "
            "Intervalul e 10 - 20%. "
            "Costul: 1500 RON (€300). "
            "═══════════════════ "
            "Nr. 42/2024 din 15.03.2024"
        )),
    ]

    print("Text original:")
    print(test_chunks[0].text)

    def on_progress(current, total, msg):
        print(f"  [{current}/{total}] {msg}")

    refined = TextRefiner.refine_all(test_chunks, progress_callback=on_progress)

    print("\nText rafinat:")
    print(refined[0].text)
