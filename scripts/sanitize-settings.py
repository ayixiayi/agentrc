#!/usr/bin/env python3
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True


def sanitize(value):
    if isinstance(value, dict):
        return {key: sanitize(child) for key, child in value.items()}
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        return '__SET_LOCALLY__'
    return value


def main() -> int:
    if len(sys.argv) != 3:
        print('usage: sanitize-settings.py <input-settings.json> <output-template.json>', file=sys.stderr)
        return 2
    src = Path(sys.argv[1]).expanduser()
    dst = Path(sys.argv[2]).expanduser()
    if not src.exists():
        print(f'settings file not found: {src}', file=sys.stderr)
        return 0
    data = json.loads(src.read_text())
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(sanitize(data), ensure_ascii=False, indent=2) + '\n')
    print(f'wrote sanitized settings template: {dst}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
