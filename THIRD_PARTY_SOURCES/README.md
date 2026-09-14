# Matching source for MPL-covered dependencies

Orion Terminal distributes BlockNote and selected native crates under the Mozilla Public License 2.0 as part of a larger work. Their matching, unmodified published source archives are included **with this application**, not merely offered through a future download promise.

In the macOS app, use Finder → Show Package Contents → `Contents/Resources/_up_/THIRD_PARTY_SOURCES/`. Extract `.tgz` / `.crate` archives with `tar -xf <archive>` or an archive reader. Reading/extracting source does not require running its scripts. The source remains under MPL-2.0; the full license is in the adjacent `THIRD_PARTY_LICENSES/MPL-2.0.txt`. Orion's root Apache license does not replace it.

`resources/distribution-license-manifest.json` records exact package names, versions, archive checksums and public origins. During preparation, archives were verified against Cargo.lock/npm integrity and their files compared byte-for-byte with the installed packages. BlockNote archives include its TypeScript source, not just compiled JavaScript. Native build-only MPL crates are conservatively included too. Orion integration is separate; these installed upstream files were not modified. Reprepare/review sources if that changes.

Maintainer preparation: `npm run licenses:prepare` (Python3.11+, locked Cargo packages already downloaded; limited public source/notice downloads). Normal builds validate frozen lock/manifests and included material hashes offline. Frontend graph checks also refuse new MPL package versions without a matching source archive. This is a packaging check, not a legal opinion or comprehensive third-party-rights clearance.
