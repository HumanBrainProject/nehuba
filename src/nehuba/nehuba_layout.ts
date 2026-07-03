import { RefCounted, Borrowed } from "neuroglancer/unstable/util/disposable.js"
import { quat, vec3 } from "neuroglancer/unstable/util/geom.js"
import { DataPanelLayoutContainer, ViewerUIState, CrossSectionSpecificationMap, SliceViewViewerState, makeSliceView } from "neuroglancer/unstable/data_panel_layout.js"
import { SliceViewPanel } from "neuroglancer/unstable/sliceview/panel.js"



import { Config } from "./config"

const configSymbol = Symbol("configSymbol")

/**
 * In neuroglancer's FourPanelLayout all the work is done in constructor. So it is not feasible to extend or monkey-patch it. 
 * Therefore the fork of the whole FourPanelLayout class is needed to change it.
 * 
 * This class started as a copy of FourPanelLayout from https://github.com/google/neuroglancer/blob/9c78cd512a722f3fe9ed097155b6f64f48b8d1c9/src/neuroglancer/viewer_layouts.ts
 * Copied on 19.07.2017 (neuroglancer master commit 9c78cd512a722f3fe9ed097155b6f64f48b8d1c9) and renamed.
 * Latest commit to include viewer_layouts.ts c1133ca359247f6e29d8996add48b1def564da6b on Oct 30, 2017 "refactor(python): factor out run_in_new_thread function that returns a Future"
 * Any changes in upstream version since then must be manually applied here with care.
 */
export class NehubaLayout extends RefCounted {
  constructor(public container: DataPanelLayoutContainer, public rootElement: HTMLElement, public viewer: ViewerUIState, crossSections: Borrowed<CrossSectionSpecificationMap>) {
    super();
    crossSections; //shut up compiler, see, I used it

    const config: Config = (viewer.display.container as any)[configSymbol];
    if (!config) throw new Error('Are you trying to use nehuba classes directly? Use should use defined API instead');
    const layoutConfig = config.layout || {};

    const configureSliceViewPanel = (slice: SliceViewPanel) => {
      //TODO It is time for NehubaSliceViewPanel
      dispatchRenderEvents(disableFixedPointInZoom(disableFixedPointInRotation(slice, config), config));
      return slice;
    }

    if (!layoutConfig.views) {
      layoutConfig.views = 'hbp-neuro'; // TODO should use neuroglaner quats by default
      // = { //Default neuroglancer quats
      //   slice1: quat.create(),
      //   slice2: quat.rotateX(quat.create(), quat.create(), Math.PI / 2),
      //   slice3: quat.rotateY(quat.create(), quat.create(), Math.PI / 2)
      // }
    }
    if (layoutConfig.views === 'hbp-neuro') {
      layoutConfig.views = {
        slice1: quat.rotateX(quat.create(), quat.create(), -Math.PI / 2),
        slice2: quat.rotateY(quat.create(), quat.rotateX(quat.create(), quat.create(), -Math.PI / 2), -Math.PI / 2),
        slice3: quat.rotateX(quat.create(), quat.create(), Math.PI)
      }
    }
    const views = layoutConfig.views;
    const quats = [views.slice1, views.slice2, views.slice3];
    let sliceViews = quats.map(q => { return makeSliceViewNhb(viewer, q); });

    let perspectivePanel: PerspectivePanel|undefined;
    const makePerspective: L.Handler = element => {

      if (layoutConfig.useNehubaPerspective) {
        const conf = layoutConfig.useNehubaPerspective;
        perspectivePanel = this.registerDisposer(
            new NehubaPerspectivePanel(display, element, perspectiveViewerState, config));
        
        sliceViews.forEach(slice => { (perspectivePanel as NehubaPerspectivePanel).planarSlices.add(slice.addRef()); })
        if (conf.fixedZoomPerspectiveSlices) {
          const cnfg = conf.fixedZoomPerspectiveSlices;
          makeFixedZoomSlicesFromSlices(sliceViews, viewer, cnfg.sliceZoom).forEach(slice => {
            const m = cnfg.sliceViewportSizeMultiplier;
            slice.setViewportSize(cnfg.sliceViewportWidth * m, cnfg.sliceViewportHeight * m);
            // The correct way to fix #1 would be:
            //    perspectivePanel!.registerDisposer(slice.visibility.add(perspectivePanel!.visibility));
            // here. But to support ilastik use-case it is done in NehubaPerspectivePanel.draw(), so that slices don't request their chunks when "Slices" checkbox is unchecked
            perspectivePanel!.sliceViews.set(slice, false);
          })
        } else {
          for (let sliceView of sliceViews) {
            perspectivePanel.sliceViews.set(sliceView.addRef(), false);
          }
        }
        // addUnconditionalSliceViews(viewer, perspectivePanel, crossSections); //not exported in data_panel_layout //TODO Submit PR to export them in the follow-up of PR #44
      } else {
        perspectivePanel = this.registerDisposer(
            new PerspectivePanel(display, element, perspectiveViewerState));
        for (let sliceView of sliceViews) {
          perspectivePanel.sliceViews.set(sliceView.addRef(), false);
        }
        // addUnconditionalSliceViews(viewer, perspectivePanel, crossSections); //not exported in data_panel_layout //TODO Submit PR to export them in the follow-up of PR #44
      }
    };
	 
    let {display} = viewer;

    const perspectiveViewerState = {
      ...getCommonPerspectiveViewerState(container),
      showSliceViews: viewer.showPerspectiveSliceViews,
      showSliceViewsCheckbox: !layoutConfig.hideSliceViewsCheckbox,
      slicesNavigationState: viewer.navigationState //!!! Passed down to NehubaPerspectivePanel in the 'untyped' way. Was already deleted once by mistake. Be careful.
    };

    const sliceViewerState = {
      ...getCommonSliceViewerState(viewer),
      showScaleBar: viewer.showScaleBar, // new TrackableBoolean(false, false), //FIXME Need to be fixed to false while using the old scalebar widget
    };

    const sliceViewerStateWithoutScaleBar = {
      ...getCommonSliceViewerState(viewer),
      showScaleBar: new TrackableBoolean(false, false),
    };
    let mainDisplayContents = [
      L.withFlex(1, L.box('column', [
        L.withFlex(1, L.box('row', [
          L.withFlex(1, element => {
            this.registerDisposer(configureSliceViewPanel(useOldScaleBar(new SliceViewPanel(display, element, sliceViews[0], sliceViewerState)/* , viewer.showScaleBar */)));
          }),
          L.withFlex(1, element => {
            this.registerDisposer(configureSliceViewPanel(new SliceViewPanel(display, element, sliceViews[1], sliceViewerStateWithoutScaleBar)));
          })
        ])),
        L.withFlex(1, L.box('row', [
          L.withFlex(1, element => {
            this.registerDisposer(configureSliceViewPanel(new SliceViewPanel(display, element, sliceViews[2], sliceViewerStateWithoutScaleBar)));
			 }),
			 L.withFlex(1, makePerspective)
        ])),
      ]))
    ];
    L.box('row', mainDisplayContents)(rootElement);

    const detail: LayoutEventDetail = { perspective: perspectivePanel && perspectivePanel.element}
    const event = new CustomEvent(layoutEventType, {detail});
    viewer.display.container.dispatchEvent(event);
  }

