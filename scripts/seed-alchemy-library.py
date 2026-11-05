#!/usr/bin/env python3
"""Fill an Archives 47 library with an alchemy-themed demo library, for preview shots.

    python3 -I scripts/seed-alchemy-library.py "<path to archives.db>" [--replace]

Writes notes (with [[links]] between them), journal entries, projects with
sub-pages, collections, tags and a few past assistant chats. Media is left to
the owner. Refuses a library that already has notes unless --replace is given,
and --replace only removes rows this script created (ids start with "alc-").
Quit Archives 47 first so it doesn't hold stale copies in memory.
"""
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

DAY = 86_400_000
NOW = int(time.time() * 1000)
PREFIX = "alc-"

# ── Content ────────────────────────────────────────────────────────────────
# Body lines: "## " heading, "- " bullet, "> " quote, otherwise a paragraph.
# [[Title]] becomes a note link to the note with that title.

COLLECTIONS = [
    ("The Great Work", "var(--neon-yellow)"),
    ("Substances", "var(--neon-green)"),
    ("Symbols & Texts", "var(--neon-violet)"),
    ("Laboratory", "var(--neon-cyan)"),
]

NOTES = [
    # title, collection, tags, days ago, favorite, body
    ("The Magnum Opus", "The Great Work", ["opus", "stages"], 2, True, """
The Great Work is the alchemist's whole project: to perfect matter, and in doing so the self. Most texts divide it into four colours, later three.
## The stages
- [[Nigredo]], the blackening: putrefaction, dissolution, the death of the old form.
- [[Albedo]], the whitening: washing, purification, the silver light of the moon.
- [[Citrinitas]], the yellowing: the dawn, solar light breaking through.
- [[Rubedo]], the reddening: union, fixation, the stone itself.
The end of the work is the [[Philosopher's Stone]], and the method is always [[Solve et Coagula]].
> As above, so below; as within, so without.
"""),
    ("Nigredo", "The Great Work", ["opus", "stages", "black"], 4, False, """
The first stage. Matter is broken down into a black, putrefying mass, the caput mortuum or "dead head".
Psychologically it is the encounter with the shadow: confusion, melancholy, despair. Nothing new can be made until the old form has rotted.
Its bird is the raven; its planet is [[Saturn]]; its metal is [[Lead]].
## Operations
- [[Calcination]]
- [[Putrefaction]]
Follows into [[Albedo]] once the black has been washed.
"""),
    ("Albedo", "The Great Work", ["opus", "stages", "white"], 5, False, """
The whitening. The blackened matter is washed, sometimes "seven times", until it turns white.
Associated with the moon, silver and the feminine principle. The swan and the white queen appear in the images.
## Operations
- [[Distillation]]
- [[Sublimation]]
It prepares the ground for [[Citrinitas]] and, in older three-stage schemes, leads straight to [[Rubedo]].
"""),
    ("Citrinitas", "The Great Work", ["opus", "stages", "yellow"], 6, False, """
The yellowing: the solar light dawning on the lunar white. Many later writers dropped it and folded it into [[Rubedo]].
Jung read it as the moment insight becomes conscious, the "dawn" after the long night of [[Nigredo]].
"""),
    ("Rubedo", "The Great Work", ["opus", "stages", "red"], 7, True, """
The reddening and the end of the work. Opposites are fixed together: king and queen, sun and moon, [[Sulfur]] and [[Mercury]].
Its bird is the phoenix. Its product is the red [[Philosopher's Stone]], which "tinctures" base metals into gold.
See [[Coniunctio]].
"""),
    ("Philosopher's Stone", "The Great Work", ["stone", "opus"], 1, True, """
The goal of the [[The Magnum Opus]]: a substance said to turn base metals into [[Gold]] and to give long life, the elixir of life.
Descriptions disagree on almost everything: a red powder, a glass, a stone that is "not a stone". It is made from the [[Prima Materia]], which is found everywhere and valued by no one.
## Properties claimed
- Transmutation of metals
- Healing, rejuvenation
- Projection: a little stone tinctures a great weight of metal
Linked to the [[Emerald Tablet]] and the [[Ouroboros]].
"""),
    ("Prima Materia", "Substances", ["matter", "stone"], 9, False, """
The first matter: formless, chaotic, the stuff before all distinctions. Every operation starts from it.
The texts say it is cheap, common and despised, "trodden underfoot". Some identify it with [[Mercury]], some with dew, some with the soul itself.
Starting point of [[Nigredo]].
"""),
    ("Tria Prima", "Substances", ["paracelsus", "principles"], 10, False, """
Paracelsus' three principles, added to the four elements:
- [[Sulfur]]: the soul, combustibility, the fiery and fixed
- [[Mercury]]: the spirit, fluidity, the volatile
- [[Salt]]: the body, solidity, what remains
Everything is a mixture of the three in different proportions.
"""),
    ("Sulfur", "Substances", ["principles", "masculine"], 11, False, """
The masculine, hot, fixed principle. In the [[Tria Prima]] it is the soul. In images it is the king, the sun, the red lion.
Paired with [[Mercury]] in the [[Coniunctio]].
"""),
    ("Mercury", "Substances", ["principles", "feminine", "metals"], 11, False, """
Quicksilver, and the spirit of the work itself: volatile, shape-shifting, both water and metal. Mercurius is called "the duplex", male and female at once.
In the [[Tria Prima]] it is the spirit. Its planet is the planet Mercury, and Hermes Trismegistus (see [[Emerald Tablet]]) gives the art its name, the hermetic art.
"""),
    ("Salt", "Substances", ["principles"], 12, False, """
The body: what stays behind after burning. Salt fixes the volatile and gives form. Third of the [[Tria Prima]].
"""),
    ("Lead", "Substances", ["metals", "saturn"], 14, False, """
The heaviest and "basest" metal, ruled by [[Saturn]]. The usual starting point for transmutation into [[Gold]].
"""),
    ("Gold", "Substances", ["metals", "sun"], 14, False, """
The perfect metal, ruled by the sun. It does not tarnish. For many alchemists, gold was less the goal than the sign that the [[Philosopher's Stone]] had been made.
"""),
    ("Saturn", "Symbols & Texts", ["planets", "black"], 15, False, """
Planet of [[Lead]], time, melancholy and the [[Nigredo]]. Often drawn as an old man with a scythe, sometimes devouring his children.
"""),
    ("Emerald Tablet", "Symbols & Texts", ["hermetic", "texts"], 3, True, """
A short, cryptic text attributed to Hermes Trismegistus, the founding scripture of alchemy. First known in Arabic (c. 8th century), later in Latin.
> That which is below is like that which is above, and that which is above is like that which is below, to do the miracles of one only thing.
> Its father is the Sun, its mother the Moon; the wind carried it in its belly; its nurse is the Earth.
It describes the making of the [[Philosopher's Stone]] in compressed form. Newton made his own translation.
"""),
    ("Ouroboros", "Symbols & Texts", ["symbols", "cycle"], 8, False, """
The serpent eating its own tail: one is the all. It stands for the cycle of the work, matter dissolving and re-forming, [[Solve et Coagula]].
Appears in the Chrysopoeia of Cleopatra (Greek, c. 3rd century) with the words "hen to pan".
"""),
    ("Solve et Coagula", "The Great Work", ["method", "operations"], 2, False, """
"Dissolve and coagulate": the whole method in three words. Break the body down, then fix the spirit into a new body. Repeat.
Every stage of [[The Magnum Opus]] is a turn of this wheel; see [[Ouroboros]].
"""),
    ("Coniunctio", "Symbols & Texts", ["symbols", "union"], 6, False, """
The chemical wedding: the union of opposites, king and queen, [[Sulfur]] and [[Mercury]], sun and moon. Its child is the hermaphrodite, the rebis ("two-thing").
The climax of the [[Rubedo]].
"""),
    ("Calcination", "Laboratory", ["operations", "fire"], 13, False, """
Heating a substance until it turns to ash. The first operation, belonging to the [[Nigredo]]. Removes the volatile, leaves the fixed.
"""),
    ("Putrefaction", "Laboratory", ["operations", "black"], 13, False, """
Rotting in gentle, steady heat (the "horse dung" bath) until the matter blackens. The death that comes before [[Albedo]].
"""),
    ("Distillation", "Laboratory", ["operations", "water"], 12, False, """
Boiling a liquid and condensing its vapour: separating the subtle from the gross. Repeated many times ("cohobation"). See [[Alembic]].
"""),
    ("Sublimation", "Laboratory", ["operations", "air"], 12, False, """
A solid turned straight to vapour and caught again as a purer solid. The volatile rises, the fixed stays behind. An [[Albedo]] operation.
"""),
    ("Alembic", "Laboratory", ["vessels"], 16, False, """
The still-head: a cap with a spout that catches vapour from the cucurbit below and leads it off to cool. The emblem of [[Distillation]].
"""),
    ("Athanor", "Laboratory", ["vessels", "fire"], 16, False, """
The alchemist's furnace, built to hold a slow, even heat for weeks. Its name was read as "immortal", because the fire must never go out during [[The Magnum Opus]].
"""),
]

