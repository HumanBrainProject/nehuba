import {DisplayContext} from 'neuroglancer/display_context';
import {PerspectiveViewRenderContext} from 'neuroglancer/perspective_view/render_layer';
import {SliceView} from 'neuroglancer/sliceview/frontend';
import {kAxes, mat4, transformVectorByMat4, vec3, vec4} from 'neuroglancer/util/geom';
import {startRelativeMouseDrag} from 'neuroglancer/util/mouse_drag';
import {ActionEvent, registerActionListener} from 'neuroglancer/util/event_action_map';

import { PerspectivePanel, PerspectiveViewerState, perspectivePanelEmit, OffscreenTextures, perspectivePanelEmitOIT } from "neuroglancer/perspective_view/panel";
import { quat } from 'neuroglancer/util/geom';
import { NavigationState, Pose } from 'neuroglancer/navigation_state';

import { NehubaSliceViewRenderHelper, TransparentPlaneRenderHelper } from "nehuba/internal/nehuba_renderers";
import { Config } from "nehuba/config";
import { WatchableVisibilityPriority } from 'neuroglancer/visibility_priority/frontend';

const tempVec3 = vec3.create();
const tempMat4 = mat4.create();

export const perspectiveRenderEventType = 'perpspectiveRenderEvent';
export interface PerspectiveRenderEventDetail {
  /** Value of -1 indicates that there are no visible segmentation layers */
  meshesLoaded: number,
  /** Value of -1 indicates that there are no visible segmentation layers */
  meshFragmentsLoaded: number,
  lastLoadedMeshId?: string
}

export interface ExtraRenderContext {
  config: Config
  showSliceViewsCheckboxValue: boolean
  slicesPose: Pose
  perspectiveNavigationState: NavigationState
  /** To be set by our custom renderLayers to indicate that mesh has been rendered. So it is a return value from draw method to avoid changing draw method signature */
  meshRendered?: boolean
  /** Value of -1 indicates that there are no visible segmentation layers */
  meshesLoaded: number
  /** Value of -1 indicates that there are no visible segmentation layers */
  meshFragmentsLoaded: number
  lastMeshId?: string
  crossSectionBackground: vec3
}

export class NehubaPerspectivePanel extends PerspectivePanel {
	/** References to slices in cross-sectional views (outside of perspective panel) */
	planarSlices = new Set<SliceView>();
	nehubaSliceViewRenderHelper: NehubaSliceViewRenderHelper;
		// this.registerDisposer(SliceViewRenderHelper.get(this.gl, perspectivePanelEmit));
	transparentPlaneRenderHelper =
		this.registerDisposer(TransparentPlaneRenderHelper.get(this.gl, perspectivePanelEmit));

	constructor(context: DisplayContext, element: HTMLElement, viewer: PerspectiveViewerState, private config: Config) {
		super(context, element, viewer);

    registerActionListener(element, 'nehuba-translate-via-mouse-drag', (e: ActionEvent<MouseEvent>) => {
      startRelativeMouseDrag(e.detail, (_event, deltaX, deltaY) => {
        if (this.config.layout!.useNehubaPerspective!.enableShiftDrag) { // <-- Added
          const temp = tempVec3;
          const {projectionMat} = this;
          const {width, height} = this;
          const {position} = this.viewer.navigationState;
          const pos = position.spatialCoordinates;
          vec3.transformMat4(temp, pos, projectionMat);
          temp[0] = 2 * deltaX / width;
          temp[1] = -2 * deltaY / height;
          vec3.transformMat4(pos, temp, this.inverseProjectionMat);
          position.changed.dispatch();
        }
      });
    });

		const removeBgConfig = config.layout!.useNehubaPerspective!.removePerspectiveSlicesBackground;
		const mode = (removeBgConfig && removeBgConfig.mode) || 'none';
    this.nehubaSliceViewRenderHelper = this.registerDisposer(NehubaSliceViewRenderHelper.get(this.gl, perspectivePanelEmit/*sliceViewPanelEmitColor*/, mode));
    
    this.registerDisposer(this.visibility.changed.add(() => Array.from(this.sliceViews.keys()).forEach(slice => slice.visibility.value = this.visibility.value)));
	}	

