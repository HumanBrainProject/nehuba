// Side-effect import: registers the volume chunk-format handlers (uncompressed +
// compressed-segmentation) that `getChunkFormatHandler` looks up on the main
// thread. Upstream this is pulled in by `ui/minimal_viewer.js`, which
// `makeNehubaViewer` (below) bypasses in order to inject a custom data context,
// so it must be imported explicitly here.
import "neuroglancer/unstable/sliceview/chunk_format_handlers.js"
import { Viewer } from "neuroglancer/unstable/viewer.js"
import { DisplayContext } from "neuroglancer/unstable/display_context.js"
import {
  disableContextMenu,
  disableWheel,
} from "neuroglancer/unstable/ui/disable_default_actions.js"
import { packColor } from "neuroglancer/unstable/util/color.js"
import { NehubaDataManagementContext } from "./nehuba_data_context"
import { Config } from "./config";
import { patchNeuroglancer } from "./patches";
import { configureInstance, setNehubaDefaultInputEventBindings } from "./hooks";
import { makeLayer, ManagedUserLayer } from "neuroglancer/unstable/layer/index.js";
import { SegmentationUserLayer } from "neuroglancer/unstable/layer/segmentation/index.js";
import { configSymbol } from "./nehuba_layout";
import { quat, vec3, vec4 } from "neuroglancer/unstable/util/geom.js";
import { isVisibleSegmentsWrapper } from "./nehuba_mesh_layer";

/**
 * Builds a neuroglancer {@link Viewer} wired to nehuba's custom chunk worker
 * (via {@link NehubaDataManagementContext}), so custom backend data sources such
 * as `nehuba-nifti` work. Mirrors `makeDefaultViewer` / `makeMinimalViewer`
 * upstream, plus the injected data context.
 */
function makeNehubaViewer(target?: HTMLElement): Viewer {
  disableContextMenu();
  disableWheel();
  let el: HTMLElement | null =
    target ?? document.getElementById("neuroglancer-container");
  if (el === null) {
    el = document.createElement("div");
    el.id = "neuroglancer-container";
    document.body.appendChild(el);
  }
  const display = new DisplayContext(el);
  const dataContext = new NehubaDataManagementContext(
    display.gl,
    display,
  ) as any;
  return new Viewer(display, { dataContext });
}

/** Value emitted by {@link NehubaViewer.mouseOver}'s `segment` observable.
 *  Attention! A `null` segment indicates that the mouse left the segmentation area. */
export interface MouseOverSegment {
  segment: number | null;
  layer: { name: string; url?: string };
}

/** Snapshot of the full navigation state emitted by
 *  {@link NehubaViewer.navigationState}'s `all` observable. */
export interface NavigationStateAll {
  orientation: quat;
  perspectiveOrientation: quat;
  perspectiveZoom: number;
  /** Physical position of the display dimensions, in nanometres. */
  position: vec3;
  zoom: number;
}

export interface Subscription {
  unsubscribe: () => void;
}

/**
 * Minimal RxJS-free observable. Only `subscribe`/`unsubscribe` are supported.
 * `subscribeFn` receives the observer callback and returns a teardown function
 * that is invoked on unsubscribe.
 */
export class Observable<T> {
  constructor(private subscribeFn: (next: (value: T) => void) => () => void) {}

  subscribe(next: (value: T) => void): Subscription {
    const teardown = this.subscribeFn(next);
    return { unsubscribe: teardown };
  }
}

export class NehubaViewer {
  static create(
    config: Config |null = null,
    target?: HTMLElement,
    errorHandler?: (error: Error) => void
  ) {
    config = config || {}
    const _target = target || document.getElementById("neuroglancer-container");
		if ((<any>_target)[configSymbol]) {
			const error = new Error('Viewer is already created in this container: ' + parent);
			// errorHandler ? errorHandler(error) :  (() => {throw error})();
			errorHandler && errorHandler(error);
			throw error;
		}
    (<any>_target)[configSymbol] = config;
    patchNeuroglancer(config);

    const viewer = makeNehubaViewer(_target ?? undefined)
    setNehubaDefaultInputEventBindings(viewer.inputEventBindings)
    if (config.hideNeuroglancerUI) viewer.uiConfiguration.showUIControls.value = false;
    this.setBackgroundsFromConfig(viewer, config);
		configureInstance(viewer, config);
    
		if (viewer.layerManager.managedLayers.length === 0) {
			NehubaViewer.restoreInitialState(viewer, config);
		}

    return new NehubaViewer(viewer, config)
  }
  private static restoreInitialState(viewer: Viewer, config: Config){
    
		const state = config.dataset && config.dataset.initialNgState;
		state && this.restoreViewerState(viewer, state, config);
  }
  
	private static restoreViewerState(viewer: Viewer, state: any, config: Config) {
		viewer.state.reset(); //Needed to reset from split view, reset obliqe slicing, reset slices checkbox etc...
		viewer.state.restoreState(state);
		if (!state.crossSectionBackgroundColor) NehubaViewer.setBackgroundsFromConfig(viewer, config);
	}
  
