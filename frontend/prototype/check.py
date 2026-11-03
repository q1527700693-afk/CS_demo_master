"""Check that every generated page has content and its local links resolve."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess

pages = Path(__file__).resolve().parent / "pages"

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links += [value for key, value in attrs if key == "href"]

files = sorted(pages.glob("*.html"))
assert len(files) == 10, f"Expected 10 pages, found {len(files)}"
for file in files:
    body = file.read_text(encoding="utf-8")
    assert "<main class=\"content\">" in body and "<style>" in body, file.name
    parser = Links()
    parser.feed(body)
    for target in parser.links:
        if not target.startswith("#"):
            assert (pages / target).exists(), f"{file.name} -> {target}"
    script = body.split("<script>", 1)[1].split("</script>", 1)[0]
    result = subprocess.run(["node", "--check"], input=script, text=True, capture_output=True)
    assert result.returncode == 0, f"{file.name}: {result.stderr}"
print(f"Checked {len(files)} standalone pages and all local links")
report = (pages / "report.html").read_text(encoding="utf-8")
for name in ("overview", "rounds", "utility", "data"):
    assert f'href="#{name}"' in report and f'id="{name}"' in report
assert "panels.forEach(panel=>panel.hidden=panel.id!==selected)" in report
assert "window.addEventListener('hashchange'" in report
print("Checked four report tabs and panel-switch handler")
