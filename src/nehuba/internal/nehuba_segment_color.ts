import {HashFunction} from 'neuroglancer/gpu_hash/hash_function';
import {NullarySignal} from 'neuroglancer/util/signal';
import {Uint64} from 'neuroglancer/util/uint64';
import {GL} from 'neuroglancer/webgl/context';
import {ShaderBuilder, ShaderProgram} from 'neuroglancer/webgl/shader';

import { SegmentColorShaderManager, SegmentColorHash } from "neuroglancer/segment_color";
import { HashMapUint64 } from 'neuroglancer/gpu_hash/hash_table';
import { GPUHashTable, HashMapShaderManager } from 'neuroglancer/gpu_hash/shader';

export class NehubaSegmentColorShaderManager extends SegmentColorShaderManager {
	private readonly hashMapShaderManager = new HashMapShaderManager('customColors');

	//Called once at the beginning, so no dynamic shader code. 
	defineShader(builder: ShaderBuilder) {
		const originalPrefix = this.prefix;
		this.prefix = originalPrefix + '_NG';
		super.defineShader(builder);
		this.hashMapShaderManager.defineShader(builder);
   	let s = `
vec3 ${originalPrefix}(uint64_t x) {
  uint64_t mappedValue;
  if (${this.hashMapShaderManager.getFunctionName}(x, mappedValue)) {
    return mappedValue.low.rgb;
  }
  return ${this.prefix}(x);
}
`;
    builder.addFragmentCode(s);
	 this.prefix = originalPrefix;
	}

	//Called at each draw
	enable(gl: GL, shader: ShaderProgram, segmentColorHash: SegmentColorHash) {
		const gpuHashTable = GPUHashTable.get(gl, (segmentColorHash as NehubaSegmentColorHash).colorMap);
		this.hashMapShaderManager.enable(gl, shader, gpuHashTable);		
		super.enable(gl, shader, segmentColorHash);
	}
}

export class NehubaSegmentColorHash extends SegmentColorHash {
	readonly colorMap = new HashMapUint64();
	
	private constructor(hashFunctions: HashFunction[], changed: NullarySignal) {
		super(hashFunctions);
		this.changed.dispose();
		this.changed = changed;
	}

	// Since some listeners are already registered for changes inderectly in `SegmentationRenderLayer` constructor to old SegmentColorHash, 
	// We need to steal the signal!!!
	static from(original: SegmentColorHash) {
		const res = new NehubaSegmentColorHash(original.hashFunctions, original.changed);
		original.changed = new NullarySignal();
		return res;
	}
	
	//TODO Make a separate call for batch setting of the whole color map without triggering redraw
	setSegmentColor(segment: number, red:number, green: number, blue: number) {
		//rgb values are checked for [0, 255] in NehubaViewer
		this.colorMap.set(new Uint64(segment), new Uint64((blue * 256 * 256) + (green * 256) + red));
		this.changed.dispatch();
	}
	/* Since `delete` is not implemented in `HashMapUint64` but inherited from `HashTableBase` it might be not intended and/or tested 
		in the context of `HashMapUint64`. It looks like it only deletes the key but not the value and I have no confidence in using it.
		If `unsetSegmentColor` is really needed, it might be safer to clear and repopulate `colorMap` instead of `delete`. 
		( At least `HashMapUint64.clear` is used by Neuroglancer authors in `EquivalencesHashMap`)  */
	// unsetSegmentColor(segment: number) {
	// 	this.colorMap.delete(new Uint64(segment));
	// 	this.changed.dispatch();
	// }

	clearCustomSegmentColors() {
		this.colorMap.clear();
		this.changed.dispatch();
	}

	static getDefault(): never {
		throw new Error('');
	}

	compute(out: Float32Array, x: Uint64) {
		let value = new Uint64();
		if (this.colorMap.get(x, value)) {
			let encoded = value.low;
			let others = Math.round(encoded % (256 * 256));
			const blue = Math.round(((encoded - others) / 256));
			encoded -= (blue * 256 * 256);
			const red = Math.round(encoded % 256);
			const green = Math.round((encoded - red) / 256);
			out[0] = red / 255;
			out[1] = green / 255;
			out[2] = blue / 255;
			return out;
		} else return super.compute(out, x);
	}

	toString() {
		return `new NehubaSegmentColorHash([${this.hashFunctions}])`; //TODO Add custom colors?
	}  
}