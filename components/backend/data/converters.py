#!/usr/bin/env python3
"""
components/backend/data/converters.py — build fine-tuning datasets locally.

Pure-stdlib converters used by the Data page (bridge.py 'data_*' methods).
Everything here is side-effect free except write_jsonl(); running this
file directly (python converters.py <csv|tsv|text|grui> ...) is a
convenient way to exercise each converter from the terminal.

Output formats
--------------
* 'alpaca'  : JSONL lines {"instruction", "input", "output"} — the
              standard for Soup (data.format: alpaca), Axolotl and most
              fine-tuning stacks.
* 'trl'     : JSONL lines {"prompt", "completion"} — consumed directly by
              mama's built-in TRL trainer (auto-detected).
"""

import csv
import json
import random
from pathlib import Path

# ── Table files (CSV / TSV / any delimiter) ──────────────────────────────────

def detect_delimiter(path: Path, sample_bytes: int = 4096) -> str:
    """Guess the field delimiter from the first lines of a table file.

    Counts each candidate's occurrences in the header line; TSV header
    cells contain no commas, so tab wins by default.
    """
    try:
        with open(path, 'r', encoding='utf-8', errors='replace', newline='') as f:
            head = f.read(sample_bytes)
    except OSError:
        return ','
    first_line = (head.split('\n', 1)[0] or '').strip()
    if not first_line:
        return ','
    delimiters = ('\t', ',', ';', '|')
    best, best_count = delimiters[1], -1
    for d in delimiters:
        count = first_line.count(d)
        if count > best_count:
            best, best_count = d, count
    return best


def read_table(path, delimiter: str = None, limit: int = 10) -> dict:
    """Read a CSV/TSV file and return {columns, rows, delimiter, total}.

    `rows` is a preview limited to the first `limit` lines. Cells are
    strings; empty header cells get a generated name (col_1, ...).
    """
    path = Path(path)
    if not path.exists():
        return {'success': False, 'error': f'File not found: {path}'}
    delim = delimiter or detect_delimiter(path)
    if len(delim) == 1:
        delim = delim
    elif delim == '\\t':
        delim = '\t'
    rows = []
    columns = []
    total = 0
    try:
        with open(path, 'r', encoding='utf-8', errors='replace', newline='') as f:
            reader = csv.DictReader(f, delimiter=delim)
            raw_columns = reader.fieldnames
            if raw_columns is None:
                return {'success': False, 'error': 'File is empty.'}
            columns = [c.strip() if c.strip() else f'col_{i + 1}'
                       for i, c in enumerate(raw_columns)]
            for row in reader:
                total += 1
                if len(rows) < limit:
                    rows.append({c: (row.get(c) or '') for c in raw_columns})
    except Exception as e:
        return {'success': False, 'error': f'Failed to read table: {e}'}
    return {
        'success': True,
        'columns': columns,
        'rows': rows,
        'delimiter': '\t' if delim == '\t' else delim,
        'delimiter_label': 'TSV' if delim == '\t' else f'{delim} (CSV)',
        'total': total,
    }


# ── Alpaca rows from a table ────────────────────────────────────────────────

def build_from_table(path, instruction_col: str, response_col: str,
                     context_col: str = None, max_samples: int = None,
                     shuffle: bool = False, seed: int = 42) -> list:
    """Turn a table file into a list of Alpaca-style example dicts.

    Rows missing either the instruction or the response column value are
    skipped; rows with both are emitted as
    {"instruction", "input" (from context, may be ""), "output"}.
    """
    table = read_table(path, limit=10 ** 6)
    if not table.get('success'):
        raise ValueError(table.get('error', 'Could not read table.'))
    columns = table['columns']
    if instruction_col not in columns or response_col not in columns:
        raise ValueError(
            f"Selected columns not found. File has: {', '.join(columns)}")

    delim = table['delimiter']
    examples = []
    with open(path, 'r', encoding='utf-8', errors='replace', newline='') as f:
        reader = csv.DictReader(f, delimiter=delim)
        for raw in reader:
            instruction = str(raw.get(instruction_col) or '').strip()
            response = str(raw.get(response_col) or '').strip()
            if not instruction or not response:
                continue
            context = str(raw.get(context_col) or '').strip() if context_col else ''
            examples.append({
                'instruction': instruction,
                'input': context,
                'output': response,
            })
    if shuffle:
        rng = random.Random(seed)
        rng.shuffle(examples)
    if max_samples:
        examples = examples[:max_samples]
    return examples


# ── Pasted text (plain Q/A pairs) ───────────────────────────────────────────

