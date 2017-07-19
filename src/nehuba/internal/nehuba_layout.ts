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
export function makeSliceView(viewerState: SliceViewViewerState, baseToSelf?: quat) {
  let navigationState: NavigationState;
  if (baseToSelf === undefined) {
    navigationState = viewerState.navigationState;
  } else {
    navigationState = new NavigationState(
        new Pose(
            viewerState.navigationState.pose.position,
            OrientationState.makeRelative(
                viewerState.navigationState.pose.orientation, baseToSelf)),
        viewerState.navigationState.zoomFactor);
  }
  return new SliceView(viewerState.chunkManager, viewerState.layerManager, navigationState);
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