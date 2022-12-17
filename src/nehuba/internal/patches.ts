import { LAYOUTS } from 'neuroglancer/data_panel_layout';
import { ImageUserLayer } from "neuroglancer/image_user_layer";
import { SegmentationUserLayer } from "neuroglancer/segmentation_user_layer";
import { MeshSource, MultiscaleMeshSource } from 'neuroglancer/mesh/frontend';
import { MultiscaleMeshLayer } from 'neuroglancer/mesh/frontend';
import { SingleMeshUserLayer } from "neuroglancer/single_mesh_user_layer";
import { RenderLayer } from 'neuroglancer/renderlayer';
import { SingleMeshLayer } from "neuroglancer/single_mesh/frontend";
import { SegmentationRenderLayer } from 'neuroglancer/sliceview/volume/segmentation_renderlayer';

import { Config } from "nehuba/config";
import { NehubaLayout } from "nehuba/internal/nehuba_layout";
import { NehubaMeshLayer, VisibleSegmentsWrapper } from "nehuba/internal/nehuba_mesh_layer";
// import { patchSingleMeshLayer } from "nehuba/internal/nehuba_single_mesh_layer"; FIXME 
import { NehubaSegmentColorShaderManager } from "nehuba/internal/nehuba_segment_color";
import { LoadedDataSubsource } from 'neuroglancer/layer_data_source';
import { MultiscaleVolumeChunkSource } from 'neuroglancer/sliceview/volume/frontend';
import { DataType } from 'neuroglancer/sliceview/volume/base';
import { PerspectiveViewSkeletonLayer, SkeletonLayer, SliceViewPanelSkeletonLayer } from 'neuroglancer/skeleton/frontend';

let patched = false;
/** Monkey patch neuroglancer code. Can be done only once. Can not be undone. Should be done before any Viewer instances are created and affects all of them. */
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
	if (conf.hideNullImageValues) fix_HideNullImageValues();
	if (conf.useCustomSegmentColors) useNehubaColorsInSegmentationRenderLayer(); // !!! Depends on complementary hook in `hooks.ts`
	if (conf.useNehubaMeshLayer) useNehubaMeshInSegmentationLayer(config.enableMeshLoadingControl);

	patched = true;
}

//@ZeroMaintenance. Wraps original NG function, so no care needed when updating NG.
function fix_HideNullImageValues() {
	//TODO submit pull-request upstream to not show 'null' in layer panel to remove this patch
	const originalImageTransform = ImageUserLayer.prototype.transformPickedValue;
	ImageUserLayer.prototype.transformPickedValue = function (this: ImageUserLayer, value: any) {
		let transformed = originalImageTransform.call(this, value);
		if (transformed === null) transformed = undefined;
		return transformed;
	}
}

//@ZeroMaintenance. Wraps original NG function, so no care needed when updating NG.
/** @deprecated useCustomSegmentColors config option is deprecated */
function useNehubaColorsInSegmentationRenderLayer() {
	// FIXME
	// const originalAddRenderLayer = SegmentationUserLayer.prototype.addRenderLayer;
	// SegmentationUserLayer.prototype.addRenderLayer = function (this: SegmentationUserLayer, layer: RenderLayer) { // TODO addRenderLayer changed arg type to Owned<>
	// 	if (layer instanceof SegmentationRenderLayer) {
	// 		layer['segmentColorShaderManager'] = new NehubaSegmentColorShaderManager('segmentColorHash'); // TODO Promoted to protected by our PR #44, but still not accessible by monkey-patching. Unless used by subclass in the future... TODO submit PR to promote to public or back to private
	// 	}
	// 	originalAddRenderLayer.call(this, layer);
	// }
}

// ****** !!! Needs attention !!! ******  Even though the change is minimal - the code is forked/copy-pasted from NG and needs to be updated if changed upstream.
function useNehubaMeshInSegmentationLayer(enableMeshLoadingControl?: boolean) {
	SegmentationUserLayer.prototype.activateDataSubsources = function (this: SegmentationUserLayer, subsources: Iterable<LoadedDataSubsource>) {
		if (enableMeshLoadingControl) {
			const { displayState } = this;
			if (!(displayState.visibleSegments instanceof VisibleSegmentsWrapper)) displayState.visibleSegments = new VisibleSegmentsWrapper(displayState.visibleSegments);
		};
		
		for (const loadedSubsource of subsources) {
			if (this.addStaticAnnotations(loadedSubsource)) continue;
			const {volume, mesh} = loadedSubsource.subsourceEntry.subsource;
			if (volume instanceof MultiscaleVolumeChunkSource) {
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