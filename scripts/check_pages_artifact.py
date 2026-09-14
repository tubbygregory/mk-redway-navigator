"""Check the actual upload-pages-artifact tar before permitting deployment."""
from pathlib import Path
import sys
import tarfile

root = Path(__file__).resolve().parents[1] / "dist"
expected = {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()
            and not any(part.startswith(".") for part in p.relative_to(root).parts)}
with tarfile.open(sys.argv[1]) as archive:
    members = archive.getmembers()
    if any(not (member.isfile() or member.isdir()) for member in members):
        raise ValueError("Unexpected links or special files in Pages artifact")
    actual = {member.name.removeprefix("./") for member in members if member.isfile()}
if actual != expected:
    raise ValueError(f"Pages archive differs from validated runtime files: {actual ^ expected}")
print(f"PASS actual Pages archive: {len(actual)} runtime files; no build/source inputs")
