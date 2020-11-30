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
    uint packed = mappedValue.value[0];
    float red = float(packed % 256u) / 255.0;
    float green = float((packed >> 8) % 256u) / 255.0;
    float blue = float(packed >> 16) / 255.0;
    return vec3(red, green, blue);
  }
  return ${this.prefix}(x);
}
`;
    builder.addFragmentCode(s);
	 this.prefix = originalPrefix;
	}

	//Called at each draw
	enable(gl: GL, shader: ShaderProgram, segmentColorHash: SegmentColorHash) {
		const gpuHashTable = GPUHashTable.get(gl, (segmentColorHash as NehubaSegmentColorHash).gpuColorMap);
		this.hashMapShaderManager.enable(gl, shader, gpuHashTable);		
		super.enable(gl, shader, segmentColorHash);
	}
}

export class NehubaSegmentColorHash extends SegmentColorHash {
	readonly gpuColorMap = new HashMapUint64();
	readonly colorMap = new Map<number, {red:number, green: number, blue: number, gpu: number}>();
	
	private constructor(hashSeed: number, changed: NullarySignal) {
		super(hashSeed);
		this.changed.dispose();
		this.changed = changed;
	}

	// Since some listeners are already registered for changes inderectly in `SegmentationRenderLayer` constructor to old SegmentColorHash, 
	// We need to steal the signal!!!
	static from(original: SegmentColorHash) {
		const res = new NehubaSegmentColorHash(original.hashSeed, original.changed);
		original.changed = new NullarySignal();
		return res;
	}
	
	setSegmentColor(segment: number, red:number, green: number, blue: number) {
		//rgb values are checked for [0, 255] in NehubaViewer
		const gpu = (blue * 256 * 256) + (green * 256) + red;
		this.colorMap.set(segment, {red, green, blue, gpu});
		if (!(this.gpuColorMap.set(new Uint64(segment), new Uint64(gpu)))) this.repopulateGpuMap();
		this.changed.dispatch();
	}

	unsetSegmentColor(segment: number) {
		this.colorMap.delete(segment);
		this.repopulateGpuMap();
		this.changed.dispatch();
	}

	batchUpdate(map: Map<number, {red:number, green: number, blue: number}>) {
		map.forEach( (color, segment) => {
			const {red, green, blue} = color;
			const gpu = (blue * 256 * 256) + (green * 256) + red;
			this.colorMap.set(segment, {red, green, blue, gpu})
		});
		this.repopulateGpuMap();
		this.changed.dispatch();
	}

	clearCustomSegmentColors() {
		this.colorMap.clear();
		this.gpuColorMap.clear();
		this.changed.dispatch();
	}

	private repopulateGpuMap() {
		const {colorMap, gpuColorMap} = this;
		gpuColorMap.clear();
		colorMap.forEach((color, segment) => { gpuColorMap.set(new Uint64(segment), new Uint64(color.gpu)) });
	}

	static getDefault(): never {
		throw new Error('NehubaSegmentColorHash is supposed to be created by `from` static method');
	}

	compute(out: Float32Array, x: Uint64) {
		// let value = new Uint64();
		// if (this.gpuColorMap.get(x, value)) {
		// 	let encoded = value.low;
		// 	let others = Math.round(encoded % (256 * 256));
		// 	const blue = Math.round(((encoded - others) / 256));
		// 	encoded -= (blue * 256 * 256);
		// 	const red = Math.round(encoded % 256);
		// 	const green = Math.round((encoded - red) / 256);
		// 	out[0] = red / 255;
		// 	out[1] = green / 255;
		// 	out[2] = blue / 255;
		// 	return out;
		// }
		const color = this.colorMap.get(x.low);
		if (color) {
			let {red, green, blue} = color;
			out[0] = red / 255;
			out[1] = green / 255;
			out[2] = blue / 255;
			return out;
		}
		else return super.compute(out, x);
	}

	toString() {
		return `new NehubaSegmentColorHash(${this.hashSeed})`; //TODO Add custom colors?
	}  
}