import { Uint64 } from 'neuroglancer/util/uint64';
import { UserLayer, ManagedUserLayer, MouseSelectionState } from "neuroglancer/layer";
import { ImageUserLayer } from "neuroglancer/image_user_layer";
import { SegmentationUserLayer } from "neuroglancer/segmentation_user_layer";
import { setupDefaultViewer } from 'neuroglancer/ui/default_viewer_setup';
import { Viewer } from "neuroglancer/viewer";

import { Config } from "nehuba/config";
import { patchNeuroglancer } from "nehuba/internal/patches";
import { configureInstance, configureParent, disableSegmentSelectionForLayer, disableSegmentHighlightingForLayer } from "nehuba/internal/hooks";
import { configSymbol } from "nehuba/internal/nehuba_layout";
import { vec3, quat } from "nehuba/exports";
import { NehubaSegmentColorHash } from "nehuba/internal/nehuba_segment_color";
import { VisibleSegmentsWrapper } from 'nehuba/internal/nehuba_mesh_layer';
import { rxify } from "nehuba/internal/tools";

import { Observable/* , Subscription */ } from "@reactivex/rxjs";
import "nehuba/Rx";

/** Create viewer */
export function createNehubaViewer(configuration?: Config/* , container?: HTMLElement */, errorHandler?: (error: Error) => void) { //TODO Accept String id for container and lookup ElementById
	return NehubaViewer.create(configuration/* , container */, errorHandler);
}

export class NehubaViewer {
	/** Don't use it, should be private. Left exposed just in case you urgently need it and there is no way around it.
	 *  But be warned that you can easily brake things by accessing it directly. */
	readonly ngviewer: Viewer
	private _config: Config;
	/** Attention! Using 'null' values to indicate that mouse left "image-containing" area, so that relevant action
	 *  could be taken, such as clearing mouse coordinates in UI. Therefore is it NECESSARY to check value for null before using it. */
	readonly mousePosition: {
		// readonly inRealSpace: Observable<vec3 | null>,  //FIXME
		readonly inVoxels: Observable<Float32Array | null> 
	}
	readonly navigationState: {
		readonly position: {
			// readonly inRealSpace: Observable<Float32Array>, //FIXME
			readonly inVoxels: Observable<Float32Array> 
		},
		readonly orientation: Observable<quat>,
		readonly sliceZoom: Observable<number>,
		readonly full: Observable<{position: Float32Array, orientation: quat, zoom: number}>,
		readonly perspectiveZoom: Observable<number>,
		readonly perspectiveOrientation: Observable<quat>,
		readonly all: Observable<{position: Float32Array, orientation: quat, zoom: number, perspectiveZoom: number, perspectiveOrientation: quat}>,
	}
	/** Attention! Using 'null' values to indicate that mouse left the segment, image or layer, so that relevant action
	 *  could be taken, such as clearing segment name and details or image greay value in UI. Therefore is it NECESSARY to check value for null before using it. */
	readonly mouseOver: {
		readonly segment: Observable<{segment: number | null, layer: {name: string, url?:string}}>,
		readonly image: Observable<{value: any|null, layer: {name: string, url:string}}>,
		readonly layer: Observable<{value: any|null, layer: {name: string, url?:string}}>
	};

	// ******* Plain old callbacks for those who don't want to use RxJs. Why don't you? Not recommended and might be removed without notice *******
	
	private onError = (err: any) => { this.errorHandler && ((err instanceof Error) ? this.errorHandler(err) : this.errorHandler(new Error(err))); };

