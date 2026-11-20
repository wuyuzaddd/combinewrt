# Treat V2 as the later revision, and revise V1 where they conflict

V1 (frozen 2026-11-15) and V2 (frozen the same day, after V1) disagree in four places. The project needs one rule for resolving them, otherwise the code has two authorities and every future change re-litigates the same questions. **Decision: V2 is the later revision and wins on every conflict. Where V1 disagrees, the V1 spec is revised (annotated) rather than treated as normative, and code that still carries a V1 shape is allowed only for reading legacy records.**

## The four conflicts and their resolution

1. **dllkids pin authority.** V1: the dllkids feed is pinned by a configured `packages.adb` checksum. V2 (ADR 0008): pins live in the database (`source_pins`), adopted transactionally by the source watch; configuration may only seed a fresh installation.
   **Resolution: the database pin is authoritative; `DLLKIDS_INDEX_SHA256` is a first-install seed and must not be described as the source of truth.** `refreshActiveCatalog` already reads the DB pin first (`src/lib/catalog/refresh-active.ts:21`); the remaining work is documentation plus removing the seed's user-visible authority (env examples, V1 spec annotation).

2. **Supplement feed location.** V1 published the signed feed at a flat `.../x86_64/`. V2 (ADR 0007) publishes version-frozen paths `/supplement/<baseVersion>/<target>/`.
   **Resolution: the version-frozen path is canonical and is what new plans and docs use; the flat path remains published only as a V1 compatibility mirror and must never be configured as the default for a new deployment.** This is a documentation change; no code conflict remains after ticket 11.

3. **New build plans.** V1 had no `schemaVersion` and the V1 form emits a V1-shaped plan. V2 requires `schemaVersion: 2` for every new plan (spec “Stack and compatibility”: “the planner writes only v2 for new builds”).
   **Resolution: every new submission produces a v2 plan, including submissions from the legacy V1 form; V1 plans remain readable and are rendered read-only.** Ticket 03's “旧 V1 表单仍走 v1 plan” is superseded by this ADR. The V1 form maps to implicit V2 defaults: target `x86/64`, profile `generic`, kernel line `6.12`, variant `efi + ext4 + combined`, base preset `minimal`, visibility `private`.

4. **`ImageFormatId` (the single-image model).** V1 types plans and artifacts with `ImageFormatId = ext4-efi | squashfs-efi | rootfs-tar`. V2 deprecated it in favour of the four-dimensional `ImageVariant`.
   **Resolution: `ImageFormatId` survives only in V1 read paths (parsing/rendering legacy plans, source offers and artifact names) and in the V1 dispatch payload the workflow still accepts. No new V2 write path may take an `ImageFormatId` as its model.** New artifact naming, variant validation and dispatch go through `ImageVariant`.

## Consequences

- `docs/adr/0009` is the single pointer future agents must read before changing V1-adjacent code.
- The V1 spec gains a “V2 取代关系” header block and inline annotations at the affected sections; its normative text is not rewritten (it stays the historical record of what was built and accepted).
- Code follow-ups forced by this decision are tracked as V2 hardening tickets (legacy form → v2 plans; `ImageFormatId` demotion; dllkids seed demotion; feed-path documentation).
- Keeping a V1 code path only for reading legacy data is explicitly permitted; keeping one that *writes* new V1-shaped records is not.
- If a future conflict arises, V2 wins by default, but the new ADR must say which V1 text it supersedes.
