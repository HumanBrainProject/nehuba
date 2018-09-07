import * as L from 'neuroglancer/layout';
import {NavigationState, OrientationState, Pose} from 'neuroglancer/navigation_state';
import {PerspectivePanel} from 'neuroglancer/perspective_view/panel';
import {SliceView, SliceViewChunkSource} from 'neuroglancer/sliceview/frontend';
import {SliceViewPanel} from 'neuroglancer/sliceview/panel';
import {TrackableBoolean, ElementVisibilityFromTrackableBoolean} from 'neuroglancer/trackable_boolean';
import {RefCounted, Borrowed} from 'neuroglancer/util/disposable';
import {removeChildren} from 'neuroglancer/util/dom';
import {vec3, quat} from 'neuroglancer/util/geom';

import { SliceViewViewerState, ViewerUIState, getCommonViewerState, DataPanelLayoutContainer, CrossSectionSpecificationMap } from 'neuroglancer/data_panel_layout';
import { Viewer } from 'neuroglancer/viewer';
// import { startRelativeMouseDrag } from 'neuroglancer/util/mouse_drag';

import { NehubaPerspectivePanel } from "nehuba/internal/nehuba_perspective_panel";
import { restrictUserNavigation } from "nehuba/internal/hooks";
import { Config } from "nehuba/config";
import { ScaleBarWidget } from 'nehuba/internal/rescued/old_scale_bar';
import {ActionEvent, registerActionListener} from 'neuroglancer/util/event_action_map';
import { startRelativeMouseDrag } from 'neuroglancer/util/mouse_drag';
import { ImageRenderLayer } from 'neuroglancer/sliceview/volume/image_renderlayer';
import { VolumeChunkSource } from 'neuroglancer/sliceview/volume/frontend';
import { ChunkState } from 'neuroglancer/chunk_manager/base';
import { RenderLayer } from 'neuroglancer/sliceview/renderlayer';
import { ChunkLayout } from 'neuroglancer/sliceview/chunk_layout';

