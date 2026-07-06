# Patches Assessment

Assessment of `src/nehuba/patches.ts` against the current neuroglancer commit
(`../neuroglancer-master`, linked via `"neuroglancer": "file:../neuroglancer-master"`, v2.41.2).

## `activateDataSubsources` (SegmentationUserLayer monkey patch)

**Status: updated, type-checks cleanly.**

The patch forks `SegmentationUserLayer.prototype.activateDataSubsources` from
`neuroglancer-master/src/layer/segmentation/index.ts` (`activateDataSubsources`, ~line 758).
The old fork was based on a much older upstream version. It was rewritten to mirror the
current upstream implementation, which added:

- Handling for `segmentPropertyMap` subsources (collected into
  `updatedSegmentPropertyMaps`, applied via `getPreprocessedSegmentPropertyMap`).
- Handling for `segmentationGraph` subsources (graph connection lifecycle,
  `graphConnection.value`, render layers from `graphConnection.createRenderLayers`).
- Handling for local-equivalences subsources (`local === LocalDataSource.equivalences`).
- The `isGroupRoot` check (`displayState.linkedSegmentationGroup.root.value === this`);
  graph/property-map subsources are deactivated on non-root linked layers.
- A `hasVolume` flag written to `displayState.hasVolume.value`.
- `loadedSubsource.activate()` now takes `displayState.segmentationGroupState.value`
  as a second argument for volume and mesh subsources.

### Preserved nehuba modifications

1. Under `enableMeshLoadingControl`, `visibleSegments` is wrapped in
   `VisibleSegmentsWrapper` before subsource activation.
2. `NehubaMeshLayer` is used in place of upstream `MeshLayer` for `MeshSource`
   subsources (marked with ⇊⇊⇊/⇈⇈⇈ comments).

### New imports

`SegmentationRenderLayer`, `SegmentPropertyMap` / `getPreprocessedSegmentPropertyMap`,
`SegmentationGraphSource`, and `LocalDataSource`, all via `neuroglancer/unstable/*`
(mapped to `lib/*` by the package export map).

### Workaround casts for defective generated d.ts

Neuroglancer's generated type declarations have two defects that required casts
(both commented in the code):

- `SegmentationUserLayer` is declared as `extends Base` with `declare const Base: any`,
  so TypeScript sees no overlap with `UserLayer`; `root.value === this` would narrow
  `this` to `never` in the `isGroupRoot` branch. Worked around with `(this as unknown)`.
- `MultiscaleSliceViewChunkSource` is emitted without its generic parameters, which
  makes `instanceof MultiscaleVolumeChunkSource` invalid (TS2359). Worked around with
  an explicit `!== undefined` check plus `as any` on the instanceof target.

## Maintenance note

This function remains a copy-paste fork of upstream and must be re-synced whenever
`activateDataSubsources` changes in neuroglancer (see the `!!! Needs attention !!!`
comment in the file).

## Outstanding

`src/nehuba/nehuba_mesh_layer.ts` still has 8 pre-existing type errors
(`defineShader`, `objectAlpha`, `ChunkManager`, `transform`, `displayDimensions`,
`renderScaleHistogram`, `visibleSegments`, `SegmentationDisplayState3D`). It also
forks upstream code (`MeshLayer` / `MeshShaderManager` internals) and needs the same
kind of update against the current commit.

---

Done — patches.ts now type-checks cleanly and matches the current neuroglancer commit.

What changed:

Rewrote activateDataSubsources to mirror the current upstream version at neuroglancer-master/src/layer/segmentation/index.ts:758. Upstream added a lot since the old fork: handling for segmentPropertyMap, segmentationGraph, and local-equivalences subsources, the isGroupRoot linked-group check, a hasVolume flag, and activate() now takes the segmentation group state as a second argument. Your two nehuba modifications are preserved: the VisibleSegmentsWrapper install under enableMeshLoadingControl, and NehubaMeshLayer in place of MeshLayer (still marked with the ⇊⇊⇊ comments).
Added imports for SegmentationRenderLayer, SegmentPropertyMap/getPreprocessedSegmentPropertyMap, SegmentationGraphSource, and LocalDataSource via the neuroglancer/unstable/* paths.
Two workaround casts for defects in neuroglancer's generated .d.ts files (commented in the code): the d.ts declares SegmentationUserLayer extends Base where Base: any, so root.value === this made TypeScript narrow this to never inside the isGroupRoot branch — fixed with (this as unknown). And MultiscaleSliceViewChunkSource is emitted without its generic parameters, which breaks instanceof MultiscaleVolumeChunkSource — fixed with an explicit !== undefined check plus an as any on the instanceof target.
One heads-up: nehuba_mesh_layer.ts still has 8 pre-existing type errors (defineShader, objectAlpha, ChunkManager, etc.) — that file also forks upstream code (MeshLayer/MeshShaderManager internals) and needs the same kind of update against the current commit. Let me know if you want me to tackle that next.