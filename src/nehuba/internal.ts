import { Config } from "./config"
import { NehubaLayout } from "./nehuba_layout"
import { LAYOUTS } from "neuroglancer/unstable/data_panel_layout.js"

let patched: boolean = false

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
	// if (conf.hideNullImageValues) fix_HideNullImageValues();
	// if (conf.useCustomSegmentColors) useNehubaColorsInSegmentationRenderLayer(); // !!! Depends on complementary hook in `hooks.ts`
	// if (conf.useNehubaMeshLayer) useNehubaMeshInSegmentationLayer(config.enableMeshLoadingControl);

	patched = true;
}