	updateProjectionMatrix() {
		super.updateProjectionMatrix();
		//TODO Regression in PerspectivePanel.startDragViewport, can not shift - drag anymore. FIX or disable
		if (this.config.layout!.useNehubaPerspective!.centerToOrigin) {
			mat4.translate(this.projectionMat, this.projectionMat, this.navigationState.position.spatialCoordinates);
			mat4.invert(this.inverseProjectionMat, this.projectionMat);
		}		
	}

	disposed() {
		for (let sliceView of this.planarSlices) {
			sliceView.dispose();
		}
		this.planarSlices.clear();
		super.disposed();
	}

  draw() {
    for (let sliceView of this.sliceViews.keys()) {
      if (this.config.layout!.useNehubaPerspective!.disablePerspectiveSlicesPreloading) {
        sliceView.visibility.value = (this.viewer.showSliceViews.value && this.visibility.visible) ? WatchableVisibilityPriority.VISIBLE : WatchableVisibilityPriority.IGNORED;
      } else sliceView.visibility.value = this.visibility.value;
    }
    if (!this.navigationState.valid) {
      return;
    }
    this.onResize();
    let {width, height} = this;
    if (width === 0 || height === 0) {
      return;
    }

    const showSliceViews = this.viewer.showSliceViews.value;
    for (const [sliceView, unconditional] of this.sliceViews) {
      if (unconditional || showSliceViews) {
        sliceView.updateRendering();
      }
    }
    for (let sliceView of this.planarSlices) {
      sliceView.updateRendering(); // ?? does it change size?
    }

    let gl = this.gl;
     this.offscreenFramebuffer.bind(width, height);

    gl.disable(gl.SCISSOR_TEST);
    const conf = this.config.layout!.useNehubaPerspective!;
    const bg = conf.perspectiveBackground
      || conf.perspectiveSlicesBackground 
      || this.viewer.crossSectionBackgroundColor.value;
    this.gl.clearColor(bg[0], bg[1], bg[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    let {projectionMat} = this;
    this.updateProjectionMatrix();

    // FIXME; avoid temporaries
    let lightingDirection = vec3.create();
    transformVectorByMat4(lightingDirection, kAxes[2], this.modelViewMat);
    vec3.normalize(lightingDirection, lightingDirection);

    let ambient = 0.2;
    let directional = 1 - ambient;

    let pickIDs = this.pickIDs;
    pickIDs.clear();
    let renderContext: PerspectiveViewRenderContext & {extra: ExtraRenderContext} = {
      dataToDevice: projectionMat,
      lightDirection: lightingDirection,
      ambientLighting: ambient,
      directionalLighting: directional,
      pickIDs: pickIDs,
      emitter: perspectivePanelEmit,
      emitColor: true,
      emitPickID: true,
      alreadyEmittedPickID: false,
      viewportWidth: width,
      viewportHeight: height,
      //Extra context for NehubaMeshLayer
      extra: {
        config: this.config,
        showSliceViewsCheckboxValue: this.viewer.showSliceViews.value,
        slicesPose: (<any>this.viewer).slicesNavigationState.pose as Pose,
        perspectiveNavigationState: this.viewer.navigationState,
        // meshRendered: false
        meshesLoaded: -1,
        meshFragmentsLoaded: -1,
        crossSectionBackground: this.viewer.crossSectionBackgroundColor.value
      }
    };

    let visibleLayers = this.visibleLayerTracker.getVisibleLayers();

    let hasTransparent = false;

    // Draw fully-opaque layers first.
    for (let renderLayer of visibleLayers) {
      if (!renderLayer.isTransparent) {
        renderLayer.draw(renderContext);
      } else {
        hasTransparent = true;
      }
    }

    const waitForMesh =  this.config.layout!.useNehubaPerspective!.waitForMesh;
    if (!waitForMesh || renderContext.extra.meshRendered) {
      this.drawSliceViews(renderContext);
    }

    const disableAxisLines = this.config.layout!.useNehubaPerspective!.disableAxisLinesInPerspective
    if (this.viewer.showAxisLines.value && !disableAxisLines) {
      this.drawAxisLines();
    }


    if (hasTransparent) {
      // Draw transparent objects.
      gl.depthMask(false);
      gl.enable(gl.BLEND);

      // Compute accumulate and revealage textures.
      const transparentConfiguration = this['transparentConfiguration']; // const {transparentConfiguration} = this; // TODO PR #44 promoted wrong member!!! We need GETTER to be protected, so increse `private get transparentConfiguration()` and decrease `transparentConfiguration_` back to private
      transparentConfiguration.bind(width, height);
      this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      renderContext.emitter = perspectivePanelEmitOIT;
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      renderContext.emitPickID = false;
      for (let renderLayer of visibleLayers) {
        if (renderLayer.isTransparent) {
          renderLayer.draw(renderContext);
        }
      }

      // Copy transparent rendering result back to primary buffer.
      gl.disable(gl.DEPTH_TEST);
      this.offscreenFramebuffer.bindSingle(OffscreenTextures.COLOR);
      gl.blendFunc(gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA);
      this.transparencyCopyHelper.draw(
          transparentConfiguration.colorBuffers[0].texture,
          transparentConfiguration.colorBuffers[1].texture);

      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);

      // Restore framebuffer attachments.
      this.offscreenFramebuffer.bind(width, height);
    }

    // Do picking only rendering pass.
    gl.WEBGL_draw_buffers.drawBuffersWEBGL([
      gl.NONE, gl.WEBGL_draw_buffers.COLOR_ATTACHMENT1_WEBGL,
      gl.WEBGL_draw_buffers.COLOR_ATTACHMENT2_WEBGL
    ]);
    renderContext.emitter = perspectivePanelEmit;
    renderContext.emitPickID = true;
    renderContext.emitColor = false;
    for (let renderLayer of visibleLayers) {
      renderContext.alreadyEmittedPickID = !renderLayer.isTransparent;
      renderLayer.draw(renderContext);
    }

    gl.disable(gl.DEPTH_TEST);
    this.offscreenFramebuffer.unbind();

    // Draw the texture over the whole viewport.
    this.setGLViewport();
    this.offscreenCopyHelper.draw(
        this.offscreenFramebuffer.colorBuffers[OffscreenTextures.COLOR].texture);

    const detail: PerspectiveRenderEventDetail = { 
      meshesLoaded: renderContext.extra.meshesLoaded,
      meshFragmentsLoaded: renderContext.extra.meshFragmentsLoaded,
      lastLoadedMeshId: renderContext.extra.lastMeshId
    }
    const event = new CustomEvent(perspectiveRenderEventType, {bubbles: true, detail});
    this.element.dispatchEvent(event);
  }

  protected drawSliceViews(renderContext: PerspectiveViewRenderContext) {
    const conf = this.config.layout!.useNehubaPerspective!;
    
    let {sliceViewRenderHelper, nehubaSliceViewRenderHelper, transparentPlaneRenderHelper} = this;
    let {lightDirection, ambientLighting, directionalLighting, dataToDevice} = renderContext;

    const showSliceViews = this.viewer.showSliceViews.value;
    if (!conf.hideImages) {
      const removeBgConfig = conf.removePerspectiveSlicesBackground;
      const render = removeBgConfig ? nehubaSliceViewRenderHelper : sliceViewRenderHelper;
      for (const [sliceView, unconditional] of this.sliceViews) {
        if (!unconditional && !showSliceViews) {
          continue;
        }
        if (sliceView.width === 0 || sliceView.height === 0 || !sliceView.hasValidViewport) {
            continue;
        }
        let scalar = Math.abs(vec3.dot(lightDirection, sliceView.viewportAxes[2]));
        let factor = ambientLighting + scalar * directionalLighting;
        let mat = tempMat4;
        // Need a matrix that maps (+1, +1, 0) to projectionMat * (width, height, 0)
        mat4.identity(mat);
        mat[0] = sliceView.width / 2.0;
        mat[5] = -sliceView.height / 2.0;
        mat4.multiply(mat, sliceView.viewportToData, mat);
        mat4.multiply(mat, dataToDevice, mat);
        const backgroundColor = vec4.create();
        const crossSectionBackgroundColor = conf.perspectiveSlicesBackground || this.viewer.crossSectionBackgroundColor.value;
        backgroundColor[0] = crossSectionBackgroundColor[0];
        backgroundColor[1] = crossSectionBackgroundColor[1];
        backgroundColor[2] = crossSectionBackgroundColor[2];
        backgroundColor[3] = 1;
  
        const discardColor = (removeBgConfig && removeBgConfig.color) || backgroundColor;
        nehubaSliceViewRenderHelper.setDiscardColor(discardColor);
        render.draw(
            sliceView.offscreenFramebuffer.colorBuffers[0].texture, mat,
            vec4.fromValues(factor, factor, factor, 1), backgroundColor, 0, 0, 1,
            1);
      }
    }
    // Reverse-order, we actually draw substrate after the slice. 
    if (conf.drawSubstrates && showSliceViews) {
      const m = (conf.fixedZoomPerspectiveSlices && conf.fixedZoomPerspectiveSlices.sliceViewportSizeMultiplier) || 1.0 ;
      for (let sliceView of this.sliceViews.keys()) {
        let mat = tempMat4;
        // Need a matrix that maps (+1, +1, 0) to projectionMat * (width, height, 0)
        mat4.identity(mat);
        mat[0] = sliceView.width / 2.0 / m;
        mat[5] = -sliceView.height / 2.0 / m;
        mat4.multiply(mat, sliceView.viewportToData, mat);

        //We want this plane to move only in the direction perpendicular to the plane.
        //So we need to undo translation in the other 2 directions.
        let dtd = mat4.clone(dataToDevice); //dataToDevice is actually this.projectionMat
        let pos = vec3.clone(this.navigationState.position.spatialCoordinates);
        let axis = vec3.clone(sliceView.viewportAxes[2]);
        let rot: quat = (<any>this.viewer).slicesNavigationState.pose.orientation.orientation;
        let inv = quat.invert(quat.create(), rot);
        vec3.transformQuat(axis, axis, inv);
        vec3.transformQuat(pos, pos, inv);
        let untranslate = vec3.create();
        for (var i = 0; i < 3; i++) {
          if (Math.round(axis[i]) === 0) untranslate[i] = -pos[i];
          else untranslate[i] = 0;
        }
        vec3.transformQuat(untranslate, untranslate, rot);
        mat4.translate(dtd, dtd, untranslate);
        mat4.multiply(mat, dtd, mat);
        // mat4.multiply(mat, dataToDevice, mat);
        const color = conf.drawSubstrates.color || vec4.fromValues(0.0, 0.0, 1.0, 0.2);
        transparentPlaneRenderHelper.draw(mat, color, {factor: 3.0, units: 1.0}); //TODO Add z offset values to config
      }
    }

    if (conf.drawZoomLevels && showSliceViews) {
      const cutOff = conf.drawZoomLevels.cutOff;
      // console.log((<any>this.viewer).slicesNavigationState.zoomFactor.value);
      if (cutOff && (<any>this.viewer).slicesNavigationState.zoomFactor.value < cutOff) {
        for (let sliceView of this.planarSlices) {
          let mat = tempMat4;
          // Need a matrix that maps (+1, +1, 0) to projectionMat * (width, height, 0)
          mat4.identity(mat);
          mat[0] = sliceView.width / 2.0;
          mat[5] = -sliceView.height / 2.0;
          mat4.multiply(mat, sliceView.viewportToData, mat);
          mat4.multiply(mat, dataToDevice, mat);
          const color = conf.drawZoomLevels.color || vec4.fromValues(1.0, 0.0, 0.0, 0.2);
          transparentPlaneRenderHelper.draw(mat, color, {factor: -1.0, units: 1.0}); //TODO Add z offset values to config
        }
      }
    }
  }

	zoomByMouse(factor: number) {
		super.zoomByMouse(factor);
		const conf = this.config.layout!.useNehubaPerspective!.restrictZoomLevel;
		if (conf) {
			if (conf.minZoom && this.navigationState.zoomFactor.value < conf.minZoom) this.navigationState.zoomFactor.value = conf.minZoom;
			if (conf.maxZoom && this.navigationState.zoomFactor.value > conf.maxZoom) this.navigationState.zoomFactor.value = conf.maxZoom;
		}
	}	
}