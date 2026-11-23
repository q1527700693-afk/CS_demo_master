from html.parser import HTMLParser
from pathlib import Path
import subprocess

file=Path(__file__).resolve().parent/'cs-demo-master-modao-single.html'
html=file.read_text(encoding='utf-8')

class Audit(HTMLParser):
    def __init__(self): super().__init__(); self.screens=set(); self.links=[]
    def handle_starttag(self,tag,attrs):
        data=dict(attrs)
        if tag=='section' and 'screen' in data.get('class','').split(): self.screens.add(data.get('id'))
        if tag=='a': self.links.append(data.get('href'))

audit=Audit();audit.feed(html)
assert len(audit.screens)==20,audit.screens
for href in audit.links:
    assert href and href.startswith('#') and href[1:] in audit.screens,href
assert all(x in audit.screens for x in ['report-overview','report-rounds','report-utility','report-data','lobby-create','lobby-detail','lobby-code'])
script=html.split('<script>',1)[1].split('</script>',1)[0]
check=subprocess.run(['node','--check'],input=script,text=True,capture_output=True)
assert check.returncode==0,check.stderr
print(f'Checked {len(audit.screens)} screens and {len(audit.links)} internal links; JS syntax valid')
