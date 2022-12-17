import { Viewer } from 'neuroglancer/viewer';
import { SegmentationUserLayer } from "neuroglancer/segmentation_user_layer";
import { Position } from 'neuroglancer/navigation_state';

import { Config } from "nehuba/config";
import { NehubaSegmentColorHash } from "nehuba/internal/nehuba_segment_color";

export function configureInstance(viewer: Viewer, config: Config) {
	const layoutConfig = config.layout || {};
	if (config.restrictUserNavigation || (layoutConfig.useNehubaPerspective && !layoutConfig.useNehubaPerspective.doNotRestrictUserNavigation)) restrictUserNavigation(viewer.navigationState.position);
	// if (config.disableSegmentSelection) disableSegmentSelection(viewer); //@deprecated Handled in NehubaViewer constructor
	
	// !!! Depends on complementary patch in `patches.ts`, so don't rxify it just yet (it's global)
	if (config.globals && config.globals.useCustomSegmentColors) useNehubaCustomSegmentColors(viewer);
	// useNehubaIndependentSegmentMeshes(viewer); //Handled in NehubaViewer

	if (config.globals && config.globals.useNehubaLayout) {
		//Remap action to nehuba
		viewer.inputEventBindings.sliceView.set('at:shift+mousedown0', {action: 'nehuba-rotate-via-mouse-drag', stopPropagation: true}); //Actual action listener is registered by NehubaLayout
		if (layoutConfig.useNehubaPerspective) {
			if (!layoutConfig.useNehubaPerspective.enablePerspectiveDrag) {
				//In principal can make toggleable, keep the previous action and delegate to it conditionally
				viewer.inputEventBindings.perspectiveView.set('at:shift+mousedown0', {action: 'ignore', stopPropagation: true});
				viewer.inputEventBindings.perspectiveView.set('at:touchtranslate2', {action: 'ignore', stopPropagation: true});
			}
		}
	}
}

export function configureParent(parent: HTMLElement, config: Config) {
	/*if (config.zoomWithoutCtrl)*/ flipCtrlOfMouseWheelEvent(parent, config);
	/*if (config.rightClickWithCtrl)*/ noRightClickWithoutCtrl(parent, config);
}

//TODO more than 3 dimensions and rename
function min3(out: Float32Array, other: Float32Array) {
	out[0] = Math.min(out[0], other[0]);
	out[1] = Math.min(out[1], other[1]);
	out[2] = Math.min(out[2], other[2]);
}
function max3(out: Float32Array, other: Float32Array) {
	out[0] = Math.max(out[0], other[0]);
	out[1] = Math.max(out[1], other[1]);
	out[2] = Math.max(out[2], other[2]);
}

//@MinimalMaintenance. Wraps original NG function, so no care needed when updating NG, unless setting of coordinates logic changes significantly upstream or the bounding box is moved/removed
/** Restricts user movements to the boundaries of displayed volumes, i.e
 *  prevents user to navigate away from the data, which does not make sense anyway.
 *  Required for clipped mesh 3d view, otherwise it looks ugly and broken if the user does navigate far away from slice field of view.
 *  Currently there is no way to 'undo' this restriction for the provided Viewer instance.*/
function restrictUserNavigation(position: Position) {
	const dispatch = position.changed.dispatch;
	position.changed.dispatch = function () {
		const space = position.coordinateSpace.value;
		if (space.valid) {
			const pos = position.value;
			const box = space.bounds;
			min3(pos, new Float32Array(box.upperBounds));
			max3(pos, new Float32Array(box.lowerBounds));	
		}
		dispatch();
	};
}

/** @deprecated useCustomSegmentColors config option is deprecated */
function useNehubaCustomSegmentColors(viewer: Viewer) {
	forAllSegmentationUserLayers(viewer, layer => {
		const { displayState } = layer;
		if (!(displayState.segmentColorHash instanceof NehubaSegmentColorHash)) displayState.segmentColorHash = NehubaSegmentColorHash.from(displayState.segmentColorHash);
	})
}

