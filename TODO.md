# TODO

Notes from porting `NehubaLayout` (`src/nehuba/nehuba_layout.ts`) from the old nehuba
(`../nehuba/src/nehuba/internal/nehuba_layout.ts`) to the new neuroglancer upstream
(`../neuroglancer-master`). `tsc --noEmit` passes as of 2026-07-03.

## Remaining work

- [ ] **Port `NehubaPerspectivePanel`.** Not transplanted yet, so the
  `layout.useNehubaPerspective` branch in `NehubaLayout` falls back to plain
  `PerspectivePanel`. Consequences until ported:
  - `planarSlices` handling is commented out (removal of cross-section slices from the
    3D view, "Slices" checkbox behavior).
  - The `slicesNavigationState` passed in `perspectiveViewerState` is currently unused.
- [ ] **`fixedZoomPerspectiveSlices` viewport sizing.** `SliceView.setViewportSize()` no
  longer exists upstream — viewport size is now driven by the panel via
  `projectionParameters`. The sizing call in `NehubaLayout` is commented out; find the
  new mechanism (likely a `DerivedProjectionParameters` override or a lightweight
  offscreen panel).
- [ ] **Custom zoom in `makeSliceViewNhb`.** The `customZoom` parameter is accepted but
  ignored, because it now delegates to upstream `makeSliceView`, which doesn't take a
  zoom. The old implementation used `TrackableCrossSectionZoom`; re-add if
  `fixedZoomPerspectiveSlices` is revived.
- [ ] **`useOldScaleBar` is a no-op passthrough.** The old HTML `ScaleBarWidget` from
  `nehuba/internal/rescued/old_scale_bar` was not ported. If it stays a no-op, un-fix
  `showScaleBar` in `sliceViewerState` (see FIXME there) and drop the function.
- [ ] **`getNumberOfMissingChunks` is stubbed (returns 0).** So `sliceRenderEvent`
  details always report 0 missing chunks. Original implementation was already
  commented out; upstream now has native chunk statistics that could be used instead.
- [ ] **`getCommonPerspectiveViewerState` / `getCommonSliceViewerState`** are still
  copy-pasted from upstream `data_panel_layout.ts` because upstream doesn't export
  them. Must be kept in sync manually with upstream changes (or submit a PR to export
  them).
- [ ] **Upstream typings gap:** the neuroglancer build in `../neuroglancer-master/lib`
  does not emit `sliceview/frontend.d.ts`, so `SliceView` cannot be imported as a type;
  `nehuba_layout.ts` derives it via `ReturnType<typeof makeSliceView>`. Investigate why
  declaration emit skips that file (or fix upstream) and switch back to a normal import.

## Done

- [x] Imports in `nehuba_layout.ts` adapted to `neuroglancer/unstable/*.js` paths,
  with `import type` for type-only imports (`isolatedModules`).
- [x] Restored same-file helpers dropped in the transplant: `getCommon*ViewerState`,
  `layoutEventType`/`LayoutEventDetail`, `sliceRenderEventType`/`SliceRenderEventDetail`,
  `disableFixedPointInZoom`, `dispatchRenderEvents`, `makeFixedZoomSlicesFromSlices`,
  `useOldScaleBar`, `getNumberOfMissingChunks`.
- [x] `dataToOffsetPixels` adapted to read `viewMatrix`/`width`/`height` from
  `sliceView.projectionParameters.value` (fields moved off `SliceView` upstream).
- [x] `makeSliceViewNhb` tags slices with the `sliceQuat` symbol so
  `makeFixedZoomSlicesFromSlices` still works.
- [x] `config.ts` import fixed: `nehuba/exports` → `neuroglancer/unstable/util/geom.js`.
