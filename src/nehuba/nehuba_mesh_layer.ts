import { ChunkState } from 'neuroglancer/unstable/chunk_manager/base.js';
import { VisibleLayerInfo } from 'neuroglancer/unstable/layer/index.js';
import { PerspectiveViewRenderContext } from 'neuroglancer/unstable/perspective_view/render_layer.js';
import { ThreeDimensionalRenderLayerAttachmentState, update3dRenderLayerAttachment } from 'neuroglancer/unstable/renderlayer.js';
import { getObjectKey } from 'neuroglancer/unstable/segmentation_display_state/base.js';
import { mat4, vec3, vec4, quat } from 'neuroglancer/unstable/util/geom.js';
import { GL } from 'neuroglancer/unstable/webgl/context.js';
import { ShaderBuilder, ShaderProgram } from 'neuroglancer/unstable/webgl/shader.js';
import { parameterizedEmitterDependentShaderGetter } from 'neuroglancer/unstable/webgl/dynamic_shader.js';
import { WatchableValue, makeCachedDerivedWatchableValue } from 'neuroglancer/unstable/trackable_value.js';
import { RefCounted } from 'neuroglancer/unstable/util/disposable.js';
import { Uint64Set } from "neuroglancer/unstable/uint64_set.js"

import { MeshShaderManager, MeshLayer, MeshSource, MeshDisplayState } from "neuroglancer/unstable/mesh/frontend.js"

import { ExtraRenderContext } from "./nehuba_perspective_panel";
import { VertexPositionFormat } from 'neuroglancer/unstable/mesh/base.js';
import { PerspectivePanel } from 'neuroglancer/unstable/perspective_view/panel.js';
import { forEachVisibleSegmentToDraw } from 'neuroglancer/unstable/segmentation_display_state/frontend.js';
import { Config } from './config';

/**
 * GLSL helper for decoding octahedron-encoded normals. Copied from Neuroglancer's
 * `mesh/frontend.ts`, where it is module-private (`glsl_decodeNormalOctahedronSnorm8`)
 * and therefore not importable.
 */
const glsl_decodeNormalOctahedronSnorm8 = `
highp vec3 decodeNormalOctahedronSnorm8(highp vec2 e) {
  vec3 v = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
  if (v.z < 0.0) v.xy = (1.0 - abs(v.yx)) * vec2(v.x > 0.0 ? 1.0 : -1.0, v.y > 0.0 ? 1.0 : -1.0);
  return normalize(v);
}
`;

