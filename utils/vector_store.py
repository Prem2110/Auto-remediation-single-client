"""
Vector Store — CPI_KNOWLEDGE_BASE (HANA Cloud)
===============================================
Table: CPI_KNOWLEDGE_BASE  (schema: HANA_SCHEMA)
Columns:
    VEC_TEXT    NCLOB           — full knowledge base text
    VEC_META    NCLOB           — JSON metadata  (title, error_category, source, …)
    VEC_VECTOR  REAL_VECTOR(0)  — pre-computed embedding (flexible dimension)

Env vars (shared with main HANA connection):
    HANA_ADDRESS       — HANA Cloud hostname
    HANA_PORT          — default 443
    HANA_USER          — runtime DB user
    HANA_PASSWORD      — runtime DB password
    HANA_SCHEMA        — schema name  (e.g. AI_USE_CASES_HDI_DB_1)
    HANA_TABLE_VECTOR  — table name   (e.g. CPI_KNOWLEDGE_BASE)
"""

import json
import logging
import os
from typing import Dict, List

from hdbcli import dbapi

logger = logging.getLogger(__name__)


class VectorStoreRetriever:
    """
    Retrieves relevant entries from CPI_KNOWLEDGE_BASE using HANA full-text search.

    Search strategy (tried in order):
      1. CONTAINS fuzzy search on VEC_TEXT   — best relevance
      2. LIKE keyword search on VEC_TEXT     — reliable fallback
      3. SELECT TOP N scan                   — last resort (returns something)
    """

    def __init__(self):
        self.host    = os.getenv("HANA_ADDRESS")
        self.port    = int(os.getenv("HANA_PORT", "443"))
        self.user    = os.getenv("HANA_USER")
        self.password = os.getenv("HANA_PASSWORD")
        self.schema  = os.getenv("HANA_SCHEMA")
        self.table   = os.getenv("HANA_TABLE_VECTOR", "CPI_KNOWLEDGE_BASE")
        self.enabled = all([self.host, self.user, self.password, self.schema, self.table])

        if not self.enabled:
            logger.warning(
                "[VectorStore] Disabled — set HANA_ADDRESS, HANA_USER, HANA_PASSWORD, "
                "HANA_SCHEMA, HANA_TABLE_VECTOR in .env"
            )

    # ── Connection ────────────────────────────────────────────────────────────

    def _get_connection(self):
        """Open HANA Cloud connection, set schema. Returns None on failure."""
        if not self.enabled:
            return None
        try:
            conn = dbapi.connect(
                address=self.host,
                port=self.port,
                user=self.user,
                password=self.password,
                encrypt=True,
                sslValidateCertificate=False,
            )
            cur = conn.cursor()
            cur.execute(f'SET SCHEMA "{self.schema}"')
            cur.close()
            return conn
        except Exception as exc:
            logger.error(f"[VectorStore] Connection failed: {exc}")
            return None

    # ── Retrieval ─────────────────────────────────────────────────────────────

    def retrieve_relevant_notes(
        self,
        error_message: str,
        error_type: str,
        iflow_id: str,
        limit: int = 5,
    ) -> List[Dict]:
        """
        Search CPI_KNOWLEDGE_BASE for entries relevant to the given error.

        Args:
            error_message: Raw error message text from SAP CPI.
            error_type:    Classified type (MAPPING_ERROR, AUTH_ERROR, …).
            iflow_id:      Integration flow name.
            limit:         Maximum rows to return.

        Returns:
            List of dicts — each has: vec_text, meta (dict),
            note_title, note_content, error_category, solution_steps, similarity.
        """
        if not self.enabled:
            logger.debug("[VectorStore] Retrieval skipped - vector store is disabled")
            return []

        conn = self._get_connection()
        if not conn:
            logger.warning("[VectorStore] Retrieval failed - could not connect to HANA")
            return []

        # Keyword string for text search — cap length to keep query tight
        keywords = f"{error_type} {error_message[:300]} {iflow_id}".strip()
        table_ref = f'"{self.table}"'
        results: List[Dict] = []
        
        logger.info(
            "[VectorStore] Starting retrieval | error_type=%s iflow=%s keywords_length=%d limit=%d",
            error_type, iflow_id, len(keywords), limit
        )

        try:
            cur = conn.cursor()

            # ── 1. CONTAINS fuzzy search on VEC_TEXT ─────────────────────────
            try:
                cur.execute(
                    f"""
                    SELECT TOP {limit}
                        VEC_TEXT,
                        VEC_META
                    FROM {table_ref}
                    WHERE CONTAINS(VEC_TEXT, ?, FUZZY(0.6))
                    """,
                    (keywords,),
                )
                rows = cur.fetchall()
                if rows:
                    results = self._rows_to_dicts(rows)
                    titles = [r.get('note_title', 'N/A') for r in results[:3]]
                    logger.info(
                        "[VectorStore] CONTAINS search SUCCESS | returned=%d entries for error_type=%s | "
                        "top_titles=%s",
                        len(results), error_type, titles
                    )
            except Exception as exc:
                logger.debug(f"[VectorStore] CONTAINS search failed, trying LIKE: {exc}")

            # ── 2. LIKE keyword search on VEC_TEXT ────────────────────────────
            if not results:
                try:
                    # Search for error_type keyword first, then first keyword of error_message
                    first_keyword = error_message.split()[0] if error_message.split() else error_type
                    cur.execute(
                        f"""
                        SELECT TOP {limit}
                            VEC_TEXT,
                            VEC_META
                        FROM {table_ref}
                        WHERE UPPER(VEC_TEXT) LIKE UPPER(?)
                           OR UPPER(VEC_TEXT) LIKE UPPER(?)
                        """,
                        (f"%{error_type}%", f"%{first_keyword}%"),
                    )
                    rows = cur.fetchall()
                    if rows:
                        results = self._rows_to_dicts(rows)
                        titles = [r.get('note_title', 'N/A') for r in results[:3]]
                        logger.info(
                            "[VectorStore] LIKE search SUCCESS | returned=%d entries for error_type=%s | "
                            "top_titles=%s",
                            len(results), error_type, titles
                        )
                except Exception as exc:
                    logger.error(f"[VectorStore] LIKE search failed: {exc}")

            # ── 3. Fallback scan — return first N rows ────────────────────────
            if not results:
                try:
                    cur.execute(
                        f"SELECT TOP {limit} VEC_TEXT, VEC_META FROM {table_ref}"
                    )
                    rows = cur.fetchall()
                    if rows:
                        results = self._rows_to_dicts(rows)
                        titles = [r.get('note_title', 'N/A') for r in results[:3]]
                        logger.info(
                            "[VectorStore] Fallback scan SUCCESS | returned=%d entries | top_titles=%s",
                            len(results), titles
                        )
                except Exception as exc:
                    logger.error(f"[VectorStore] Fallback scan failed: {exc}")

            cur.close()
        except Exception as exc:
            logger.error(f"[VectorStore] Retrieval error: {exc}")
        finally:
            try:
                conn.close()
            except Exception:
                pass
        
        # Log final result summary
        if results:
            logger.info(
                "[VectorStore] Retrieval COMPLETE | total_entries=%d error_type=%s iflow=%s | "
                "categories=%s",
                len(results), error_type, iflow_id,
                list(set(r.get('error_category', 'N/A') for r in results))
            )
        else:
            logger.warning(
                "[VectorStore] Retrieval returned NO RESULTS | error_type=%s iflow=%s | "
                "This may impact RCA quality - consider adding relevant KB entries",
                error_type, iflow_id
            )

        return results

    # ── Row → dict ────────────────────────────────────────────────────────────

    @staticmethod
    def _rows_to_dicts(rows) -> List[Dict]:
        """
        Convert (VEC_TEXT, VEC_META) rows to structured dicts.

        VEC_META is expected to be a JSON string. Common keys:
            title / note_title, error_category / category,
            solution_steps / solution, source
        """
        results = []
        for i, row in enumerate(rows):
            vec_text = row[0] or ""
            raw_meta = row[1] or "{}"

            # Parse VEC_META JSON
            try:
                meta: Dict = json.loads(raw_meta) if isinstance(raw_meta, str) else (raw_meta or {})
            except (json.JSONDecodeError, TypeError):
                meta = {}

            # Extract fields — try common key variations
            title = (
                meta.get("title")
                or meta.get("note_title")
                or meta.get("name")
                or f"KB Entry {i + 1}"
            )
            category = (
                meta.get("error_category")
                or meta.get("category")
                or meta.get("type")
                or meta.get("error_type")
                or ""
            )
            solution = (
                meta.get("solution_steps")
                or meta.get("solution")
                or meta.get("fix")
                or meta.get("resolution")
                or ""
            )
            source = meta.get("source") or meta.get("url") or ""

            results.append({
                "note_id":        meta.get("id") or meta.get("note_id") or str(i + 1),
                "note_title":     title,
                "note_content":   vec_text,
                "error_category": category,
                "solution_steps": solution,
                "source":         source,
                "meta":           meta,
                "similarity":     1.0,
            })
        return results

    # ── Prompt formatter ──────────────────────────────────────────────────────

    def format_notes_for_prompt(self, notes: List[Dict]) -> str:
        """
        Format knowledge base entries for injection into the LLM RCA/fix prompt.

        Keeps each entry under ~500 chars for VEC_TEXT to avoid bloating the context.
        """
        if not notes:
            return ""

        lines = ["\n\n=== RELEVANT ENTRIES FROM CPI KNOWLEDGE BASE ==="]
        for note in notes:
            lines.append(f"\n--- {note.get('note_title', 'KB Entry')} ---")

            if note.get("error_category"):
                lines.append(f"Category : {note['error_category']}")

            if note.get("source"):
                lines.append(f"Source   : {note['source']}")

            content = note.get("note_content", "")
            if content:
                # Trim to keep prompt size manageable
                trimmed = content[:600].strip()
                if len(content) > 600:
                    trimmed += "…"
                lines.append(f"Content  : {trimmed}")

            if note.get("solution_steps"):
                lines.append(f"Solution : {note['solution_steps']}")

            lines.append("-" * 60)

        return "\n".join(lines)


# ── Global singleton ──────────────────────────────────────────────────────────
_vector_store: VectorStoreRetriever | None = None


def get_vector_store() -> VectorStoreRetriever:
    """Return (or create) the global VectorStoreRetriever instance."""
    global _vector_store
    if _vector_store is None:
        _vector_store = VectorStoreRetriever()
    return _vector_store
