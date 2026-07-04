import { LoadedDataSubsource } from "neuroglancer/unstable/layer/layer_data_source.js"
import { Config } from "./config"
import { NehubaLayout } from "./nehuba_layout"
import { LAYOUTS } from "neuroglancer/unstable/data_panel_layout.js"
import { SegmentationUserLayer } from "neuroglancer/unstable/layer/segmentation/index.js"
import { NehubaMeshLayer, VisibleSegmentsWrapper } from "./nehuba_mesh_layer"
import { MultiscaleVolumeChunkSource } from "neuroglancer/unstable/sliceview/volume/frontend.js"
import { DataType } from "neuroglancer/unstable/util/data_type.js"
import { MeshSource, MultiscaleMeshLayer, MultiscaleMeshSource } from "neuroglancer/unstable/mesh/frontend.js"
import { PerspectiveViewSkeletonLayer, SkeletonLayer, SliceViewPanelSkeletonLayer } from "neuroglancer/unstable/skeleton/frontend.js"
// import { Segmentation } from "neuroglancer/unstable/main.d.ts"
let patched: boolean = false

export function patchNeuroglancer(config: Config) {
	const conf = config.globals || {};
	//TODO allow patching multiple times with the same config
	//TODO check for config values in patches. Allows runtime toggling. But only if was on here... Or should we patch all then anyway? Not good for debug/tracing problems
	if (patched) return; //throw new Error('Monkey patches are already applied to Neuroglancer. Should call patchNeuroglancer(config) only once');
	/** Install NehubaLayout as the only layout used by neuroglancer */
	if (conf.useNehubaLayout) {
		LAYOUTS.clear();
		LAYOUTS.set('4panel', {factory: (container, element, viewer, crossSections) => new NehubaLayout(container, element, viewer, crossSections)});
		LAYOUTS.set('xy', {factory: (container, element, viewer, crossSections) => new NehubaLayout(container, element, viewer, crossSections)}); // Needed only for split views to work. 'xy' is default layout when splitting the view //TODO Actually implement other NG layouts
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
      if (!(segmentationGroupState.value.visibleSegments instanceof VisibleSegmentsWrapper)) {
        segmentationGroupState.value.visibleSegments = new VisibleSegmentsWrapper(segmentationGroupState.value.visibleSegments);
      }
		};
		
		for (const loadedSubsource of subsources) {
			if (this.addStaticAnnotations(loadedSubsource)) continue;
			const {volume, mesh} = loadedSubsource.subsourceEntry.subsource;
			if (!!volume && volume instanceof MultiscaleVolumeChunkSource) {
			  switch (volume.dataType) {
				 case DataType.FLOAT32:
					loadedSubsource.deactivate('Data type not compatible with segmentation layer');
					continue;
			  }
			  loadedSubsource.activate(
					() => loadedSubsource.addRenderLayer(new SegmentationRenderLayer(volume, {
					  ...this.displayState,
					  transform: loadedSubsource.getRenderLayerTransform(),
					  renderScaleTarget: this.sliceViewRenderScaleTarget,
					  renderScaleHistogram: this.sliceViewRenderScaleHistogram,
					  localPosition: this.localPosition,
					})));
			} else if (mesh !== undefined) {
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
			  });
			} else {
			  loadedSubsource.deactivate('Not compatible with segmentation layer');
			}
		 }	
	}
}