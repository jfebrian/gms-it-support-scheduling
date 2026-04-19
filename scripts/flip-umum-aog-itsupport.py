#!/usr/bin/env python3
"""
One-shot data migration: set requiresItSupport = true for every "Umum" and
"AOG" weekly service across all churches in data/churches.yaml.

Rationale (Joanda, 2026-04-19): these services can always use IT Support in
principle — whether a shift actually gets assigned depends on whether the
church livestreams. The flag now means "could use IT support" rather than
"must have it". EK children's ministries stay requiresItSupport: false.

Detection rule (narrow by intent, not by free-form name):
  - id prefix `umum` → Umum services
  - id prefix `aog`  → AOG services

All other services (ek-*, etc.) are left alone.

Preserves the existing churches.yaml formatting via ruamel.yaml round-trip.
"""
from pathlib import Path
from ruamel.yaml import YAML

DATA_PATH = Path(__file__).resolve().parent.parent / 'data' / 'churches.yaml'


def main() -> int:
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.indent(mapping=2, sequence=4, offset=2)
    yaml.width = 4096  # don't wrap lines

    with DATA_PATH.open('r', encoding='utf-8') as f:
        data = yaml.load(f)

    flipped = 0
    for church in data:
        for svc in church.get('weeklyServices', []) or []:
            sid = str(svc.get('id', ''))
            if not (sid == 'aog' or sid.startswith('umum') or sid.startswith('aog-')):
                continue
            if svc.get('requiresItSupport') is True:
                continue
            svc['requiresItSupport'] = True
            flipped += 1
            print(f"  flipped: {church['id']} / {sid}")

    if flipped == 0:
        print('No changes needed.')
        return 0

    # ruamel.yaml always indents top-level block sequences by the offset amount,
    # which shifts every line by +2 spaces vs. the project's existing style. The
    # cleanest fix is to dump to a string and strip 2 leading spaces from each
    # non-empty line (every line in this file has at least that much, so the
    # relative shape is preserved).
    from io import StringIO
    buf = StringIO()
    yaml.dump(data, buf)
    raw = buf.getvalue()
    fixed_lines = []
    for line in raw.splitlines(keepends=True):
        if line.startswith('  '):
            fixed_lines.append(line[2:])
        else:
            fixed_lines.append(line)
    with DATA_PATH.open('w', encoding='utf-8') as f:
        f.write(''.join(fixed_lines))

    print(f'\nFlipped {flipped} service(s) to requiresItSupport: true.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
