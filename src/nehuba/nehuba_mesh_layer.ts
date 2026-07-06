import { ChunkState } from 'neuroglancer/unstable/chunk_manager/base.js';
// import {ChunkManager} from 'neuroglancer/unstable/chunk_manager/frontend.js';
import { VisibleLayerInfo } from 'neuroglancer/unstable/layer/index.js';
import { PerspectiveViewRenderContext } from 'neuroglancer/unstable/perspective_view/render_layer.js';
import { ThreeDimensionalRenderLayerAttachmentState, update3dRenderLayerAttachment } from 'neuroglancer/unstable/renderlayer.js';
import { forEachVisibleSegment, getObjectKey } from 'neuroglancer/unstable/segmentation_display_state/base.js';
// import {getObjectColor, SegmentationDisplayState3D} from 'neuroglancer/unstable/segmentation_display_state/frontend.js';
import { mat4, vec3, vec4, quat } from 'neuroglancer/unstable/util/geom.js';
import { getObjectId } from 'neuroglancer/unstable/util/object_id.js';
import { GL } from 'neuroglancer/unstable/webgl/context.js';
import { ShaderBuilder, ShaderModule, ShaderProgram } from 'neuroglancer/unstable/webgl/shader.js';
// import {Uint64} from 'neuroglancer/util/uint64';
import { Uint64Set } from "neuroglancer/unstable/uint64_set.js"

import { HashSetUint64 } from 'neuroglancer/unstable/gpu_hash/hash_table.js';

import { MeshShaderManager, MeshLayer, MeshSource, MeshDisplayState } from "neuroglancer/unstable/mesh/frontend.js"

import { ExtraRenderContext } from "./nehuba_perspective_panel";
import { VertexPositionFormat } from 'neuroglancer/unstable/mesh/base.js';
import { PerspectivePanel } from 'neuroglancer/unstable/perspective_view/panel.js';
import { getObjectColor } from 'neuroglancer/unstable/segmentation_display_state/frontend.js';

export class NehubaMeshShaderManager extends MeshShaderManager {
  defineShader(builder: ShaderBuilder) {
    super.defineShader(builder);
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
float lightingFactor = abs(dot(normal, uLightDirection.xyz)) + uLightDirection.w;
vColor = vec4(lightingFactor * uColor.rgb, uColor.a);
if (uColor.a < 1.0) {
	vBackFaceColor = vec4(vColor.rgb, 0.0);
} else {
	vBackFaceColor = uBackFaceColor;
}
		`; //vBackFaceColor = vec4(lightingFactor * uBackFaceColor.rgb, uColor.a);
    builder.setVertexMain(vertexMain);
    builder.setFragmentMain(`
if (vNavPos.x >= 0.0 && vNavPos.y >= 0.0 && vNavPos.z >= 0.0) {
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
    gl.uniform4fv(shader.uniform('uOctant'), octant);
  }
  setBackFaceColor(gl: GL, shader: ShaderProgram, color: vec4) {
    gl.uniform4fv(shader.uniform('uBackFaceColor'), color);
  }
  getShader(gl: GL, emitter: ShaderModule) {
    return gl.memoize.get(
      `mesh/NehubaMeshShaderManager:${getObjectId(emitter)}/` +
      `${this.fragmentRelativeVertices}/${this.vertexPositionFormat}`,
      () => {
        let builder = new ShaderBuilder(gl);
        builder.require(emitter);
        this.defineShader(builder);
        return builder.build();
      });
  }
}

export class NehubaMeshLayer extends MeshLayer {

  private getShader_;
  constructor(chunkManager: ChunkManager, source: MeshSource, displayState: MeshDisplayState) {
    super(chunkManager, source, displayState);
    this.meshShaderManager = new NehubaMeshShaderManager(/*fragmentRelativeVertices=*/ false, VertexPositionFormat.float32);
    this.getShader_ = this.meshShaderManager.makeGetter(this)
    console.log("nehuba mesh layer!")
    debugger
  }

