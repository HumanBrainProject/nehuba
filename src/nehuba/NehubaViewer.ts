import { setupDefaultViewer } from 'neuroglancer/ui/default_viewer_setup';
import { Viewer } from "neuroglancer/viewer";

import { Config } from "nehuba/config";
import { patchNeuroglancer } from "nehuba/internal/patches";
import { configureInstance, configureParent, forEachSegmentationUserLayerOnce, disableSegmentSelectionForLayer, forAllSegmentationUserLayers } from "nehuba/internal/hooks";
import { configSymbol } from "nehuba/internal/nehuba_layout";

/** Create viewer */
export function createNehubaViewer(configuration?: Config/* , container?: HTMLElement */, errorHandler?: (error: Error) => void) { //TODO Accept String id for container and lookup ElementById
	return NehubaViewer.create(configuration/* , container */, errorHandler);
}

export class NehubaViewer {
	/** Don't use it, should be private. Left exposed just in case you urgently need it and there is no way around it.
	 *  But be warned that you can easily brake things by accessing it directly. */
	readonly ngviewer: Viewer
	private _config: Config;

	private mouseOnSegment?: (segment: number, layer?: {name: string, url:string}) => void;
	private mouseOffSegment?: () => void;

	setMouseEnterSegmentCallback(callback: (segment: number, layer?: {name: string, url:string}) => void) {
		this.mouseOnSegment = callback;
	}
	clearMouseEnterSegmentCallback() {
		this.mouseOnSegment = undefined;
	}
	setMouseLeaveSegmentCallback(callback: () => void) {
		this.mouseOffSegment = callback;
	}
	clearMouseLeaveSegmentCallback() {
		this.mouseOffSegment = undefined;
	}

	private constructor(viewer: Viewer, config: Config, public errorHandler?: (error: Error) => void) {
		this.ngviewer = viewer;
		this._config = config;

		const callbacksSet = Symbol('Callbacks are set');
		forAllSegmentationUserLayers(viewer, layer => {
			if ((<any>layer)[callbacksSet]) return;
			const selection = layer.displayState.segmentSelectionState;
			selection.registerDisposer(selection.changed.add(() => {
				const {mouseOnSegment, mouseOffSegment} = this;
				if (selection.hasSelectedSegment) {
					const selected = selection.selectedSegment;
					if (selected.high !== 0) this.handleError('Segment id number does not fit into 32 bit integer');
					const segment = selected.low;
					/* if (segment) */ mouseOnSegment && mouseOnSegment(segment);
					// else mouseOffSegment && mouseOffSegment();
				} else mouseOffSegment && mouseOffSegment();
			}));
			(<any>layer)[callbacksSet] = true;
		});
	}

	private handleError(message: string) {
		const error = new Error(message);
		const {errorHandler} = this;
		// this.errorHandler ? this.errorHandler(error) :  (() => {throw error})();
		errorHandler && errorHandler(error);
		throw error;
	}

	get config() { return this._config; }
	/** Temporary experimental workaround, might not work as expected. Don't use if you can avoid it. */
	set config(newConfig: Config) {
		this._config = newConfig;
		(this.ngviewer.display.container as any)[configSymbol] = this._config;
	}

	static create(configuration?: Config/* , container?: HTMLElement */, errorHandler?: (error: Error) => void) { //TODO Accept String id for container and lookup ElementById
		const config = configuration || {};

		const parent = /* container ||  */document.getElementById('container')!; //TODO id as param ( String|HTMLElement )
		if ((<any>parent)[configSymbol]) {
			const error = new Error('Viewer is already created in this container: ' + parent);
			// errorHandler ? errorHandler(error) :  (() => {throw error})();
			errorHandler && errorHandler(error);
			throw error;
		}
		(<any>parent)[configSymbol] = config;

		patchNeuroglancer(config);
		configureParent(parent, config);

		let viewer = setupDefaultViewer();

		configureInstance(viewer, config);

		if (viewer.layerManager.managedLayers.length === 0) {
			NehubaViewer.restoreInitialState(viewer, config);
		}

		return new NehubaViewer(viewer, config, errorHandler);
	}
	private static restoreInitialState(viewer: Viewer, config: Config) {
		const state = config.dataset && config.dataset.initialNgState;
		state && viewer.state.restoreState(state);
	}

	relayout() {
		this.ngviewer.layoutName.changed.dispatch();
	}
	redraw() {
		this.ngviewer.display.scheduleRedraw();
	}
	dispose() {
		this.ngviewer.dispose();
	}
	applyInitialNgState() {
		NehubaViewer.restoreInitialState(this.ngviewer, this.config);
	}
	/** Disable segment selection only for currently loaded segmentation layers. New layers loaded afterwards are not affected.*/
	disableSegmentSelectionForLoadedLayers() {
		forEachSegmentationUserLayerOnce(this.ngviewer, disableSegmentSelectionForLayer);
	}
}