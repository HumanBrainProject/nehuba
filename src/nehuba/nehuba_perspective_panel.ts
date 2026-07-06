import { NavigationState } from "neuroglancer/unstable/navigation_state.js"
import type { DisplayContext } from 'neuroglancer/unstable/display_context.js';
import type { PerspectiveViewRenderContext } from 'neuroglancer/unstable/perspective_view/render_layer.js';
import type { FramePickingData } from 'neuroglancer/unstable/rendered_data_panel.js';
import { kAxes, mat4, vec3, vec4, quat } from 'neuroglancer/unstable/util/geom.js';
import { PerspectivePanel, PerspectiveViewerState, perspectivePanelEmit, OffscreenTextures, perspectivePanelEmitOIT, maxProjectionEmit } from "neuroglancer/unstable/perspective_view/panel.js";
import type { ProjectionParameters } from 'neuroglancer/unstable/projection_parameters.js';

import { Config, SliceViewsConfig } from "./config";
import { sliceQuat } from "./nehuba_layout";
import { WatchableVisibilityPriority } from 'neuroglancer/unstable/visibility_priority/frontend.js';
import { MultipleScaleBarTextures } from "neuroglancer/unstable/widget/scale_bar.js";
import { makeSliceView } from 'neuroglancer/unstable/data_panel_layout.js';
import { isProjectionLayer } from 'neuroglancer/unstable/volume_rendering/trackable_volume_rendering_mode.js';
import { VolumeRenderingRenderLayer } from 'neuroglancer/unstable/volume_rendering/volume_render_layer.js';
import { NehubaSliceViewRenderHelper, TransparentPlaneRenderHelper } from "./nehuba_renderers";


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

// `lib/sliceview/frontend.d.ts` is not emitted in the neuroglancer build, so derive the type instead of importing it
type SliceView = ReturnType<typeof makeSliceView>;

const tempMat4 = mat4.create();