	private static setBackgroundsFromConfig(viewer: Viewer, config: Config) {
		const crossSections = (config.dataset && config.dataset.imageBackground) || config.crossSectionBackground;
		if (crossSections) viewer.crossSectionBackgroundColor.value = crossSections;
		const perspective = (config.dataset && config.dataset.imageBackground) || config.perspectiveViewBackground;
		if (perspective) viewer.perspectiveViewBackgroundColor.value = perspective;
	}
  
  public ngviewer: Viewer | null = null
  public config: Config | null = null

  constructor(viewer: Viewer, config: Config) {
    this.ngviewer = viewer
    this.config = config
    this.mouseOver = {
      segment: this.createMouseOverSegmentObservable(viewer),
      position: this.createMouseOverPositionObservable(viewer)
    }
    this.navigationState = {
      all: this.createNavigationStateAllObservable(viewer)
    }
  }

  dispose(){
    
  }

  /**
   * Builds an observable emitting a snapshot of the cross-section and
   * perspective navigation state (orientation, position, zoom). Only emits
   * when at least one of the values actually changed, so that redundant
   * `changed` dispatches from neuroglancer do not produce duplicate emissions.
   */
  private createNavigationStateAllObservable(viewer: Viewer): Observable<NavigationStateAll> {
    return new Observable<NavigationStateAll>((next) => {
      let last: NavigationStateAll | null = null;

      // Convert the current voxel position into physical nanometres for the
      // (up to three) display dimensions. neuroglancer stores `scales` in base
      // SI units (metres per voxel for length dimensions), so nm = voxel * scale * 1e9.
      const physicalPositionNm = (): vec3 => {
        const nav = viewer.navigationState;
        const voxel = nav.position.value;
        const { scales } = nav.position.coordinateSpace.value;
        const { displayDimensionIndices, displayRank } = nav.pose.displayDimensions.value;
        const out = vec3.create();
        for (let i = 0; i < displayRank; ++i) {
          const dim = displayDimensionIndices[i];
          out[i] = voxel[dim] * scales[dim] * 1e9;
        }
        return out;
      };

      const snapshot = (): NavigationStateAll => ({
        orientation: quat.clone(viewer.navigationState.pose.orientation.orientation),
        perspectiveOrientation: quat.clone(viewer.perspectiveNavigationState.pose.orientation.orientation),
        perspectiveZoom: viewer.perspectiveNavigationState.zoomFactor.value,
        position: physicalPositionNm(),
        zoom: viewer.navigationState.zoomFactor.value,
      });

      const differs = (a: NavigationStateAll, b: NavigationStateAll) =>
        a.zoom !== b.zoom
        || a.perspectiveZoom !== b.perspectiveZoom
        || !vec3.exactEquals(a.position, b.position)
        || !quat.exactEquals(a.orientation, b.orientation)
        || !quat.exactEquals(a.perspectiveOrientation, b.perspectiveOrientation);

      const emit = () => {
        const current = snapshot();
        if (last === null || differs(last, current)) {
          last = current;
          next(current);
        }
      };

      emit();
      const unsubCrossSection = viewer.navigationState.changed.add(emit);
      const unsubPerspective = viewer.perspectiveNavigationState.changed.add(emit);

      return () => {
        unsubCrossSection();
        unsubPerspective();
      };
    });
  }

  /**
   * Builds an observable emitting the currently hovered segment across all
   * segmentation layers. Emits `{segment: null, ...}` when the mouse leaves a
   * segment, so consumers should check for `null` before using the value.
   */
  private createMouseOverSegmentObservable(viewer: Viewer): Observable<MouseOverSegment> {
    return new Observable<MouseOverSegment>((next) => {
      // Per-managed-layer teardown for the segmentSelectionState subscription.
      const perLayer = new Map<ManagedUserLayer, () => void>();

      const emit = (managed: ManagedUserLayer, userLayer: SegmentationUserLayer) => {
        const state = userLayer.displayState.segmentSelectionState;
        next({
          segment: state.hasSelectedSegment ? Number(state.selectedSegment) : null,
          layer: { name: managed.name }
        });
      };

      const rescan = () => {
        const current = new Set<ManagedUserLayer>();
        for (const managed of viewer.layerManager.managedLayers) {
          const userLayer = managed.layer;
          if (!(userLayer instanceof SegmentationUserLayer)) continue;
          current.add(managed);
          if (perLayer.has(managed)) continue;
          const state = userLayer.displayState.segmentSelectionState;
          perLayer.set(managed, state.changed.add(() => emit(managed, userLayer)));
        }
        // Detach layers that are no longer present.
        for (const [managed, teardown] of perLayer) {
          if (!current.has(managed)) {
            teardown();
            perLayer.delete(managed);
          }
        }
      };

      rescan();
      const unsubLayersChanged = viewer.layerManager.layersChanged.add(rescan);

      return () => {
        unsubLayersChanged();
        for (const teardown of perLayer.values()) teardown();
        perLayer.clear();
      };
    });
  }