export class NehubaMeshShaderManager extends MeshShaderManager {
  public hideSlicesWatchable = new WatchableValue<boolean>(false);
  constructor(
    public fragmentRelativeVertices: boolean,
    public vertexPositionFormat: VertexPositionFormat,
    public conf?: Config
  ) {
    super(fragmentRelativeVertices, vertexPositionFormat)
  }
  /*
   * In the current Neuroglancer the base `MeshShaderManager` no longer exposes a
   * `defineShader` method to override: the shader is defined inline inside `makeGetter`
   * via `parameterizedEmitterDependentShaderGetter`. We keep a `defineShader` method here
   * for clarity, but it can no longer call `super.defineShader`, so we reproduce the parts
   * of the base setup this layer relies on (float32 vertex positions, octahedral normals,
   * lighting) before adding the nehuba-specific clipping uniforms. It is wired up through
   * our own `makeGetter` override below.
   */
  defineShader(builder: ShaderBuilder, silhouetteRenderingEnabled = false) {
    // --- base MeshShaderManager setup (float32 vertex position format) ---
    builder.addAttribute('highp vec3', 'aVertexPosition');
    builder.addVertexCode('highp vec3 getVertexPosition() { return aVertexPosition; }');
    builder.addAttribute('highp vec2', 'aVertexNormal');
    builder.addVarying('highp vec4', 'vColor');
    builder.addUniform('highp vec4', 'uLightDirection');
    builder.addUniform('highp vec4', 'uColor');
    builder.addUniform('highp mat3', 'uNormalMatrix');
    builder.addUniform('highp mat4', 'uModelViewProjection');
    builder.addUniform('highp uint', 'uPickID');
    // Silhouette rendering: the inherited `beginLayer` sets `uSilhouettePower` whenever
    // `displayState.silhouetteRendering.value > 0`, so the uniform must be declared here
    // (and the shader rebuilt via the parameters watchable in `makeGetter`) to match the
    // base MeshShaderManager; otherwise setting it fails with "invalid uniform uSilhouettePower".
    if (silhouetteRenderingEnabled) {
      builder.addUniform('highp float', 'uSilhouettePower');
    }
    builder.addVertexCode(glsl_decodeNormalOctahedronSnorm8);

    // --- nehuba-specific clipping additions ---
    builder.addUniform('highp mat4', 'uModelMatrix');
    builder.addVarying('highp vec4', 'vNavPos');
    builder.addUniform('highp mat4', 'uNavState');
    builder.addUniform('highp vec4', 'uOctant');
    builder.addUniform('highp vec4', 'uBackFaceColor');
    builder.addVarying('highp vec4', 'vBackFaceColor');
    let vertexMain = ``;
    if (this.fragmentRelativeVertices) {
      vertexMain += `
  highp vec3 vertexPosition = uFragmentOrigin + uFragmentShape * getVertexPosition();
  highp vec3 normalMultiplier = 1.0 / uFragmentShape;
  `;
    } else {
      vertexMain += `
  highp vec3 vertexPosition = getVertexPosition();
  highp vec3 normalMultiplier = vec3(1.0, 1.0, 1.0);
  `;
    }
    vertexMain += `
vec4 position = uModelMatrix * vec4(vertexPosition, 1.0);
if (uOctant.w > 0.0) {
	vNavPos = uNavState * position * uOctant;
} else {
	vNavPos = vec4(-1.0);
}
gl_Position = uModelViewProjection * vec4(vertexPosition, 1.0);
vec3 origNormal = decodeNormalOctahedronSnorm8(aVertexNormal);
vec3 normal = normalize(uNormalMatrix * (normalMultiplier * origNormal));
float absCosAngle = abs(dot(normal, uLightDirection.xyz));
float lightingFactor = absCosAngle + uLightDirection.w;
vColor = vec4(lightingFactor * uColor.rgb, uColor.a);
`;
    if (silhouetteRenderingEnabled) {
      vertexMain += `
vColor *= pow(1.0 - absCosAngle, uSilhouettePower);
`;
    }
    vertexMain += `
if (uColor.a < 1.0) {
	vBackFaceColor = vec4(vColor.rgb, 0.0);
} else {
	vBackFaceColor = uBackFaceColor;
}
		`; //vBackFaceColor = vec4(lightingFactor * uBackFaceColor.rgb, uColor.a);
    builder.setVertexMain(vertexMain);
    const meshOcclusionConds: string[] = []
    const hideSlices = this.conf?.layout?.useNehubaPerspective?.hideSlices || []
    if (!hideSlices.includes("slice2")) {
      meshOcclusionConds.push(`vNavPos.x >= 0.0`)
    }
    if (!hideSlices.includes("slice1")) {
      meshOcclusionConds.push(`vNavPos.y >= 0.0`)
    }
    if (!hideSlices.includes("slice3")) {
      meshOcclusionConds.push(`vNavPos.z >= 0.0`)
    }
    // do not render backmesh if:
    // - no occlusion
    // - silhouette enabled
    if (meshOcclusionConds.length === 0 || silhouetteRenderingEnabled) {
      builder.setFragmentMain(`
if (gl_FrontFacing) emit(vColor, uPickID);
else discard;
      `)
      return
    }
    
    builder.setFragmentMain(`
if (${meshOcclusionConds.join(" && ")}) {
  discard;
} else {
  if (gl_FrontFacing) emit(vColor, uPickID);
  else emit(vBackFaceColor, uPickID);
}
		`);
  }
  /* In commit aec53cf0bba24567ae60454725f1e97023e7f689 of Neuroglancer `uModelMatrix` was removed, so we need to re-add it here */
  beginModel(gl: GL, shader: ShaderProgram, renderContext: PerspectiveViewRenderContext, modelMat: mat4) {
    super.beginModel(gl, shader, renderContext, modelMat);
    gl.uniformMatrix4fv(shader.uniform('uModelMatrix'), false, modelMat);
  }

