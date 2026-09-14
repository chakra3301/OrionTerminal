# Reconstruction subsystem provenance

This subsystem contains modified adaptations of **img2threejs** by hoainho
(https://github.com/hoainho/img2threejs), copyright 2026 hoainho, licensed under
Apache-2.0. The license is retained in
`../../../../THIRD_PARTY_LICENSES/img2threejs-Apache-2.0.txt` from this directory.
See the repository-root `THIRD_PARTY_NOTICES.md` for inspected license revisions.
Upstream previously used MIT before relicensing to Apache-2.0; its historical
MIT notice is also retained at
`../../../../THIRD_PARTY_LICENSES/img2threejs-historical-MIT.txt`. Neither license
inspection reconstructs the exact original port revision.

The port changes Python/file-oriented validation, scoring, and pass orchestration
into TypeScript and connects it to Orion's live stores, Three.js construction,
reference capture, and native agent transport. Source headers identify upstream
files for validation, detail inventory, camera/de-lighting, geometry, projection,
Divine Eye/objectness, review policy, and correction loops.

This is a source attribution notice, not a claim that all implementation files
were copied verbatim or that the exact original upstream revision has been
reconstructed. On 2026-09-13, the 27 upstream files referenced by 21 local port
headers were inspected at the recorded Apache baseline; no additional file-specific
license notices were found. Both known historical MIT and Apache grants are
retained. This is a bounded attribution review, not proof of the original
file-for-file input. Orion-specific UI and integration code are covered by the
repository's Apache-2.0 license.