	/** Attention! Will pass 'null' instead of segment number to indicate that mouse left segmentation area, so that relevant action
	 *  could be taken, such as clearing segment info in UI. Therefore is it NECESSARY to check segment number for null before using it.
	 *  @returns {() => void} a function to remove this callback in the future  */
	addMouseOverSegmentCallback(callback: (segment: number | null, layer?: {name: string, url?:string}) => void) {
		const s = this.mouseOver.segment.subscribe(it => callback(it.segment, it.layer), this.onError);
		return () => s.unsubscribe();
	}
	/** @deprecated Use addMouseOverSegmentCallback with a condition that a segment number is not 'null' */
	addMouseEnterSegmentCallback(callback: (segment: number, layer?: {name: string, url?:string}) => void) {
		const s = this.mouseOver.segment.filter(it => it.segment !== null).subscribe(it => callback(it.segment!, it.layer), this.onError);
		return () => s.unsubscribe();
	}
	/** @deprecated Use addMouseOverSegmentCallback with a condition that a segment number is 'null' */
	addMouseLeaveSegmentsCallback(callback: () => void) {
		const s = this.mouseOver.segment.filter(it => it.segment === null).subscribe(() => callback(), this.onError);
		return () => s.unsubscribe();
	}
	/** @returns {() => void} a function to remove this callback in the future */
	// FIXME
	// addNavigationStateCallbackInRealSpaceCoordinates(callback: (position: Float32Array) => void) {
	// 	const s = this.navigationState.position.inRealSpace.subscribe(position => callback(position), this.onError);
	// 	return () => s.unsubscribe();
	// }
	/** @returns {() => void} a function to remove this callback in the future */	
	addNavigationStateCallbackInVoxelCoordinates(callback: (position: Float32Array) => void) {
		const s = this.navigationState.position.inVoxels.subscribe(position => callback(position), this.onError);
		return () => s.unsubscribe();
	}
	/** Attention! Will pass 'null' value to callback in order to indicate that mouse left "image-containing" area, so that relevant action
	 *  could be taken, such as clearing mouse coordinates in UI. Therefore is it NECESSARY to check position for null before using it. 
	 *  @returns {() => void} a function to remove this callback in the future  */
	// FIXME
	// addMousePositionCallbackInRealSpaceCoordinates(callback: (position: vec3 | null) => void) {
	// 	const s = this.mousePosition.inRealSpace.subscribe(position => callback(position), this.onError);
	// 	return () => s.unsubscribe();
	// }
	/** Attention! Will pass 'null' value to callback in order to indicate that mouse left "image-containing" area, so that relevant action
	 *  could be taken, such as clearing mouse coordinates in UI. Therefore is it NECESSARY to check position for null before using it. 
	 *  @returns {() => void} a function to remove this callback in the future  */
	addMousePositionCallbackInVoxelCoordinates(callback: (position: Float32Array | null) => void) {
		const s = this.mousePosition.inVoxels.subscribe(position => callback(position), this.onError);
		return () => s.unsubscribe();
	}

	setPosition(newPosition: Float32Array) {
		this.ngviewer.navigationState.pose.position.value = newPosition;
	}

