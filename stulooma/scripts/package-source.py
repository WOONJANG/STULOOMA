#!/usr/bin/env python3
"""Package the current reviewable source, without dependencies or local secrets."""
import json
from pathlib import Path
import subprocess
import zipfile

app = Path(__file__).resolve().parent.parent
repository = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=app, text=True).strip())
version = json.loads((app / 'package.json').read_text())['version']
destination = app / 'out' / f'STULOOMA-source-{version}.zip'
destination.parent.mkdir(exist_ok=True)
files = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=repository).split(b'\0')
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for raw in sorted(set(files)):
        if not raw:
            continue
        relative = Path(raw.decode('utf-8'))
        source = repository / relative
        if source.is_symlink():
            raise RuntimeError(f'Source archive refuses symbolic link: {relative}')
        if source.is_file():
            archive.write(source, Path(f'STULOOMA-source-{version}') / relative)
with zipfile.ZipFile(destination) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('Source ZIP integrity check failed')
print(destination)