JOURNAL = [
    ("Black week", 0, "Harbour Rd", """
Started reading on the [[Nigredo]] again. Strange how the oldest texts treat rot as a beginning rather than an end.
Wrote out the first lines of the [[Emerald Tablet]] by hand. They read better slowly.
"""),
    ("The athanor metaphor", 1, "Studio", """
Kept thinking about the [[Athanor]]: a fire that must never go out for weeks. That's the part nobody puts in the pictures. Most of the work is keeping a steady low heat.
"""),
    ("Seven washings", 3, "Library", """
"Wash the black seven times." Read about [[Albedo]] in three sources and they all agree on nothing except the number.
"""),
    ("Dream: the red lion", 5, "", """
Dreamt of a red lion eating the sun. Looked it up: green lion devours the sun in the Rosarium; red lion is [[Sulfur]]. My dream mixed them up.
"""),
    ("Reading list cleared", 9, "Harbour Rd", """
Finished the Paracelsus chapter on the [[Tria Prima]]. Next: Jung, Psychology and Alchemy.
"""),
]

PROJECTS = [
    ("Mapping the Emerald Tablet", 2, """
A line-by-line commentary on the [[Emerald Tablet]], comparing the Arabic, Latin and Newton versions.
""", [
        ("Line 1: as above, so below", "The most quoted line. Compare with [[Ouroboros]] and the idea that one thing contains all."),
        ("Line 4: father Sun, mother Moon", "Sun and moon as [[Sulfur]] and [[Mercury]]; the wind and the earth as the vessel and the nurse."),
        ("Newton's translation", "Newton's version is stiffer and more literal. His notes link it straight to [[Philosopher's Stone]] recipes."),
    ]),
    ("Colours of the Work", 4, """
A visual study: one board per stage of [[The Magnum Opus]], built from manuscripts and my own photos.
""", [
        ("Black", "References for [[Nigredo]]: crows, ash, tar, burnt paper."),
        ("White", "References for [[Albedo]]: salt flats, frost, moonlight on water."),
        ("Red", "References for [[Rubedo]]: rust, dried roses, embers."),
    ]),
]

