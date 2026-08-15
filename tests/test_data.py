# tests/test_data.py
"""Data-page converter tests (components/backend/data/converters.py)."""

import json

import pytest

from components.backend.data.converters import (
    build_from_grui_recording,
    build_from_table,
    build_from_text,
    detect_delimiter,
    examples_to_records,
    parse_text_pairs,
    read_table,
    write_jsonl,
)


# ── Table files ────────────────────────────────────────────────────────────

def test_detect_delimiter_tsv(tmp_path):
    f = tmp_path / "qa.tsv"
    f.write_text("instruction\tresponse\tcontext\n", encoding="utf-8")
    assert detect_delimiter(f) == "\t"


def test_detect_delimiter_csv_when_no_tabs(tmp_path):
    f = tmp_path / "qa.csv"
    f.write_text("instruction,response,context\n", encoding="utf-8")
    assert detect_delimiter(f) == ","


def test_read_table_preview_and_total(tmp_path):
    f = tmp_path / "qa.csv"
    f.write_text(
        "instruction,response\n" "What is 2+2?,4\n" "Say hi,Hello!\n" "a,,bad\n",
        encoding="utf-8",
    )
    table = read_table(str(f), limit=2)
    assert table["success"] is True
    assert table["columns"] == ["instruction", "response"]
    assert len(table["rows"]) == 2
    assert table["rows"][0]["instruction"] == "What is 2+2?"
    assert table["total"] == 3


def test_read_table_missing_file():
    table = read_table("/nonexistent/qa.csv")
    assert table["success"] is False


def test_build_from_table_skips_empty_cells(tmp_path):
    f = tmp_path / "qa.csv"
    f.write_text(
        "instruction,response,context\n"
        "Q1,A1,C1\n"
        "only instruction,,C2\n"
        ",only response,C3\n",
        encoding="utf-8",
    )
    examples = build_from_table(str(f), "instruction", "response", context_col="context")
    assert len(examples) == 1
    assert examples[0] == {"instruction": "Q1", "input": "C1", "output": "A1"}


def test_build_from_table_bad_column(tmp_path):
    f = tmp_path / "qa.csv"
    f.write_text("a,b\n1,2\n", encoding="utf-8")
    with pytest.raises(ValueError):
        build_from_table(str(f), "nope", "b")


# ── Pasted text ────────────────────────────────────────────────────────────

def test_parse_text_pairs_q_a_blocks():
    text = "Q: color of sky?\nA: blue\n\nQ: capital of France\nA: Paris\n"
    assert parse_text_pairs(text) == [("color of sky?", "blue"), ("capital of France", "Paris")]


def test_parse_text_pairs_tab_separated():
    text = "what is 2+2?\t4\ncapital of Spain\tMadrid\n"
    assert parse_text_pairs(text) == [("what is 2+2?", "4"), ("capital of Spain", "Madrid")]


def test_build_from_text_roundtrip():
    examples = build_from_text("Q: hi\nA: hello\n", max_samples=1)
    assert examples == [{"instruction": "hi", "input": "", "output": "hello"}]


# ── grui recordings ────────────────────────────────────────────────────────

EVENTS = (
    '{"t": 0.01, "device": "keyboard", "event": "down", "code": "KeyW"}\n'
    '{"t": 0.10, "device": "mouse", "event": "move", "x": 10, "y": 20}\n'
    '{"t": 0.20, "device": "mouse", "event": "button_down", "button": "left", "x": 10, "y": 20}\n'
    '{"t": 0.30, "device": "keyboard", "event": "up", "code": "KeyW"}\n'
)


@pytest.fixture
def grui_recording(tmp_path):
    rec = tmp_path / "rec1"
    rec.mkdir()
    (rec / "events.jsonl").write_text(EVENTS, encoding="utf-8")
    (rec / "markers.jsonl").write_text(
        '{"t": 0.0, "type": "annotation", "label": "go left"}\n', encoding="utf-8")
    (rec / "metadata.json").write_text(
        json.dumps({"duration": 1.0, "stats": {"frames_captured": 30}}), encoding="utf-8")
    return rec


def test_grui_recording_build_uses_marker_labels(grui_recording):
    examples = build_from_grui_recording(str(grui_recording))
    assert len(examples) == 1
    assert examples[0]["instruction"] == "Demonstrate: go left"
    assert "press w" in examples[0]["output"]
    assert "click left at (10, 20)" in examples[0]["output"]


def test_grui_recording_build_custom_instruction(grui_recording):
    examples = build_from_grui_recording(str(grui_recording), instruction="Reach the goal")
    assert examples[0]["instruction"] == "Reach the goal — go left"


def test_grui_recording_build_rejects_non_recording(tmp_path):
    with pytest.raises(ValueError):
        build_from_grui_recording(str(tmp_path / "nope"))


# ── Output formats ─────────────────────────────────────────────────────────

def test_examples_to_records_trl():
    records = examples_to_records(
        [{"instruction": "q", "input": "ctx", "output": "a"}], "trl")
    assert records == [{"prompt": "q\n\nContext:\nctx", "completion": "a"}]


def test_examples_to_records_alpaca_passthrough():
    ex = [{"instruction": "q", "input": "", "output": "a"}]
    assert examples_to_records(ex, "alpaca") == ex


def test_write_jsonl(tmp_path):
    out = tmp_path / "data" / "set.jsonl"
    n = write_jsonl(str(out), [{"a": 1}, {"a": 2}])
    assert n == 2
    assert [json.loads(l) for l in out.read_text().splitlines()] == [{"a": 1}, {"a": 2}]