"""Check current inline Markdown link paths and ATX heading anchors locally."""
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit


def prose(text):
    """Exclude fenced examples and inline code, not planned filenames."""
    lines, fence = [], None
    for line in text.splitlines():
        marker = re.match(r'^\s*(`{3,}|~{3,})', line)
        if marker:
            token = marker[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            continue
        if fence is None:
            lines.append(re.sub(r'(`+).*?\1', '', line))
    return '\n'.join(lines)


def anchors(text):
    result, counts = set(), {}
    for heading in re.findall(r'^ {0,3}#{1,6}\s+(.+?)\s*#*$', prose(text), re.M):
        slug = re.sub(r'[^\w\- ]', '', heading.lower()).replace(' ', '-')
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        result.add(f'{slug}-{count}' if count else slug)
    return result


def main(paths=None):
    paths = paths if paths is not None else sys.argv[1:]
    if not paths:
        paths = subprocess.check_output(
            ['git', 'ls-files', '-z', '--', '*.md']).decode().strip('\0').split('\0')
    errors = []
    for name in paths:
        path = Path(name)
        text = path.read_text(encoding='utf-8')
        for destination in re.findall(r'!?\[[^\]\n]*\]\(([^\s)]+)\)', prose(text)):
            url = urlsplit(destination)
            if url.scheme or url.netloc:
                continue
            target = path.parent / unquote(url.path) if url.path else path
            if not target.is_file():
                errors.append(f'{name}: broken link: {destination}')
            elif url.fragment and unquote(url.fragment) not in anchors(target.read_text(encoding='utf-8')):
                errors.append(f'{name}: broken anchor: {destination}')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print(f'Documentation checks passed ({len(paths)} files).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
