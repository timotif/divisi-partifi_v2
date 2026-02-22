"""Tests for backend/db.py — the SQLite persistence layer.

All tests run against a temporary database in a pytest tmp_path directory
so they never touch the real storage/ folder and are fully isolated from
one another.

Run with:
    cd backend && pytest tests/test_db.py -v
"""

import os
import sqlite3
import time
import pytest
import db as dbmod


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Redirect all db module path constants to a temporary directory.

    Each test gets its own empty database so there is no shared state.
    """
    pdfs_dir  = tmp_path / "pdfs"
    parts_dir = tmp_path / "parts"
    db_path   = tmp_path / "partifi.db"

    monkeypatch.setattr(dbmod, "STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(dbmod, "PDFS_DIR",    str(pdfs_dir))
    monkeypatch.setattr(dbmod, "PARTS_DIR",   str(parts_dir))
    monkeypatch.setattr(dbmod, "DB_PATH",     str(db_path))

    dbmod.init_db()
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SCORE_ID   = "aaaaaaaa-0000-0000-0000-000000000001"
SCORE_ID_2 = "aaaaaaaa-0000-0000-0000-000000000002"
PAGES_META = [{"page_num": 0, "width": 1942, "height": 2634}]
SETUP_DICT = {
    "dividersByPage":       {"0": [100, 400]},
    "systemDividersByPage": {"0": [True, False]},
    "snapFlagsByPage":      {"0": [True, None]},
    "stripNamesByPage":     {"0": ["Violin I", "Violin II"]},
    "confirmedPages":       [0],
    "headerRegion":         None,
    "markings":             [],
    "spacingByPart":        {},
    "offsetsByPart":        {},
    "pageBreaksByPart":     {},
}


def _insert(score_id=SCORE_ID, pdf_hash="hash_abc"):
    dbmod.insert_score(
        score_id=score_id,
        title="Test Score",
        composer="Bach",
        page_count=4,
        pages_meta=PAGES_META,
        pdf_hash=pdf_hash,
    )


# ---------------------------------------------------------------------------
# init_db
# ---------------------------------------------------------------------------

class TestInitDb:
    def test_creates_directories(self):
        assert os.path.isdir(dbmod.PDFS_DIR)
        assert os.path.isdir(dbmod.PARTS_DIR)

    def test_creates_database_file(self):
        assert os.path.isfile(dbmod.DB_PATH)

    def test_idempotent(self):
        # calling init_db a second time must not raise or corrupt the schema
        dbmod.init_db()
        dbmod.init_db()
        assert os.path.isfile(dbmod.DB_PATH)

    def test_tables_exist(self):
        with dbmod.get_conn() as conn:
            tables = {
                r[0]
                for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
        assert {"scores", "setups", "generated_parts"}.issubset(tables)

    def test_foreign_keys_enabled(self):
        with dbmod.get_conn() as conn:
            fk_on = conn.execute("PRAGMA foreign_keys").fetchone()[0]
        assert fk_on == 1

    def test_wal_mode(self):
        with dbmod.get_conn() as conn:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode == "wal"


# ---------------------------------------------------------------------------
# scores CRUD
# ---------------------------------------------------------------------------

class TestInsertScore:
    def test_basic_insert(self):
        _insert()
        row = dbmod.get_score(SCORE_ID)
        assert row is not None
        assert row["score_id"] == SCORE_ID
        assert row["title"] == "Test Score"
        assert row["composer"] == "Bach"
        assert row["page_count"] == 4
        assert row["pdf_hash"] == "hash_abc"

    def test_pages_meta_round_trips_as_json(self):
        import json
        _insert()
        row = dbmod.get_score(SCORE_ID)
        assert json.loads(row["pages_meta"]) == PAGES_META

    def test_timestamps_set(self):
        before = time.time()
        _insert()
        after = time.time()
        row = dbmod.get_score(SCORE_ID)
        assert before <= row["created_at"] <= after
        assert before <= row["updated_at"] <= after

    def test_duplicate_score_id_raises(self):
        _insert()
        with pytest.raises(sqlite3.IntegrityError):
            _insert()

    def test_empty_composer_default(self):
        dbmod.insert_score(
            score_id=SCORE_ID,
            title="No Composer",
            composer="",
            page_count=1,
            pages_meta=[],
            pdf_hash="h",
        )
        row = dbmod.get_score(SCORE_ID)
        assert row["composer"] == ""


class TestGetScore:
    def test_returns_none_for_unknown_id(self):
        assert dbmod.get_score("does-not-exist") is None

    def test_returns_correct_row(self):
        _insert()
        assert dbmod.get_score(SCORE_ID)["score_id"] == SCORE_ID


class TestListScores:
    def test_empty_library(self):
        assert dbmod.list_scores() == []

    def test_returns_all_scores(self):
        _insert(SCORE_ID, "h1")
        _insert(SCORE_ID_2, "h2")
        ids = {r["score_id"] for r in dbmod.list_scores()}
        assert ids == {SCORE_ID, SCORE_ID_2}

    def test_ordered_by_updated_at_desc(self):
        _insert(SCORE_ID, "h1")
        time.sleep(0.01)
        _insert(SCORE_ID_2, "h2")
        rows = dbmod.list_scores()
        assert rows[0]["score_id"] == SCORE_ID_2  # most recently inserted


class TestGetScoreByHash:
    def test_returns_none_when_no_match(self):
        assert dbmod.get_score_by_hash("nonexistent") is None

    def test_finds_existing_hash(self):
        _insert(pdf_hash="unique_hash")
        row = dbmod.get_score_by_hash("unique_hash")
        assert row is not None
        assert row["score_id"] == SCORE_ID

    def test_returns_most_recently_updated(self):
        _insert(SCORE_ID, "shared_hash")
        _insert(SCORE_ID_2, "shared_hash")
        # touch SCORE_ID to make it more recent
        dbmod.touch_score(SCORE_ID)
        row = dbmod.get_score_by_hash("shared_hash")
        assert row["score_id"] == SCORE_ID


class TestTouchScore:
    def test_updates_updated_at(self):
        _insert()
        before = dbmod.get_score(SCORE_ID)["updated_at"]
        time.sleep(0.01)
        dbmod.touch_score(SCORE_ID)
        after = dbmod.get_score(SCORE_ID)["updated_at"]
        assert after > before

    def test_does_not_change_created_at(self):
        _insert()
        created = dbmod.get_score(SCORE_ID)["created_at"]
        dbmod.touch_score(SCORE_ID)
        assert dbmod.get_score(SCORE_ID)["created_at"] == created


class TestDeleteScore:
    def test_removes_row(self):
        _insert()
        dbmod.delete_score(SCORE_ID)
        assert dbmod.get_score(SCORE_ID) is None

    def test_noop_on_missing_id(self):
        # should not raise
        dbmod.delete_score("nonexistent-id")

    def test_cascade_removes_setups(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "Default", 600, SETUP_DICT)
        dbmod.delete_score(SCORE_ID)
        assert dbmod.list_setups(SCORE_ID) == []

    def test_cascade_removes_generated_parts(self):
        _insert()
        dbmod.save_generated_parts(SCORE_ID, [{"name": "Violin I", "page_count": 2, "staves_count": 5}])
        dbmod.delete_score(SCORE_ID)
        assert dbmod.get_generated_parts(SCORE_ID) == []


class TestUpdateScoreMeta:
    def test_updates_title_and_composer(self):
        _insert()
        dbmod.update_score_meta(SCORE_ID, "New Title", "Beethoven")
        row = dbmod.get_score(SCORE_ID)
        assert row["title"] == "New Title"
        assert row["composer"] == "Beethoven"

    def test_updates_updated_at(self):
        _insert()
        before = dbmod.get_score(SCORE_ID)["updated_at"]
        time.sleep(0.01)
        dbmod.update_score_meta(SCORE_ID, "T", "C")
        assert dbmod.get_score(SCORE_ID)["updated_at"] > before


# ---------------------------------------------------------------------------
# setups CRUD
# ---------------------------------------------------------------------------

class TestSaveSetup:
    def test_insert_returns_positive_id(self):
        _insert()
        sid = dbmod.save_setup(SCORE_ID, "Default", 600, SETUP_DICT)
        assert sid > 0

    def test_load_after_save(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "Default", 600, SETUP_DICT)
        result = dbmod.load_setup(SCORE_ID, "Default")
        assert result is not None
        assert result["version_name"] == "Default"
        assert result["display_width"] == 600
        assert result["setup"] == SETUP_DICT

    def test_upsert_overwrites_existing(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "Default", 600, SETUP_DICT)
        new_setup = {**SETUP_DICT, "confirmedPages": [0, 1, 2]}
        dbmod.save_setup(SCORE_ID, "Default", 800, new_setup)
        result = dbmod.load_setup(SCORE_ID, "Default")
        assert result["display_width"] == 800
        assert result["setup"]["confirmedPages"] == [0, 1, 2]

    def test_upsert_preserves_setup_id(self):
        _insert()
        sid1 = dbmod.save_setup(SCORE_ID, "Default", 600, SETUP_DICT)
        sid2 = dbmod.save_setup(SCORE_ID, "Default", 800, SETUP_DICT)
        assert sid1 == sid2

    def test_multiple_versions_independent(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "v1", 600, {"x": 1})
        dbmod.save_setup(SCORE_ID, "v2", 600, {"x": 2})
        assert dbmod.load_setup(SCORE_ID, "v1")["setup"] == {"x": 1}
        assert dbmod.load_setup(SCORE_ID, "v2")["setup"] == {"x": 2}

    def test_setup_json_round_trips_complex_types(self):
        _insert()
        complex_setup = {
            "nested": {"a": [1, 2, 3], "b": None},
            "unicode": "Violin \u2160",
            "float": 3.14,
        }
        dbmod.save_setup(SCORE_ID, "Default", 600, complex_setup)
        result = dbmod.load_setup(SCORE_ID, "Default")
        assert result["setup"] == complex_setup

    def test_saved_at_is_recent(self):
        _insert()
        before = time.time()
        dbmod.save_setup(SCORE_ID, "Default", 600, SETUP_DICT)
        after = time.time()
        result = dbmod.load_setup(SCORE_ID, "Default")
        assert before <= result["saved_at"] <= after


class TestLoadSetup:
    def test_returns_none_for_unknown_score(self):
        assert dbmod.load_setup("no-such-score", "Default") is None

    def test_returns_none_for_unknown_version(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "Default", 600, SETUP_DICT)
        assert dbmod.load_setup(SCORE_ID, "nonexistent") is None


class TestListSetups:
    def test_empty_when_no_versions(self):
        _insert()
        assert dbmod.list_setups(SCORE_ID) == []

    def test_lists_all_versions(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "v1", 600, {})
        dbmod.save_setup(SCORE_ID, "v2", 600, {})
        names = {v["version_name"] for v in dbmod.list_setups(SCORE_ID)}
        assert names == {"v1", "v2"}

    def test_ordered_by_saved_at_desc(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "first", 600, {})
        time.sleep(0.01)
        dbmod.save_setup(SCORE_ID, "second", 600, {})
        versions = dbmod.list_setups(SCORE_ID)
        assert versions[0]["version_name"] == "second"

    def test_does_not_include_other_scores(self):
        _insert(SCORE_ID, "h1")
        _insert(SCORE_ID_2, "h2")
        dbmod.save_setup(SCORE_ID,   "v1", 600, {})
        dbmod.save_setup(SCORE_ID_2, "v2", 600, {})
        names = {v["version_name"] for v in dbmod.list_setups(SCORE_ID)}
        assert names == {"v1"}


class TestDeleteSetup:
    def test_removes_version(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "Default", 600, SETUP_DICT)
        assert dbmod.delete_setup(SCORE_ID, "Default") is True
        assert dbmod.load_setup(SCORE_ID, "Default") is None

    def test_returns_false_for_nonexistent_version(self):
        _insert()
        assert dbmod.delete_setup(SCORE_ID, "ghost") is False

    def test_other_versions_unaffected(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "v1", 600, {"keep": True})
        dbmod.save_setup(SCORE_ID, "v2", 600, {"keep": False})
        dbmod.delete_setup(SCORE_ID, "v2")
        assert dbmod.load_setup(SCORE_ID, "v1")["setup"] == {"keep": True}


class TestRenameSetup:
    def test_renames_successfully(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "old", 600, SETUP_DICT)
        assert dbmod.rename_setup(SCORE_ID, "old", "new") is True
        assert dbmod.load_setup(SCORE_ID, "new") is not None
        assert dbmod.load_setup(SCORE_ID, "old") is None

    def test_returns_false_for_nonexistent_source(self):
        _insert()
        assert dbmod.rename_setup(SCORE_ID, "ghost", "new") is False

    def test_returns_false_when_target_name_exists(self):
        _insert()
        dbmod.save_setup(SCORE_ID, "v1", 600, {})
        dbmod.save_setup(SCORE_ID, "v2", 600, {})
        assert dbmod.rename_setup(SCORE_ID, "v1", "v2") is False
        # both versions must still exist unchanged
        assert dbmod.load_setup(SCORE_ID, "v1") is not None
        assert dbmod.load_setup(SCORE_ID, "v2") is not None


# ---------------------------------------------------------------------------
# generated_parts CRUD
# ---------------------------------------------------------------------------

PARTS = [
    {"name": "Violin I",  "page_count": 3, "staves_count": 10},
    {"name": "Violin II", "page_count": 3, "staves_count": 10},
    {"name": "Viola",     "page_count": 2, "staves_count": 7},
]


class TestSaveGeneratedParts:
    def test_stores_all_parts(self):
        _insert()
        dbmod.save_generated_parts(SCORE_ID, PARTS)
        rows = dbmod.get_generated_parts(SCORE_ID)
        names = {r["part_name"] for r in rows}
        assert names == {"Violin I", "Violin II", "Viola"}

    def test_replaces_previous_parts(self):
        _insert()
        dbmod.save_generated_parts(SCORE_ID, PARTS)
        new_parts = [{"name": "Cello", "page_count": 1, "staves_count": 4}]
        dbmod.save_generated_parts(SCORE_ID, new_parts)
        rows = dbmod.get_generated_parts(SCORE_ID)
        assert len(rows) == 1
        assert rows[0]["part_name"] == "Cello"

    def test_empty_list_clears_parts(self):
        _insert()
        dbmod.save_generated_parts(SCORE_ID, PARTS)
        dbmod.save_generated_parts(SCORE_ID, [])
        assert dbmod.get_generated_parts(SCORE_ID) == []

    def test_generated_at_is_recent(self):
        _insert()
        before = time.time()
        dbmod.save_generated_parts(SCORE_ID, PARTS)
        after = time.time()
        for row in dbmod.get_generated_parts(SCORE_ID):
            assert before <= row["generated_at"] <= after

    def test_correct_page_and_stave_counts(self):
        _insert()
        dbmod.save_generated_parts(SCORE_ID, PARTS)
        by_name = {r["part_name"]: r for r in dbmod.get_generated_parts(SCORE_ID)}
        assert by_name["Viola"]["page_count"] == 2
        assert by_name["Viola"]["staves_count"] == 7


class TestGetGeneratedParts:
    def test_empty_when_none_saved(self):
        _insert()
        assert dbmod.get_generated_parts(SCORE_ID) == []

    def test_does_not_return_other_scores_parts(self):
        _insert(SCORE_ID, "h1")
        _insert(SCORE_ID_2, "h2")
        dbmod.save_generated_parts(SCORE_ID,   PARTS)
        dbmod.save_generated_parts(SCORE_ID_2, [{"name": "Flute", "page_count": 1, "staves_count": 3}])
        names = {r["part_name"] for r in dbmod.get_generated_parts(SCORE_ID)}
        assert "Flute" not in names


class TestInvalidateGeneratedParts:
    def test_removes_db_rows(self):
        _insert()
        dbmod.save_generated_parts(SCORE_ID, PARTS)
        dbmod.invalidate_generated_parts(SCORE_ID)
        assert dbmod.get_generated_parts(SCORE_ID) == []

    def test_removes_parts_directory(self):
        _insert()
        parts_dir = os.path.join(dbmod.PARTS_DIR, SCORE_ID)
        os.makedirs(parts_dir, exist_ok=True)
        dummy = os.path.join(parts_dir, "Violin I.pdf")
        with open(dummy, "wb") as f:
            f.write(b"%PDF-dummy")
        dbmod.invalidate_generated_parts(SCORE_ID)
        assert not os.path.isdir(parts_dir)

    def test_noop_when_directory_missing(self):
        _insert()
        # no directory created — should not raise
        dbmod.invalidate_generated_parts(SCORE_ID)


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

class TestPathHelpers:
    def test_pdf_path_contains_score_id(self):
        path = dbmod.pdf_path(SCORE_ID)
        assert SCORE_ID in path
        assert path.endswith(".pdf")

    def test_part_pdf_path_contains_score_and_name(self):
        path = dbmod.part_pdf_path(SCORE_ID, "Violin I")
        assert SCORE_ID in path
        assert "Violin I.pdf" in path


# ---------------------------------------------------------------------------
# sha256_of_bytes
# ---------------------------------------------------------------------------

class TestSha256OfBytes:
    def test_known_hash(self):
        # SHA-256 of empty bytes is a well-known constant
        expected = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        assert dbmod.sha256_of_bytes(b"") == expected

    def test_different_inputs_different_hashes(self):
        assert dbmod.sha256_of_bytes(b"abc") != dbmod.sha256_of_bytes(b"xyz")

    def test_same_input_same_hash(self):
        data = b"partifi test data"
        assert dbmod.sha256_of_bytes(data) == dbmod.sha256_of_bytes(data)

    def test_returns_hex_string(self):
        result = dbmod.sha256_of_bytes(b"test")
        assert isinstance(result, str)
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)