//TODO Following 2 functions are copy-pasted from neuroglancer/viewer_layout.ts because they are not exported
//TODO Submit PR to export them in the follow-up of PR #44
function getCommonPerspectiveViewerState(viewer: ViewerUIState) {
  return {
    ...getCommonViewerState(viewer),
    navigationState: viewer.perspectiveNavigationState,
    inputEventMap: viewer.inputEventBindings.perspectiveView,
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

const sliceQuat = Symbol('SliceQuat');
/**
 * This function started as a copy of makeSliceView from https://github.com/google/neuroglancer/blob/9c78cd512a722f3fe9ed097155b6f64f48b8d1c9/src/neuroglancer/viewer_layouts.ts
 * Copied on 19.07.2017 (neuroglancer master commit 9c78cd512a722f3fe9ed097155b6f64f48b8d1c9) and renamed.
 * Latest commit to viewer_layouts.ts 736b20335d4349d8a252bd37e33d343cb73294de on May 21, 2017 "feat: Add Viewer-level prefetching support."
 * Any changes in upstream version since then must be manually applied here with care.
 */
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

function makeFixedZoomSlicesFromSlices(sliceViews: SliceView[], viewerState: SliceViewViewerState, customZoom: number) {
  return sliceViews.map(slice => {
    const q: quat = (<any>slice)[sliceQuat];
    return makeSliceViewNhb(viewerState, q, customZoom);
  })
}

export const configSymbol = Symbol('config');
export const layoutEventType = 'layoutEvent';
export interface LayoutEventDetail {
  // perspectivePanel: PerspectivePanel
  perspective?: HTMLElement
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

    layoutConfig.useNehubaPerspective && !layoutConfig.useNehubaPerspective.doNotRestrictUserNavigation && restrictUserNavigation(viewer as Viewer);

    const configureSliceViewPanel = (slice: SliceViewPanel) => {
      //TODO It is time for NehubaSliceViewPanel
      dispatchRenderEvents(dedebounce(disableFixedPointInZoom(disableFixedPointInRotation(slice, config), config), config));
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
      ...getCommonPerspectiveViewerState(viewer),
      showSliceViews: viewer.showPerspectiveSliceViews,
      showSliceViewsCheckbox: !layoutConfig.hideSliceViewsCheckbox,
      slicesNavigationState: viewer.navigationState //!!! Passed down to NehubaPerspectivePanel in the 'untyped' way. Was already deleted once by mistake. Be careful.
    };

    const sliceViewerState = {
      ...getCommonSliceViewerState(viewer),
      showScaleBar: /* viewer.showScaleBar, */ new TrackableBoolean(false, false), //Fixed to false while using the old scalebar widget
    };

    const sliceViewerStateWithoutScaleBar = {
      ...getCommonSliceViewerState(viewer),
      showScaleBar: new TrackableBoolean(false, false),
    };
    let mainDisplayContents = [
      L.withFlex(1, L.box('column', [
        L.withFlex(1, L.box('row', [
          L.withFlex(1, element => {
            this.registerDisposer(configureSliceViewPanel(useOldScaleBar(new SliceViewPanel(display, element, sliceViews[0], sliceViewerState), viewer.showScaleBar)));
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
    display.onResize();

    const detail: LayoutEventDetail = { perspective: perspectivePanel && perspectivePanel.element}
    const event = new CustomEvent(layoutEventType, {detail});
    viewer.display.container.dispatchEvent(event);
  }

  disposed() {
    removeChildren(this.rootElement);
    super.disposed();
  }
}

//TODO raise an issue upstream
/** Upstream neuroglancer added debouncing of SliceViewPanel.onResize (commit c59c3d6f561fa2cf5fb9eda7d77d9f458cae3637)
 *  which causes flicker when "Reset" is pressed (state changed programmatically twice at the same cycle). So we need to de-debounce */
function dedebounce(slice: SliceViewPanel, config: Config) {
  const originalOnResize = slice.onResize;
  slice.onResize = function() {
    if (config.dedebounceUpdates) this.sliceView.setViewportSize(this.element.clientWidth, this.element.clientHeight);
    else originalOnResize.call(this);
  }
  return slice;
}

// ****** !!! Needs attention !!! ******  Even so the change is minimal - the code is forked/copy-pasted from NG and needs to be updated if changed upstream.
// The registerActionListener block is copied from https://github.com/google/neuroglancer/blob/de7ca35dd4d9fa4e6c3166d636ee430af6da0fa0/src/neuroglancer/sliceview/panel.ts
// Copied on 27.11.2017 (neuroglancer master commit de7ca35dd4d9fa4e6c3166d636ee430af6da0fa0).
// Latest commit to panel.ts 1e06a4768702596f366fb605e9e953f9b8e48386 on Nov 7, 2017 "fix(scale_bar): render scale bar using WebGL to avoid flickering"
// Any changes in upstream version since then must be manually applied here with care.
function disableFixedPointInRotation(slice: SliceViewPanel, config: Config) {
  const {element} = slice;
  registerActionListener(element, 'nehuba-rotate-via-mouse-drag', (e: ActionEvent<MouseEvent>) => {
    const {viewer, sliceView} = slice; // <-- Added

    const {mouseState} = /* this. */viewer;
    if (mouseState.updateUnconditionally()) {
      //⇊⇊⇊ Our change is here ⇊⇊⇊
      const initialPosition = config.rotateAtViewCentre ? undefined : vec3.clone(mouseState.position);
      //⇈⇈⇈ Our change is here ⇈⇈⇈
      startRelativeMouseDrag(e.detail, (_event, deltaX, deltaY) => {
        let {viewportAxes} = /* this. */sliceView;
        /* this. */viewer.navigationState.pose.rotateAbsolute(
            viewportAxes[1], deltaX / 4.0 * Math.PI / 180.0, initialPosition);
        /* this. */viewer.navigationState.pose.rotateAbsolute(
            viewportAxes[0], deltaY / 4.0 * Math.PI / 180.0, initialPosition);
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

/*
function patchSliceView(slice: SliceViewPanel) {
  let untyped = slice as any;
  untyped.unregisterDisposer(untyped.sliceViewRenderHelper);
  untyped.registerDisposer(untyped.sliceViewRenderHelper = NehubaSliceViewRenderHelper.get(untyped.gl, sliceViewPanelEmitColor))
  return slice;
}
*/

/** https://github.com/google/neuroglancer/commit/1e06a4768702596f366fb605e9e953f9b8e48386 
 *  changed the scalebar rendering to be done with WebGL instead of separate HTML element to avoid
 *  some kind of flickering. 
 * 
 *  I don't know which flickering are they talking about.
 * 
 *  THE PROBLEM: Clear and very disturbing regression of visual experience on highdpi screens.
 *  Since neuroglancer is not highdpi-aware, new scalebar is rendered in low dpi and because it contains text,
 *  this mismatch of dpi is clearly visible.
 * 
 *  THE SOLUTION: Take an opportunity to make the whole neuroglancer render in highdpi. TODO submmit upstream.
 * 
 *  Until then we use the old scalebar widget
 */
function useOldScaleBar(slice: SliceViewPanel, showScaleBar: TrackableBoolean) { //TODO config option?
  const scaleBarWidget = slice.registerDisposer(new ScaleBarWidget());

  let scaleBar = scaleBarWidget.element;
  slice.registerDisposer(
      new ElementVisibilityFromTrackableBoolean(/* viewer. */showScaleBar, scaleBar));
  slice.element.appendChild(scaleBar);

  const originalDraw = slice.draw;
  slice.draw = function (this: SliceViewPanel) {
    originalDraw.call(this);

    // Update the scale bar if needed.
    {
      let {sliceView} = this;
      let {width/* , height, dataToDevice */} = sliceView;
      // let {scaleBarWidget} = this;
      let {dimensions} = scaleBarWidget;
      dimensions.targetLengthInPixels = Math.min(width / 4, 100);
      dimensions.nanometersPerPixel = sliceView.pixelSize;
      scaleBarWidget.update();
    }    
  }

  return slice;
}

export const sliceRenderEventType = 'sliceRenderEvent';
/** Contains a reference to corresponding slice view. Don't store, allow gc */
export interface SliceRenderEventDetail {
  /** Missing chunks from layers of 'image' type.
   *  Value of -1 indicates that there are no layers yet */
  missingImageChunks: number,
  /** Missing chunks from all layers.
   *  Value of -1 indicates that there are no layers yet */
  missingChunks: number,
  nanometersToOffsetPixels: (point: vec3) => vec3
}

function dispatchRenderEvents(slice: SliceViewPanel) {
  const originalDraw = slice.draw;
  slice.draw = function (this: SliceViewPanel) {
    originalDraw.call(this);
    const coordsConv = (point: vec3) => dataToOffsetPixels(slice, point);
    const detail: SliceRenderEventDetail = {
      missingImageChunks: getNumberOfMissingChunks(this.sliceView, it => it instanceof ImageRenderLayer),
      missingChunks: getNumberOfMissingChunks(this.sliceView),
      nanometersToOffsetPixels: coordsConv
    };
    const event = new CustomEvent(sliceRenderEventType, {bubbles: true, detail});
    this.element.dispatchEvent(event);  
  }  
}

//TODO Should be a method of {Nehuba}SliceViewPanel
function dataToOffsetPixels(slice: SliceViewPanel, point: vec3) {
  const vec = vec3.transformMat4(vec3.create(), point, slice.sliceView.dataToViewport);
  vec[0] = (vec[0] + slice.sliceView.width / 2) + slice.element.clientLeft;
  vec[1] = (vec[1] + slice.sliceView.height / 2) + slice.element.clientTop;
  return vec;
}

//TODO Find a way to count failed chunks
/** Adapted from RenderLayer.draw() from neuroglancer/sliceview/volume/renderlayer.ts 
*  Latest commit to renderlayer.ts 5d8c31adf370891993408a41d9a531df8d342955 on Jan 11, 2018 "feat(sliceview): directly support an additional affine coordinate transform" */
function getNumberOfMissingChunks(sliceView: SliceView, layerSelector?: (layer: RenderLayer) => boolean) {
  //BTW SliceView has numVisibleChunks property now, could be useful
  const layers = sliceView.visibleLayerList
    .filter(it => layerSelector ? layerSelector(it) : true);
  if (layers.length === 0) return -1;
  return layers
    .map(layer => sliceView.visibleLayers.get(layer)!)
    .reduce((a, b) => a.concat(b), [])
    .filter(it => it.source instanceof VolumeChunkSource) //Suppress errors just in case
    .map(it => it as {chunkLayout: ChunkLayout, source: SliceViewChunkSource})
    .map(it => {
      const chunkLayout = it.chunkLayout;
      const source = it.source as VolumeChunkSource;
      const chunks = source.chunks;
      const visibleChunks = sliceView.visibleChunks.get(chunkLayout);
      if (visibleChunks) {
        return visibleChunks
          .map(key => chunks.get(key))
          .filter(chunk => !(chunk && chunk.state === ChunkState.GPU_MEMORY)) // TODO Looks like failed chunks are undefined here instead of ChunkState.FAILED, did not observe any state other then GPU_MEMORY. TODO fix and submit upstream proper chunk state reporting
          .length;
      } else {
        console.log('visibleChunks are not defined'); //seems to be always defined
        return 0;
      }
    })
    .reduce((accumulator, currentValue) => accumulator + currentValue, 0);
}