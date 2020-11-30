import {ChunkState} from 'neuroglancer/chunk_manager/base';
import {ChunkManager} from 'neuroglancer/chunk_manager/frontend';
import {PerspectiveViewRenderContext} from 'neuroglancer/perspective_view/render_layer';
import {forEachSegmentToDraw, getObjectColor, SegmentationDisplayState3D} from 'neuroglancer/segmentation_display_state/frontend';
import {mat4, vec3, vec4, quat} from 'neuroglancer/util/geom';
import {getObjectId} from 'neuroglancer/util/object_id';
import {GL} from 'neuroglancer/webgl/context';
import {ShaderBuilder, ShaderModule, ShaderProgram} from 'neuroglancer/webgl/shader';
import {Uint64Set} from 'neuroglancer/uint64_set';
import {Uint64} from 'neuroglancer/util/uint64';
import {HashSetUint64} from 'neuroglancer/gpu_hash/hash_table';
import {RPC, RpcId, SharedObject} from "neuroglancer/worker_rpc";

import { MeshShaderManager, MeshLayer, MeshSource } from "neuroglancer/mesh/frontend";
import { Disposer } from "neuroglancer/util/disposable";

import { ExtraRenderContext } from "nehuba/internal/nehuba_perspective_panel";

export class NehubaMeshShaderManager extends MeshShaderManager {
	defineShader(builder: ShaderBuilder) {
		super.defineShader(builder);
		builder.addVarying('highp vec4', 'vNavPos');
		builder.addUniform('highp mat4', 'uNavState');
		builder.addUniform('highp vec4', 'uOctant');
		builder.addUniform('highp vec4', 'uBackFaceColor');
		builder.addVarying('highp vec4', 'vBackFaceColor')
		builder.setVertexMain(`
vec4 position = uModelMatrix * vec4(aVertexPosition, 1.0);
vNavPos = uNavState * position * uOctant;
gl_Position = uProjection * position;
vec3 normal = (uModelMatrix * vec4(aVertexNormal, 0.0)).xyz;
float lightingFactor = abs(dot(normal, uLightDirection.xyz)) + uLightDirection.w;
vColor = vec4(lightingFactor * uColor.rgb, uColor.a);
if (uColor.a < 1.0) {
	vBackFaceColor = vec4(vColor.rgb, 0.0);
} else {
	vBackFaceColor = uBackFaceColor;
}
		`); //vBackFaceColor = vec4(lightingFactor * uBackFaceColor.rgb, uColor.a);
		builder.setFragmentMain(`
if (vNavPos.x > 0.0 && vNavPos.y > 0.0 && vNavPos.z > 0.0) {
  discard;
} else {
  if (gl_FrontFacing) emit(vColor, uPickID);
  else emit(vBackFaceColor, uPickID);
}
		`);
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
		return gl.memoize.get(`mesh/NehubaMeshShaderManager:${getObjectId(emitter)}`, () => {
			let builder = new ShaderBuilder(gl);
			builder.require(emitter);
			this.defineShader(builder);
			return builder.build();
		});
	}
}

export class NehubaMeshLayer extends MeshLayer {
	constructor(chunkManager: ChunkManager, source: MeshSource, displayState: SegmentationDisplayState3D) {
		super(chunkManager, source, displayState);
		this.meshShaderManager = new NehubaMeshShaderManager();
	}	

