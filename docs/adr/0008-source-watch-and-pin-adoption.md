# Watch sources and adopt pins automatically

V2 will run a source watch in the site process, store source pins and candidates in the database, and adopt external prebuilt pins automatically under explicit guardrails. The supplement source is rebuilt and published automatically after its upstream commit changes, unless package metadata changed or verification failed.

## Why

V1 pins dllkids in code and the supplement source commit in a workflow file. When dllkids changed, the daily catalog refresh failed with a checksum mismatch and an operator had to edit code and redeploy. The supplement feed only rebuilt when an operator triggered it. That is not "syncing with upstream"; it is manual maintenance with a scheduled detector.

The two sources have different trust models. dllkids is an unsigned prebuilt binary feed. The supplement feed is built by this project from a reviewed recipe and signed by the project. Automating both with one policy would either leave dllkids stale or give an unsigned feed more trust than it deserves.

## Decision

### Source watch

- The site runs a source-watch scheduler every six hours. GitHub Actions remains the build executor; it is not the watcher.
- A watch records, in the database: the observed upstream identity, the active pin, the last check time, the last error, and a candidate pin when the two differ.
- The admin UI shows the active pin, the observed pin, the timestamps, a readable diff summary, and the adoption/rollback history.

### dllkids: auto-adopt, but transactionally

- A changed dllkids index is downloaded completely and parsed with `apk adbdump`. A partial or unparseable index is never adopted.
- A same-version package whose package hash changed is treated as a supply-chain anomaly. The candidate is recorded and the active pin stays unchanged until an operator resolves it.
- A valid candidate is adopted in one transaction: record the previous pin and cached index bytes, write the new pin, refresh the catalog. If the catalog refresh fails, restore the previous pin and snapshot.
- Adoption refreshes the catalog only. It does not automatically start a smoke build or a user image; the next build uses the new snapshot.
- The index bytes are cached so a rollback and an audit do not depend on the upstream still serving the old index.
- dllkids is unsigned. Adoption is trust by policy (HTTPS plus pinned history plus the anomaly checks), not cryptographic verification. The source offer must state that.

### Supplement: auto-build and auto-publish with a compliance gate

- The watch compares the registered supplement recipe's upstream commit with the build that produced the live feed.
- The six-hour site watch is authoritative; an upstream webhook is used when the upstream repository can emit one, with the scheduled watch as the fallback. A change must be detected within 24 hours and the affected feed rebuilt or published within 48 hours.
- When the commit changes, the site dispatches a supplement build with the exact `base_version` and `source_commit`; the workflow must accept both as inputs instead of hard-coding a commit.
- The build runs the feed tests, generates the signed index, and verifies the signature before publishing.
- Auto-publish is allowed only when the recipe hash, SPDX identifier, `publicAllowed` decision, and package set shape are unchanged.
- If any metadata changed, or if build/feed tests fail, the result stays in staging and the live feed remains untouched. The previous live index stays available.
- Every published supplement index is version-frozen and recorded with its source commit, index sha256, signing-key fingerprint, and build run id.

### Extension registry refs

- Extension registry entries are watched with the same scheduler. A changed source ref becomes a candidate rebuild, not an immediate publication.
- Automatic publication follows the supplement rule: only when recipe hash, SPDX, `publicAllowed`, target set and package-set shape are unchanged and the feed tests pass; otherwise the result stays in staging.
- A theme or bundle is rebuilt through the same registry path; its preview/default metadata is part of the recipe hash.

### Pin storage

- Active pins, candidate pins, cached source bytes, adoption history and rollback points live in the database.
- Configuration may seed the first pin for a fresh installation, but it is not the ongoing source of truth.
- Changing a pin is auditable: who or what adopted it, when, from which observed value, and which catalog snapshot it produced.

## Consequences

- A routine dllkids update no longer needs a code change or redeploy. A same-version hash change requires a human decision.
- A malicious or compromised unsigned dllkids index that looks structurally normal can still be adopted automatically. The same-version hash check, full-index parse, cached bytes, and rollback are the available mitigations; they do not make the feed trustworthy.
- The site now writes source-watch state and pin history. Backups must include those tables, not only the catalog.
- The build workflow needs `source_commit` as a first-class input for supplement rebuilds; the registry, not the workflow, remains the authority for what may be built.
- Source offer records the pin that the build actually used, including dllkids's lack of a signature.
