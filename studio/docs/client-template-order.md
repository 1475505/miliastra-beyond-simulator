# Client-template GIA sibling direction (2026-10-12)

Authoring lists real siblings foreground-first. Native GIA lists them background-first. Keep the independent template list in its original order; it is not a single paint stack.

The device comparison used one nested WOO template (11 containers, 236 images). Changing only its GUIDs restored the selected inspector, but the UI tree showed the last wire child first and dark base shapes covered the face. Reversing each parent's `children` and `relatedIds`, with matching accessory DFS order, was subsequently accepted by the user. The accepted patch SHA256 is `a3f11438b75f2018d62209cbf7fae90f952c9eaa79f629cb861040bfe9813173`. Latest acceptance is a user report, not a new screenshot or native reexport. This does not validate arbitrary GUID ranges, every widget type or full-game runtime.

## Codec behavior

- Client export visits each template's descendants using reversed siblings, so accessories follow the same DFS as wire children. It reverses each unit's `children` and corresponding `relatedIds` without mutating the authoring tree. Both standalone and combined exports use this path.
- Client import registers legacy/missing `Info.index` identities in the original wire-tree order, then reverses actual control siblings for display. This preserves the device-verified old index repair while correcting paint order. The synthetic template holder is never reversed.
- Existing Authoring JSON already stores editor order and is not migrated. Importing an old incorrectly exported GIA now reflects its actual native direction; no filename-based heuristic silently flips an unknown source.
- Runtime dynamic insertion, Lua sibling indices and the server-container codec are unchanged.

## Relationship to `7d20283106ecb6b624af78c325d34bfe8440610f`

That commit replaces reused control-kind constants with persistent `Info.index` asset registration, and validates duplicate independent template indices. It also changes the default export game version. It does not change client sibling direction or the GUID allocator. Its parent already contains the forward client export/import paths; the earliest available repository commit `df5e003` contains them too. The current layer defect is not introduced by `7d20283`.

`test/gia-asset-indices.test.mjs` still verifies the accepted legacy mapping: extra roots 13/14/15 and the same original child GUIDs mapped to 16–29. Its new-asset test expects bottom-first wire DFS but retains the same per-node asset numbers. Fixing paint order must not reinterpret asset registration as layering.

## Regression evidence

`test/gia-client-order.test.mjs` constructs independent synthetic wire bytes with explicit nested sibling order. It checks import against known editor order, standalone/combined export against known wire order, preservation of template-list order, accessory DFS and no authoring tree mutation. Before the fix, directional tests failed while an import/export roundtrip passed; roundtrip symmetry alone is insufficient.

Local validation: 22 focused tests pass; full `pnpm test` passes 336 tests with 9 environment skips, zero failures. `pnpm install --frozen-lockfile` and `pnpm build` also complete. These are simulator checks, distinct from the prior single-template device acceptance. New builds must be loaded by restarting existing Web/MCP/DSH hosts.

## Imported index calibration (2026-10-12 follow-up)

The user subsequently accepted the full WOO package and supplied five client GUIDs. A constant delta fits three template roots but fails for two descendants. Native preorder (root, then recursively visit bottom-first wire children, then the next independent template) fits all five: corolla 1073743766; sleeping corolla 1073744047; its scarf at offset 252 = 1073744299; its last image at offset 292 = 1073744339; next sprout 1073744340. The corolla and sleeping corolla contain 281 and 293 nodes respectively. This is provided device evidence for one unchanged import batch, not an official guarantee for partial imports, deduplicated assets or subsequently edited hierarchies.

`gia/client-order.js` now shares that traversal between export and opt-in `setControlGuid({id, guid, autoFillClientGuids: true})`. The latter applies only to the client-template asset, validates the complete interval and outside collisions before mutation, preserves internal IDs and script mounts, and updates explicit references simultaneously. A batch ID marks simultaneous mappings in the pending Lua ledger. Server and script GUIDs are separate; image asset IDs and Info.index never follow this numbering. Tests cover nested anchors, multiple roots, overlapping permutations, references, unchanged anchors, range/collision rejection and persistence. One-time Edge acceptance covered the checkbox, interval preview, submit and saved reload; the browser script was removed after the 2026-10-12 release check passed.
