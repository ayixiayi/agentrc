#!/usr/bin/env python3
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

STRICT_PATTERNS = [
    ('GitHub classic token', re.compile(r'gh[opsu]_[A-Za-z0-9_]{20,}')),
    ('GitHub fine-grained token', re.compile(r'github_pat_[A-Za-z0-9_]{40,}')),
    ('OpenAI style key', re.compile(r'\bsk-[A-Za-z0-9_-]{32,}\b')),
    ('Telegram bot token', re.compile(r'\b\d{6,}:[A-Za-z0-9_-]{30,}\b')),
    ('Google OAuth secret', re.compile(r'\bGOCSPX-[A-Za-z0-9_-]{20,}\b')),
    ('Private key', re.compile(r'-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----')),
    ('Bearer token literal', re.compile(r'Bearer\s+(?!__SET_LOCALLY__)[A-Za-z0-9._~+/=-]{24,}')),
]

SKIP_DIRS = {'.git', 'node_modules', '.venv', '__pycache__'}
FORBIDDEN_RAW_FILENAMES = {'settings.json', 'telegram.json'}


def is_forbidden_raw_config(path: Path) -> bool:
    return path.name in FORBIDDEN_RAW_FILENAMES


def git_tracked_files(root: Path):
    if not (root / '.git').exists():
        return []
    proc = subprocess.run(
        ['git', '-C', str(root), 'ls-files', '-z'],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if proc.returncode != 0:
        return []
    return [Path(item.decode()) for item in proc.stdout.split(b'\0') if item]


def iter_paths(root: Path):
    for path in root.rglob('*'):
        rel = path.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        yield path


def iter_files(root: Path):
    for path in iter_paths(root):
        if path.is_symlink():
            continue
        if path.is_file():
            yield path


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    symlinks = [path.relative_to(root) for path in iter_paths(root) if path.is_symlink()]
    if symlinks:
        print('Secret guard blocked sync. Symlinks are not allowed in the sync repo:')
        for rel in symlinks[:50]:
            print(f'- {rel}')
        if len(symlinks) > 50:
            print(f'... {len(symlinks) - 50} more')
        return 1

    forbidden = []
    for rel in git_tracked_files(root):
        if is_forbidden_raw_config(rel):
            forbidden.append((rel, 'tracked by git'))
    for path in iter_files(root):
        rel = path.relative_to(root)
        if is_forbidden_raw_config(rel):
            forbidden.append((rel, 'present in repository tree'))
    if forbidden:
        print('Secret guard blocked sync. Raw local config files must not be stored in this repo:')
        seen = set()
        for rel, reason in forbidden:
            key = (rel.as_posix(), reason)
            if key in seen:
                continue
            seen.add(key)
            print(f'- {rel}: {reason}')
        print('Allowed examples/templates: amp/settings.template.json and amp/telegram.json.example')
        return 1

    findings = []
    for path in iter_files(root):
        try:
            text = path.read_text(errors='ignore')
        except Exception:
            continue
        for label, pattern in STRICT_PATTERNS:
            for match in pattern.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                findings.append((path.relative_to(root), line, label))
    if findings:
        print('Secret guard blocked sync. Findings:')
        for rel, line, label in findings[:50]:
            print(f'- {rel}:{line}: {label}')
        if len(findings) > 50:
            print(f'... {len(findings) - 50} more')
        return 1
    print('secret guard: ok')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
