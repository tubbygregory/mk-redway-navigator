"""Check the actual upload-pages-artifact tar before permitting deployment."""
from pathlib import Path
import sys
import re
import tarfile
import hashlib

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
    for member in members:
        if member.isfile():
            name = member.name.removeprefix("./")
            uploaded = archive.extractfile(member).read()
            if hashlib.sha256(uploaded).digest() != hashlib.sha256((root / name).read_bytes()).digest():
                raise ValueError(f"Pages archive content differs from validated runtime file: {name}")
        if member.isfile() and member.name.endswith((".html", ".md", ".json")):
            content = uploaded.decode("utf-8")
            if re.search(r"used with[^.]{0,100}permission|permission[^.]{0,100}confirmed|council_geometry_permission", content, re.I):
                raise ValueError(f"Obsolete council source notice in Pages artifact: {member.name}")
print(f"PASS actual Pages archive: {len(actual)} matching runtime files and contents; no build/source inputs")
