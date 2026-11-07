# Client-template GIA order and index calibration

Parent: [Studio](../README.md#专题树).

Authoring lists real siblings foreground-first. Native GIA lists them background-first. Keep the independent template list in its original order; it is not a single paint stack.

Device evidence is the user's acceptance of one nested WOO template with background-first wire siblings and matching accessory DFS. Full-workspace records: `probes/client-template-order-guid-20261012/`. This report has no new screenshot or native reexport and does not validate arbitrary GUID ranges, every widget type or full-game runtime.

## Codec behavior

- Client export visits each template's descendants using reversed siblings, so accessories follow the same DFS as wire children. It reverses each unit's `children` and corresponding `relatedIds` without mutating the authoring tree. Both standalone and combined exports use this path.
- Client import registers legacy/missing `Info.index` identities in the original wire-tree order, then reverses actual control siblings for display. This preserves the device-verified old index repair while correcting paint order. The synthetic template holder is never reversed.
- Existing Authoring JSON already stores editor order and is not migrated. Importing an old incorrectly exported GIA now reflects its actual native direction; no filename-based heuristic silently flips an unknown source.
- Runtime dynamic insertion, Lua sibling indices and the server-container codec are unchanged.

<a id="relationship-to-7d20283106ecb6b624af78c325d34bfe8440610f"></a>
## Asset registration is independent

Persistent `Info.index` identifies assets, not paint order or control GUIDs. `test/gia-asset-indices.test.mjs` verifies that wire reordering retains per-node asset numbers and accepted legacy mappings. Do not reinterpret asset registration as layering.

## Regression evidence

`test/gia-client-order.test.mjs` constructs independent synthetic wire bytes with explicit nested sibling order. It checks known editor/wire order, template-list order, accessory DFS and no authoring mutation. A symmetric import/export roundtrip alone cannot prove the native direction.

These checks verify simulator behavior, separately from the single-template device report.

<a id="imported-index-calibration-2026-10-12-follow-up"></a>
## Imported index calibration

The accepted full WOO package supplied five client GUIDs consistent with native preorder: root, recursively visit bottom-first wire children, then the next independent template. A constant offset across all nodes does not fit. This is provided device evidence for one unchanged import batch, not an official guarantee for partial imports, deduplicated assets or edited hierarchies; original identities remain in the probe record above.

`gia/client-order.js` shares that traversal between export and opt-in `setControlGuid({id, guid, autoFillClientGuids: true})`. The latter applies only to the client-template asset, validates the complete interval and outside collisions before mutation, preserves internal IDs and script mounts, and updates explicit references simultaneously. A batch ID marks simultaneous mappings in the pending Lua ledger. Server and script GUIDs are separate; image asset IDs and Info.index never follow this numbering. Regression: `test/control-guid-autofill.test.mjs` covers nested anchors, multiple roots, overlapping permutations, references, unchanged anchors, range/collision rejection and persistence.