CHATS = [
    ("Why four stages became three", 1, [
        ("user", "Why do some texts list four stages of the Great Work and others only three?"),
        ("assistant", "Your notes have the answer in pieces. Medieval writers used four colours: Nigredo, Albedo, Citrinitas and Rubedo. From the 15th–16th century Citrinitas was often dropped and folded into Rubedo, so the yellowing became part of the reddening. Your note on Citrinitas also mentions Jung reading it as the dawn of insight, which is why it comes back in psychological readings."),
    ]),
    ("Prima materia: what is it?", 6, [
        ("user", "Summarise what my notes say about the prima materia."),
        ("assistant", "From \"Prima Materia\": it's the formless first matter every operation starts from. The texts call it common and despised, \"trodden underfoot\", and identify it variously with Mercury, dew or the soul. In your Magnum Opus note it's the raw stuff of the Nigredo."),
    ]),
]

# ── Block helpers ──────────────────────────────────────────────────────────
_counter = 0


def bid() -> str:
    global _counter
    _counter += 1
    return f"{PREFIX}b{_counter:05d}"


def inline(text: str, ids: dict) -> list:
    out = []
    pos = 0
    for m in re.finditer(r"\[\[([^\]]+)\]\]", text):
        if m.start() > pos:
            out.append({"type": "text", "text": text[pos:m.start()], "styles": {}})
        title = m.group(1)
        target = ids.get(title)
        if target:
            out.append({"type": "link", "href": f"orion://note/{target}",
                        "content": [{"type": "text", "text": title, "styles": {}}]})
        else:
            out.append({"type": "text", "text": title, "styles": {}})
        pos = m.end()
    if pos < len(text):
        out.append({"type": "text", "text": text[pos:], "styles": {}})
    return out


def blocks(body: str, ids: dict) -> tuple[str, str]:
    out, plain = [], []
    for raw in body.strip().splitlines():
        line = raw.strip()
        if not line:
            continue
        props = {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}
        kind = "paragraph"
        if line.startswith("## "):
            kind, line = "heading", line[3:]
            props["level"] = 2
        elif line.startswith("- "):
            kind, line = "bulletListItem", line[2:]
        elif line.startswith("> "):
            kind, line = "quote", line[2:]
        out.append({"id": bid(), "type": kind, "props": props, "content": inline(line, ids), "children": []})
        plain.append(re.sub(r"\[\[([^\]]+)\]\]", r"\1", line))
    return json.dumps(out), "\n".join(plain)


