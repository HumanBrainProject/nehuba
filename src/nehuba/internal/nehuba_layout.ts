import * as L from 'neuroglancer/layout';
import {NavigationState, OrientationState, Pose} from 'neuroglancer/navigation_state';
import {PerspectivePanel} from 'neuroglancer/perspective_view/panel';
import {SliceView} from 'neuroglancer/sliceview/frontend';
import {SliceViewPanel} from 'neuroglancer/sliceview/panel';
import {TrackableBoolean} from 'neuroglancer/trackable_boolean';
import {RefCounted} from 'neuroglancer/util/disposable';
import {removeChildren} from 'neuroglancer/util/dom';
import {vec3, quat} from 'neuroglancer/util/geom';

import { SliceViewViewerState, ViewerUIState, getCommonViewerState } from 'neuroglancer/viewer_layouts.ts';
import { Viewer } from 'neuroglancer/viewer';
import { startRelativeMouseDrag } from 'neuroglancer/util/mouse_drag';

import { NehubaPerspectivePanel } from "shuba/internal/nehuba_perspective_panel";
import { restrictUserNavigation } from "shuba/hooks";
import { Config } from "shuba/config";

/**
 * This function started as a copy of makeSliceView from https://github.com/google/neuroglancer/blob/9c78cd512a722f3fe9ed097155b6f64f48b8d1c9/src/neuroglancer/viewer_layouts.ts
 * Copied on 19.07.2017 (neuroglancer master commit 9c78cd512a722f3fe9ed097155b6f64f48b8d1c9) and renamed.
 * Latest commit to viewer_layouts.ts 736b20335d4349d8a252bd37e33d343cb73294de on May 21, 2017 "feat: Add Viewer-level prefetching support."
 * Any changes in upstream version since then must be manually applied here with care.
 */
const sliceQuat = Symbol('SliceQuat');
function makeSliceViewNhb(viewerState: SliceViewViewerState, baseToSelf?: quat, customZoom?: number) {
  let navigationState: NavigationState;
  if (baseToSelf === undefined) {
    navigationState = viewerState.navigationState;
  } else {
    navigationState = new NavigationState(
        new Pose(
            viewerState.navigationState.pose.position,
            OrientationState.makeRelative(
                viewerState.navigationState.pose.orientation, baseToSelf)),
        customZoom || viewerState.navigationState.zoomFactor);
  }
  const slice =  new SliceView(viewerState.chunkManager, viewerState.layerManager, navigationState);
  (<any>slice)[sliceQuat] = baseToSelf || quat.create();
  return slice;
}

/**
 * In neuroglancer's FourPanelLayout all the work is done in constructor. So it is not feasible to extend or monkey-patch it. 
 * Therefore the fork of the whole FourPanelLayout class is needed to change it.
 * 
 * This class started as a copy of FourPanelLayout from https://github.com/google/neuroglancer/blob/9c78cd512a722f3fe9ed097155b6f64f48b8d1c9/src/neuroglancer/viewer_layouts.ts
 * Copied on 19.07.2017 (neuroglancer master commit 9c78cd512a722f3fe9ed097155b6f64f48b8d1c9) and renamed.
 * Latest commit to viewer_layouts.ts 736b20335d4349d8a252bd37e33d343cb73294de on May 21, 2017 "feat: Add Viewer-level prefetching support."
 * Any changes in upstream version since then must be manually applied here with care.
 */
