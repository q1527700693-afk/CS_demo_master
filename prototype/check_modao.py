from html.parser import HTMLParser
from pathlib import Path

pages = Path(__file__).resolve().parent / 'modao_pages'
files = sorted(pages.glob('*.html'))

class Audit(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links=[]
        self.buttons=[]
    def handle_starttag(self, tag, attrs):
        values=dict(attrs)
        if tag=='a': self.links.append(values.get('href'))
        if tag=='button': self.buttons.append(values)

assert len(files)==34, len(files)
for file in files:
    text=file.read_text(encoding='utf-8')
    assert '<main class="content">' in text and '<style>' in text, file.name
    assert '<script' not in text and '<button' not in text and ' hidden' not in text, file.name
    audit=Audit(); audit.feed(text)
    for target in audit.links:
        assert target and (pages/target).is_file(), (file.name,target)

report={x.stem for x in files if x.stem.startswith('report-')}
assert report=={'report-overview','report-rounds','report-utility','report-data','report-map'}
print(f'Checked {len(files)} visible state canvases; all links resolve, no script buttons')
