import { Viewer } from 'neuroglancer/viewer';
import { BoundingBox, vec3 } from 'neuroglancer/util/geom';
import { SegmentationUserLayer } from "neuroglancer/segmentation_user_layer";
import { DisplayContext } from 'neuroglancer/display_context';

import { Config } from "nehuba/config";
import { NehubaSegmentColorHash } from "nehuba/internal/nehuba_segment_color";

export function configureInstance(viewer: Viewer, config: Config) {
	if (config.restrictUserNavigation) restrictUserNavigation(viewer);
	// if (config.disableSegmentSelection) disableSegmentSelection(viewer); //@deprecated Handled in NehubaViewer constructor
	
	// !!! Depends on complementary patch in `patches.ts`, so don't rxify it just yet (it's global)
	if (config.globals && config.globals.useCustomSegmentColors) useNehubaCustomSegmentColors(viewer);
	// useNehubaIndependentSegmentMeshes(viewer); //Handled in NehubaViewer

	//Remap actions to nehuba
	if (config.globals && config.globals.useNehubaLayout) {
		viewer.inputEventBindings.sliceView.set('at:shift+mousedown0', {action: 'nehuba-rotate-via-mouse-drag', stopPropagation: true}) //Actual action listener is registered by NehubaLayout
		if (config.layout && config.layout.useNehubaPerspective) {
			viewer.inputEventBindings.perspectiveView.set('at:shift+mousedown0', {action: 'nehuba-translate-via-mouse-drag', stopPropagation: true}) //Actual action listener is registered by NehubaPerspectivePanel
		}
	}

	if (config.dedebounceUpdates) dedebounce(viewer, config);
}

export function configureParent(parent: HTMLElement, config: Config) {
	/*if (config.zoomWithoutCtrl)*/ flipCtrlOfMouseWheelEvent(parent, config);
	/*if (config.rightClickWithCtrl)*/ noRightClickWithoutCtrl(parent, config);
}

const bbox   = Symbol('bbox');
const hooked = Symbol('hooked');
//@MinimalMaintenance. Wraps original NG function, so no care needed when updating NG, unless setting of coordinates logic changes significantly upstream or the bounding box is moved/removed
/** Restricts user movements to the boundaries of displayed volumes, i.e
 *  prevents user to navigate away from the data, which does not make sense anyway.
 *  Required for clipped mesh 3d view, otherwise it looks ugly and broken if the user does navigate far away from slice field of view.
 *  Currently there is no way to 'undo' this restriction for the provided Viewer instance.*/
export function restrictUserNavigation(viewer: Viewer) { //Exported, because 3d view layout depends on it and call this hook by itself. TODO There must be better way...
	if ((<any>viewer)[hooked]) return;

	// let isFiniteVec = (vec: vec3) => { return Number.isFinite(vec[0]) && Number.isFinite(vec[1]) && Number.isFinite(vec[2]); }
	// let isFiniteBox = (box: BoundingBox) => { return isFiniteVec(box.upper) && isFiniteVec(box.lower); }

	viewer.registerDisposer(viewer.layerManager.layersChanged.add(() => {
		let boxFound = false;
		let box = new BoundingBox(
			vec3.fromValues(Infinity, Infinity, Infinity),
			vec3.fromValues(-Infinity, -Infinity, -Infinity));
		for (let managedLayer of viewer.layerManager.managedLayers) {
			let userLayer = managedLayer.layer;
			if (userLayer == null) continue;
			for (let renderLayer of userLayer.renderLayers) {
				let boundingBox = renderLayer.boundingBox;
				if (boundingBox == null) continue;
				vec3.min(box.lower, box.lower, boundingBox.lower);
				vec3.max(box.upper, box.upper, boundingBox.upper);
				boxFound = true;
			}
		};
		if (boxFound/*isFiniteBox(box)*/) (<any>viewer.navigationState.position)[bbox] = box;
		if (boxFound/*isFiniteBox(box)*/) (<any>viewer.navigationState.pose)[bbox] = box; //temp
		if (boxFound/*isFiniteBox(box)*/) viewer.navigationState.position.changed.dispatch();
	}));
	//Neuroglancer sets position by directly settting coordinates of spatialCoordinates vector (we don't want to intercept that)
	//and then calling dispatch() of respective signal, which we decorate here to set coordinates back into the bounding box.
	let { position } = viewer.navigationState;
	const dispatch = position.changed.dispatch;
	position.changed.dispatch = function () {
		let box: BoundingBox|undefined = (<any>position)[bbox];
		if (box) {
			let pos = position.spatialCoordinates;
			vec3.min(pos, pos, box.upper);
			vec3.max(pos, pos, box.lower);
		}
		dispatch();
	};
	
	(<any>viewer)[hooked] = true;
}

function useNehubaCustomSegmentColors(viewer: Viewer) {
	forAllSegmentationUserLayers(viewer, layer => {
		const { displayState } = layer;
		if (!(displayState.segmentColorHash instanceof NehubaSegmentColorHash)) displayState.segmentColorHash = NehubaSegmentColorHash.from(displayState.segmentColorHash);
	})
}

//TODO raise an issue upstream
/** Upstream neuroglancer added debouncing of resize handling in DisplayContext (commit 05d6398d0995318dcce6151e7a285c9b606720b6)
 *  which causes flickering when "Reset" is pressed (state changed programmatically twice at the same cycle). So we need to de-debounce */
function dedebounce(viewer: Viewer, config: Config) {
	const originalOnResize = viewer.display.onResize;
	viewer.display.onResize = function(this: DisplayContext) {
		if (config.dedebounceUpdates) {
			this.scheduleRedraw();
			for (let panel of this.panels) {
			  panel.onResize();
			}  	
		} else originalOnResize.call(this);
	} as any;
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