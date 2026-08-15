# Makes components/* importable as a namespace for bridge-side helpers
# (e.g. components.backend.data.converters). Files here are executed as
# subprocess scripts by training; this package marker only matters for
# module imports and PyInstaller's hiddenimports.