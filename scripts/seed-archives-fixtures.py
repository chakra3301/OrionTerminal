#!/usr/bin/env python3
"""Seed a throwaway Archives 47 library with fixture notes for demos and screenshots.

    python3 -I scripts/seed-archives-fixtures.py "<path to archives.db>"

Refuses any file not named archives.db inside a *.archives47.dev directory, so
it can never touch a real library (Orion's or the installed Archives 47's).
Run the dev app once first so the migrations have created the tables.
"""
import json
import sqlite3
import sys
import time
import uuid
from pathlib import Path


def blocks(paragraphs):
    out = []
    for p in paragraphs:
        kind, level = "paragraph", None
        if p.startswith("## "):
            kind, level, p = "heading", 2, p[3:]
        props = {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}
        if level:
            props["level"] = level
        out.append({
            "id": uuid.uuid4().hex,
            "type": kind,
            "props": props,
            "content": [{"type": "text", "text": p, "styles": {}}],
            "children": [],
        })
    return json.dumps(out)


DAY = 86_400_000
NOW = int(time.time() * 1000)

NOTES = [
    ("note", "Field notes: tide pools", ["## Low tide, north cove", "Anemones closed by noon. Hermit crabs trading shells near the flat rock.", "Bring the waterproof notebook next time."], 1),
    ("note", "Reading list", ["The Overstory", "A Pattern Language", "The Mushroom at the End of the World"], 3),
    ("note", "Kitchen experiments", ["## Miso caramel", "Equal parts white miso and brown butter; fold into the caramel off heat.", "Too salty with flaky salt on top. Skip it."], 6),
    ("note", "Synth patch: glass bells", ["FM, ratio 3.5, short decay, a little chorus.", "Sounds best two octaves up."], 9),
    ("journal", "Thursday", ["Walked the long way home along the canal. Fog sat on the water all afternoon.", "Finished the tide-pool sketches."], 0),
    ("journal", "Wednesday", ["Quiet day. Repotted the fern and reorganised the shelf of field guides."], 1),
    ("journal", "Monday", ["Started the week with a cold swim. Worth it."], 3),
    ("project", "Garden plan 2027", ["## Beds", "Three raised beds along the south fence; herbs nearest the door.", "## Timeline", "Order seeds in January, start tomatoes indoors in March."], 2),
]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    db = Path(sys.argv[1]).expanduser().resolve()
    if db.name != "archives.db" or not db.parent.name.endswith(".archives47.dev"):
        sys.exit(f"refusing: {db} is not a dev Archives 47 library")
    conn = sqlite3.connect(db)
    try:
        if conn.execute("SELECT count(*) FROM notes").fetchone()[0]:
            sys.exit("refusing: library already has notes")
        for kind, title, paras, days_ago in NOTES:
            ts = NOW - days_ago * DAY
            conn.execute(
                "INSERT INTO notes (id, title, blocks_json, plaintext, parent_id, kind, location, collection_id, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)",
                (str(uuid.uuid4()), title, blocks(paras), "\n".join(p.lstrip("# ") for p in paras), kind,
                 "Harbour Rd" if kind == "journal" else "", ts, ts),
            )
        conn.commit()
        print(f"seeded {len(NOTES)} fixture notes into {db}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
