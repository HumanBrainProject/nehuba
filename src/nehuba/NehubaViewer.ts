import { Viewer } from "neuroglancer/unstable/viewer.js"
import { makeDefaultViewer } from "neuroglancer/unstable/ui/default_viewer.js"
import { Config } from "./config";
import { patchNeuroglancer } from "./patches";
import { configureInstance, setNehubaDefaultInputEventBindings } from "./hooks";
import { makeLayer } from "neuroglancer/unstable/layer/index.js";
import { configSymbol } from "./nehuba_layout";

export class NehubaViewer {
  static create(
    config: Config,
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

    return new NehubaViewer(viewer, config)
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
  }

  addLayer(spec: any, name?: string){
    const _name = name || spec.get("name")
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
    this.ngviewer.layerManager.addManagedLayer(l)
    
    return l
  }
}

/**
 * 
https://neuroglancer.humanbrainproject.eu/precomputed/BigBrainRelease.2015/8bit|neuroglancer-precomputed:
 */