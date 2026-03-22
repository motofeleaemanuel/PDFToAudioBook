"""
Text Processor Module
Cleans and prepares extracted PDF text for natural-sounding TTS conversion.
Handles decorative symbols, dividers, diacritics, number ranges, and percentages.
"""

import re
from typing import List
from dataclasses import dataclass


@dataclass
class TextChunk:
    """A chunk of text ready for TTS processing."""
    index: int
    text: str
    char_count: int = 0

    def __post_init__(self):
        self.char_count = len(self.text)


class TextProcessor:
    """Cleans and splits text for optimal TTS processing."""

    # OpenAI TTS limit is 4096 chars per request.
    # We keep chunks smaller to allow room for LLM refinement expansion.
    MAX_CHUNK_SIZE = 2500

    # ── Decorative / divider patterns to remove ─────────────
    DIVIDER_PATTERNS = [
        r'[─━═—–\-]{3,}',           # horizontal lines: ---, ───, ═══, etc.
        r'[_]{3,}',                   # underscores: ___
        r'[•·◦▪▫●○◆◇■□▶▷►▻★☆]{2,}', # repeated bullets/symbols
        r'[*]{3,}',                   # *** dividers
        r'[~]{3,}',                   # ~~~ dividers
        r'[#]{2,}',                   # ## dividers
        r'[=]{3,}',                   # === dividers
        r'[\.]{4,}',                  # .... (table of contents dots)
        r'[\|]{2,}',                  # || pipes
        r'[/\\]{3,}',                # /// or \\\ dividers
    ]

    # ── Symbols to remove completely ────────────────────────
    REMOVE_SYMBOLS = [
        '►', '◄', '▲', '▼', '◆', '◇', '■', '□', '●', '○',
        '★', '☆', '✦', '✧', '✪', '✫', '✬', '✭', '✮', '✯',
        '✰', '✱', '✲', '✳', '✴', '✵', '✶', '✷', '✸', '✹',
        '✺', '✻', '✼', '✽', '✾', '✿', '❀', '❁', '❂', '❃',
        '❄', '❅', '❆', '❇', '❈', '❉', '❊', '❋', '❌', '❍',
        '❖', '❗', '❘', '❙', '❚', '❛', '❜', '❝', '❞',
        '⬤', '⬢', '⬡', '⬠', '⬟', '△', '▽', '◁', '▷',
        '⟨', '⟩', '⟪', '⟫', '⌐', '¬', '¦', '§', '¤',
        '†', '‡', '‰', '‱', '※', '⁂', '⁎', '⁑',
        '→', '←', '↑', '↓', '↔', '↕', '⇒', '⇐', '⇑', '⇓',
        '©', '®', '™', '℠',
    ]

    # ── Number words in Romanian ────────────────────────────
    UNITS = ['zero', 'unu', 'doi', 'trei', 'patru', 'cinci',
             'șase', 'șapte', 'opt', 'nouă']
    TEENS = ['zece', 'unsprezece', 'doisprezece', 'treisprezece',
             'paisprezece', 'cincisprezece', 'șaisprezece',
             'șaptesprezece', 'optsprezece', 'nouăsprezece']
    TENS = ['', '', 'douăzeci', 'treizeci', 'patruzeci', 'cincizeci',
            'șaizeci', 'șaptezeci', 'optzeci', 'nouăzeci']

    @staticmethod
    def clean_text(text: str) -> str:
        """
        Clean raw PDF text for natural TTS.

        Pipeline:
        1. Remove decorative symbols and dividers
        2. Remove page numbers
        3. Normalize whitespace and line breaks
        4. Expand numbers, percentages, and special notations
        5. Fix diacritics display
        6. Final cleanup
        """

        # ── Step 1: Remove decorative dividers ──────────
        for pattern in TextProcessor.DIVIDER_PATTERNS:
            text = re.sub(pattern, ' ', text)

        # Remove individual decorative symbols
        for symbol in TextProcessor.REMOVE_SYMBOLS:
            text = text.replace(symbol, '')

        # Remove bullet points at start of lines (•, -, *, ▸, etc.)
        text = re.sub(r'^\s*[•·▸▹‣⁃]\s*', '', text, flags=re.MULTILINE)

        # ── Step 2: Remove page numbers ─────────────────
        # Standalone numbers (page numbers)
        text = re.sub(r'^\s*\d{1,4}\s*$', '', text, flags=re.MULTILINE)
        # "Page X" or "Pagina X" patterns
        text = re.sub(r'(?i)\b(?:page|pagina|pag\.?)\s*\d+\b', '', text)

        # ── Step 3: Remove headers/footers ──────────────
        lines = text.split('\n')
        cleaned_lines = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                if cleaned_lines and cleaned_lines[-1] != '':
                    cleaned_lines.append('')
                continue
            # Skip very short all-caps lines (likely headers/footers)
            if len(stripped) < 5 and stripped.isupper():
                continue
            # Skip lines that are only symbols/numbers
            if re.match(r'^[\W\d\s]+$', stripped) and len(stripped) < 10:
                continue
            cleaned_lines.append(stripped)

        text = '\n'.join(cleaned_lines)

        # ── Step 4: Fix line breaks ─────────────────────
        # Fix hyphenated words split across lines
        text = re.sub(r'(\w)-\n(\w)', r'\1\2', text)

        # Replace multiple newlines with period + space
        text = re.sub(r'\n{2,}', '. ', text)

        # Replace single newlines with space
        text = re.sub(r'\n', ' ', text)

        # ── Step 5: Expand special notations ────────────
        # Percentages: "10%" → "10 la sută"
        text = re.sub(r'(\d+(?:[.,]\d+)?)\s*%', r'\1 la sută', text)

        # Number ranges with dash: "10 - 20" or "10-20" → "10 până la 20"
        text = re.sub(r'(\d+)\s*[-–—]\s*(\d+)', r'\1 până la \2', text)

        # Currency: "100 RON" → "100 de lei"
        text = re.sub(r'(\d+(?:[.,]\d+)?)\s*RON\b', r'\1 lei', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+(?:[.,]\d+)?)\s*EUR\b', r'\1 euro', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+(?:[.,]\d+)?)\s*USD\b', r'\1 dolari', text, flags=re.IGNORECASE)
        text = re.sub(r'€\s*(\d+(?:[.,]\d+)?)', r'\1 euro', text)
        text = re.sub(r'\$\s*(\d+(?:[.,]\d+)?)', r'\1 dolari', text)

        # "nr." → "numărul"
        text = re.sub(r'\bnr\.\s*', 'numărul ', text, flags=re.IGNORECASE)

        # "art." → "articolul"
        text = re.sub(r'\bart\.\s*', 'articolul ', text, flags=re.IGNORECASE)

        # "alin." → "alineatul"
        text = re.sub(r'\balin\.\s*', 'alineatul ', text, flags=re.IGNORECASE)

        # "lit." → "litera"
        text = re.sub(r'\blit\.\s*', 'litera ', text, flags=re.IGNORECASE)

        # "pct." → "punctul"
        text = re.sub(r'\bpct\.\s*', 'punctul ', text, flags=re.IGNORECASE)

        # "cap." → "capitolul"
        text = re.sub(r'\bcap\.\s*', 'capitolul ', text, flags=re.IGNORECASE)

        # "fig." → "figura"
        text = re.sub(r'\bfig\.\s*', 'figura ', text, flags=re.IGNORECASE)

        # "tab." → "tabelul"
        text = re.sub(r'\btab\.\s*', 'tabelul ', text, flags=re.IGNORECASE)

        # "ex." → "exemplu"
        text = re.sub(r'\bex\.\s*', 'exemplu ', text, flags=re.IGNORECASE)

        # "etc." stays as is (TTS handles it)
        # "e.g." → "de exemplu"
        text = re.sub(r'\be\.g\.\s*', 'de exemplu ', text, flags=re.IGNORECASE)

        # "i.e." → "adică"
        text = re.sub(r'\bi\.e\.\s*', 'adică ', text, flags=re.IGNORECASE)

        # Roman numerals in context (Chapter I, II, etc.)
        roman_map = {
            'I': 'unu', 'II': 'doi', 'III': 'trei', 'IV': 'patru',
            'V': 'cinci', 'VI': 'șase', 'VII': 'șapte', 'VIII': 'opt',
            'IX': 'nouă', 'X': 'zece', 'XI': 'unsprezece', 'XII': 'doisprezece',
            'XIII': 'treisprezece', 'XIV': 'paisprezece', 'XV': 'cincisprezece',
            'XVI': 'șaisprezece', 'XVII': 'șaptesprezece', 'XVIII': 'optsprezece',
            'XIX': 'nouăsprezece', 'XX': 'douăzeci',
        }

        def replace_roman(match):
            prefix = match.group(1)
            roman = match.group(2)
            if roman in roman_map:
                return f"{prefix}{roman_map[roman]}"
            return match.group(0)

        text = re.sub(
            r'((?:capitolul|cap\.|secțiunea|partea|titlul|anexa)\s+)((?:XX|XIX|XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I))\b',
            replace_roman,
            text,
            flags=re.IGNORECASE
        )

        # ── Step 6: Clean up punctuation ────────────────
        # Fix multiple spaces
        text = re.sub(r'\s{2,}', ' ', text)
        # Fix multiple periods
        text = re.sub(r'\.{2,}', '.', text)
        # Fix period-space issues
        text = re.sub(r'\.\s*\.', '.', text)
        # Fix space before punctuation
        text = re.sub(r'\s+([.,;:!?])', r'\1', text)
        # Ensure space after punctuation
        text = re.sub(r'([.,;:!?])([A-Za-zĂÂÎȘȚăâîșț])', r'\1 \2', text)

        # ── Step 7: Remove remaining non-speech characters ─
        # Keep only letters, digits, basic punctuation, and Romanian diacritics
        text = re.sub(r'[^\w\s.,;:!?\'"()\-–àâăîșțéèêëïöüÀÂĂÎȘȚÉÈÊËÏÖÜ]', ' ', text)

        # Final cleanup
        text = re.sub(r'\s{2,}', ' ', text)

        return text.strip()

    @classmethod
    def split_into_chunks(cls, text: str) -> List[TextChunk]:
        """
        Split text into chunks suitable for OpenAI TTS processing.
        Tries to split at sentence boundaries for natural pauses.
        """
        if not text:
            return []

        chunks = []
        sentences = re.split(r'(?<=[.!?])\s+', text)

        current_chunk = ""
        chunk_index = 0

        for sentence in sentences:
            if len(sentence) > cls.MAX_CHUNK_SIZE:
                if current_chunk:
                    chunks.append(TextChunk(
                        index=chunk_index,
                        text=current_chunk.strip()
                    ))
                    chunk_index += 1
                    current_chunk = ""

                # Split long sentence by commas
                parts = re.split(r'(?<=,)\s+', sentence)
                for part in parts:
                    if len(current_chunk) + len(part) + 1 > cls.MAX_CHUNK_SIZE:
                        if current_chunk:
                            chunks.append(TextChunk(
                                index=chunk_index,
                                text=current_chunk.strip()
                            ))
                            chunk_index += 1
                        current_chunk = part
                    else:
                        current_chunk += " " + part if current_chunk else part
            elif len(current_chunk) + len(sentence) + 1 > cls.MAX_CHUNK_SIZE:
                chunks.append(TextChunk(
                    index=chunk_index,
                    text=current_chunk.strip()
                ))
                chunk_index += 1
                current_chunk = sentence
            else:
                current_chunk += " " + sentence if current_chunk else sentence

        if current_chunk.strip():
            chunks.append(TextChunk(
                index=chunk_index,
                text=current_chunk.strip()
            ))

        return chunks

    @classmethod
    def process(cls, raw_text: str) -> List[TextChunk]:
        """Full pipeline: clean text then split into TTS-ready chunks."""
        cleaned = cls.clean_text(raw_text)
        return cls.split_into_chunks(cleaned)


if __name__ == "__main__":
    sample = """
    1

    ─────────────────────────
    CAPITOLUL I
    Introducere
    ─────────────────────────

    Aceasta este o carte despre programare.
    Vom învăța multe lucruri interesante despre
    cum funcționează computerele și cum putem
    să scriem cod eficient.

    ★ ★ ★

    Rata de succes este de 85%.
    Intervalul recomandat este 10 - 20%.
    Costul total: 1500 RON.

    2

    ═══════════════════════════
    CAPITOLUL II
    Bazele programării
    ═══════════════════════════

    Conform art. 15, alin. 3, lit. b) din cap. III,
    nr. 42/2024, programarea este arta de a comunica cu
    calculatorul prin intermediul limbajelor
    de programare (fig. 1).
    """

    processor = TextProcessor()
    chunks = processor.process(sample)
    print(f"Chunk-uri generate: {len(chunks)}")
    for chunk in chunks:
        print(f"\n--- Chunk {chunk.index} ({chunk.char_count} chars) ---")
        print(chunk.text)
