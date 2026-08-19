"""bridge/datasets.py — dataset preview + fine-tune data building mixin."""

import csv
import json
from pathlib import Path

from .core import logger


class DatasetsMixin:
    """Dataset preview (local files or HF Hub) and CSV/TSV → JSONL building."""

    def dataset_preview(self, path: str, max_rows: int = 5) -> dict:
        """Preview a dataset (JSONL, CSV, Parquet, or HF Hub dataset ID).
        Returns column names and sample rows.
        """
        import json as pyjson
        import traceback

        def _log(msg):
            print(f'[dataset_preview] {msg}', flush=True)

        def safe_row(r):
            """Convert a single row dict to JSON-safe values, truncating long strings."""
            out = {}
            for k, v in r.items():
                v = self._make_json_safe(v)
                if isinstance(v, str) and len(v) > 500:
                    v = v[:500] + '…'
                out[str(k)] = v
            return out

        try:
            # ── Try local file/directory first ────────────────────────────
            p = Path(path)
            if p.exists():
                _log(f'local path exists: {p} (suffix={p.suffix})')
                if p.suffix == '.csv':
                    with open(p, 'r', encoding='utf-8') as f:
                        reader = csv.DictReader(f)
                        rows = []
                        for i, row in enumerate(reader):
                            if i >= max_rows:
                                break
                            rows.append(safe_row(row))
                        _log(f'loaded {len(rows)} rows from CSV')
                        return {'success': True, 'columns': list(reader.fieldnames or []), 'rows': rows}

                elif p.suffix in ('.jsonl', '.json'):
                    rows = []
                    columns = set()
                    with open(p, 'r', encoding='utf-8') as f:
                        for i, line in enumerate(f):
                            if i >= max_rows:
                                break
                            line = line.strip()
                            if line:
                                try:
                                    row = pyjson.loads(line)
                                    if isinstance(row, dict):
                                        rows.append(safe_row(row))
                                        columns.update(row.keys())
                                except pyjson.JSONDecodeError:
                                    pass
                    _log(f'loaded {len(rows)} rows from JSON')
                    return {'success': True, 'columns': sorted(columns), 'rows': rows}

                elif p.suffix == '.parquet':
                    try:
                        import pandas as pd
                        df = pd.read_parquet(p)
                        cols = list(df.columns)
                        sample = df.head(max_rows).to_dict(orient='records')
                        _log(f'loaded {len(sample)} rows from Parquet')
                        return {'success': True, 'columns': cols, 'rows': [safe_row(r) for r in sample]}
                    except ImportError:
                        return {'success': False, 'error': 'pandas required for parquet preview'}

                elif p.is_dir():
                    try:
                        from datasets import load_from_disk
                        _log('loading dataset directory with load_from_disk...')
                        ds = load_from_disk(str(p))
                        cols = ds.column_names
                        rows = ds.select(range(min(max_rows, len(ds)))).to_list()
                        _log(f'loaded {len(rows)} rows from dataset directory')
                        return {'success': True, 'columns': cols, 'rows': [safe_row(r) for r in rows]}
                    except Exception as e:
                        _log(f'load_from_disk failed: {e}')
                        return {'success': False, 'error': 'Not a valid dataset directory'}

                return {'success': False, 'error': f'Unsupported file format: {p.suffix}'}

            # ── Not a local path — try Hugging Face Hub via API ──────────
            import urllib.request as urlreq
            import urllib.error

            _log(f'Hugging Face Hub dataset: {path}')
            try:
                self._enqueue_emit('_datasetPreviewCallback', {
                    'stage': 'contacting',
                    'message': 'Contacting Hugging Face datasets server...'
                })

                # Step 1: Get dataset info (configs, splits, features)
                info_url = f'https://datasets-server.huggingface.co/info?dataset={path}'
                _log(f'fetching dataset info: {info_url}')
                req = urlreq.Request(info_url, headers={'User-Agent': 'mama/1.0'})
                with urlreq.urlopen(req, timeout=15) as resp:
                    info_data = pyjson.loads(resp.read().decode('utf-8'))
                _log('dataset info received OK')

                # Extract config and split
                configs = info_data.get('dataset_info', {})
                if not configs:
                    _log('no configs found in dataset info')
                    return {'success': False, 'error': 'No configs found for dataset'}

                # Pick the first config (usually 'default' or the only one)
                config_name = next(iter(configs.keys())) if isinstance(configs, dict) else 'default'
                config_info = configs.get(config_name, {}) if isinstance(configs, dict) else configs
                splits = config_info.get('splits', {}) if isinstance(config_info, dict) else {}
                split_name = 'train' if 'train' in splits else (next(iter(splits.keys())) if splits else 'train')
                _log(f'config={config_name}, split={split_name}')

                # Features / columns
                features = config_info.get('features', {}) if isinstance(config_info, dict) else {}
                cols = list(features.keys()) if features else []

                self._enqueue_emit('_datasetPreviewCallback', {
                    'stage': 'rows',
                    'message': 'Downloading sample rows...'
                })

                # Step 2: Fetch first rows from the Datasets Server
                rows_url = (
                    f'https://datasets-server.huggingface.co/rows'
                    f'?dataset={path}&config={config_name}&split={split_name}'
                )
                _log(f'fetching sample rows: {rows_url}')
                req2 = urlreq.Request(rows_url, headers={'User-Agent': 'mama/1.0'})
                with urlreq.urlopen(req2, timeout=30) as resp2:
                    rows_data = pyjson.loads(resp2.read().decode('utf-8'))
                _log('sample rows received OK')

                raw_rows = rows_data.get('rows', []) if isinstance(rows_data, dict) else []
                sample = []
                for i, item in enumerate(raw_rows):
                    if i >= max_rows:
                        break
                    row_data = item.get('row', item) if isinstance(item, dict) else item
                    if isinstance(row_data, dict):
                        sample.append(safe_row(row_data))
                _log(f'processed {len(sample)} sample rows')

                if not cols and sample:
                    cols = list(sample[0].keys())

                self._enqueue_emit('_datasetPreviewCallback', {
                    'stage': 'done',
                    'message': 'Preview ready'
                })
                _log('preview complete, returning result')

                return {
                    'success': True,
                    'columns': cols,
                    'rows': sample,
                    'dataset_id': path,
                    'split': split_name,
                    'config': config_name,
                    'source': 'huggingface',
                    'total_rows': splits.get(split_name, {}).get('num_examples', 0) if isinstance(splits, dict) else 0,
                }

            except urllib.error.HTTPError as e:
                _log(f'HTTPError: {e.code} {e.reason}')
                if e.code == 404:
                    return {'success': False, 'error': f'Dataset "{path}" not found on Hugging Face Hub'}
                return {'success': False, 'error': f'HF API error ({e.code}): {e.reason}'}
            except urllib.error.URLError as e:
                _log(f'URLError: {e.reason}')
                return {'success': False, 'error': f'Network error accessing HF Hub: {e.reason}'}
            except Exception as e:
                _log(f'unexpected HF error: {e}\n{traceback.format_exc()}')
                return {'success': False, 'error': f'Hugging Face dataset error: {e}'}

        except Exception as e:
            _log(f'unexpected error: {e}\n{traceback.format_exc()}')
            return {'success': False, 'error': str(e)}

    # ── Fine-tune data building ──────────────────────────────────────────────

    def data_table_preview(self, path: str, delimiter: str = '',
                           limit: int = 10) -> dict:
        """Preview a CSV/TSV file: columns, first rows, delimiter guess."""
        if not path:
            return {'success': False, 'error': 'No file selected.'}
        try:
            from components.backend.data.converters import read_table
            return read_table(path, delimiter or None, max(1, int(limit)))
        except Exception as e:
            logger.error('data_table_preview failed: %s', e)
            return {'success': False, 'error': str(e)}

    def _data_default_dir(self) -> Path:
        """Default home for built datasets: <open project>/data (else user data dir)."""
        try:
            recents = self._read_recents() or {}
            proj = recents.get('open')
            if proj:
                return Path(proj) / 'data'
        except Exception:
            pass
        return self._data_dir / 'user' / 'data'

    @staticmethod
    def _resolve_data_out(params: dict, source: str, fallback: Path) -> Path:
        """Effective output path for a built dataset. An explicit output_path
        wins; an input-file source writes next to it; otherwise the fallback
        (project data dir) is used."""
        out = (params.get('output_path') or '').strip()
        if not out and source:
            src = Path(source)
            out = str(src.parent / (src.stem + '.jsonl'))
        if not out:
            out = str(fallback / 'dataset.jsonl')
        return Path(out)

    def data_build_from_table(self, params: dict) -> dict:
        """Build a fine-tuning JSONL from a CSV/TSV file's columns."""
        params = params or {}
        path = (params.get('input_path') or '').strip()
        instruction_col = (params.get('instruction_col') or '').strip()
        response_col = (params.get('response_col') or '').strip()
        context_col = ((params.get('context_col') or '').strip()) or None
        fmt = (params.get('format') or 'alpaca').strip().lower()
        if not path or not instruction_col or not response_col:
            return {'success': False, 'error': 'File and both columns are required.'}
        try:
            from components.backend.data.converters import (
                build_from_table, examples_to_records, write_jsonl)
            examples = build_from_table(
                path, instruction_col, response_col, context_col,
                max_samples=int(params['max_samples']) if params.get('max_samples') else None,
                shuffle=bool(params.get('shuffle')),
                seed=int(params.get('seed', 42)))
            if not examples:
                return {'success': False,
                        'error': 'No rows had both columns filled in — nothing to write.'}
            out = self._resolve_data_out(params, path, self._data_default_dir())
            count = write_jsonl(out, examples_to_records(examples, fmt))
            return {'success': True, 'path': str(out), 'samples': count,
                    'format': fmt}
        except Exception as e:
            logger.error('data_build_from_table failed: %s', e)
            return {'success': False, 'error': str(e)}