  setValuesForClipping(gl: GL, shader: ShaderProgram, values: ValuesForClipping) {
    this.setNavState(gl, shader, values.navState);
    this.setOctant(gl, shader, values.octant);
    this.setBackFaceColor(gl, shader, values.backFaceColor);
  }
  setNavState(gl: GL, shader: ShaderProgram, navMat: mat4) {
    gl.uniformMatrix4fv(shader.uniform('uNavState'), false, navMat);
  }
  setOctant(gl: GL, shader: ShaderProgram, octant: vec4) {
    if (this.conf?.layout?.useNehubaPerspective?.lockMeshOcclusion) {
      return
    }
    gl.uniform4fv(shader.uniform('uOctant'), octant);
  }
  setBackFaceColor(gl: GL, shader: ShaderProgram, color: vec4) {
    gl.uniform4fv(shader.uniform('uBackFaceColor'), color);
  }
  /*
   * Overrides the base `makeGetter` so the emitter-dependent shader is built with our
   * custom `defineShader` (adding the clipping uniforms) rather than the base one. We keep
   * the base silhouette-rendering parameter so `uSilhouettePower` is declared when silhouette
   * rendering is enabled, matching the inherited `beginLayer` which sets that uniform.
   */
  makeGetter(layer: RefCounted & { gl: GL; displayState: MeshDisplayState }) {
    // Combine the hideSlices rebuild trigger with the silhouette-enabled flag so the shader
    // is rebuilt (and `uSilhouettePower` (re)declared) whenever either changes.
    const parameters = layer.registerDisposer(
      makeCachedDerivedWatchableValue(
        (hideSlicesToggle, silhouetteRendering) => ({
          hideSlicesToggle,
          silhouetteRenderingEnabled: silhouetteRendering > 0,
        }),
        [this.hideSlicesWatchable, layer.displayState.silhouetteRendering],
      ),
    );
    // The base `makeGetter` is typed with `Parameters = boolean`; our richer parameters
    // object makes the return type structurally incompatible. Callers (`draw`) only read
    // `.shader` from the getter, so cast back to the base return type to satisfy the override.
    return parameterizedEmitterDependentShaderGetter(layer, layer.gl, {
      memoizeKey:
        `mesh/NehubaMeshShaderManager/${this.fragmentRelativeVertices}/${this.vertexPositionFormat}`,
      parameters,
      defineShader: (builder, { silhouetteRenderingEnabled }) => {
        this.defineShader(builder, silhouetteRenderingEnabled);
      },
    }) as unknown as ReturnType<MeshShaderManager["makeGetter"]>;
  }
}

export class NehubaMeshLayer extends MeshLayer {

  private getShader_;
  private hideSlices = new Set<'slice1' | 'slice2' | 'slice3'>()
  constructor(chunkManager: ChunkManager, source: MeshSource, displayState: MeshDisplayState) {
    super(chunkManager, source, displayState);
    this.meshShaderManager = new NehubaMeshShaderManager(/*fragmentRelativeVertices=*/ false, VertexPositionFormat.float32);
    this.getShader_ = this.meshShaderManager.makeGetter(this)
  }

  rebuildShader(conf: Config){
    const wantedHideSlices = new Set(conf.layout?.useNehubaPerspective?.hideSlices || [])
    if (!(this.meshShaderManager instanceof NehubaMeshShaderManager)) {
      return false
    }
    const currHideSlices = this.hideSlices
    
    if (wantedHideSlices.size !== currHideSlices.size) {
      this.hideSlices = wantedHideSlices
      this.meshShaderManager.hideSlicesWatchable.value = !this.meshShaderManager.hideSlicesWatchable.value
      return true
    }
    if ([...wantedHideSlices].some(v => !currHideSlices.has(v))) {
      this.hideSlices = wantedHideSlices
      this.meshShaderManager.hideSlicesWatchable.value = !this.meshShaderManager.hideSlicesWatchable.value
      return true
    }
    return false
  }