	/** @throws Will throw an error if none or more then one segmentations found matching optional {layer} criteria */
	showSegment(id: number, layer?: {name?: string, url?:string}) {
		this.getSingleSegmentation(layer).displayState.visibleSegments.add(new Uint64(id));
	}
	/** @throws Will throw an error if none or more then one segmentations found matching optional {layer} criteria */
	hideSegment(id: number, layer?: {name?: string, url?:string}) {
		this.getSingleSegmentation(layer).displayState.visibleSegments.delete(new Uint64(id));
	}
	/** Attention! Due to how neuroglacner works, empty array corresponds to *ALL* the segments being visible. 
	 *  @throws Will throw an error if none or more then one segmentations found matching optional {layer} criteria */
	getShownSegmentsNow(layer?: {name?: string, url?:string}) {
		return Array.from(this.getSingleSegmentation(layer).displayState.visibleSegments, this.segmentToNumber);
	}
	/** Attention! Due to how neuroglacner works, empty array corresponds to *ALL* the segments being visible. 
	 *  Returned observable terminates when currently loaded segmentation layer is disposed and needs to be acquired again 
	 *  by calling this method when layers are re-added, for example if "Reset" button is pressed, 
	 *  new URL copy-pasted by the user or `restoreState` is called on ngviewer programmatically)
	 *  @throws Will throw an error if none or more then one segmentations found matching optional {layer} criteria */
	getShownSegmentsObservable(layer?: {name?: string, url?:string}) {
		const l = this.getSingleSegmentation(layer); //Looks like `visibleSegments` is not properly disposed by NG, so we use the layer as RefCounted for rxify
		return rxify({s: l.displayState.visibleSegments, r: l}, it => Array.from(it, this.segmentToNumber));
	}
	/** @throws Will throw an error if none or more then one segmentations found matching optional {layer} criteria
	 *  @throws Will throw an error if custom segment color support is not enabled in {config.globals} (not routed to {errorHandler})
	 *  @throws Will throw an error if rgb values are not integers in 0..255 range 
	 *  @deprecated Use `segmentColors` property of segmentation layer in the viewer json state */
	setSegmentColor(segmentId: number, color: {red:number, green: number, blue: number}, layer?: {name?: string, url?:string}) {
		this.checkRGB(color);
		this.getSingleSegmentationColors(layer).setSegmentColor(segmentId, color.red, color.green, color.blue);
	}
	/** @throws Will throw an error if none or more then one segmentations found matching optional {layer} criteria
	 *  @throws Will throw an error if custom segment color support is not enabled in {config.globals} (not routed to {errorHandler})
	 *  @deprecated Use `segmentColors` property of segmentation layer in the viewer json state */
	unsetSegmentColor(segmentId: number, layer?: {name?: string, url?:string}) {
		this.getSingleSegmentationColors(layer).unsetSegmentColor(segmentId);
	}
	/** @throws Will throw an error if none or more then one segmentations found matching optional {layer} criteria
	 *  @throws Will throw an error if custom segment color support is not enabled in {config.globals} (not routed to {errorHandler})
	 *  @deprecated Use `segmentColors` property of segmentation layer in the viewer json state */
	clearCustomSegmentColors(layer?: {name?: string, url?:string}) {
		this.getSingleSegmentationColors(layer).clearCustomSegmentColors();
	}
	/** Applied to currently loaded segmentation layer. Needs to be called again when layers are re-added, for example if "Reset" button is pressed, 
	 *  new URL copy-pasted by the user or `restoreState` is called on ngviewer programmatically)
     *  @throws Will throw an error if none or more then one segmentations found matching optional {layer} criteria
	 *  @throws Will throw an error if custom segment color support is not enabled in {config.globals} (not routed to {errorHandler})
	 *  @deprecated Use `segmentColors` property of segmentation layer in the viewer json state*/
	batchAddAndUpdateSegmentColors(colorMap: Map<number, {red:number, green: number, blue: number}>, layer?: {name?: string, url?:string}) {
		this.getSingleSegmentationColors(layer).batchUpdate(colorMap);
	}

	/** Provides a list of segment meshes to be loaded by background thread if {config.enableMeshLoadingControl} is set to true. 
	 *  All (and only) of the meshes from provided array are loaded by the backgroung thread. This set of meshes will be used by {NehubaMeshLayer} as "All meshes", 
	 *  e.g. displayed in 3d view when front octant is removed or when "Slices" checkbox is unchecked and no segment is selected. In the former case {NehubaMeshLayer} will
	 *  also start to display full meshes (without clipping in the front octant) for selected segments. 
	 *  (Exceptions is when {config.layout.useNehubaPerspective.mesh.surfaceParcellation} is true, then all meshes are displayed and clipped 
	 *  in the front octant at all times regardless of selected segments and "Slices" checkbox)
	 *  If particular mesh is not present in the provided array, it will not be loaded and displayed even if corresponding segment is selected.
	 *  Applied to currently loaded segmentation layer. Needs to be called again when layers are re-added, for example if "Reset" button is pressed, 
	 *  new URL copy-pasted by the user or `restoreState` is called on ngviewer programmatically)
	 *  @throws Will throw an error if none or more then one segmentations found matching optional {layer} criteria
	 *  @throws Will throw an error if mesh loading control is not enabled ({config.enableMeshLoadingControl}) */
	setMeshesToLoad(meshes: number[], layer?: {name?: string, url?:string}) {
		const { visibleSegments } = this.getSingleSegmentation(layer).displayState;
		visibleSegments instanceof VisibleSegmentsWrapper ? visibleSegments.setMeshesToLoad(meshes) : this.throwError('visibleSegments property is not wrapped by nehuba. Maybe mesh loading control is not enabled in config (enableMeshLoadingControl?: boolean) ');
	}

