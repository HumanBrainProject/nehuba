# Perspective Panel Assessment

Assessment of `src/nehuba/nehuba_perspective_panels.ts` against the current
neuroglancer commit (`../neuroglancer-master`, linked via
`"neuroglancer": "file:../neuroglancer-master"`, v2.41.2).

The file forks `PerspectivePanel` from
`neuroglancer-master/src/perspective_view/panel.ts`. The previous version was
based on a much older upstream and was updated to match the current commit.

## Import paths

- All `neuroglancer/*` imports → `neuroglancer/unstable/*.js` (the package export
  map maps `./unstable/*` → `./lib/*`), matching the convention already used in
  `nehuba_layout.ts` and `nehuba_mesh_layer.ts`.
- `nehuba/...` alias imports → relative paths (`./config`, `./nehuba_layout`,
  etc.). There is no `nehuba/*` path alias configured in `tsconfig.json` or
  `vite.config.ts`.
- `SliceView`: `lib/sliceview/frontend.d.ts` is not emitted in the neuroglancer
  build, so the type is derived via `type SliceView = ReturnType<typeof
  makeSliceView>` (same workaround as `nehuba_layout.ts`).

## API updates

- **Projection matrices.** The old `this.viewProjectionMat` /
  `this.viewProjectionMatInverse` members and the `updateProjectionMatrix()`
  override point are gone. They now live in `this.projectionParameters.value`
  (a `DerivedProjectionParameters`). The `centerToOrigin` nehuba tweak was moved
  into a `getRenderProjectionParameters()` helper that derives an adjusted
  per-frame copy, since there is no longer a mutable member to override.
- **Viewport.** `this.width` / `this.height` → `this.renderViewport`;
  `setGLViewport()` → `setGLClippedViewport()`.
- **RenderContext.** Rebuilt to the new `PerspectiveViewRenderContext` shape
  (`projectionParameters`, `wireFrame`, `bindFramebuffer`, `frameNumber`,
  `sliceViewsPresent`, `isContinuousCameraMotionInProgress`,
  `force3DHistogramForAutoRange`). The removed fields (`viewProjectionMat`,
  `viewportWidth`, `viewportHeight`, `displayDimensions`, `globalPosition`) were
  dropped. The nehuba `extra: ExtraRenderContext` payload is preserved.
- **`drawWithPicking`.** Rebased onto the new upstream algorithm — stencil-based
  pick priority and the full volume-rendering / max-projection / OIT transparent
  passes — while preserving all nehuba hooks (see below).
- **`drawSliceViews`.** Slice geometry is now read from
  `sliceView.projectionParameters.value` (`width`, `height`, `invViewMatrix`,
  `viewportNormalInCanonicalCoordinates`) instead of the removed direct
  properties. `viewProjectionMat` is sourced from
  `renderContext.projectionParameters`.
- **Scale bar.** `scaleBars.draw(...)` updated to the new signature
  (`renderViewport`, `displayDimensionRenderInfo.value`,
  `relativeDisplayScales.value`, `zoom / logicalHeight`, options).

### Preserved nehuba modifications

1. Slice preloading visibility logic (`disablePerspectiveSlicesPreloading`).
2. `planarSlices` set, updated each frame and disposed in `disposed()`.
3. `waitForMesh` gating of `drawSliceViews`, driven by
   `renderContext.extra.meshRendered`.
4. `disableAxisLinesInPerspective` config.
5. `removePerspectiveSlicesBackground` / `perspectiveSlicesBackground` via the
   custom `NehubaSliceViewRenderHelper`.
6. `hideAllSlices`, `hideSlices`, `drawSubstrates`, `drawZoomLevels` config.
7. `restrictZoomLevel` clamping in `zoomByMouse`.
8. The old HTML `ScaleBarWidget` (highdpi rationale) plus the render-complete
   `CustomEvent` (`perspectiveRenderEventType`) dispatch.

### Workaround casts

The generated neuroglancer `.d.ts` files declare several `PerspectivePanel`
members as `private` / `protected` (e.g. `transparentConfiguration`,
`maxProjectionConfiguration`, `scaleBars`, `isContinuousCameraMotionInProgress`,
`hasVolumeRendering`, and the various copy helpers). Since this class forks
`drawWithPicking`, these are accessed via bracket notation (`this['member']`) to
bypass the visibility modifiers, as was done in the previous version.

## Outstanding

The file does not yet type-check cleanly. Two nehuba-internal modules it depends
on have not been ported into this repo:

- `./nehuba_renderers` — `NehubaSliceViewRenderHelper`, `TransparentPlaneRenderHelper`
- `./rescued/old_scale_bar` — `ScaleBarWidget`

These are the only remaining errors (both `TS2307`, module-not-found) and are
prerequisites for compilation.

Two follow-ups:

1. **Duplicate `ExtraRenderContext`.** This file redefines it, but
   `nehuba_perspective_panel.ts` (singular) also exports it, and
   `nehuba_mesh_layer.ts` imports it from there. Once this file is the real
   panel, the singular stub should be deleted and the mesh layer re-pointed here.
2. **`centerToOrigin` and axis lines.** `drawAxisLines` uses
   `this.projectionParameters.value` directly (not the render context), so the
   `centerToOrigin` tweak no longer affects axis lines. Worth a visual check.
