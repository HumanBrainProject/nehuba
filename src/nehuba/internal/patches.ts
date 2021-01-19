import { LAYOUTS } from 'neuroglancer/data_panel_layout';
import { ImageUserLayer } from "neuroglancer/image_user_layer";
import { SegmentationUserLayer } from "neuroglancer/segmentation_user_layer";
import { MeshSource, MultiscaleMeshSource } from 'neuroglancer/mesh/frontend';
import { MultiscaleMeshLayer } from 'neuroglancer/mesh/frontend';
import { SingleMeshUserLayer } from "neuroglancer/single_mesh_user_layer";
import { RenderLayer } from "neuroglancer/layer";
import { SingleMeshLayer } from "neuroglancer/single_mesh/frontend";
import { SegmentationRenderLayer } from 'neuroglancer/sliceview/volume/segmentation_renderlayer';

import { Config } from "nehuba/config";
import { NehubaLayout } from "nehuba/internal/nehuba_layout";
import { NehubaMeshLayer } from "nehuba/internal/nehuba_mesh_layer";
import { patchSingleMeshLayer } from "nehuba/internal/nehuba_single_mesh_layer";
import { NehubaSegmentColorShaderManager } from "nehuba/internal/nehuba_segment_color";

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
	if (conf.useNehubaMeshLayer) useNehubaMeshInSegmentationLayer();
	if (conf.useNehubaSingleMeshLayer) useNehubaSingleMesh();

	patched = true;
}

export function useNehubaSingleMesh() {
/*	The other (correct) way to do it would be to implement our own user layer and register it. Something like:
	class NehubaSingleMeshUserLayer extends SingleMeshUserLayer {
		constructor(manager: LayerListSpecification, x: any) {
			super(manager,x);
			...............
		}
		addRenderLayer(layer: RenderLayer) {
			...............
			super.addRenderLayer(layer);
		}
	}
	registerLayerType('nmesh', NehubaSingleMeshUserLayer);
*/
	const originalAddRenderLayer = SingleMeshUserLayer.prototype.addRenderLayer;
	SingleMeshUserLayer.prototype.addRenderLayer = function (this:SingleMeshUserLayer, layer: RenderLayer) {
		//At this point SingleMeshLayer just created by SingleMeshUserLayer constructor
		//Currently this method is called only by SingleMeshUserLayer and only with `new SingleMeshLayer(...)`
		//So we know that layer is SingleMeshLayer, but still perform instanceof check just in case
		if (layer instanceof SingleMeshLayer) patchSingleMeshLayer(layer as SingleMeshLayer);
		originalAddRenderLayer.call(this, layer);
	}
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
function useNehubaColorsInSegmentationRenderLayer() {
	const originalAddRenderLayer = SegmentationUserLayer.prototype.addRenderLayer;
	SegmentationUserLayer.prototype.addRenderLayer = function (this: SegmentationUserLayer, layer: RenderLayer) {
		if (layer instanceof SegmentationRenderLayer) {
			layer['segmentColorShaderManager'] = new NehubaSegmentColorShaderManager('segmentColorHash'); // TODO Promoted to protected by our PR #44, but still not accessible by monkey-patching. Unless used by subclass in the future... TODO submit PR to promote to public or back to private
		}
		originalAddRenderLayer.call(this, layer);
	}
}

//@MinimalMaintenance. Because method is so small and the change is so simple. But needs to be monitored upstream for changes.
function useNehubaMeshInSegmentationLayer() {
	SegmentationUserLayer.prototype.addMesh = function (this: SegmentationUserLayer, meshSource: MeshSource|MultiscaleMeshSource) {
		if (meshSource instanceof MeshSource) {
			// this.meshLayer = new MeshLayer(this.manager.chunkManager, meshSource, this.displayState);
			this.meshLayer = new NehubaMeshLayer(this.manager.chunkManager, meshSource, this.displayState);
		} else {
			this.meshLayer =
				new MultiscaleMeshLayer(this.manager.chunkManager, meshSource, this.displayState);
		}
		this.addRenderLayer(this.meshLayer!);
	};	
}