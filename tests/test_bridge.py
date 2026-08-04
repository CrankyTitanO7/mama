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