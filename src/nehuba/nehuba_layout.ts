import { RefCounted } from "neuroglancer/unstable/util/disposable.js"
import type { Borrowed } from "neuroglancer/unstable/util/disposable.js"
import { quat, vec3, kAxes } from "neuroglancer/unstable/util/geom.js"
import { makeSliceView, getCommonViewerState } from "neuroglancer/unstable/data_panel_layout.js"
import type { DataPanelLayoutContainer, ViewerUIState, CrossSectionSpecificationMap, SliceViewViewerState } from "neuroglancer/unstable/data_panel_layout.js"
import { SliceViewPanel } from "neuroglancer/unstable/sliceview/panel.js"
// `lib/sliceview/frontend.d.ts` is not emitted in the neuroglancer build, so derive the type instead of importing it
type SliceView = ReturnType<typeof makeSliceView>;
import { PerspectivePanel } from "neuroglancer/unstable/perspective_view/panel.js"
import { TrackableBoolean } from "neuroglancer/unstable/trackable_boolean.js"
import * as L from "neuroglancer/unstable/layout.js"
import { removeChildren } from "neuroglancer/unstable/util/dom.js"
import { registerActionListener } from "neuroglancer/unstable/util/event_action_map.js"
import type { ActionEvent } from "neuroglancer/unstable/util/event_action_map.js"
import { startRelativeMouseDrag } from "neuroglancer/unstable/util/mouse_drag.js"
import type { FramePickingData } from "neuroglancer/unstable/rendered_data_panel.js"
import { ImageRenderLayer } from "neuroglancer/unstable/sliceview/volume/image_renderlayer.js"
import type { SliceViewRenderLayer } from "neuroglancer/unstable/sliceview/renderlayer.js"

// import { NehubaPerspectivePanel } from "./nehuba_perspective_panel" //TODO Not ported to the new upstream yet, see `useNehubaPerspective` below
import { Config } from "./config"

export const configSymbol = Symbol("configSymbol")
export const sliceQuat = Symbol('SliceQuat');

export const layoutEventType = 'layoutEvent';
export interface LayoutEventDetail {
  perspective?: HTMLElement
}

