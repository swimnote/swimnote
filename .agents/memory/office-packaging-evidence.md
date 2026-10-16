---
name: OFFICE packaging evidence
description: Electron metadata normalization and the boundary between source, installer and Windows acceptance evidence
---

Electron Packager 20.3.0 removes the build-only `private` property from the staged package.json. Use a staged runtime manifest without that property when enforcing byte-for-byte ASAR equality; do not weaken the executable/renderer file allowlist or bypass unexpected metadata differences.

**Why:** Strict Stage 2 payload verification stopped before installer compilation because the packager removed only this property. Application compilation and application-file hashes were not the failure.

**How to apply:** Treat pre-installer packaging/check failures separately from actual installer invocations. Preserve failed and previously delivered output directories, use a newly frozen identity when source changes, and never represent a successful Linux extraction/hash check as Windows UI acceptance.
