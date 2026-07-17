import { Viewer } from "neuroglancer/unstable/viewer.js"
import { makeDefaultViewer } from "neuroglancer/unstable/ui/default_viewer.js"
import { packColor } from "neuroglancer/unstable/util/color.js"
import { Config } from "./config";
import { patchNeuroglancer } from "./patches";
import { configureInstance, setNehubaDefaultInputEventBindings } from "./hooks";
import { makeLayer, ManagedUserLayer } from "neuroglancer/unstable/layer/index.js";
import { SegmentationUserLayer } from "neuroglancer/unstable/layer/segmentation/index.js";
import { configSymbol } from "./nehuba_layout";
import { vec3, vec4 } from "neuroglancer/unstable/util/geom.js";

/** Value emitted by {@link NehubaViewer.mouseOver}'s `segment` observable.
 *  Attention! A `null` segment indicates that the mouse left the segmentation area. */
export interface MouseOverSegment {
  segment: number | null;
  layer: { name: string; url?: string };
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
    config: Config = {},
    target?: HTMLElement,
    errorHandler?: (error: Error) => void
  ) {
    const _target = target || document.getElementById("neuroglancer-container");
		if ((<any>_target)[configSymbol]) {
			const error = new Error('Viewer is already created in this container: ' + parent);
			// errorHandler ? errorHandler(error) :  (() => {throw error})();
			errorHandler && errorHandler(error);
			throw error;
		}
    (<any>_target)[configSymbol] = config;
    patchNeuroglancer(config);

    const viewer = makeDefaultViewer()
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
      segment: this.createMouseOverSegmentObservable(viewer)
    }
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
  }
}

/**
 * 
https://neuroglancer.humanbrainproject.eu/precomputed/BigBrainRelease.2015/8bit|neuroglancer-precomputed:
 */