  /**
   * Builds an observable emitting the physical position of the mouse cursor in
   * nanometres for the (up to three) display dimensions. Emits `null` when the
   * cursor leaves the view / is not associated with a position, so consumers
   * should check for `null` before using the value.
   */
  private createMouseOverPositionObservable(viewer: Viewer): Observable<vec3 | null> {
    return new Observable<vec3 | null>((next) => {
      const mouseState = viewer.mouseState;

      // Convert the current mouse voxel position into physical nanometres for
      // the display dimensions. `scales` are in base SI units (metres per voxel
      // for length dimensions), so nm = voxel * scale * 1e9.
      const physicalPositionNm = (): vec3 | null => {
        if (!mouseState.active) return null;
        const voxel = mouseState.position;
        const { scales } = mouseState.coordinateSpace;
        const { displayDimensionIndices, displayRank } = viewer.navigationState.pose.displayDimensions.value;
        const out = vec3.create();
        for (let i = 0; i < displayRank; ++i) {
          const dim = displayDimensionIndices[i];
          out[i] = voxel[dim] * scales[dim] * 1e9;
        }
        return out;
      };

      let last: vec3 | null = null;
      const emit = () => {
        const current = physicalPositionNm();
        // Skip redundant emissions (both null, or identical positions).
        if (last === null && current === null) return;
        if (last !== null && current !== null && vec3.exactEquals(last, current)) return;
        last = current;
        next(current);
      };

      emit();
      const unsub = mouseState.changed.add(emit);
      return () => unsub();
    });
  }

  /**
   * Moves the cross-section to the given physical position, expressed in
   * nanometres for the (up to three) display dimensions. This is the inverse of
   * the conversion used by {@link createNavigationStateAllObservable}: since
   * neuroglancer stores `scales` in base SI units (metres per voxel for length
   * dimensions), voxel = nm / (scale * 1e9).
   */
  setPosition(position: vec3){
    const nav = this.ngviewer?.navigationState;
    if (!nav) {
      throw new Error("navigationState not populated")
    }
    const { scales } = nav.position.coordinateSpace.value;
    const { displayDimensionIndices, displayRank } = nav.pose.displayDimensions.value;
    const voxel = nav.position.value;
    for (let i = 0; i < displayRank; ++i) {
      const dim = displayDimensionIndices[i];
      voxel[dim] = position[i] / (scales[dim] * 1e9);
    }
    nav.position.value = voxel;
  }

  addLayer(spec: any, name?: string, insertIndex?: number){
    const _name = name || spec["name"]
    if (!_name) {
      throw new Error("layer name must be provided")
    }
    const manager = this.ngviewer?.layerManager
    if (!manager) {
      throw new Error("layermanager not populated")
    }
    if (!this.ngviewer?.layerSpecification) {
      throw new Error("layerspecification is undefined")
    }
    const l = makeLayer(this.ngviewer?.layerSpecification, _name, spec)
    this.ngviewer.layerManager.addManagedLayer(l, insertIndex)
    
    return l
  }

  setMeshesToLoad(ids: number[], layername: string){
    const layer = this.ngviewer?.layerManager.getLayerByName(layername);
    if (!(layer?.layer instanceof SegmentationUserLayer)) {
      return
    }
    if (!isVisibleSegmentsWrapper(layer.layer.displayState.segmentationGroupState.value.visibleSegments)) {
      return
    }
    layer.layer.displayState.segmentationGroupState.value.visibleSegments.setMeshesToLoad(ids)
  }

  showSegments(ids: number[], layername: string){
    const layer = this.ngviewer?.layerManager.getLayerByName(layername)
    if (!(layer?.layer) || !(layer?.layer instanceof SegmentationUserLayer)) {
      return
    }
    layer?.layer.displayState.segmentationGroupState.value.visibleSegments.clear()
    layer?.layer.displayState.segmentationGroupState.value.visibleSegments.add(ids.map(v => BigInt(v)))
  }

  setSegmentsColors(colormap: Record<number, vec3|vec4>, layername: string){
    const layer = this.ngviewer?.layerManager.getLayerByName(layername)
    if (!(layer?.layer) || !(layer?.layer instanceof SegmentationUserLayer)) {
      return
    }
    const cgs = layer.layer.displayState.segmentationColorGroupState.value
    cgs.segmentStatedColors.clear()
    for (const [ idx, rgb ] of Object.entries(colormap)){
      const packedColor = packColor(rgb)
      cgs.segmentStatedColors.set(BigInt(idx), BigInt(packedColor))
    }
  }

  /** Attention! Uses `null` values to indicate that the mouse left the segment,
   *  so it is NECESSARY to check the value for null before using it. */
  readonly mouseOver: {
    readonly segment: Observable<MouseOverSegment>
    /** Physical mouse position in nanometres for the display dimensions, or
     *  `null` when the cursor is not over the view. */
    readonly position: Observable<vec3 | null>
  }

  /** Emits a snapshot of the navigation state whenever orientation, position
   *  or zoom (cross-section or perspective) changes. */
  readonly navigationState: {
    readonly all: Observable<NavigationStateAll>
  }
}

/**
 * 
https://neuroglancer.humanbrainproject.eu/precomputed/BigBrainRelease.2015/8bit|neuroglancer-precomputed:
 */