// Handled in NehubaViewer
// function useNehubaIndependentSegmentMeshes(viewer: Viewer) {
// 	forAllSegmentationUserLayers(viewer, layer => {
// 		const { displayState } = layer;
// 		if (!(displayState.visibleSegments instanceof VisibleSegmentsWrapper)) displayState.visibleSegments = new VisibleSegmentsWrapper(displayState.visibleSegments);
// 	})
// }

export function disableSegmentSelectionForLayer(layer: SegmentationUserLayer) {
	layer.displayState.segmentSelectionState.set(null);
	layer.displayState.segmentSelectionState.set = function () {}
}
//FIXME Seems to be working only for 3d, does not work for cross-sections, why?
export function disableSegmentHighlightingForLayer(layer: SegmentationUserLayer) {
	layer.displayState.segmentSelectionState.isSelected = function() {return false;}
}

/** !!! func will be called for each layer every time the set of layers changes.
 *  So it might be called many times for the same layer. TODO change function name to reflect that 
 *  !!! Since this function becomes popular and number of hooks applied to SegmentationUserLayer grows steadily ->
 *  The hooks might start to depend on each other and the order of invocation might become important!!! 
 *  In this case it is de facto a mess and must be reimplemented */
export function forAllSegmentationUserLayers(viewer: Viewer, func: (layer: SegmentationUserLayer) => void) {
	forEachSegmentationUserLayerOnce(viewer, func);
	let { layerManager } = viewer;
	layerManager.registerDisposer(layerManager.layersChanged.add(() => {
		forEachSegmentationUserLayerOnce(viewer, func);
	}));
}

export function forEachSegmentationUserLayerOnce(viewer: Viewer, func: (layer: SegmentationUserLayer) => void) {
	let { layerManager } = viewer;
	layerManager.managedLayers
		.map((l) => { return l.layer; })
		.filter((layer) => { return !!layer; }) // null-check, just in case, perchaps not needed
		.filter((layer) => { return layer instanceof SegmentationUserLayer; })
		.map((l) => { return l as SegmentationUserLayer })
		.forEach((layer) => { func(layer) });
}

function flipCtrlOfMouseWheelEvent(parent: HTMLElement, config: Config) {
	const customEvent = Symbol('customEvent');
	parent.addEventListener('wheel', e => { //TODO Use `registerEventListener` from 'neuroglancer/util/disposable'
		if ((<any>e)[customEvent]) return;
		if (!config.zoomWithoutCtrl) return;
		e.stopImmediatePropagation();
		e.stopPropagation();
		e.preventDefault();
		const evt = new Proxy<WheelEvent>(e, {
			get: function(target: any, p: PropertyKey) {
				if (p === 'ctrlKey') return !target[p];
				const res = target[p];
				if (typeof res === 'function') return res.bind(target);
				else return res;
			}
		});
		const e2 = new WheelEvent(e.type, evt);
		(<any>e2)[customEvent] = true;
		e.target!.dispatchEvent(e2);
	}, true);
}

/** Simply stop propogation of right click without ctrl. For better handling of right click see deprecated useCtrlForNgRightClick() in patches.ts */
function noRightClickWithoutCtrl(parent: HTMLElement, config: Config) {
	parent.addEventListener('mousedown', e => {
		if (config.rightClickWithCtrl && e.button === 2 && !e.ctrlKey) {
			e.stopImmediatePropagation();
			e.stopPropagation();
			e.preventDefault(); //TODO remove?
		}
	}, true);	
}

/** @deprecated Handled in NehubaViewer constructor using RxJs and in semi-togglable way */
export function disableSegmentSelection(viewer: Viewer) {
	forAllSegmentationUserLayers(viewer, (layer) => {
		disableSegmentSelectionForLayer(layer);
	});
}