  disposed() {
    removeChildren(this.rootElement);
    super.disposed();
  }
}

const tempVec3 = vec3.create();
const tempVec3b = vec3.create();
// ****** !!! Needs attention !!! ******  Even though the change is minimal - the code is forked/copy-pasted from NG and needs to be updated if changed upstream.
// The registerActionListener block is copied from neuroglancer/sliceview/panel.ts
// Any changes in upstream version since then must be manually applied here with care.
function disableFixedPointInRotation(slice: SliceViewPanel, config: Config) {
  const {element} = slice;
  registerActionListener(element, 'nehuba-rotate-via-mouse-drag', (e: ActionEvent<MouseEvent>) => {
    const {viewer, navigationState} = slice; // <-- Added

    const {mouseState} = /* this. */viewer;
    if (mouseState.updateUnconditionally()) {
      //⇊⇊⇊ Our change is here ⇊⇊⇊
      const initialPosition = config.rotateAtViewCentre ? navigationState.position.value : Float32Array.from(mouseState.position);
      //⇈⇈⇈ Our change is here ⇈⇈⇈
      startRelativeMouseDrag(e.detail, (_event, deltaX, deltaY) => {
        const {pose} = /* this. */navigationState;
        const xAxis = vec3.transformQuat(tempVec3, kAxes[0], pose.orientation.orientation);
        const yAxis = vec3.transformQuat(tempVec3b, kAxes[1], pose.orientation.orientation);
        /* this. */viewer.navigationState.pose.rotateAbsolute(
            yAxis, -deltaX / 4.0 * Math.PI / 180.0, initialPosition);
        /* this. */viewer.navigationState.pose.rotateAbsolute(
            xAxis, -deltaY / 4.0 * Math.PI / 180.0, initialPosition);
      });
    }
  });  
  // 'restrictUserNavigation' is implemented in hooks.ts
  // But maybe we can stop the mouse from moving beyond the boundaries if we implement it in custom 'translate-via-mouse-drag'?
  return slice;
}

/**
 * This function is an adapted copy of makeSliceView from neuroglancer/data_panel_layouts.ts
 */
function makeSliceViewNhb(viewerState: SliceViewViewerState, baseToSelf?: quat, customZoom?: number) {
  return makeSliceView(viewerState, baseToSelf)
  // let zoom = customZoom && viewerState.navigationState.registerDisposer(new TrackableCrossSectionZoom(viewerState.navigationState.displayDimensions));
  // if (zoom && customZoom) zoom.legacyValue = customZoom;
  // let navigationState: NavigationState;
  // if (baseToSelf === undefined) {
  //   navigationState = viewerState.navigationState;
  // } else {
  //   navigationState = new NavigationState(
  //       new DisplayPose(
  //           viewerState.navigationState.pose.position.addRef(),
  //           viewerState.navigationState.pose.displayDimensions.addRef(),
  //           OrientationState.makeRelative(
  //               viewerState.navigationState.pose.orientation, baseToSelf)),
  //       zoom || viewerState.navigationState.zoomFactor);
  // }
  // const slice =  new SliceView(viewerState.chunkManager, viewerState.layerManager, navigationState);
  // (<any>slice)[sliceQuat] = baseToSelf || quat.create();
  // return slice;
}
