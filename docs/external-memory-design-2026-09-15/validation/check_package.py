"""Structural delivery checks and portable archive creation."""
import hashlib
import json
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
projects = json.loads((ROOT / 'research/projects.json').read_text(encoding='utf-8-sig'))
paper_index = json.loads((ROOT / 'research/papers.json').read_text(encoding='utf-8-sig'))
papers = paper_index['papers']
assert len({p['id'] for p in projects}) == len(projects)
assert len({p['id'] for p in papers}) == len(papers)
assert paper_index['counts']['papers'] == len(papers)
assert sum(p['read_depth'] == 'focused_full_text' for p in papers) == paper_index['counts']['focused_full_text']

broken = []
local_checked = 0
for file in ROOT.rglob('*.md'):
    if '.qa' in file.parts:
        continue
    text = file.read_text(encoding='utf-8-sig')
    assert not re.search(r'cite|turn\d+(?:search|view)\d+', text), str(file)
    for match in re.finditer(r'(?<!!)\[[^\]]*\]\(([^\n]*?)\)', text):
        target = match.group(1).strip().strip('<>')
        if re.match(r'^(?:https?://|mailto:|#)', target):
            continue
        target = unquote(target.split('#')[0])
        target = re.sub(r':\d+(?:-\d+)?$', '', target)
        if not target:
            continue
        resolved = Path(target) if re.match(r'^[A-Za-z]:[/\\]', target) else file.parent / target
        local_checked += 1
        if not resolved.exists():
            broken.append({'file': str(file.relative_to(ROOT)), 'target': target})

assert not broken, json.dumps(broken, ensure_ascii=False, indent=2)
for file in ROOT.rglob('*.json'):
    if '.qa' not in file.parts:
        json.loads(file.read_text(encoding='utf-8-sig'))
results = json.loads((ROOT / 'validation/results.json').read_text(encoding='utf-8'))
reader = json.loads((ROOT / 'validation/reader-results.json').read_text(encoding='utf-8'))
assert results['passed'] and reader['passed']

report = {'kind':'delivery_structure_check','projects':len(projects),'papers':len(papers),
          'focused_paper_sections':paper_index['counts']['focused_full_text'],
          'local_links_checked':local_checked,'broken_local_links':broken,
          'reference_tests_passed':results['tests_run'],'reader_chapters_checked':reader['chapters_checked'],
          'json_parsing':'passed','passed':True}
(ROOT / 'validation/package-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

files = [p for p in ROOT.rglob('*') if p.is_file() and '.qa' not in p.parts and '__pycache__' not in p.parts and p.name != 'manifest.json']
manifest = {'format_version':1,'checked_at':'2026-09-15','files':[
    {'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    for p in sorted(files)]}
(ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
archive = ROOT.parent / '外部项目记忆服务设计包-2026-09-15.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for file in files + [ROOT / 'manifest.json']:
        z.write(file, ROOT.name + '/' + file.relative_to(ROOT).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert len(z.namelist()) == len(files) + 1
print(json.dumps({**report,'archive':str(archive),'archive_files':len(files)+1,'archive_bytes':archive.stat().st_size},ensure_ascii=False))