	draw(renderContext: PerspectiveViewRenderContext & { extra: ExtraRenderContext }) { //What if called without extra? (by normal ng layer)
		if (!renderContext.emitColor && renderContext.alreadyEmittedPickID) {
			// No need for a separate pick ID pass.
			return;
		}
		let {gl, displayState, /*meshShaderManager*/} = this;
		let meshShaderManager = this.meshShaderManager as NehubaMeshShaderManager;
		let alpha = Math.min(1.0, displayState.objectAlpha.value);
		if (alpha <= 0.0) {
			// Skip drawing.
			return;
		}
		let shader = this.getShader(renderContext.emitter);
		shader.bind();
		meshShaderManager.beginLayer(gl, shader, renderContext);

		if (!renderContext.extra) console.error('Bad configuration. Nehuba mesh layer is used by neuroglancer code.');
		const valuesForClipping = getValuesForClipping(renderContext.extra);
		meshShaderManager.setValuesForClipping(gl, shader, valuesForClipping);
		const conf = (renderContext.extra && renderContext.extra.config.layout!.useNehubaPerspective!.mesh); //Is it undefined?
		const surfaceParcellation = conf && conf.surfaceParcellation;

		let objectChunks = this.source.fragmentSource.objectChunks;

		let {pickIDs} = renderContext;

		const objectToDataMatrix = this.displayState.objectToDataTransform.transform;

		const {visibleSegments} = displayState
		let visibleMeshes: Uint64Set;
		if (visibleSegments instanceof VisibleSegmentsWrapper) {
			if (!surfaceParcellation && !renderContext.extra.showSliceViewsCheckboxValue) {
				visibleMeshes = visibleSegments.size === 0 ? visibleSegments.getLoadedMeshes() : visibleSegments;
			} else visibleMeshes = visibleSegments.getLoadedMeshes();
		} else visibleMeshes = visibleSegments;
		const displayStateProxy = new Proxy<SegmentationDisplayState3D>(displayState, {
			get: function(target: any, p: PropertyKey) {
				if (p === 'visibleSegments') return visibleMeshes;
				const res = target[p];
				if (typeof res === 'function') return res.bind(target);
				else return res;
			}
		});		

		let loadedFragments = 0; //Array.from(objectChunks.values()).reduce((acc, current) => acc + current.size, 0);
		forEachSegmentToDraw(displayStateProxy, objectChunks, (rootObjectId, objectId, fragments) => {
			// loadedFragments += fragments.size; //Currently the same (all fragments have ChunkState.GPU_MEMORY)
			if (renderContext.emitColor) {
				meshShaderManager.setColor(gl, shader, getObjectColor(displayState, rootObjectId, alpha));
			}
			if (renderContext.emitPickID) {
				meshShaderManager.setPickID(gl, shader, pickIDs.registerUint64(this, objectId));
			}
			if (renderContext.extra.showSliceViewsCheckboxValue && visibleSegments instanceof VisibleSegmentsWrapper && !surfaceParcellation) {
				if (visibleSegments.has(rootObjectId))	meshShaderManager.setValuesForClipping(gl, shader, NoClipping);
				else meshShaderManager.setValuesForClipping(gl, shader, valuesForClipping);
			}
			meshShaderManager.beginObject(gl, shader, objectToDataMatrix);
			for (let fragment of fragments) {
				if (fragment.state === ChunkState.GPU_MEMORY) {
					meshShaderManager.drawFragment(gl, shader, fragment);
					loadedFragments++;
				}
			}
		});

		meshShaderManager.endLayer(gl, shader);
		renderContext.extra.meshRendered = objectChunks.size > 0;
		if (renderContext.extra.meshesLoaded === -1) renderContext.extra.meshesLoaded = 0;
		renderContext.extra.meshesLoaded += objectChunks.size;
		if (renderContext.extra.meshFragmentsLoaded === -1) renderContext.extra.meshFragmentsLoaded = 0;
		renderContext.extra.meshFragmentsLoaded += loadedFragments;
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

export const NoClipping: ValuesForClipping = {navState: mat4.create(), octant: vec4.fromValues(0.0, 0.0, 0.0, 0.0), backFaceColor: vec4.fromValues(0.5, 0.5, 0.5, 1)};

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
      const pose = extra.slicesPose;

      if (conf.removeBasedOnNavigation) {
        pose.toMat4(navState);
        mat4.invert(navState, navState);
      }
      
      if (conf.flipRemovedOctant) {
		  const octantZ = centerToOrigin ? extra.perspectiveNavigationState.zoomFactor.value : 1.0;
        octant = vec4.fromValues(0.0, 0.0, -(octantZ), 1.0);
		  let perspectivePose = extra.perspectiveNavigationState.pose;
		  let pos = centerToOrigin ? pose.position.spatialCoordinates : vec3.fromValues(0.0, 0.0, 0.0);
        let perspectiveQuat = perspectivePose.orientation.orientation;
        let navQuat = quat.invert(quat.create(), pose.orientation.orientation);
        let resQuat = quat.multiply(quat.create(), navQuat, perspectiveQuat);
        let rot = mat4.fromQuat(mat4.create(), resQuat);
        vec4.transformMat4(octant, octant, rot);
        octant[0] = octant[0] < (pos[0]/100) ? -1.0 : 1.0;
        octant[1] = octant[1] < (pos[1]/100) ? -1.0 : 1.0;
        octant[2] = octant[2] < (pos[2]/100) ? -1.0 : 1.0;
      //   octant[3] = octant[3] < 0.0 ? -1.0 : 1.0;
      }
    }
    return {navState, octant, backFaceColor: vec4.fromValues(backFaceColor[0], backFaceColor[1], backFaceColor[2], 1.0)};
}