export class NehubaLayout extends RefCounted {
  constructor(public rootElement: HTMLElement, public viewer: ViewerUIState) {
    super();

    let sliceViews = makeOrthogonalSliceViews(viewer);
    let {display} = viewer;

    const perspectiveViewerState = {
      ...getCommonViewerState(viewer),
      navigationState: viewer.perspectiveNavigationState,
      showSliceViews: viewer.showPerspectiveSliceViews,
      showSliceViewsCheckbox: true,
    };

    const sliceViewerState = {
      ...getCommonViewerState(viewer),
      navigationState: viewer.navigationState,
      showScaleBar: viewer.showScaleBar,
    };

    const sliceViewerStateWithoutScaleBar = {
      ...getCommonViewerState(viewer),
      navigationState: viewer.navigationState,
      showScaleBar: new TrackableBoolean(false, false),
    };
    let mainDisplayContents = [
      L.withFlex(1, L.box('column', [
        L.withFlex(1, L.box('row', [
          L.withFlex(1, element => {
            element.className = 'gllayoutcell noselect';
            this.registerDisposer(new SliceViewPanel(display, element, sliceViews[0], sliceViewerState));
          }),
          L.withFlex(1, element => {
            element.className = 'gllayoutcell noselect';
            this.registerDisposer(new SliceViewPanel(display, element, sliceViews[1], sliceViewerStateWithoutScaleBar));
          })
        ])),
        L.withFlex(1, L.box('row', [
          L.withFlex(1, element => {
            element.className = 'gllayoutcell noselect';
            let perspectivePanel = this.registerDisposer(
                new PerspectivePanel(display, element, perspectiveViewerState));
            for (let sliceView of sliceViews) {
              perspectivePanel.sliceViews.add(sliceView.addRef());
            }
          }),
          L.withFlex(1, element => {
            element.className = 'gllayoutcell noselect';
            this.registerDisposer(new SliceViewPanel(display, element, sliceViews[2], sliceViewerStateWithoutScaleBar));
          })
        ])),
      ]))
    ];
    L.box('row', mainDisplayContents)(rootElement);
    display.onResize();
  }

  disposed() {
    removeChildren(this.rootElement);
    super.disposed();
  }
}

// ****** !!! Needs attention !!! ******  Even so the change is minimal - the code is forked/copy-pasted from NG and needs to be updated if changed upstream.
// The startDragViewport function is copied from https://github.com/google/neuroglancer/blob/9c78cd512a722f3fe9ed097155b6f64f48b8d1c9/src/neuroglancer/sliceview/panel.ts
// Copied on 19.07.2017 (neuroglancer master commit 9c78cd512a722f3fe9ed097155b6f64f48b8d1c9).
// Latest commit to panel.ts 3d08828cc337dce1e9bba454f0ef00073697b2e0 on Jun 6, 2017 " fix: make SliceViewPanel and PerspectivePanel resize handling more ro…"
// Any changes in upstream version since then must be manually applied here with care.
function disableFixedPointInRotation(slice: SliceViewPanel, config: Config) {
	slice.startDragViewport = function (this: SliceViewPanel, e: MouseEvent) {
    let {mouseState} = this.viewer;
    if (mouseState.updateUnconditionally()) {
      let initialPosition = vec3.clone(mouseState.position);
      startRelativeMouseDrag(e, (event, deltaX, deltaY) => {
        let {position} = this.viewer.navigationState;
        if (event.shiftKey) {
          let {viewportAxes} = this.sliceView;
          this.viewer.navigationState.pose.rotateAbsolute(
              viewportAxes[1], deltaX / 4.0 * Math.PI / 180.0, initialPosition);
          this.viewer.navigationState.pose.rotateAbsolute(
              viewportAxes[0], deltaY / 4.0 * Math.PI / 180.0, initialPosition);
        } else {
          let pos = position.spatialCoordinates;
          vec3.set(pos, deltaX, deltaY, 0);
          vec3.transformMat4(pos, pos, this.sliceView.viewportToData);
          position.changed.dispatch();
        }
      });
    }
	};

  return slice;
}
/*
function patchSliceView(slice: SliceViewPanel) {
  let untyped = slice as any;
  untyped.unregisterDisposer(untyped.sliceViewRenderHelper);
  untyped.registerDisposer(untyped.sliceViewRenderHelper = NehubaSliceViewRenderHelper.get(untyped.gl, sliceViewPanelEmitColor))
  return slice;
}
*/