def parse_text_pairs(text: str) -> list:
    """Parse pasted instruction/response text into (instruction, response).

    Two layouts are understood:

    1. Tab-separated pairs: one pair per line, instruction<TAB>response
       (or comma/pipe separated — the first non-space separator is used).
    2. Q:/A: blocks: an instruction line starting with ``Q:`` (or
       ``instruction:`` / ``>``) followed by an answer line starting with
       ``A:`` (or ``response:``). Blocks may span multiple lines each —
       indented continuation lines belong to the current block. Blocks are
       separated by blank lines.

    Lines that match neither layout are skipped.
    """
    pairs = []
    current_q = None
    current_lines = []

    def flush():
        nonlocal current_q, current_lines
        if current_q is not None:
            answer = '\n'.join(current_lines).strip()
            if answer:
                pairs.append((current_q, answer))
        current_q = None
        current_lines = []

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            flush()
            continue
        lower = line.lower()
        if lower.startswith('q:'):
            flush()
            current_q = line[2:].strip()
        elif lower.startswith('a:'):
            if current_q is None:
                current_q = 'Perform the demonstrated task.' if pairs else '(task)'
            current_lines.append(line[2:].strip())
        elif lower.startswith('instruction:'):
            flush()
            current_q = line[len('instruction:'):].strip()
        elif lower.startswith('response:'):
            if current_q is None:
                current_q = '(task)'
            current_lines.append(line[len('response:'):].strip())
        elif current_q is not None and (line.startswith('>') or line.startswith('  ')):
            # continuation of the answer block (indented or quoted)
            current_lines.append(line.lstrip('> '))
        elif '\t' in line or '|' in line or (',' in line and line.count(',') == 1):
            # one-line TSV/CSV-style pair
            flush()
            sep = '\t' if '\t' in line else ('|' if '|' in line else ',')
            q, _, a = line.partition(sep)
            if q.strip() and a.strip():
                pairs.append((q.strip(), a.strip()))
    flush()
    return pairs


def build_from_text(text: str, max_samples: int = None,
                    shuffle: bool = False, seed: int = 42) -> list:
    """Build Alpaca-style examples from pasted pairs text."""
    pairs = parse_text_pairs(text)
    examples = [
        {'instruction': q, 'input': '', 'output': a}
        for q, a in pairs if q and a
    ]
    if shuffle:
        rng = random.Random(seed)
        rng.shuffle(examples)
    if max_samples:
        examples = examples[:max_samples]
    return examples


# ── grui recordings (imitation → text examples) ─────────────────────────────

# Human-readable names for the pynput-ish key codes produced by grui.
_KEY_NAMES = {
    'Key.space': 'space', 'Key.enter': 'enter', 'Key.tab': 'tab',
    'Key.backspace': 'backspace', 'Key.shift': 'shift', 'Key.ctrl': 'ctrl',
    'Key.alt': 'alt', 'Key.cmd': 'cmd', 'Key.up': 'up arrow',
    'Key.down': 'down arrow', 'Key.left': 'left arrow',
    'Key.right': 'right arrow', 'Key.esc': 'escape', 'Key.delete': 'delete',
}


def _key_name(code: str) -> str:
    """Canonical key code ('KeyW', 'Key.space') → readable label."""
    if code in _KEY_NAMES:
        return _KEY_NAMES[code]
    if code.startswith('Key.'):
        return code[len('Key.'):]
    if code.startswith('Key'):
        return code[3:].lower()
    return code


def load_grui_events(recording_dir) -> tuple:
    """Load a grui recording's events.jsonl + markers.jsonl.

    Returns (events, markers) — lists of dicts sorted by time `t`.
    """
    recording = Path(recording_dir)
    events = []
    markers = []
    ev_path = recording / 'events.jsonl'
    mk_path = recording / 'markers.jsonl'
    if not ev_path.exists():
        raise ValueError(f'Not a grui recording (no events.jsonl): {recording}')
    for line in ev_path.read_text('utf-8', errors='replace').splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if mk_path.exists():
        for line in mk_path.read_text('utf-8', errors='replace').splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                markers.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    events.sort(key=lambda e: e.get('t', 0))
    markers.sort(key=lambda m: m.get('t', 0))
    return events, markers


