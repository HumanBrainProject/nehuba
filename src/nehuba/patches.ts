import { LoadedDataSubsource } from "neuroglancer/unstable/layer/layer_data_source.js"
import { Config } from "./config"
import { NehubaLayout } from "./nehuba_layout"
import { LAYOUTS } from "neuroglancer/unstable/data_panel_layout.js"
import { SegmentationUserLayer } from "neuroglancer/unstable/layer/segmentation/index.js"
import { NehubaMeshLayer, createVisibleSegmentsWrapper, isVisibleSegmentsWrapper } from "./nehuba_mesh_layer"
import { MultiscaleVolumeChunkSource } from "neuroglancer/unstable/sliceview/volume/frontend.js"
import { DataType } from "neuroglancer/unstable/util/data_type.js"
import { MeshSource, MultiscaleMeshLayer, MultiscaleMeshSource } from "neuroglancer/unstable/mesh/frontend.js"
import { PerspectiveViewSkeletonLayer, SkeletonLayer, SliceViewPanelSkeletonLayer } from "neuroglancer/unstable/skeleton/frontend.js"
import { SegmentationRenderLayer } from "neuroglancer/unstable/sliceview/volume/segmentation_renderlayer.js"
import { SegmentPropertyMap, getPreprocessedSegmentPropertyMap } from "neuroglancer/unstable/segmentation_display_state/property_map.js"
import { SegmentationGraphSource } from "neuroglancer/unstable/segmentation_graph/source.js"
import { LocalDataSource } from "neuroglancer/unstable/datasource/local.js"

let patched: boolean = false

export function patchNeuroglancer(config: Config) {
  const conf = config.globals || {};
  //TODO allow patching multiple times with the same config
  //TODO check for config values in patches. Allows runtime toggling. But only if was on here... Or should we patch all then anyway? Not good for debug/tracing problems
  if (patched) return; //throw new Error('Monkey patches are already applied to Neuroglancer. Should call patchNeuroglancer(config) only once');
  /** Install NehubaLayout as the only layout used by neuroglancer */
  if (conf.useNehubaLayout) {
    LAYOUTS.clear();
    LAYOUTS.set('4panel', { factory: (container, element, viewer, crossSections) => new NehubaLayout(container, element, viewer, crossSections) });
    LAYOUTS.set('xy', { factory: (container, element, viewer, crossSections) => new NehubaLayout(container, element, viewer, crossSections) }); // Needed only for split views to work. 'xy' is default layout when splitting the view //TODO Actually implement other NG layouts
  }
  // if (conf.hideNullImageValues) fix_HideNullImageValues();
  // if (conf.useCustomSegmentColors) useNehubaColorsInSegmentationRenderLayer(); // !!! Depends on complementary hook in `hooks.ts`
  if (conf.useNehubaMeshLayer) useNehubaMeshInSegmentationLayer(config.enableMeshLoadingControl);

  patched = true;
}