  draw(
    renderContext: PerspectiveViewRenderContext & { extra: ExtraRenderContext },
    attachment: VisibleLayerInfo<
      PerspectivePanel,
      ThreeDimensionalRenderLayerAttachmentState
    >,
  ) { //What if called without extra? (by normal ng layer)
    debugger
    if (!renderContext.emitColor && renderContext.alreadyEmittedPickID) {
      // No need for a separate pick ID pass.
      return;
    }
    const { gl, displayState, /*meshShaderManager*/ } = this;
    const meshShaderManager = this.meshShaderManager as NehubaMeshShaderManager;
    const alpha = Math.min(1.0, displayState.objectAlpha.value);
    
    if (alpha <= 0.0) {
      // Skip drawing.
      return;
    }
    console.log('postalpha')
    
    const modelMatrix = update3dRenderLayerAttachment(displayState.transform.value, renderContext.projectionParameters.displayDimensionRenderInfo, attachment);
    debugger
    if (modelMatrix === undefined) {
      return;
    }
    console.log('before shader')
    const { shader } = this.getShader_(renderContext.emitter);
    if (!shader) return
    console.log("shader?!?!")
    shader.bind();
    meshShaderManager.beginLayer(gl, shader, renderContext, this.displayState);

    if (!renderContext.extra) {
      console.error('Bad configuration. Nehuba mesh layer is used by neuroglancer code.');
    }
    const valuesForClipping = getValuesForClipping(renderContext.extra);
    meshShaderManager.setValuesForClipping(gl, shader, valuesForClipping);
    const conf = (renderContext.extra && renderContext.extra.config.layout!.useNehubaPerspective!.mesh); //Is it undefined?
    const surfaceParcellation = conf && conf.surfaceParcellation;

    meshShaderManager.beginModel(gl, shader, renderContext, modelMatrix);

    let { pickIDs } = renderContext;
    const manifestChunks = this.source.chunks;

    let totalChunks = 0, presentChunks = 0;
    const { renderScaleHistogram } = this.displayState;
    const fragmentChunks = this.source.fragmentSource.chunks;

    const { visibleSegments } = displayState
    let visibleMeshes: Uint64Set;
    if (isVisibleSegmentsWrapper(visibleSegments)) {
      if (!surfaceParcellation && !renderContext.extra.showSliceViewsCheckboxValue) {
        visibleMeshes = visibleSegments.size === 0 ? visibleSegments.getLoadedMeshes() : visibleSegments;
      } else {
        visibleMeshes = visibleSegments.getLoadedMeshes()
      };
    } else {
      visibleMeshes = visibleSegments
    };
    const displayStateProxy = new Proxy<SegmentationDisplayState3D>(displayState, {
      get: function (target: any, p: PropertyKey) {
        if (p === 'visibleSegments') return visibleMeshes;
        const res = target[p];
        if (typeof res === 'function') return res.bind(target);
        else return res;
      }
    });

    forEachVisibleSegment(displayStateProxy, (objectId, rootObjectId) => {
      const key = getObjectKey(objectId);
      const manifestChunk = manifestChunks.get(key);
      if (manifestChunk === undefined) return;
      if (renderContext.emitColor) {
        meshShaderManager.setColor(gl, shader, getObjectColor(displayState, rootObjectId, alpha));
      }
      if (renderContext.emitPickID) {
        meshShaderManager.setPickID(gl, shader, pickIDs.registerUint64(this, objectId));
      }
      if (renderContext.extra.showSliceViewsCheckboxValue && isVisibleSegmentsWrapper(visibleSegments) && !surfaceParcellation) {
        if (visibleSegments.has(rootObjectId)) meshShaderManager.setValuesForClipping(gl, shader, NoClipping);
        else meshShaderManager.setValuesForClipping(gl, shader, valuesForClipping);
      }
      totalChunks += manifestChunk.fragmentIds.length;

      for (const fragmentId of manifestChunk.fragmentIds) {
        const fragment = fragmentChunks.get(`${key}/${fragmentId}`);
        if (fragment !== undefined && fragment.state === ChunkState.GPU_MEMORY) {
          meshShaderManager.drawFragment(gl, shader, fragment);
          ++presentChunks;
        }
      }
    });

    if (renderContext.emitColor) {
      renderScaleHistogram.begin(
        this.chunkManager.chunkQueueManager.frameNumberCounter.frameNumber);
      renderScaleHistogram.add(
        Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, presentChunks,
        totalChunks - presentChunks);
    }
    meshShaderManager.endLayer(gl, shader);

    let objectChunks = this.source.fragmentSource.chunks;
    renderContext.extra.meshRendered = objectChunks.size > 0;
    if (renderContext.extra.meshesLoaded === -1) renderContext.extra.meshesLoaded = 0;
    renderContext.extra.meshesLoaded += objectChunks.size;
    if (renderContext.extra.meshFragmentsLoaded === -1) renderContext.extra.meshFragmentsLoaded = 0;
    renderContext.extra.meshFragmentsLoaded += presentChunks;
    const objectKeys = Array.from(objectChunks.keys())
    renderContext.extra.lastMeshId = objectKeys[objectKeys.length - 1];
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
  console.log('clipping?')
  const v = extra?.config?.layout?.useNehubaPerspective?.centerToOrigin
  debugger
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

  const localHashTable = new HashSetUint64()
  const overrides: Record<PropertyKey, unknown> = {

    getLoadedMeshes: () => wrapped,

    setMeshesToLoad: (meshes: number[]) => {
      wrapped.clear();
      //TODO Find a way to batch set all at once without triggering (twice!) changed.dispatch
      const meshesBigInt = meshes.map(v => BigInt(v));
      wrapped.add(meshesBigInt);

      // Bad workaround needed to trick new SegmentSetWidget, which uses dispatched value to update itself
      // TODO Remove when nehuba own widgets are available
      wrapped.changed.dispatch(meshesBigInt, true);
    },
    has(x: bigint){
      return localHashTable.has(x)
    },
    add(x: bigint | bigint[] | BigUint64Array){
      const tmp = typeof x === "bigint" ? [x] : x
      let changed = false
      for (const v of tmp) {
        if (localHashTable.add(v)) {
          changed = true
        }
      }
      if (changed) {
        wrapped.changed.dispatch(x, true)
      }
    },
    delete(x: bigint | bigint[] | BigUint64Array) {
      const tmp = typeof x === "bigint" ? [x] : x
      let changed = false
      for (const v of tmp) {
        if (localHashTable.delete(v)) {
          changed = true
        }
      }
      if (changed) {
        wrapped.changed.dispatch(x, false)
      }
    },
    keys(){
      return localHashTable.keys()
    },
    get hashTable(){
      return localHashTable
    },
    get size(){
      return localHashTable.size
    },
    toJSON() {
      let result = new Array<string>();
      for (let id of localHashTable) {
        result.push(id.toString());
      }
      return result;
    }  
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