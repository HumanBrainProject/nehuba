import { EventActionMap } from "neuroglancer/unstable/util/event_action_map.js"
import { InputEventBindings } from "neuroglancer/unstable/data_panel_layout.js"

import { Config } from "./config"
import { Viewer } from "neuroglancer/unstable/viewer.js";
import { Position } from "neuroglancer/unstable/navigation_state.js";


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

export function configureInstance(viewer: Viewer, config: Config) {
	const layoutConfig = config.layout || {};
	if (config.restrictUserNavigation || (layoutConfig.useNehubaPerspective && !layoutConfig.useNehubaPerspective.doNotRestrictUserNavigation)) {
    restrictUserNavigation(viewer.navigationState.position)
  }
	// if (config.disableSegmentSelection) disableSegmentSelection(viewer); //@deprecated Handled in NehubaViewer constructor
	
	// !!! Depends on complementary patch in `patches.ts`, so don't rxify it just yet (it's global)
	// if (config.globals && config.globals.useCustomSegmentColors) useNehubaCustomSegmentColors(viewer);
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

export function setNehubaDefaultInputEventBindings(inputEventBindings: InputEventBindings) {
  inputEventBindings.sliceView.addParent(
    getNehubaDefaultSliceViewPanelBindings(),
    Number.NEGATIVE_INFINITY,
  )
  inputEventBindings.perspectiveView.addParent(
    getNehubaDefaultPerspectivePanelBindings(),
    Number.NEGATIVE_INFINITY,
  )
}

export function getNehubaDefaultSliceViewPanelBindings() {
  return EventActionMap.fromObject(
    {
      "at:mousedown0": {
        action: "translate-via-mouse-drag",
        stopPropagation: true,
      },
      "at:shift+mousedown0": {
        action: "rotate-via-mouse-drag",
        stopPropagation: true,
      },
    },
    {
      parents: [
        [getNehubaDefaultRenderedDataPanelBindings(), Number.NEGATIVE_INFINITY]
      ]
    }
  )
}

export function getNehubaDefaultPerspectivePanelBindings() {
  return EventActionMap.fromObject(
    {

      "at:mousedown0": {
        action: "rotate-via-mouse-drag",
        stopPropagation: true,
      },
    },
    {
      parents: [
        [getNehubaDefaultRenderedDataPanelBindings(), Number.NEGATIVE_INFINITY]
      ]
    }
  )
}

export function getNehubaDefaultRenderedDataPanelBindings() {
  return EventActionMap.fromObject(
    {
      "wheel": { action: "zoom-via-wheel", preventDefault: true },
    }
  )
}