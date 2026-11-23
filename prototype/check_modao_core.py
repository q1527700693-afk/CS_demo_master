from html.parser import HTMLParser
from pathlib import Path

root=Path(__file__).resolve().parent/'modao_core'
files=sorted(root.glob('*.html'))
assert len(files)==20,len(files)

class Links(HTMLParser):
    def __init__(self): super().__init__(); self.targets=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a': self.targets.append(dict(attrs).get('href'))

for file in files:
    text=file.read_text(encoding='utf-8')
    assert '<main class="content">' in text and '<script' not in text and '<button' not in text,file.name
    links=Links();links.feed(text)
    for target in links.targets:
        assert target and (root/target).exists(),(file.name,target)
for key in ('report-overview','report-rounds','report-utility','report-data','lobby-create','lobby-detail','lobby-code','upload-progress','training-result','friends-request'):
    assert (root/f'{key}.html').exists(),key
print('Checked 20 core pages, links, report tabs, and key state screens')