// ****** !!! Needs attention !!! ******  Even though the change is minimal - the code is forked/copy-pasted from NG and needs to be updated if changed upstream.
function useNehubaMeshInSegmentationLayer(enableMeshLoadingControl?: boolean) {

  SegmentationUserLayer.prototype.activateDataSubsources = function (this: SegmentationUserLayer, subsources: Iterable<LoadedDataSubsource>) {
    if (enableMeshLoadingControl) {
      const segmentationGroupState = this.displayState.segmentationGroupState;
      if (!isVisibleSegmentsWrapper(segmentationGroupState.value.visibleSegments)) {
        segmentationGroupState.value.visibleSegments = createVisibleSegmentsWrapper(segmentationGroupState.value.visibleSegments);
      }
    };


    const updatedSegmentPropertyMaps: SegmentPropertyMap[] = [];
    // Cast needed: the generated d.ts declares SegmentationUserLayer as `extends Base` with `Base: any`,
    // so TS sees no overlap with UserLayer and would otherwise narrow `this` to `never`.
    const isGroupRoot = this.displayState.linkedSegmentationGroup.root.value === (this as unknown);
    let updatedGraph: SegmentationGraphSource | undefined;
    let hasVolume = false;
    for (const loadedSubsource of subsources) {
      if (this.addStaticAnnotations(loadedSubsource)) continue;
      const { volume, mesh, segmentPropertyMap, segmentationGraph, local } = loadedSubsource.subsourceEntry.subsource;
      // Cast needed: the generated d.ts omits the generic params of MultiscaleSliceViewChunkSource,
      // making MultiscaleVolumeChunkSource unusable as an instanceof target.

      if (!!volume && volume instanceof (MultiscaleVolumeChunkSource as any)) {
        switch (volume.dataType) {
          case DataType.FLOAT32:
            loadedSubsource.deactivate('Data type not compatible with segmentation layer');
            continue;
        }
        hasVolume = true;
        loadedSubsource.activate(
          () => loadedSubsource.addRenderLayer(new SegmentationRenderLayer(volume, {
            ...this.displayState,
            transform: loadedSubsource.getRenderLayerTransform(),
            renderScaleTarget: this.sliceViewRenderScaleTarget,
            renderScaleHistogram: this.sliceViewRenderScaleHistogram,
            localPosition: this.localPosition,
          })),
          this.displayState.segmentationGroupState.value
        );
        continue
      }

      if (!!mesh) {
        loadedSubsource.activate(() => {
          const displayState = {
            ...this.displayState,
            transform: loadedSubsource.getRenderLayerTransform(),
            
          };
          if (mesh instanceof MeshSource) {
            loadedSubsource.addRenderLayer(
              //⇊⇊⇊ Our change is here ⇊⇊⇊
              //  new MeshLayer(this.manager.chunkManager, mesh, displayState));
              new NehubaMeshLayer(this.manager.chunkManager, mesh, displayState));
            //⇈⇈⇈ Our change is here ⇈⇈⇈
          } else if (mesh instanceof MultiscaleMeshSource) {
            loadedSubsource.addRenderLayer(
              new MultiscaleMeshLayer(this.manager.chunkManager, mesh, displayState));
          } else {
            const base = new SkeletonLayer(this.manager.chunkManager, mesh, displayState);
            loadedSubsource.addRenderLayer(new PerspectiveViewSkeletonLayer(base.addRef()));
            loadedSubsource.addRenderLayer(
              new SliceViewPanelSkeletonLayer(/* transfer ownership */ base));
          }
        }, this.displayState.segmentationGroupState.value);
        continue
      }

      if (!!segmentPropertyMap) {
        if (!isGroupRoot) {
          loadedSubsource.deactivate('Not supported on non-root linked segmentation layers');
        } else {
          loadedSubsource.activate(() => { });
          updatedSegmentPropertyMaps.push(segmentPropertyMap);
        }
        continue
      }
      if (!!segmentationGraph) {
        if (!isGroupRoot) {
          loadedSubsource.deactivate('Not supported on non-root linked segmentation layers');
          continue
        }
        if (!!updatedGraph) {
          loadedSubsource.deactivate('Only one segmentation graph is supported');
          continue
        }
        updatedGraph = segmentationGraph;
        loadedSubsource.activate((refCounted) => {
          const graphConnection = segmentationGraph.connect(this);
          refCounted.registerDisposer(() => {
            graphConnection.dispose();
            this.graphConnection.value = undefined;
          });
          const displayState = {
            ...this.displayState,
            transform: loadedSubsource.getRenderLayerTransform(),
          };
          const graphRenderLayers = graphConnection.createRenderLayers(
            this.manager.chunkManager, displayState, this.localPosition);
          this.graphConnection.value = graphConnection;
          for (const renderLayer of graphRenderLayers) {
            loadedSubsource.addRenderLayer(renderLayer);
          }
        })
        continue
      }

      if (local === LocalDataSource.equivalences) {
        if (!isGroupRoot) {
          loadedSubsource.deactivate('Not supported on non-root linked segmentation layers');
          continue
        }
        if (!!updatedGraph) {
          loadedSubsource.deactivate('Only one segmentation graph is supported');
          continue
        }
        updatedGraph = this.displayState.originalSegmentationGroupState.localGraph;
        loadedSubsource.activate((refCounted) => {
          this.graphConnection.value = refCounted.registerDisposer(updatedGraph!.connect(this));
          refCounted.registerDisposer(() => {
            this.graphConnection.value = undefined;
          });
        });
        continue
      }
      loadedSubsource.deactivate('Not compatible with segmentation layer');
    }
    this.displayState.originalSegmentationGroupState.segmentPropertyMap.value =
      getPreprocessedSegmentPropertyMap(this.manager.chunkManager, updatedSegmentPropertyMaps);
    this.displayState.originalSegmentationGroupState.graph.value = updatedGraph;
    this.displayState.hasVolume.value = hasVolume;
  }
}