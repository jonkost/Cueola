#!/usr/bin/env python3
"""Content-hash cache busting — a python fallback for scripts/bump-cache.mjs.

Same job, same output, for machines without node on PATH:
every versioned asset gets `?v=<first 10 hex of its SHA-256>` and every reference
in the HTML pages (and sw.js) is rewritten in one shot. The service worker derives
its cache name from these `?v=` values, so this doubles as its invalidation switch.

Run before shipping, whenever any versioned asset changed:

    python3 scripts/bump_cache.py         # rewrite pages in place
    python3 scripts/bump_cache.py --dry   # show what would change

ASSETS and PAGES are parsed straight out of bump-cache.mjs, so the two scripts can
never disagree about what is versioned — add new files there, in one place only.

Zero dependencies. Idempotent: unchanged files produce unchanged pages.
"""
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MJS = os.path.join(ROOT, 'scripts', 'bump-cache.mjs')


def parse_list(src, name):
    """Pull an exported string array out of bump-cache.mjs."""
    m = re.search(r'export const ' + name + r' = \[(.*?)\];', src, re.S)
    if not m:
        sys.exit('bump_cache.py: could not parse %s from %s' % (name, MJS))
    body = re.sub(r'//[^\n]*', '', m.group(1))  # drop comments
    return re.findall(r"'([^']+)'", body)


def main():
    dry = '--dry' in sys.argv
    try:
        src = open(MJS, encoding='utf-8').read()
    except OSError:
        sys.exit('bump_cache.py: cannot read %s' % MJS)

    assets = parse_list(src, 'ASSETS')
    pages = parse_list(src, 'PAGES')

    versions = {}
    for asset in assets:
        path = os.path.join(ROOT, asset)
        if not os.path.exists(path):
            print('  MISSING (skipped)  %s' % asset)
            continue
        text = open(path, encoding='utf-8').read()
        versions[asset] = hashlib.sha256(text.encode('utf-8')).hexdigest()[:10]
        print('  %s  %s' % (versions[asset], asset))

    total = 0
    for page in pages:
        page_path = os.path.join(ROOT, page)
        if not os.path.exists(page_path):
            continue
        text = original = open(page_path, encoding='utf-8').read()
        changes = []
        for asset, digest in versions.items():
            pattern = re.compile(r'(["\'(])((?:\.\./)*' + re.escape(asset) + r')\?v=([\w.-]+)')

            def replace(match, digest=digest, asset=asset):
                if match.group(3) != digest:
                    changes.append((asset, match.group(3), digest))
                return '%s%s?v=%s' % (match.group(1), match.group(2), digest)

            text = pattern.sub(replace, text)
        for asset, old, new in changes:
            total += 1
            print('  %s: %s ?v=%s -> ?v=%s' % (page, asset, old, new))
        if text != original and not dry:
            open(page_path, 'w', encoding='utf-8').write(text)

    # Versioned refs a page carries that are NOT registered in ASSETS. These stop
    # getting bumped and go stale in caches forever — exactly how the KeyWi Bird
    # modules silently shipped an old build for weeks.
    versioned_ref = re.compile(r'''["'(]([\w./-]+\.(?:js|css))\?v=([\w.-]+)''')
    unmanaged = set()
    for page in pages:
        page_path = os.path.join(ROOT, page)
        if not os.path.exists(page_path):
            continue
        for match in versioned_ref.finditer(open(page_path, encoding='utf-8').read()):
            normalized = re.sub(r'^(?:\.\./)+', '', match.group(1))
            if normalized not in assets:
                unmanaged.add(match.group(1))
    if unmanaged:
        print('  WARNING: versioned refs not managed by this script: %s' % ', '.join(sorted(unmanaged)))
        print('  Add them to ASSETS in scripts/bump-cache.mjs so they keep getting bumped.')

    if total:
        print('%s %d reference%s.' % ('Would rewrite' if dry else 'Rewrote', total, '' if total == 1 else 's'))
    else:
        print('All references already current.')


if __name__ == '__main__':
    main()
