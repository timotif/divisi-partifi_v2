"""Tests for setup version naming — the validator and the save-as path.

Covers the three gaps recorded in
docs/adr/0002-version-names-do-not-use-sanitize-string.md:
legible names survive, empty-after-normalizing is rejected rather than
silently overwriting Default, and save-as refuses an existing name.

Run with:
    cd backend && pytest tests/test_version_names.py -v
"""

import sqlite3
import pytest

import db as dbmod
from analyzer import sanitize_version_name, sanitize_string


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Each test gets its own empty database (mirrors test_db.py)."""
    monkeypatch.setattr(dbmod, "STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(dbmod, "PDFS_DIR",    str(tmp_path / "pdfs"))
    monkeypatch.setattr(dbmod, "PARTS_DIR",   str(tmp_path / "parts"))
    monkeypatch.setattr(dbmod, "DB_PATH",     str(tmp_path / "partifi.db"))
    dbmod.init_db()
    yield


SCORE_ID = "aaaaaaaa-0000-0000-0000-000000000001"
PAGES_META = [{"page_num": 0, "width": 1942, "height": 2634}]


def _score():
    dbmod.insert_score(
        score_id=SCORE_ID, title="T", composer="C",
        page_count=1, pages_meta=PAGES_META, pdf_hash="h",
    )


class TestValidator:
    def test_accents_survive(self):
        """The whole point of not using sanitize_string."""
        assert sanitize_version_name("Fauré – révision") == "Fauré – révision"
        assert sanitize_string("Fauré – révision") == "Faur rvision"

    def test_nfc_collapses_equivalent_spellings(self):
        """Composed vs decomposed must not become two distinct versions."""
        composed = "Fauré"        # é as one code point
        decomposed = "Fauré"     # e + combining acute
        assert composed != decomposed
        assert sanitize_version_name(composed) == sanitize_version_name(decomposed)

    def test_control_chars_stripped_and_whitespace_collapsed(self):
        assert sanitize_version_name("v\x001") == "v1"
        assert sanitize_version_name("  a   b  ") == "a b"

    def test_empty_when_nothing_legible_remains(self):
        for value in ("", "   ", "\x00\x01", None):
            assert sanitize_version_name(value) == ""

    def test_length_capped(self):
        assert len(sanitize_version_name("a" * 300)) == 128


class TestSaveAs:
    def test_create_new_rejects_existing_name(self):
        """The UNIQUE constraint rejects, so there is no check-then-write race."""
        _score()
        dbmod.save_setup(SCORE_ID, "v2", 600, {"a": 1}, create_new=True)
        with pytest.raises(sqlite3.IntegrityError):
            dbmod.save_setup(SCORE_ID, "v2", 600, {"a": 2}, create_new=True)

    def test_create_new_does_not_clobber_existing(self):
        _score()
        dbmod.save_setup(SCORE_ID, "v2", 600, {"keep": True}, create_new=True)
        with pytest.raises(sqlite3.IntegrityError):
            dbmod.save_setup(SCORE_ID, "v2", 600, {"keep": False}, create_new=True)
        assert dbmod.load_setup(SCORE_ID, "v2")["setup"] == {"keep": True}

    def test_autosave_still_upserts(self):
        """Autosave must keep overwriting its own target."""
        _score()
        first = dbmod.save_setup(SCORE_ID, "v2", 600, {"n": 1})
        second = dbmod.save_setup(SCORE_ID, "v2", 600, {"n": 2})
        assert first == second
        assert dbmod.load_setup(SCORE_ID, "v2")["setup"] == {"n": 2}


class TestGeneratedPartsMigration:
    """generated_parts gained version_name after databases already existed."""

    OLD_SCHEMA = """
        CREATE TABLE generated_parts (
            score_id     TEXT NOT NULL,
            part_name    TEXT NOT NULL,
            page_count   INTEGER NOT NULL,
            staves_count INTEGER NOT NULL,
            generated_at REAL NOT NULL,
            PRIMARY KEY (score_id, part_name)
        );
    """

    def _old_db(self):
        """Replace the current table with the pre-migration one, plus a row."""
        with dbmod.get_conn() as conn:
            conn.executescript("DROP TABLE generated_parts;" + self.OLD_SCHEMA)
            conn.execute(
                "INSERT INTO generated_parts VALUES (?, ?, ?, ?, ?)",
                (SCORE_ID, "Violin I", 2, 4, 123.0),
            )

    def test_adds_column_and_keeps_existing_rows(self):
        _score()
        self._old_db()
        dbmod.init_db()

        rows = dbmod.get_generated_parts(SCORE_ID)
        assert len(rows) == 1, "existing parts must survive the migration"
        assert rows[0]["version_name"] == "Default"
        assert rows[0]["part_name"] == "Violin I"

    def test_is_idempotent(self):
        """init_db runs on every startup; a second pass must not error."""
        _score()
        self._old_db()
        dbmod.init_db()
        dbmod.init_db()
        assert len(dbmod.get_generated_parts(SCORE_ID)) == 1

    def test_records_the_generating_version(self):
        _score()
        dbmod.save_generated_parts(
            SCORE_ID, [{"name": "Vln", "page_count": 1, "staves_count": 2}], "v2",
        )
        assert dbmod.get_generated_parts(SCORE_ID)[0]["version_name"] == "v2"

    def test_generating_replaces_the_whole_set(self):
        """One set per score: generating from another version supersedes it."""
        _score()
        dbmod.save_generated_parts(
            SCORE_ID, [{"name": "Vln", "page_count": 1, "staves_count": 2}], "Default",
        )
        dbmod.save_generated_parts(
            SCORE_ID, [{"name": "Vla", "page_count": 1, "staves_count": 2}], "v2",
        )
        rows = dbmod.get_generated_parts(SCORE_ID)
        assert [r["part_name"] for r in rows] == ["Vla"]
        assert rows[0]["version_name"] == "v2"