def slug(s: str) -> str:
    return PREFIX + re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40]


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    replace = "--replace" in sys.argv
    if len(args) != 1:
        sys.exit(__doc__)
    db = Path(args[0]).expanduser().resolve()
    if db.name != "archives.db" or "archives47" not in db.parent.name:
        sys.exit(f"refusing: {db} is not an Archives 47 library")
    conn = sqlite3.connect(db)
    try:
        theirs = conn.execute("SELECT count(*) FROM notes WHERE id NOT LIKE ?", (PREFIX + "%",)).fetchone()[0]
        ours = conn.execute("SELECT count(*) FROM notes WHERE id LIKE ?", (PREFIX + "%",)).fetchone()[0]
        if theirs:
            sys.exit(f"refusing: library has {theirs} notes that this script didn't create")
        if ours and not replace:
            sys.exit("library already seeded; pass --replace to rebuild it")
        for table, col in [("note_tags", "note_id"), ("notes", "id"), ("collections", "id"), ("chats", "id")]:
            conn.execute(f"DELETE FROM {table} WHERE {col} LIKE ?", (PREFIX + "%",))
        conn.execute("DELETE FROM tags WHERE id LIKE ?", (PREFIX + "%",))

        coll_ids = {}
        for i, (name, color) in enumerate(COLLECTIONS):
            cid = slug("col " + name)
            coll_ids[name] = cid
            ts = NOW - (20 - i) * DAY
            conn.execute("INSERT INTO collections (id, name, color, created_at, updated_at) VALUES (?,?,?,?,?)",
                         (cid, name, color, ts, ts))

        ids = {t: slug(t) for t, *_ in NOTES}
        for t, *_ in PROJECTS:
            ids[t] = slug("proj " + t)

        tag_ids = {}

        def tag(note_id: str, name: str) -> None:
            if name not in tag_ids:
                tag_ids[name] = slug("tag " + name)
                conn.execute("INSERT INTO tags (id, name) VALUES (?,?)", (tag_ids[name], name))
            conn.execute("INSERT INTO note_tags (note_id, tag_id) VALUES (?,?)", (note_id, tag_ids[name]))

        def insert(nid, title, body, kind, ts, parent=None, coll=None, location="", fav=False):
            bj, plain = blocks(body, ids)
            conn.execute(
                "INSERT INTO notes (id, title, blocks_json, plaintext, parent_id, kind, location, collection_id, favorite, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (nid, title, bj, plain, parent, kind, location, coll, 1 if fav else 0, ts, ts))

        for title, coll, tags, days, fav, body in NOTES:
            nid = ids[title]
            insert(nid, title, body, "note", NOW - days * DAY - 3_600_000 * (len(title) % 9), coll=coll_ids[coll], fav=fav)
            for t in tags:
                tag(nid, t)

        for title, days, loc, body in JOURNAL:
            nid = slug("journal " + title)
            insert(nid, title, body, "journal", NOW - days * DAY - 2 * 3_600_000, location=loc)
            tag(nid, "journal")

        for title, days, body, pages in PROJECTS:
            pid = ids[title]
            insert(pid, title, body, "project", NOW - days * DAY, fav=True)
            for j, (ptitle, pbody) in enumerate(pages):
                insert(slug(f"{title} {ptitle}"), ptitle, pbody, "project", NOW - days * DAY + (j + 1) * 60_000, parent=pid)

        for title, days, msgs in CHATS:
            ts = NOW - days * DAY
            messages = [{"id": f"{PREFIX}m{i}-{slug(title)}", "role": r, "content": c} for i, (r, c) in enumerate(msgs)]
            conn.execute(
                "INSERT INTO chats (id, title, messages_json, searchable_text, origin, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                (slug("chat " + title), title, json.dumps(messages), " ".join(c for _, c in msgs), "archives", ts, ts))

        conn.commit()
        counts = {t: conn.execute(f"SELECT count(*) FROM {t} WHERE id LIKE ?", (PREFIX + "%",)).fetchone()[0]
                  for t in ["notes", "collections", "chats", "tags"]}
        links = sum(len(re.findall(r"\[\[", n[5])) for n in NOTES)
        print(f"seeded {db}: {counts}, ~{links} note links")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
