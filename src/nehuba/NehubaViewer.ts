import { setupDefaultViewer } from 'neuroglancer/ui/default_viewer_setup';
import { Viewer } from "neuroglancer/viewer";

import { Config } from "nehuba/config";
import { patchNeuroglancer } from "nehuba/internal/patches";
import { configureInstance, configureParent } from "nehuba/internal/hooks";
import { configSymbol } from "nehuba/internal/nehuba_layout";

/** Create viewer */
export function createNehubaViewer(configuration?: Config, container?: HTMLElement) { //TODO Accept String id for container and lookup ElementById
	return NehubaViewer.create(configuration, container);
}

export class NehubaViewer {
	/** Don't use it, should be private. Left exposed just in case you urgently need it and there is no way around it.
	 *  But be warned that you can easily brake things by accessing it directly. */
	ngviewer: Viewer

	private constructor(viewer: Viewer) {
		this.ngviewer = viewer;
	}

	static create(configuration?: Config, container?: HTMLElement) { //TODO Accept String id for container and lookup ElementById
		const config = configuration || {};

		const parent = container || document.getElementById('container')!; //TODO id as param ( String|HTMLElement )
		if ((<any>parent)[configSymbol]) throw new Error('Viewer is already created in this container: ' + parent);
		(<any>parent)[configSymbol] = config;

		patchNeuroglancer(config);
		configureParent(parent, config);

		let viewer = setupDefaultViewer();

		configureInstance(viewer, config);

		if (viewer.layerManager.managedLayers.length === 0) {
			const state = config.dataset && config.dataset.initialNgState;
			state && viewer.state.restoreState(state);
		}

		return new NehubaViewer(viewer);
	}

	relayout() {
		this.ngviewer.layoutName.changed.dispatch();
	}
}