enum TransparentRenderingState {
  TRANSPARENT = 0,
  VOLUME_RENDERING = 1,
  MAX_PROJECTION = 2,
}

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
  scaleBars_ = this.registerDisposer(new MultipleScaleBarTextures(this.gl));

  constructor(context: DisplayContext, element: HTMLElement, viewer: PerspectiveViewerState, private config: Config) {
    super(context, element, viewer);

    const removeBgConfig = config.layout!.useNehubaPerspective!.removePerspectiveSlicesBackground;
    const mode = (removeBgConfig && removeBgConfig.mode) || 'none';
    this.nehubaSliceViewRenderHelper = this.registerDisposer(NehubaSliceViewRenderHelper.get(this.gl, perspectivePanelEmit/*sliceViewPanelEmitColor*/, mode));

    this.registerDisposer(this.visibility.changed.add(() => Array.from(this.sliceViews.keys()).forEach(slice => slice.visibility.value = this.visibility.value)));
  }

  disposed() {
    for (let sliceView of this.planarSlices) {
      sliceView.dispose();
    }
    this.planarSlices.clear();
    super.disposed();
  }

  /**
   * Applies the `centerToOrigin` nehuba tweak to a copy of the current projection parameters.
   * Upstream replaced the old `updateProjectionMatrix()` override point with the
   * `DerivedProjectionParameters` mechanism, so instead of mutating a member we derive an
   * adjusted copy that is used only for this frame's rendering.
   */
  private getRenderProjectionParameters(): ProjectionParameters {
    const pp = this.projectionParameters.value;
    const conf = this.config && this.config.layout && this.config.layout.useNehubaPerspective;
    if (!conf || !conf.centerToOrigin) {
      return pp;
    }
    //TODO Regression in PerspectivePanel.startDragViewport, can not shift - drag anymore. FIX or disable
    const pos = this.navigationState.position.value;
    const viewProjectionMat = mat4.clone(pp.viewProjectionMat);
    mat4.translate(viewProjectionMat, viewProjectionMat, vec3.fromValues(pos[0], pos[1], pos[2]));
    const invViewProjectionMat = mat4.create();
    mat4.invert(invViewProjectionMat, viewProjectionMat);
    return { ...pp, viewProjectionMat, invViewProjectionMat } as ProjectionParameters;
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
    const { width, height } = this.renderViewport;
    const showSliceViews = this.viewer.showSliceViews.value;
    for (const [sliceView, unconditional] of this.sliceViews) {
      if (unconditional || showSliceViews) {
        sliceView.updateRendering();
      }
    }
    for (let sliceView of this.planarSlices) {
      sliceView.updateRendering(); // ?? does it change size?
    }

    const gl = this.gl;
    const disablePicking = () => {
      gl.drawBuffers(this.offscreenFramebuffer.singleAttachmentList);
    };
    const bindFramebuffer = () => {
      this.offscreenFramebuffer.bind(width, height);
    };
    bindFramebuffer();
    gl.disable(gl.SCISSOR_TEST);

    // See upstream PerspectivePanel.drawWithPicking for the stencil buffer scheme documentation.
    gl.enable(WebGL2RenderingContext.STENCIL_TEST);
    gl.stencilMask(0xffffffff);
    gl.clearStencil(0);
    gl.clear(WebGL2RenderingContext.STENCIL_BUFFER_BIT);

    gl.stencilOp(
      /*sfail=*/ WebGL2RenderingContext.KEEP,
      /*dpfail=*/ WebGL2RenderingContext.KEEP,
      /*dppass=*/ WebGL2RenderingContext.REPLACE,
    );
    gl.stencilFunc(/*func=*/ WebGL2RenderingContext.ALWAYS, /*ref=*/ 1, /*mask=*/ 1);

    const backgroundColor = this.viewer.perspectiveViewBackgroundColor.value;
    this.gl.clearColor(backgroundColor[0], backgroundColor[1], backgroundColor[2], 0.0);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.clearBufferfv(WebGL2RenderingContext.COLOR, OffscreenTextures.COLOR, [
      backgroundColor[0], backgroundColor[1], backgroundColor[2], 0.0,
    ]);
    gl.clearBufferfv(WebGL2RenderingContext.COLOR, OffscreenTextures.Z, [0, 0, 0, 0]);
    gl.clearBufferfv(WebGL2RenderingContext.COLOR, OffscreenTextures.PICK, [0, 0, 0, 0]);

    gl.enable(gl.DEPTH_TEST);
    const projectionParameters = this.getRenderProjectionParameters();

    // FIXME; avoid temporaries
    let lightingDirection = vec3.create();
    vec3.transformQuat(
        lightingDirection, kAxes[2], this.navigationState.pose.orientation.orientation);
    vec3.scale(lightingDirection, lightingDirection, -1);

    let ambient = 0.2;
    let directional = 1 - ambient;

    const renderContext: PerspectiveViewRenderContext & {extra: ExtraRenderContext} = {
      wireFrame: this.viewer.wireFrame.value,
      projectionParameters,
      lightDirection: lightingDirection,
      ambientLighting: ambient,
      directionalLighting: directional,
      pickIDs: pickingData.pickIDs,
      emitter: perspectivePanelEmit,
      emitColor: true,
      emitPickID: true,
      alreadyEmittedPickID: false,
      bindFramebuffer,
      frameNumber: this.context.frameNumber,
      sliceViewsPresent: this.sliceViews.size > 0,
      isContinuousCameraMotionInProgress: this['isContinuousCameraMotionInProgress'],
      force3DHistogramForAutoRange: this.context.force3DHistogramForAutoRange,
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

    mat4.copy(pickingData.invTransform, projectionParameters.invViewProjectionMat);

    const { visibleLayers } = this.visibleLayerTracker;

    let hasTransparent = false;
    let hasVolumeRenderingPick = false;
    let hasAnnotation = false;
    let hasVolumeRendering = false;

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
        if (renderLayer.isVolumeRendering) {
          hasVolumeRendering = true;
          hasVolumeRenderingPick =
            hasVolumeRenderingPick ||
            !renderContext.isContinuousCameraMotionInProgress ||
            isProjectionLayer(renderLayer as VolumeRenderingRenderLayer);
        }
      }
    }
    this['hasVolumeRendering'] = hasVolumeRendering;

    const waitForMesh = this.config.layout!.useNehubaPerspective!.waitForMesh;
    if (!waitForMesh || hasTransparent || renderContext.extra.meshRendered) {
      this.drawSliceViews(renderContext);
    }

    if (hasAnnotation) {
      // Render annotations with blending enabled.
      gl.enable(WebGL2RenderingContext.BLEND);
      gl.depthFunc(WebGL2RenderingContext.LEQUAL);
      gl.blendFunc(WebGL2RenderingContext.SRC_ALPHA, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA);
      for (const [renderLayer, attachment] of visibleLayers) {
        if (renderLayer.isAnnotation) {
          const annotationRenderLayer = renderLayer as any;
          if (annotationRenderLayer.base.state.displayState.disablePicking.value) {
            disablePicking();
            annotationRenderLayer.draw(renderContext, attachment);
            renderContext.bindFramebuffer();
          } else {
            annotationRenderLayer.draw(renderContext, attachment);
          }
        }
      }
      gl.depthFunc(WebGL2RenderingContext.LESS);
      gl.disable(WebGL2RenderingContext.BLEND);
    }

    const disableAxisLines = this.config.layout!.useNehubaPerspective!.disableAxisLinesInPerspective;
    if (this.viewer.showAxisLines.value && !disableAxisLines) {
      this.drawAxisLines();
    }

    // Disable stencil operations.
    gl.stencilOp(
      /*sfail=*/ WebGL2RenderingContext.KEEP,
      /*dpfail=*/ WebGL2RenderingContext.KEEP,
      /*dppass=*/ WebGL2RenderingContext.KEEP,
    );

    if (hasTransparent) {
      // Draw transparent objects.
      let volumeRenderingBufferWidth = width;
      let volumeRenderingBufferHeight = height;

      // Create volume rendering related buffers.
      let bindMaxProjectionBuffer: () => void = () => {};
      let bindMaxProjectionPickingBuffer: () => void = () => {};
      let bindVolumeRenderingBuffer: () => void = () => {};
      if (hasVolumeRendering) {
        // Max projection setup
        renderContext.maxProjectionEmit = maxProjectionEmit;
        const maxProjectionConfiguration = this['maxProjectionConfiguration'];
        bindMaxProjectionBuffer = () => {
          maxProjectionConfiguration.bind(volumeRenderingBufferWidth, volumeRenderingBufferHeight);
        };
        gl.depthMask(true);
        bindMaxProjectionBuffer();
        renderContext.bindMaxProjectionBuffer = bindMaxProjectionBuffer;
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clearDepth(0.0);
        gl.clear(WebGL2RenderingContext.COLOR_BUFFER_BIT | WebGL2RenderingContext.DEPTH_BUFFER_BIT);

        // Max projection picking setup
        const maxProjectionPickConfiguration = this['maxProjectionPickConfiguration'];
        bindMaxProjectionPickingBuffer = () => {
          maxProjectionPickConfiguration.bind(volumeRenderingBufferWidth, volumeRenderingBufferHeight);
        };
        bindMaxProjectionPickingBuffer();
        gl.clear(WebGL2RenderingContext.COLOR_BUFFER_BIT | WebGL2RenderingContext.DEPTH_BUFFER_BIT);

        // Volume rendering setup
        bindVolumeRenderingBuffer = () => {
          this['volumeRenderingConfiguration'].bind(volumeRenderingBufferWidth, volumeRenderingBufferHeight);
        };
        bindVolumeRenderingBuffer();
        renderContext.bindVolumeRenderingBuffer = bindVolumeRenderingBuffer;
        gl.clearDepth(1.0);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(WebGL2RenderingContext.COLOR_BUFFER_BIT | WebGL2RenderingContext.DEPTH_BUFFER_BIT);
      }

      const transparentConfiguration = this['transparentConfiguration'];
      renderContext.bindFramebuffer = () => {
        transparentConfiguration.bind(width, height);
      };
      renderContext.bindFramebuffer();

      // Compute accumulate and revealage textures.
      gl.depthMask(false);
      gl.enable(WebGL2RenderingContext.BLEND);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(WebGL2RenderingContext.COLOR_BUFFER_BIT);
      renderContext.emitter = perspectivePanelEmitOIT;
      gl.blendFuncSeparate(WebGL2RenderingContext.ONE, WebGL2RenderingContext.ONE, WebGL2RenderingContext.ZERO, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA);
      renderContext.emitPickID = false;
      let currentTransparentRenderingState = TransparentRenderingState.TRANSPARENT;
      for (const [renderLayer, attachment] of visibleLayers) {
        if (renderLayer.isVolumeRendering) {
          renderContext.depthBufferTexture =
            this.offscreenFramebuffer.colorBuffers[OffscreenTextures.Z].texture;

          const isVolumeProjectionLayer = isProjectionLayer(renderLayer as VolumeRenderingRenderLayer);
          const needsSecondPickingPass =
            !isVolumeProjectionLayer &&
            !renderContext.isContinuousCameraMotionInProgress &&
            !renderContext.wireFrame;

          if (isVolumeProjectionLayer) {
            gl.depthMask(true);
            gl.disable(WebGL2RenderingContext.BLEND);
            gl.depthFunc(WebGL2RenderingContext.GREATER);
            if (currentTransparentRenderingState !== TransparentRenderingState.MAX_PROJECTION) {
              renderContext.emitter = maxProjectionEmit;
              bindMaxProjectionBuffer();
            }
          } else {
            if (currentTransparentRenderingState !== TransparentRenderingState.VOLUME_RENDERING) {
              renderContext.emitter = perspectivePanelEmitOIT;
              bindVolumeRenderingBuffer();
            }
            gl.disable(WebGL2RenderingContext.DEPTH_TEST);
            currentTransparentRenderingState = TransparentRenderingState.VOLUME_RENDERING;
          }

          renderLayer.draw(renderContext, attachment);
          gl.enable(WebGL2RenderingContext.DEPTH_TEST);

          if (!needsSecondPickingPass && !isVolumeProjectionLayer) {
            continue;
          }

          const maxProjectionConfiguration = this['maxProjectionConfiguration'];
          bindMaxProjectionPickingBuffer();
          this['maxProjectionToPickCopyHelper'].draw(
            maxProjectionConfiguration.colorBuffers[1 /*depth*/].texture,
            maxProjectionConfiguration.colorBuffers[2 /*intensity*/].texture,
            maxProjectionConfiguration.colorBuffers[3 /*pick*/].texture,
          );

          gl.enable(WebGL2RenderingContext.BLEND);
          gl.blendFuncSeparate(WebGL2RenderingContext.ONE, WebGL2RenderingContext.ONE, WebGL2RenderingContext.ZERO, WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA);

          if (isVolumeProjectionLayer) {
            bindVolumeRenderingBuffer();
            gl.depthMask(false);
            gl.disable(WebGL2RenderingContext.DEPTH_TEST);
            this['maxProjectionColorCopyHelper'].draw(
              maxProjectionConfiguration.colorBuffers[0 /*color*/].texture,
              maxProjectionConfiguration.colorBuffers[1 /*depth*/].texture,
            );
          }

          bindMaxProjectionBuffer();
          renderContext.emitter = maxProjectionEmit;
          gl.depthMask(true);
          gl.clearColor(0.0, 0.0, 0.0, 0.0);
          gl.clearDepth(0.0);
          gl.clear(WebGL2RenderingContext.COLOR_BUFFER_BIT | WebGL2RenderingContext.DEPTH_BUFFER_BIT);

          gl.clearDepth(1.0);
          gl.clearColor(0.0, 0.0, 0.0, 1.0);
          gl.depthMask(false);
          gl.enable(WebGL2RenderingContext.DEPTH_TEST);
          gl.depthFunc(WebGL2RenderingContext.LESS);

          currentTransparentRenderingState = TransparentRenderingState.MAX_PROJECTION;
        }
        // Draw regular transparent layers
        else if (renderLayer.isTransparent) {
          if (currentTransparentRenderingState !== TransparentRenderingState.TRANSPARENT) {
            renderContext.emitter = perspectivePanelEmitOIT;
            renderContext.bindFramebuffer();
          }
          currentTransparentRenderingState = TransparentRenderingState.TRANSPARENT;
          renderLayer.draw(renderContext, attachment);
        }
      }

      // Copy transparent rendering result back to primary buffer.
      gl.disable(WebGL2RenderingContext.DEPTH_TEST);
      if (hasVolumeRendering) {
        renderContext.bindFramebuffer();
        this['transparentToTransparentCopyHelper'].draw(
          this['volumeRenderingConfiguration'].colorBuffers[0].texture,
          this['volumeRenderingConfiguration'].colorBuffers[1].texture,
        );
      }
      gl.blendFunc(WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA, WebGL2RenderingContext.SRC_ALPHA);
      this.offscreenFramebuffer.bindSingle(OffscreenTextures.COLOR);
      this['transparencyCopyHelper'].draw(
          transparentConfiguration.colorBuffers[0].texture,
          transparentConfiguration.colorBuffers[1].texture);

      gl.depthMask(true);
      gl.disable(WebGL2RenderingContext.BLEND);
      gl.enable(WebGL2RenderingContext.DEPTH_TEST);

      // Restore framebuffer attachments.
      renderContext.bindFramebuffer = bindFramebuffer;
      bindFramebuffer();

      // Do picking only rendering pass for transparent layers.
      gl.enable(WebGL2RenderingContext.STENCIL_TEST);
      gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      renderContext.emitter = perspectivePanelEmit;
      renderContext.emitPickID = true;
      renderContext.emitColor = false;

      // First, render `transparentPickEnabled=true` layers.
      gl.stencilFunc(/*func=*/ WebGL2RenderingContext.NOTEQUAL, /*ref=*/ 3, /*mask=*/ 1);
      gl.stencilOp(
        /*sfail=*/ WebGL2RenderingContext.KEEP,
        /*dpfail=*/ WebGL2RenderingContext.KEEP,
        /*dppass=*/ WebGL2RenderingContext.REPLACE,
      );
      gl.stencilMask(2);
      if (hasVolumeRenderingPick) {
        this['maxProjectionPickCopyHelper'].draw(
          this['maxProjectionPickConfiguration'].colorBuffers[0].texture /*depth*/,
          this['maxProjectionPickConfiguration'].colorBuffers[1].texture /*pick*/,
        );
      }
      for (const [renderLayer, attachment] of visibleLayers) {
        if (!renderLayer.isTransparent || !renderLayer.transparentPickEnabled || renderLayer.isVolumeRendering) {
          continue;
        } else {
          renderLayer.draw(renderContext, attachment);
        }
      }

      gl.stencilFunc(/*func=*/ WebGL2RenderingContext.EQUAL, /*ref=*/ 0, /*mask=*/ 3);
      gl.stencilOp(
        /*sfail=*/ WebGL2RenderingContext.KEEP,
        /*dpfail=*/ WebGL2RenderingContext.KEEP,
        /*dppass=*/ WebGL2RenderingContext.KEEP,
      );
      gl.stencilMask(0);
      for (const [renderLayer, attachment] of visibleLayers) {
        if (!renderLayer.isTransparent || renderLayer.transparentPickEnabled) {
          continue;
        }
        renderLayer.draw(renderContext, attachment);
      }
    }
    gl.stencilMask(0xffffffff);
    gl.disable(WebGL2RenderingContext.STENCIL_TEST);

    /** Neuroglancer renders the scalebar with WebGL instead of separate HTML element.
     *  See the old scalebar widget note in the git history for the highdpi rationale. */
    if (this.viewer.showScaleBar.value && this.viewer.orthographicProjection.value) {

      // Only modify color buffer.
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

      gl.disable(WebGL2RenderingContext.DEPTH_TEST);
      gl.enable(WebGL2RenderingContext.BLEND);
      gl.blendFunc(
        WebGL2RenderingContext.SRC_ALPHA,
        WebGL2RenderingContext.ONE_MINUS_SRC_ALPHA,
      );
      const { scaleBars_ } = this;
      const options = this.viewer.scaleBarOptions.value;
      scaleBars_.draw(
        this.renderViewport,
        this.navigationState.displayDimensionRenderInfo.value,
        this.navigationState.relativeDisplayScales.value,
        this.navigationState.zoomFactor.value /
          this.renderViewport.logicalHeight,
        options,
      );
      gl.disable(WebGL2RenderingContext.BLEND);
    }

    this.offscreenFramebuffer.unbind();

    // Draw the texture over the whole viewport.
    this.setGLClippedViewport();
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
    let {lightDirection, ambientLighting, directionalLighting, projectionParameters: {viewProjectionMat}} = renderContext;

    const showSliceViews = this.viewer.showSliceViews.value;
    if (!conf.hideAllSlices) {
      const removeBgConfig = conf.removePerspectiveSlicesBackground;
      const render = removeBgConfig ? nehubaSliceViewRenderHelper : sliceViewRenderHelper;
      for (const [sliceView, unconditional] of this.sliceViews) {
        if (!unconditional && !showSliceViews) {
          continue;
        }
        const {
          width: sliceViewWidth,
          height: sliceViewHeight,
          invViewMatrix: sliceViewInvViewMatrix,
          viewportNormalInCanonicalCoordinates,
        } = sliceView.projectionParameters.value;
        if (sliceViewWidth === 0 || sliceViewHeight === 0 || !sliceView.valid) {
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
            Math.abs(vec3.dot(lightDirection, viewportNormalInCanonicalCoordinates));
        let factor = ambientLighting + scalar * directionalLighting;
        let mat = tempMat4;
        // Need a matrix that maps (+1, +1, 0) to projectionMat * (width, height, 0)
        mat4.identity(mat);
        mat[0] = sliceViewWidth / 2.0;
        mat[5] = -sliceViewHeight / 2.0;
        mat4.multiply(mat, sliceViewInvViewMatrix, mat);
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
    // Reverse-order, we actually draw substrate after the slice.
    if (conf.drawSubstrates && showSliceViews) {
      const m = (conf.fixedZoomPerspectiveSlices && conf.fixedZoomPerspectiveSlices.sliceViewportSizeMultiplier) || 1.0 ;
      for (let sliceView of this.sliceViews.keys()) {
        const {
          width: sliceViewWidth,
          height: sliceViewHeight,
          invViewMatrix: sliceViewInvViewMatrix,
          viewportNormalInCanonicalCoordinates,
        } = sliceView.projectionParameters.value;
        let mat = tempMat4;
        // Need a matrix that maps (+1, +1, 0) to projectionMat * (width, height, 0)
        mat4.identity(mat);
        mat[0] = sliceViewWidth / 2.0 / m;
        mat[5] = -sliceViewHeight / 2.0 / m;
        mat4.multiply(mat, sliceViewInvViewMatrix, mat);

        //We want this plane to move only in the direction perpendicular to the plane.
        //So we need to undo translation in the other 2 directions.
        let dtd = mat4.clone(viewProjectionMat);
        const position = this.navigationState.position.value;
        let pos = vec3.fromValues(position[0], position[1], position[2]);
        let axis = vec3.clone(viewportNormalInCanonicalCoordinates);
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
          const {
            width: sliceViewWidth,
            height: sliceViewHeight,
            invViewMatrix: sliceViewInvViewMatrix,
          } = sliceView.projectionParameters.value;
          let mat = tempMat4;
          // Need a matrix that maps (+1, +1, 0) to projectionMat * (width, height, 0)
          mat4.identity(mat);
          mat[0] = sliceViewWidth / 2.0;
          mat[5] = -sliceViewHeight / 2.0;
          mat4.multiply(mat, sliceViewInvViewMatrix, mat);
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