export class VisibleSegmentsWrapper extends SharedObject implements Uint64Set {
	private wrapped: Uint64Set
	private localHashTable = new HashSetUint64();
	constructor(visibleSegments: Uint64Set) {
		super();
		this.wrapped = visibleSegments;
		for (const x of this.wrapped.hashTable) {
			this.localHashTable.add(x);
		}
	}
	
	setMeshesToLoad(meshes: number[]) {
		this.wrapped.clear();
		//TODO Find a way to batch set all at once without triggering (twice!) changed.dispatch
		meshes.forEach(n => {
			const value = new Uint64(n);
			this.wrapped.add(value);
			// Bad workaround needed to trick new SegmentSetWidget, which uses dispatched value to update itself
			// TODO Remove when nehuba own widgets are available
			this.wrapped.changed.dispatch(value, false);
		});
	}

	getLoadedMeshes() {
		return this.wrapped;
	}

	// get hashTable() { return this.wrapped.hashTable }
	get hashTable() { return this.localHashTable }
	get changed() { return this.wrapped.changed }

	add_(x: Uint64): boolean {	x; throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
  
	add(x: Uint64) {
		// if (this.add_(x)) {
		if (this.localHashTable.add(x)) {
		// //   let {rpc} = this;
		// //   if (rpc) {
		// // 	 rpc.invoke('Uint64Set.add', {'id': this.rpcId, 'value': x});
		// //   }
		  this.changed.dispatch(x, true);
		}
	}
  
	has(x: Uint64) {
		return this.localHashTable.has(x);
	}
  
	[Symbol.iterator]() {
		return this.localHashTable.keys();
	}
  
	delete_(x: Uint64): boolean {	x;	throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
  
	delete(x: Uint64) {
		// if (this.delete_(x)) {
		if (this.localHashTable.delete(x)) {
		// //   let {rpc} = this;
		// //   if (rpc) {
		// // 	 rpc.invoke('Uint64Set.delete', {'id': this.rpcId, 'value': x});
		// //   }
		  this.changed.dispatch(x, false);
		}
	}
  
	get size() {
		return this.localHashTable.size;
	}
  
	clear() {
		if (this.localHashTable.clear()) {
		// //   let {rpc} = this;
		// //   if (rpc) {
		// // 	 rpc.invoke('Uint64Set.clear', {'id': this.rpcId});
		// //   }
		  this.changed.dispatch(null, false);
		}
	}
  
	toJSON() {
		let result = new Array<string>();
		for (let id of this) {
		  result.push(id.toString());
		}
		return result;
	}  

	get rpcId(): RpcId|null { return this.wrapped.rpcId;/* throw new Error('Unexpected member access of VisibleSegmentsWrapper'); */ }

	
	// ******* Members of SharedObject, not expected to be called on wrapper *******
	get rpc(): RPC|null { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	set rpc(arg: RPC|null) { arg;/* ignore */ }
	set rpcId(arg: RpcId|null) { arg;/* ignore */ }
	get isOwner(): boolean|undefined { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	get unreferencedGeneration(): number { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	get referencedGeneration(): number { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	initializeSharedObject(rpc: RPC, rpcId = rpc.newId()) { rpcId; throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	initializeCounterpart(rpc: RPC, options: any = {}) { rpc; options; throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	addCounterpartRef():{'id': number | null;	'gen': number;} { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	ownerDispose() { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	counterpartRefCountReachedZero(generation: number) { generation; throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	get RPC_TYPE_ID(): string { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	// ******* Members of RefCounted, not expected to be called on wrapper *******
	set refCount(n: number) { n;/* ignore */ }
	get refCount(): number { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	get wasDisposed(): boolean|undefined { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	addRef(): this { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	dispose() { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	refCountReachedZero() { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	disposed() { throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	registerDisposer<T extends Disposer>(f: T): T { f; throw new Error('Unexpected member access of VisibleSegmentsWrapper'); } //return this.wrapped.registerDisposer(f);
	unregisterDisposer<T extends Disposer>(f: T): T { f; throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	registerEventListener(target: EventTarget, eventType: string, listener: any, arg?: any) { target; eventType; listener; arg; throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
	registerCancellable<T extends{cancel: () => void}>(cancellable: T): T { cancellable; throw new Error('Unexpected member access of VisibleSegmentsWrapper'); }
}