def _event_to_line(ev: dict, include_time: bool = True) -> str:
    """One line of the human-readable transcript for an input event."""
    device = ev.get('device', '')
    etype = ev.get('event', '')
    stamp = f'[t={ev.get("t", 0):.2f}] ' if include_time else ''
    if device == 'keyboard':
        if etype in ('down', 'press'):
            char = ev.get('char') or ''
            label = char if (char and not char.startswith('\x00')) else _key_name(ev.get('code', ''))
            return f'{stamp}press {label}'
        if etype in ('up', 'release'):
            return f'{stamp}release {_key_name(ev.get("code", ""))}'
    if device == 'mouse':
        x, y = ev.get('x'), ev.get('y')
        if etype == 'move':
            return f'{stamp}move mouse to ({x}, {y})'
        if etype == 'button_down':
            return f'{stamp}click {ev.get("button", "left")} at ({x}, {y})'
        if etype == 'button_up':
            return f'{stamp}release {ev.get("button", "left")} at ({x}, {y})'
        if etype == 'scroll':
            return f'{stamp}scroll {ev.get("dy", 0)}'
    if etype in ('recording_start', 'recording_stop', 'pause', 'resume'):
        return f'{stamp}{etype}'
    return ''


def _transcript(events, start_t: float, end_t: float,
                max_lines: int = 120) -> str:
    """Compact transcript of events in [start_t, end_t)."""
    lines = []
    last = None
    for ev in events:
        t = ev.get('t', 0)
        if t < start_t:
            continue
        if end_t is not None and t >= end_t:
            break
        if ev.get('event') == 'move' and last == 'move':
            continue  # collapse consecutive mouse moves
        line = _event_to_line(ev, include_time=True)
        if line:
            lines.append(line)
            last = ev.get('event')
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines.append('...')
    return '\n'.join(lines)


def build_from_grui_recording(recording_dir: str, instruction: str = None,
                              max_samples: int = None, seed: int = 42) -> list:
    """Convert one grui recording into Alpaca-style examples.

    When the recording has annotations (markers), each annotated segment
    becomes one example: the instruction is the annotation label (or a
    user-provided task description) and the response is the plain-language
    transcript of the input events in that segment. Without markers the
    whole recording becomes a single example.
    """
    events, markers = load_grui_events(recording_dir)
    if not events:
        raise ValueError('Recording has no input events to convert.')

    segments = []
    if markers:
        for i, marker in enumerate(markers):
            ts = marker.get('t', 0)
            end = markers[i + 1].get('t', None) if i + 1 < len(markers) else None
            if end is not None and end - ts < 0.2:
                continue  # ignore degenerate segments
            label = marker.get('label', '')
            segments.append((ts, end, label or 'the demonstrated task'))
    else:
        segments.append((events[0].get('t', 0), None, 'the demonstrated task'))

    examples = []
    for start_t, end_t, label in segments:
        transcript = _transcript(events, start_t, end_t)
        if not transcript:
            continue
        if instruction:
            task = instruction.format(label=label, segment=label) \
                if '{' in instruction and '}' in instruction else \
                f'{instruction} — {label}'.strip(' —')
        else:
            task = f'Demonstrate: {label}'
        examples.append({
            'instruction': task,
            'input': '',
            'output': transcript,
        })
    if max_samples:
        examples = examples[:max_samples]
    return examples


# ── Output ───────────────────────────────────────────────────────────────────

def examples_to_records(examples: list, fmt: str) -> list:
    """Convert Alpaca example dicts into the requested output format."""
    if fmt == 'trl':
        records = []
        for ex in examples:
            prompt = ex['instruction']
            if ex.get('input'):
                prompt = f"{prompt}\n\nContext:\n{ex['input']}"
            records.append({'prompt': prompt, 'completion': ex['output']})
        return records
    return list(examples)  # 'alpaca' is the canonical shape


def write_jsonl(path, records: list) -> int:
    """Write records as JSONL. Returns the number of lines written."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            count += 1
    return count


# ── CLI (sanity-check helper) ───────────────────────────────────────────────

def _cli():
    import argparse
    import sys
    p = argparse.ArgumentParser(description='mama data converters sanity check')
    p.add_argument('source', choices=['csv', 'text', 'grui'])
    p.add_argument('input')
    p.add_argument('--out', default=None)
    p.add_argument('--instruction-col', default='instruction')
    p.add_argument('--response-col', default='response')
    p.add_argument('--format', default='alpaca', choices=['alpaca', 'trl'])
    args = p.parse_args()
    if args.source == 'csv':
        table = read_table(args.input, limit=5)
        print(json.dumps(table, indent=2))
        examples = build_from_table(args.input, args.instruction_col, args.response_col)
    elif args.source == 'text':
        examples = build_from_text(Path(args.input).read_text('utf-8'))
    else:
        examples = build_from_grui_recording(args.input)
    print(f'{len(examples)} examples built')
    if examples:
        print(json.dumps(examples[0], indent=2, ensure_ascii=False))
    if args.out:
        print(write_jsonl(args.out, examples_to_records(examples, args.format)), 'lines written')
    sys.exit(0 if examples else 1)


if __name__ == '__main__':
    _cli()