//TODO Following 2 functions are copy-pasted from neuroglancer/data_panel_layout.ts because they are not exported
function getCommonPerspectiveViewerState(container: DataPanelLayoutContainer) {
  const { viewer } = container;
  return {
    ...getCommonViewerState(viewer),
    navigationState: viewer.perspectiveNavigationState,
    inputEventMap: viewer.inputEventBindings.perspectiveView,
    orthographicProjection: container.specification.orthographicProjection,
    showScaleBar: viewer.showScaleBar,
    rpc: viewer.chunkManager.rpc!,
  };
}
function getCommonSliceViewerState(viewer: ViewerUIState) {
  return {
    ...getCommonViewerState(viewer),
    navigationState: viewer.navigationState,
    inputEventMap: viewer.inputEventBindings.sliceView,
  };
}

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
        //TODO NehubaPerspectivePanel is not ported to the new upstream yet, falling back to plain PerspectivePanel
        perspectivePanel = this.registerDisposer(
            new PerspectivePanel(display, element, perspectiveViewerState));

        // sliceViews.forEach(slice => { (perspectivePanel as NehubaPerspectivePanel).planarSlices.add(slice.addRef()); })
        if (conf.fixedZoomPerspectiveSlices) {
          const cnfg = conf.fixedZoomPerspectiveSlices;
          makeFixedZoomSlicesFromSlices(sliceViews, viewer, cnfg.sliceZoom).forEach(slice => {
            const m = cnfg.sliceViewportSizeMultiplier;
            m; //TODO SliceView.setViewportSize() is gone in the new upstream, viewport size is now driven by the panel via projectionParameters
            // slice.setViewportSize(cnfg.sliceViewportWidth * m, cnfg.sliceViewportHeight * m);
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

function disableFixedPointInZoom(slice: SliceViewPanel, config: Config) {
  const originalZoomByMouse = slice.zoomByMouse;
  slice.zoomByMouse = function (this: SliceViewPanel, factor: number) {
    if (config.zoomAtViewCentre) this.navigationState.zoomBy(factor);
    else originalZoomByMouse.call(this, factor);
  }

  return slice;
}

/** https://github.com/google/neuroglancer/commit/1e06a4768702596f366fb605e9e953f9b8e48386
 *  changed the scalebar rendering to be done with WebGL instead of separate HTML element.
 *  Until the old scalebar widget is ported to the new upstream this is a no-op passthrough. */
function useOldScaleBar(slice: SliceViewPanel/*FIXME , showScaleBar: TrackableBoolean */) { //TODO config option?
  // FIXME see original nehuba for the (commented-out) old scalebar hookup
  return slice;
}

export const sliceRenderEventType = 'sliceRenderEvent';
/** Contains a reference to corresponding slice view. Don't store, allow gc */
export interface SliceRenderEventDetail { //TODO There is native statistics with UI available in neuroglancer now, try to use that for missing chunks
  /** Missing chunks from layers of 'image' type.
   *  Value of -1 indicates that there are no layers yet */
  missingImageChunks: number,
  /** Missing chunks from all layers.
   *  Value of -1 indicates that there are no layers yet */
  missingChunks: number,
  nanometersToOffsetPixels: (point: vec3) => vec3
}

function dispatchRenderEvents(slice: SliceViewPanel) {
  const originalDraw = slice.drawWithPicking;
  slice.drawWithPicking = function (this: SliceViewPanel, pickingData: FramePickingData) {
    const res = originalDraw.call(this, pickingData);
    const coordsConv = (point: vec3) => dataToOffsetPixels(slice, point);
    const detail: SliceRenderEventDetail = {
      missingImageChunks: getNumberOfMissingChunks(this.sliceView, it => it instanceof ImageRenderLayer),
      missingChunks: getNumberOfMissingChunks(this.sliceView),
      nanometersToOffsetPixels: coordsConv
    };
    const event = new CustomEvent(sliceRenderEventType, {bubbles: true, detail});
    this.element.dispatchEvent(event);
    return res;
  }
}

//TODO Should be a method of {Nehuba}SliceViewPanel
function dataToOffsetPixels(slice: SliceViewPanel, point: vec3) {
  const { viewMatrix, width, height } = slice.sliceView.projectionParameters.value;
  const vec = vec3.transformMat4(vec3.create(), point, viewMatrix);
  vec[0] = (vec[0] + width / 2) + slice.element.clientLeft;
  vec[1] = (vec[1] + height / 2) + slice.element.clientTop;
  return vec;
}

//TODO Find a way to count failed chunks
/** Stubbed, see original nehuba for the (commented-out) implementation */
function getNumberOfMissingChunks(sliceView: SliceView, layerSelector?: (layer: SliceViewRenderLayer) => boolean) {
  sliceView; layerSelector;
  return 0;
}

/**
 * This function is an adapted copy of makeSliceView from neuroglancer/data_panel_layouts.ts
 */
function makeSliceViewNhb(viewerState: SliceViewViewerState, baseToSelf?: quat, customZoom?: number) {
  customZoom; //TODO custom zoom (fixedZoomPerspectiveSlices) not supported yet with the new upstream makeSliceView
  const slice = makeSliceView(viewerState, baseToSelf);
  (slice as any)[sliceQuat] = baseToSelf || quat.create();
  return slice;
}

function makeFixedZoomSlicesFromSlices(sliceViews: SliceView[], viewerState: SliceViewViewerState, customZoom: number) {
  return sliceViews.map(slice => {
    const q: quat = (slice as any)[sliceQuat];
    return makeSliceViewNhb(viewerState, q, customZoom);
  })
}