	relayout() {
		this.ngviewer.layout.container.component.changed.dispatch();
	}
	redraw() {
		this.ngviewer.display.scheduleRedraw();
	}
	dispose() {
		this.ngviewer.dispose();
		(this.ngviewer.display.container as any)[configSymbol] = undefined;
	}
	applyInitialNgState() {
		NehubaViewer.restoreInitialState(this.ngviewer, this.config);
	}
	hideNeuroglancerUI() {
		this.ngviewer.uiConfiguration.showUIControls.value = false;
	}
	showNeuroglancerUI() {
		this.ngviewer.uiConfiguration.showUIControls.value = true;
	}
	get crossSectionBackground() {
		return this.ngviewer.crossSectionBackgroundColor.value;
	}
	set crossSectionBackground(color: vec3) {
		this.ngviewer.crossSectionBackgroundColor.value = color;
	}
	get perspectiveViewBackground() {
		return this.ngviewer.perspectiveViewBackgroundColor.value;
	}
	set perspectiveViewBackground(color: vec3) {
		this.ngviewer.perspectiveViewBackgroundColor.value = color;
	}
	restoreState(state: any) {
		NehubaViewer.restoreViewerState(this.ngviewer, state, this.config);
	}

	static create(configuration?: Config/* , container?: HTMLElement */, errorHandler?: (error: Error) => void) { //TODO Accept String id for container and lookup ElementById
		const config = configuration || {};

		const parent = /* container ||  */document.getElementById('neuroglancer-container')!; //TODO id as param ( String|HTMLElement )
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

		if (config.hideNeuroglancerUI) viewer.uiConfiguration.showUIControls.value = false;
		this.setBackgroundsFromConfig(viewer, config);

		configureInstance(viewer, config);

		if (viewer.layerManager.managedLayers.length === 0) {
			NehubaViewer.restoreInitialState(viewer, config);
		}

		return new NehubaViewer(viewer, config, errorHandler);
	}

	private static setBackgroundsFromConfig(viewer: Viewer, config: Config) {
		const crossSections = (config.dataset && config.dataset.imageBackground) || config.crossSectionBackground;
		if (crossSections) viewer.crossSectionBackgroundColor.value = crossSections;
		const perspective = (config.dataset && config.dataset.imageBackground) || config.perspectiveViewBackground;
		if (perspective) viewer.perspectiveViewBackgroundColor.value = perspective;
	}

	get config() { return this._config; }
	/** Temporary experimental workaround, might not work as expected. Don't use if you can avoid it. */
	set config(newConfig: Config) {
		this._config = newConfig;
		(this.ngviewer.display.container as any)[configSymbol] = this._config;
	}

	private _createdSegmentationUserLayers: Observable<SegmentationUserLayer>;
	private get createdSegmentationUserLayers() { return this._createdSegmentationUserLayers.unseen(); }