  draw(
    renderContext: PerspectiveViewRenderContext & { extra: ExtraRenderContext },
    attachment: VisibleLayerInfo<
      PerspectivePanel,
      ThreeDimensionalRenderLayerAttachmentState
    >,
  ) { //What if called without extra? (by normal ng layer)
    if (!renderContext.emitColor && renderContext.alreadyEmittedPickID) {
      // No need for a separate pick ID pass.
      return;
    }
    this.rebuildShader(renderContext.extra.config)
    const { gl, displayState, /*meshShaderManager*/ } = this;
    const meshShaderManager = this.meshShaderManager as unknown as NehubaMeshShaderManager;
    meshShaderManager.conf = renderContext.extra.config
    
    meshShaderManager.conf.layout?.useNehubaPerspective?.hideSlices

    const alpha = Math.min(1.0, displayState.objectAlpha.value);

    if (alpha <= 0.0) {
      // Skip drawing.
      return;
    }

    const modelMatrix = update3dRenderLayerAttachment(displayState.transform.value, renderContext.projectionParameters.displayDimensionRenderInfo, attachment);
    if (modelMatrix === undefined) {
      return;
    }
    const { shader } = this.getShader_(renderContext.emitter);
    if (!shader) return
    shader.bind();
    meshShaderManager.beginLayer(gl, shader, renderContext, this.displayState);

    if (!renderContext.extra) {
      console.error('Bad configuration. Nehuba mesh layer is used by neuroglancer code.');
    }
    const valuesForClipping = getValuesForClipping(renderContext.extra);
    meshShaderManager.setValuesForClipping(gl, shader, valuesForClipping);

    meshShaderManager.beginModel(gl, shader, renderContext, modelMatrix);

    const manifestChunks = this.source.chunks;

    let totalChunks = 0, presentChunks = 0;
    // const { renderScaleHistogram } = this.displayState;
    const fragmentChunks = this.source.fragmentSource.chunks;

    const _visibleSegments = displayState?.segmentationGroupState?.value?.visibleSegments
    let uint64set: Uint64Set | null = null
    if (isVisibleSegmentsWrapper(_visibleSegments)) {
      uint64set = _visibleSegments.getLoadedMeshes()
    }

    forEachVisibleSegmentToDraw(
      displayState,
      this,
      renderContext.emitColor,
      renderContext.emitPickID ? renderContext.pickIDs : undefined,
      (objectId: any, color: any, pickIndex: any) => {
        if (!!uint64set && !uint64set.has(objectId)) {
          return
        }
        const key = getObjectKey(objectId);
        const manifestChunk = manifestChunks.get(key);
        ++totalChunks;
        if (manifestChunk === undefined) return;
        ++presentChunks;
        if (renderContext.emitColor) {
          meshShaderManager.setColor(gl, shader, color!);
        }
        if (renderContext.emitPickID) {
          meshShaderManager.setPickID(gl, shader, pickIndex!);
        }
        totalChunks += manifestChunk.fragmentIds.length;

        for (const fragmentId of manifestChunk.fragmentIds) {
          
          // if (renderContext.extra.showSliceViewsCheckboxValue && isVisibleSegmentsWrapper(visibleSegments) && !surfaceParcellation) {
          //   if (visibleSegments.has(rootObjectId)) meshShaderManager.setValuesForClipping(gl, shader, NoClipping);
          //   else meshShaderManager.setValuesForClipping(gl, shader, valuesForClipping);
          // }
          const { key: fragmentKey } = this.source.getFragmentKey(
            key,
            fragmentId,
          );
          const fragment = fragmentChunks.get(fragmentKey);
          if (
            fragment !== undefined &&
            fragment.state === ChunkState.GPU_MEMORY
          ) {
            meshShaderManager.drawFragment(gl, shader, fragment);
            ++presentChunks;
          }
        }
      }
    )

    meshShaderManager.endLayer(gl, shader);
  }
}

// const tempQuat = quat.create();
// const tempMat4 = mat4.create();
// TODO Use these in getValuesForClipping() to save some allocations. At the moment left as it is for clarity

export interface ValuesForClipping {
  navState: mat4;
  octant: vec4;
  backFaceColor: vec4;
}

export const NoClipping: ValuesForClipping = { navState: mat4.create(), octant: vec4.fromValues(0.0, 0.0, 0.0, 0.0), backFaceColor: vec4.fromValues(0.5, 0.5, 0.5, 1) };

