import {DisplayContext} from 'neuroglancer/display_context';
import {PerspectiveViewRenderContext} from 'neuroglancer/perspective_view/render_layer';
import {FramePickingData} from 'neuroglancer/rendered_data_panel';
import {SliceView} from 'neuroglancer/sliceview/frontend';
import {kAxes, mat4, vec3, vec4} from 'neuroglancer/util/geom';

import { PerspectivePanel, PerspectiveViewerState, perspectivePanelEmit, OffscreenTextures, perspectivePanelEmitOIT } from "neuroglancer/perspective_view/panel";
import { quat } from 'neuroglancer/util/geom';
import { NavigationState, DisplayPose } from 'neuroglancer/navigation_state';

import { NehubaSliceViewRenderHelper, TransparentPlaneRenderHelper } from "nehuba/internal/nehuba_renderers";
import { Config, SliceViewsConfig } from "nehuba/config";
import { sliceQuat } from "nehuba/internal/nehuba_layout";
import { WatchableVisibilityPriority } from 'neuroglancer/visibility_priority/frontend';
import { ScaleBarWidget } from 'nehuba/internal/rescued/old_scale_bar';
import { ElementVisibilityFromTrackableBoolean } from 'neuroglancer/trackable_boolean';
import { makeDerivedWatchableValue } from 'neuroglancer/trackable_value';

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
  slicesNavigationState: NavigationState
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
  scaleBarWidget = this.registerDisposer(new ScaleBarWidget());

  constructor(context: DisplayContext, element: HTMLElement, viewer: PerspectiveViewerState, private config: Config) {
    super(context, element, viewer);

    const removeBgConfig = config.layout!.useNehubaPerspective!.removePerspectiveSlicesBackground;
    const mode = (removeBgConfig && removeBgConfig.mode) || 'none';
    this.nehubaSliceViewRenderHelper = this.registerDisposer(NehubaSliceViewRenderHelper.get(this.gl, perspectivePanelEmit/*sliceViewPanelEmitColor*/, mode));

    this.registerDisposer(this.visibility.changed.add(() => Array.from(this.sliceViews.keys()).forEach(slice => slice.visibility.value = this.visibility.value)));

    const scaleBar = this.scaleBarWidget.element;
    const showScaleBar = viewer.showScaleBar;
    const orthographicProjection = viewer.orthographicProjection;
    this.registerDisposer(new ElementVisibilityFromTrackableBoolean(makeDerivedWatchableValue((a, b) => a && b, showScaleBar, orthographicProjection), scaleBar));
    element.appendChild(scaleBar);
  }	

	updateProjectionMatrix() {
		super.updateProjectionMatrix();
		//TODO Regression in PerspectivePanel.startDragViewport, can not shift - drag anymore. FIX or disable
		if (this.config && this.config.layout && this.config.layout.useNehubaPerspective && this.config.layout.useNehubaPerspective.centerToOrigin) {
      const pos = this.navigationState.position.value;
			mat4.translate(this.viewProjectionMat, this.viewProjectionMat, vec3.fromValues(pos[0], pos[1], pos[2]));
			mat4.invert(this.viewProjectionMatInverse, this.viewProjectionMat);
		}
	}

	disposed() {
		for (let sliceView of this.planarSlices) {
			sliceView.dispose();
		}
		this.planarSlices.clear();
		super.disposed();
	}

  drawWithPicking(pickingData: FramePickingData): boolean {
    for (let sliceView of this.sliceViews.keys()) {
      if (this.config.layout!.useNehubaPerspective!.disablePerspectiveSlicesPreloading) {
        sliceView.visibility.value = (this.viewer.showSliceViews.value && this.visibility.visible) ? WatchableVisibilityPriority.VISIBLE : WatchableVisibilityPriority.IGNORED;
      } else sliceView.visibility.value = this.visibility.value;
    }
    if (!this.navigationState.valid) {
      return false;
    }
    const {width, height} = this;

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
    const backgroundColor = this.viewer.perspectiveViewBackgroundColor.value;
    this.gl.clearColor(backgroundColor[0], backgroundColor[1], backgroundColor[2], 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    let {viewProjectionMat} = this;
    this.updateProjectionMatrix();

    // FIXME; avoid temporaries
    let lightingDirection = vec3.create();
    vec3.transformQuat(
        lightingDirection, kAxes[2], this.navigationState.pose.orientation.orientation);
    vec3.scale(lightingDirection, lightingDirection, -1);

    let ambient = 0.2;
    let directional = 1 - ambient;

    const {
      navigationState:
          {pose: {displayDimensions: {value: displayDimensions}, position: {value: globalPosition}}}
    } = this;

    const renderContext: PerspectiveViewRenderContext & {extra: ExtraRenderContext} = {
      viewProjectionMat: viewProjectionMat,
      lightDirection: lightingDirection,
      ambientLighting: ambient,
      directionalLighting: directional,
      pickIDs: pickingData.pickIDs,
      emitter: perspectivePanelEmit,
      emitColor: true,
      emitPickID: true,
      alreadyEmittedPickID: false,
      viewportWidth: width,
      viewportHeight: height,
      displayDimensions,
      globalPosition,
      //Extra context for NehubaMeshLayer
      extra: {
        config: this.config,
        showSliceViewsCheckboxValue: this.viewer.showSliceViews.value,
        slicesNavigationState: (<any>this.viewer).slicesNavigationState as NavigationState,
        perspectiveNavigationState: this.viewer.navigationState,
        // meshRendered: false
        meshesLoaded: -1,
        meshFragmentsLoaded: -1,
        crossSectionBackground: this.viewer.crossSectionBackgroundColor.value
      }
    };

    mat4.copy(pickingData.invTransform, this.viewProjectionMatInverse);

    const {visibleLayers} = this.visibleLayerTracker;

    let hasTransparent = false;

    let hasAnnotation = false;

    // Draw fully-opaque layers first.
    for (const [renderLayer, attachment] of visibleLayers) {
      if (!renderLayer.isTransparent) {
        if (!renderLayer.isAnnotation) {
          renderLayer.draw(renderContext, attachment);
        } else {
          hasAnnotation = true;
        }
      } else {
        hasTransparent = true;
      }
    }

    const waitForMesh =  this.config.layout!.useNehubaPerspective!.waitForMesh;
    if (!waitForMesh || hasTransparent || renderContext.extra.meshRendered) {
      this.drawSliceViews(renderContext);
    }

    if (hasAnnotation) {
      gl.enable(WebGL2RenderingContext.BLEND);
      gl.depthFunc(WebGL2RenderingContext.LEQUAL);
      gl.blendFunc(WebGL2RenderingContext.SRC_ALPHA, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA);
      // Render only to the color buffer, but not the pick or z buffer.  With blending enabled, the
      // z and color values would be corrupted.
      gl.drawBuffers([
        gl.COLOR_ATTACHMENT0,
        gl.NONE,
        gl.NONE,
      ]);
      renderContext.emitPickID = false;

      for (const [renderLayer, attachment] of visibleLayers) {
        if (renderLayer.isAnnotation) {
          renderLayer.draw(renderContext, attachment);
        }
      }
      gl.depthFunc(WebGL2RenderingContext.LESS);
      gl.disable(WebGL2RenderingContext.BLEND);
      gl.drawBuffers([
        gl.COLOR_ATTACHMENT0,
        gl.COLOR_ATTACHMENT1,
        gl.COLOR_ATTACHMENT2,
      ]);
      renderContext.emitPickID = true;
    }
    const disableAxisLines = this.config.layout!.useNehubaPerspective!.disableAxisLinesInPerspective
    if (this.viewer.showAxisLines.value && !disableAxisLines) {
      this.drawAxisLines();
    }


    if (hasTransparent) {
      // Draw transparent objects.
      gl.depthMask(false);
      gl.enable(WebGL2RenderingContext.BLEND);

      // Compute accumulate and revealage textures.
      const transparentConfiguration = this['transparentConfiguration']; // const {transparentConfiguration} = this; // TODO PR #44 promoted wrong member!!! We need GETTER to be protected, so increse `private get transparentConfiguration()` and decrease `transparentConfiguration_` back to private
      transparentConfiguration.bind(width, height);
      this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(WebGL2RenderingContext.COLOR_BUFFER_BIT);
      renderContext.emitter = perspectivePanelEmitOIT;
      gl.blendFuncSeparate(WebGL2RenderingContext.ONE, WebGL2RenderingContext.ONE, WebGL2RenderingContext.ZERO, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA);
      renderContext.emitPickID = false;
      for (const [renderLayer, attachment] of visibleLayers) {
        if (renderLayer.isTransparent) {
          renderLayer.draw(renderContext, attachment);
        }
      }

      // Copy transparent rendering result back to primary buffer.
      gl.disable(WebGL2RenderingContext.DEPTH_TEST);
      this.offscreenFramebuffer.bindSingle(OffscreenTextures.COLOR);
      gl.blendFunc(WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA, WebGL2RenderingContext.SRC_ALPHA);
      this.transparencyCopyHelper.draw(
          transparentConfiguration.colorBuffers[0].texture,
          transparentConfiguration.colorBuffers[1].texture);

      gl.depthMask(true);
      gl.disable(WebGL2RenderingContext.BLEND);
      gl.enable(WebGL2RenderingContext.DEPTH_TEST);

      // Restore framebuffer attachments.
      this.offscreenFramebuffer.bind(width, height);
    }

    // Do picking only rendering pass.
    gl.drawBuffers([
      gl.NONE, gl.COLOR_ATTACHMENT1,
      gl.COLOR_ATTACHMENT2
    ]);
    renderContext.emitter = perspectivePanelEmit;
    renderContext.emitPickID = true;
    renderContext.emitColor = false;

    // Offset z values forward so that we reliably write pick IDs and depth information even though
    // we've already done one drawing pass.
    gl.enable(WebGL2RenderingContext.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -1);
    for (const [renderLayer, attachment] of visibleLayers) {
      renderContext.alreadyEmittedPickID = !renderLayer.isTransparent && !renderLayer.isAnnotation;
      renderLayer.draw(renderContext, attachment);
    }
    gl.disable(WebGL2RenderingContext.POLYGON_OFFSET_FILL);

    /** Neuroglancer renders the scalebar with WebGL instead of separate HTML element.
     * 
     *  THE PROBLEM: Clear and very disturbing regression of visual experience on highdpi screens.
     *  Since neuroglancer is not highdpi-aware, new scalebar is rendered in low dpi and because it contains text,
     *  this mismatch of dpi is clearly visible.
     * 
     *  THE SOLUTION: Take an opportunity to make the whole neuroglancer render in highdpi. TODO submmit upstream.
     * 
     *  Until then we use the old scalebar widget
     */
    // FIXME
    // if (this.viewer.showScaleBar.value && this.viewer.orthographicProjection.value) {
    //   //Replaces original neuroglancer code of the block
    //   const { dimensions } = this.scaleBarWidget;
    //   dimensions.targetLengthInPixels = Math.min(width / 4, 100);
    //   dimensions.nanometersPerPixel = this['nanometersPerPixel']; //this.nanometersPerPixel; //TODO Submit PR to make protected in the follow-up of PR #44
    //   this.scaleBarWidget.update();
    // }

     /* Original neuroglancer code modulo access to private properties: */
     if (this.viewer.showScaleBar.value && this.viewer.orthographicProjection.value) {
      // Only modify color buffer.
      gl.drawBuffers([
        gl.COLOR_ATTACHMENT0,
      ]);

      gl.disable(WebGL2RenderingContext.DEPTH_TEST);
      gl.enable(WebGL2RenderingContext.BLEND);
      gl.blendFunc(WebGL2RenderingContext.SRC_ALPHA, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA);
      const scaleBars = this['scaleBars']; //const {scaleBars} = this; //TODO Submit PR to make protected in the follow-up of PR #44
      const options = this.viewer.scaleBarOptions.value;
      scaleBars.draw(
          width, this.navigationState.pose.displayDimensions.value,
          this.navigationState.zoomFactor.value / this.height, options);
      gl.disable(WebGL2RenderingContext.BLEND);
    }    

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

    return true;
  }

  protected drawSliceViews(renderContext: PerspectiveViewRenderContext) {
    const conf = this.config.layout!.useNehubaPerspective!;
    
    let {sliceViewRenderHelper, nehubaSliceViewRenderHelper, transparentPlaneRenderHelper} = this;
    let {lightDirection, ambientLighting, directionalLighting, viewProjectionMat} = renderContext;

    const showSliceViews = this.viewer.showSliceViews.value;
    if (!conf.hideAllSlices) {
      const removeBgConfig = conf.removePerspectiveSlicesBackground;
      const render = removeBgConfig ? nehubaSliceViewRenderHelper : sliceViewRenderHelper;
      for (const [sliceView, unconditional] of this.sliceViews) {
        if (!unconditional && !showSliceViews) {
          continue;
        }
        if (sliceView.width === 0 || sliceView.height === 0 || !sliceView.valid) {
            continue;
        }
        if (conf.hideSlices) {
          const views = this.config.layout!.views as SliceViewsConfig;
          const q: quat = (<any>sliceView)[sliceQuat];
          let sliceId: 'slice1' | 'slice2' | 'slice3' | null = null;
          switch(q) {
            case(views.slice1): { sliceId = 'slice1'; break }
            case(views.slice2): { sliceId = 'slice2'; break }
            case(views.slice3): { sliceId = 'slice3'; break }
          };
          if (sliceId && conf.hideSlices.indexOf(sliceId) > -1) continue; //TODO use hideSlices.includes(sliceId)  
        }

        let scalar =
            Math.abs(vec3.dot(lightDirection, sliceView.viewportNormalInCanonicalCoordinates));
        let factor = ambientLighting + scalar * directionalLighting;
        let mat = tempMat4;
        // Need a matrix that maps (+1, +1, 0) to projectionMat * (width, height, 0)
        mat4.identity(mat);
        mat[0] = sliceView.width / 2.0;
        mat[5] = -sliceView.height / 2.0;
        mat4.multiply(mat, sliceView.invViewMatrix, mat);
        mat4.multiply(mat, viewProjectionMat, mat);
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

    const substrateTranslate = (conf && conf.drawSubstrates && conf.drawSubstrates.translate) || [0, 0, 0]

    // Reverse-order, we actually draw substrate after the slice. 
    if (conf.drawSubstrates && showSliceViews) {
      const m = (conf.fixedZoomPerspectiveSlices && conf.fixedZoomPerspectiveSlices.sliceViewportSizeMultiplier) || 1.0 ;
      for (let sliceView of this.sliceViews.keys()) {
        let mat = tempMat4;
        // Need a matrix that maps (+1, +1, 0) to projectionMat * (width, height, 0)
        mat4.identity(mat);
        
        
        mat[0] = sliceView.width / 2.0 / m;
        mat[5] = -sliceView.height / 2.0 / m;
        mat4.multiply(mat, sliceView.invViewMatrix, mat);

        //We want this plane to move only in the direction perpendicular to the plane.
        //So we need to undo translation in the other 2 directions.
        let dtd = mat4.clone(viewProjectionMat);
        const position = this.navigationState.position.value;
        let pos = vec3.fromValues(position[0], position[1], position[2]);
        let axis = vec3.clone(sliceView.viewportNormalInCanonicalCoordinates);
        let rot: quat = (<any>this.viewer).slicesNavigationState.pose.orientation.orientation;
        let inv = quat.invert(quat.create(), rot);
        vec3.transformQuat(axis, axis, inv);
        vec3.transformQuat(pos, pos, inv);
        let untranslate = vec3.create();
        for (var i = 0; i < 3; i++) {
          if (Math.round(axis[i]) === 0) untranslate[i] = -pos[i] + substrateTranslate[i];
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
          mat4.multiply(mat, sliceView.invViewMatrix, mat);
          mat4.multiply(mat, viewProjectionMat, mat);
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