	private constructor(viewer: Viewer, config: Config, public errorHandler?: (error: Error) => void) {
		this.ngviewer = viewer;
		this._config = config;

		//TODO Use reactive wrapper around viewer to send error to new subscribers if viewer has been disposed. rx.defer ( -> Obs.from || Obs.err).map (...)...

		const nav = viewer.navigationState;
		this.navigationState = {
			position: {
				// inRealSpace: Observable.empty(), // FIXME
				inVoxels: rxify(nav.position, p => {
					const voxelPos = p.value.slice();
					for (let i = 0; i < 3; ++i) voxelPos[i] = Math.floor(voxelPos[i]);
					return voxelPos;
				}, {share: false}).notNull().publishReplay(1).refCount()
			},
			orientation: rxify(nav.pose.orientation, o => quat.clone(o.orientation)),
			sliceZoom: rxify({s: nav.zoomFactor, r: nav}, z => z.value),
			perspectiveZoom: rxify({s: viewer.perspectiveNavigationState.zoomFactor, r: viewer.perspectiveNavigationState}, z => z.value),
			perspectiveOrientation: rxify(viewer.perspectiveNavigationState.pose.orientation, o => quat.clone(o.orientation)),
			full: rxify(nav, n => { return {
				position: n.position.value.slice(), 
				orientation: quat.clone(n.pose.orientation.orientation), 
				zoom: n.zoomFactor.value
			}}),
			get all() {
				const perspective = this.perspectiveZoom.combineLatest(this.perspectiveOrientation, (perspectiveZoom, perspectiveOrientation) => {return {perspectiveZoom, perspectiveOrientation}});
				return this.full.combineLatest(perspective, (full, perspective) => {return {...full, ...perspective}}).publishReplay(1).refCount();
			}
		}

		const mouse = rxify({s: viewer.mouseState, r: viewer}, m => m.active ? m.position.slice() : null);
		this.mousePosition = {
			// inRealSpace: mouse,
			inVoxels: mouse.map( position => {
				if (position) {
					const voxelPos = position.slice();
					for (let i = 0; i < 3; ++i) voxelPos[i] = Math.floor(voxelPos[i]);
					return voxelPos;
				} else return position;
			}).publishReplay(1).refCount()
		}

		const {layerManager} = viewer;
		const managedLayers = rxify({s: {changed: layerManager.layersChanged, layerManager}, r: layerManager}, s => s.layerManager) //emits layerManager when layers cahnge, shared, so it will cashe layerManager reference
		.concatMap(it => Observable.from(it.managedLayers));

		//Config.disableSegmentSelection 
		this._createdSegmentationUserLayers = managedLayers.map(l => l.layer).notNull()
		// .ofType(SegmentationUserLayer)
		.filter(l => l instanceof SegmentationUserLayer).map(l => l as SegmentationUserLayer);
		
		this.createdSegmentationUserLayers.subscribe(l => {if (this.config.disableSegmentSelection) disableSegmentSelectionForLayer(l)});
		this.createdSegmentationUserLayers.subscribe(l => {if (this.config.disableSegmentHighlighting) disableSegmentHighlightingForLayer(l)});

		const userLayersWithNames = managedLayers.let(toUserLayersWithNames);
		
		const segmentationLayersWithNames = userLayersWithNames.filter(it => it.userLayer instanceof SegmentationUserLayer).map(it => {return {name: it.name, layer: (it.userLayer as SegmentationUserLayer)}});

		const segment = segmentationLayersWithNames
		.unseen(it => it.layer)
		.flatMap(it => {
			const name = it.name;
			// const url = it.layer.volumePath; FIXME
			return rxify(it.layer.displayState.segmentSelectionState, s => {
				return {
					segment: s.hasSelectedSegment ? this.segmentToNumber(s.selectedSegment) : null,
					layer: {name/* , url */} // FIXME url
				}
			})
		}).publishReplay(1).refCount(); //Cashing last emission does not make a lot of sense here since we are merging different layers

		const mouseOverLayer = rxify(viewer.layerSelectedValues, s => s)
		.concatMap(it => {
			return Observable.from(it.layerManager.managedLayers)
			.filter(it => it.visible).let(toUserLayersWithNames)
			.map(l => {return {mouse: it.mouseState, layer: l}})
		});
		
		const image = mouseOverLayer.filter(it => it.layer.userLayer instanceof ImageUserLayer).let(toLayerValues).map(it => {return {...it, layer: {...it.layer, url: it.layer.url!}}});
		const layer = mouseOverLayer.let(toLayerValues);
		this.mouseOver = {segment, image, layer};
	}

