"""bridge — PyWebView JS API bridge for mama.

Replaces Electron's ipc-handlers.js, settings-store.js, project-store.js, etc.
All methods are callable from the frontend via window.pywebview.api.*.

The implementation is split into domain mixins (one module per domain) that
are composed here into a single MamaApi class, so the pywebview-visible
surface is exactly one object with every method as before.
"""

from .env import (
    CONDA_PREFIX_NAMES,
    allowed_python_path,
    augment_path_for_gui_launch,
    clean_subprocess_env,
)
from .core import Core, logger
from .python_env import PythonEnvMixin
from .settings import SettingsMixin
from .updates import UpdateMixin
from .navigation import NavigationMixin
from .system import SystemMixin
from .projects import ProjectsMixin
from .themes import ThemesMixin
from .training import TrainingMixin
from .models import ModelsMixin
from .datasets import DatasetsMixin
from .modules import ModulesMixin
from .examples import ExamplesMixin
from .export import ExportMixin


class MamaApi(PythonEnvMixin, SettingsMixin, UpdateMixin, NavigationMixin,
              SystemMixin, ProjectsMixin, ThemesMixin, TrainingMixin,
              ModelsMixin, DatasetsMixin, ModulesMixin, ExamplesMixin,
              ExportMixin, Core):
    """Python backend exposed to the frontend via pywebview JS bridge."""


__all__ = [
    'MamaApi',
    'Core',
    'CONDA_PREFIX_NAMES',
    'allowed_python_path',
    'augment_path_for_gui_launch',
    'clean_subprocess_env',
    'logger',
]
