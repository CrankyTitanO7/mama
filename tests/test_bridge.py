# tests/test_bridge.py
import json

import pytest

from bridge import MamaApi


@pytest.fixture
def api(tmp_path):
    return MamaApi(user_settings_path=str(tmp_path / "settings.json"), base_dir=str(tmp_path))


def test_update_training_params_valid_input(tmp_path, api):
    # 1. Setup: Build a training config like the frontend submits
    config = {
        "model": "test_model",
        "epochs": 10,
        "learning_rate": 0.001,
        "output_dir": str(tmp_path / "run"),
    }

    # 2. Execution: Persist the params through the bridge API
    result = api.train_config_save(str(tmp_path / "run"), json.dumps(config))

    # 3. Assertion: The save must be reported as success and round-trip intact
    assert result["success"] is True
    saved = api.train_read_config(str(tmp_path / "run"))
    assert saved["success"] is True
    assert saved["config"]["epochs"] == 10
    assert saved["config"]["learning_rate"] == 0.001
    assert saved["config"]["model"] == "test_model"


def test_update_training_params_invalid_input(api):
    # You can also test how your app handles bad inputs from JS
    result = api.train_config_save(str(api._base_dir / "run"), "{not valid json")

    assert result["success"] is False
    assert "error" in result


def test_whiteboard_save_round_trip(tmp_path, api):
    graph = {
        "format": "mama-whiteboard-graph",
        "version": 1,
        "canvas": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {
                "id": "obj-1",
                "widget_type": "model",
                "label": "Model",
                "x": 100,
                "y": 100,
                "width": 240,
                "height": 233,
                "color": "#4a90e2",
                "fields": [
                    {"key": "input", "label": "Input file", "type": "file", "value": "(none)"},
                    {"key": "output", "label": "Output file", "type": "file", "value": "(none)"},
                ],
                "params": [{"key": "epochs", "label": "Epochs", "value": "10"}],
            }
        ],
        "connections": [
            {
                "id": "obj-7",
                "from": "obj-1",
                "from_anchor": "output",
                "to": "obj-2",
                "to_anchor": "input",
                "color": "#1a1a2e",
                "size": 3,
            }
        ],
        "annotations": [{"id": "obj-3", "type": "text", "x": 5, "y": 6, "text": "note", "fontSize": 24}],
    }

    result = api.whiteboard_save(str(tmp_path), json.dumps(graph))

    assert result["success"] is True
    assert result["path"] == str(tmp_path / "graph.json")
    saved = (tmp_path / "graph.json").read_text("utf-8")
    # Human-readable: the file carries an explanatory comment header
    assert "//" in saved
    assert "mama" in saved

    loaded = api.whiteboard_read(str(tmp_path))

    assert loaded["success"] is True
    data = loaded["data"]
    assert data["format"] == "mama-whiteboard-graph"
    assert data["nodes"][0]["widget_type"] == "model"
    assert data["nodes"][0]["params"][0]["value"] == "10"
    assert data["connections"][0]["from"] == "obj-1"
    assert data["annotations"][0]["type"] == "text"


def test_whiteboard_read_direct_file_and_missing(tmp_path, api):
    assert api.whiteboard_read(str(tmp_path))["success"] is False

    (tmp_path / "graph.json").write_text("not json at all", "utf-8")
    assert api.whiteboard_read(str(tmp_path))["success"] is False

    api.whiteboard_save(str(tmp_path), json.dumps({"format": "mama-whiteboard-graph", "version": 1}))
    direct = api.whiteboard_read(str(tmp_path / "graph.json"))
    assert direct["success"] is True
    assert direct["data"]["format"] == "mama-whiteboard-graph"


def test_whiteboard_save_invalid_json(api):
    result = api.whiteboard_save(str(api._base_dir), "{not valid json")
    assert result["success"] is False
    assert "error" in result