	private getSingleSegmentationColors(layer?: {name?: string, url?:string}) {
		const res = this.getSingleSegmentation(layer).displayState.segmentColorHash;
		if (res instanceof NehubaSegmentColorHash) return res;
		else throw Error('Looks like neuroglancer was not patched and hooked to support custom segment colors. Are you sure you enabled it by `config.globals.useCustomSegmentColors: true` or similar?');//this.throwError('Looks like ');
	}
	private getSingleSegmentation(layer?: {name?: string/* , url?:string */}) { //FIXME url
		const res = this.ngviewer.layerManager.managedLayers
			.filter(l => { return !layer || !layer.name || l.name === layer.name })
			.map(l  => { return l.layer; })
			.filter(l => { return !!l; }) // null-check, just in case, perchaps not needed
			.filter(l => { return l instanceof SegmentationUserLayer; })
			.map(l => { return l as SegmentationUserLayer })
			// .filter(l => { return !layer || !layer.url || l.volumePath === layer.url }) FIXME
		if (res.length === 0) this.throwError('No parcellation found');
		if (res.length > 1) this.throwError('Ambiguous request. Multiple parcellations found')
		return res[0];
	}

	private segmentToNumber(segment: Uint64) {
		if (segment.high !== 0) this.throwError('Segment id number does not fit into 32 bit integer ' + segment.toString(10));
		return segment.low;
	}

	private throwError(message: string): never {
		const error = new Error(message);
		const {errorHandler} = this;
		// this.errorHandler ? this.errorHandler(error) :  (() => {throw error})();
		errorHandler && errorHandler(error);
		throw error;
	}

	private static restoreInitialState(viewer: Viewer, config: Config) {
		const state = config.dataset && config.dataset.initialNgState;
		state && this.restoreViewerState(viewer, state, config);
	}

	private static restoreViewerState(viewer: Viewer, state: any, config: Config) {
		viewer.state.reset(); //Needed to reset from split view, reset obliqe slicing, reset slices checkbox etc...
		viewer.state.restoreState(state);
		if (!state.crossSectionBackgroundColor) NehubaViewer.setBackgroundsFromConfig(viewer, config);
	}

	private checkRGB(color: {red:number, green: number, blue: number}) {
		this.checkRGBValue(color.red, 'red');
		this.checkRGBValue(color.green, 'green');
		this.checkRGBValue(color.blue, 'blue');
	}
	private checkRGBValue(n: number, channel: string) { 
		if (!Number.isInteger(n)) this.throwError(`Provided color value ${n} for ${channel} channel is not an integer (0 to 255).`);
		if (n < 0 || n > 255) this.throwError(`Provided color value ${n} for ${channel} channel is not in expected range of 0 to 255.`);
	};
}

function toUserLayersWithNames(managedLayers: Observable<ManagedUserLayer>) {
	return managedLayers
	.map(it => {return {name: it.name, value: it.layer}})
	.filter(it => !!it.value).map(it => {return {name: it.name, userLayer: it.value!}});
}

function toLayerValues(mouseLayer: Observable<{mouse: MouseSelectionState, layer: {name: string, userLayer: UserLayer}}>) {
	return mouseLayer
	.map(it => {
		const userLayer = it.layer.userLayer;
		const value = userLayer.getValueAt(it.mouse.position, it.mouse);
		let url = (userLayer as any).volumePath;
		if (!url) url = (userLayer as any).parameters && (userLayer as any).parameters.meshSourceUrl;
		return {value: value === 0 ? 0 : (value ? value : null), layer: {name: it.layer.name, url: url ? url as string : undefined}};
	});
}