export function getValuesForClipping(extra: ExtraRenderContext): ValuesForClipping {
  if (!extra.showSliceViewsCheckboxValue) {
    return NoClipping;
  }

  const centerToOrigin = (extra && extra.config.layout!.useNehubaPerspective!.centerToOrigin);
  const conf = (extra && extra.config.layout!.useNehubaPerspective!.mesh); //Is it undefined?

  const backFaceColor =
    (conf && conf.backFaceColor) ||
    (extra && extra.config && extra.config.layout && extra.config.layout.useNehubaPerspective && extra.config.layout.useNehubaPerspective.perspectiveSlicesBackground) ||
    (extra && extra.crossSectionBackground)

  const navState = mat4.create();
  let octant = (conf && conf.removeOctant) || vec4.fromValues(0.0, 0.0, 0.0, 0.0);
  if (extra && conf) {
    if (conf.removeBasedOnNavigation) {
      extra.slicesNavigationState.toMat4(navState);
      mat4.invert(navState, navState);
    }

    if (conf.flipRemovedOctant) {
      const octantZ = centerToOrigin ? extra.perspectiveNavigationState.zoomFactor.value : 1.0;
      octant = vec4.fromValues(0.0, 0.0, -(octantZ), 1.0);
      let perspectivePose = extra.perspectiveNavigationState.pose;
      let position = extra.slicesNavigationState.position.value;
      let pos = centerToOrigin ? vec3.fromValues(position[0], position[1], position[2]) : vec3.fromValues(0.0, 0.0, 0.0);
      let perspectiveQuat = perspectivePose.orientation.orientation;
      let navQuat = quat.invert(quat.create(), extra.slicesNavigationState.pose.orientation.orientation);
      let resQuat = quat.multiply(quat.create(), navQuat, perspectiveQuat);
      let rot = mat4.fromQuat(mat4.create(), resQuat);
      vec4.transformMat4(octant, octant, rot);
      octant[0] = octant[0] < pos[0] ? -1.0 : 1.0;
      octant[1] = octant[1] < pos[1] ? -1.0 : 1.0;
      octant[2] = octant[2] < pos[2] ? -1.0 : 1.0;
      octant[3] = 1.0;//octant[3] < 0.0 ? -1.0 : 1.0;
    }
  }
  return { navState, octant, backFaceColor: vec4.fromValues(backFaceColor[0], backFaceColor[1], backFaceColor[2], 1.0) };
}

/**
 * Public surface of the visible-segments wrapper, on top of the plain `Uint64Set`.
 *
 * The wrapper keeps a private "visible meshes" set (`localHashTable`) separate from the
 * underlying "loaded meshes" set (the wrapped `Uint64Set`), so mesh loading can be
 * controlled independently of segment selection.
 */
export interface VisibleSegmentsWrapper extends Uint64Set {
  getLoadedMeshes(): Uint64Set;
  setMeshesToLoad(meshes: number[]): void;
}

/**
 * Marker used to identify a wrapped set. A `Proxy` cannot be detected with `instanceof`,
 * so we tag it with this symbol and query it via {@link isVisibleSegmentsWrapper}.
 */
const IS_VISIBLE_SEGMENTS_WRAPPER = Symbol("isVisibleSegmentsWrapper");

export function isVisibleSegmentsWrapper(x: unknown): x is VisibleSegmentsWrapper {
  return !!x && (x as any)[IS_VISIBLE_SEGMENTS_WRAPPER] === true;
}

/**
 * Wraps a `Uint64Set` of visible segments with a `Proxy` that transparently forwards every
 * member to the wrapped set, except for the ones listed in `overrides`. This replaces the
 * former hand-written `VisibleSegmentsWrapper` class and its large amount of pass-through /
 * "should never be called" boilerplate.
 */
export function createVisibleSegmentsWrapper(wrapped: Uint64Set): VisibleSegmentsWrapper {

  const localHashTable = new Uint64Set()
  const overrides: Record<PropertyKey, unknown> = {

    getLoadedMeshes: () => localHashTable,

    setMeshesToLoad: (meshes: number[]) => {
      wrapped.clear()
      localHashTable.clear()

      const meshesBigInt = meshes.map(v => BigInt(v));
      localHashTable.add(meshesBigInt)
      wrapped.add(meshesBigInt)

      wrapped.changed.dispatch(meshesBigInt, true);
    },
  };

  const proxy = new Proxy(wrapped, {
    get(target, p) {
      if (p === IS_VISIBLE_SEGMENTS_WRAPPER) {
        return true
      }
      if (p in overrides) return overrides[p];
      const res = (target as any)[p];
      return typeof res === "function" ? res.bind(target) : res;
    },
  }) as unknown as VisibleSegmentsWrapper;

  return proxy;
}