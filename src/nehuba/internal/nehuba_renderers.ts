import {RefCounted} from 'neuroglancer/util/disposable';
import {mat4, vec4} from 'neuroglancer/util/geom';
import {getObjectId} from 'neuroglancer/util/object_id';
import {GL} from 'neuroglancer/webgl/context';
import {ShaderBuilder, ShaderModule, ShaderProgram} from 'neuroglancer/webgl/shader';
import {getSquareCornersBuffer} from 'neuroglancer/webgl/square_corners_buffer';

import { removeBackgroundMode } from "shuba/config";

/**
 * In neuroglancer's SliceViewRenderHelper the shader is built in constructor. So it is not feasible to extend or monkey-patch it. 
 * Therefore the fork of the whole SliceViewRenderHelper class is needed to change it.
 * 
 * This class is a copy of SliceViewRenderHelper from https://github.com/google/neuroglancer/blob/9c78cd512a722f3fe9ed097155b6f64f48b8d1c9/src/neuroglancer/sliceview/frontend.ts 
 * Copied on 17.07.2017 (neuroglancer master commit 9c78cd512a722f3fe9ed097155b6f64f48b8d1c9) and renamed.
 * Any changes in upstream version since then must be manually applied here with care.
 * 
 * Adds the ability to remove background from slice by discarding pixels with color greater, less or equal to the specified 'discardColor'
 * 
 * Original neuroglancer description:
 * 	"Helper for rendering a SliceView that has been pre-rendered to a texture."
 */
export class NehubaSliceViewRenderHelper extends RefCounted {
  private copyVertexPositionsBuffer = getSquareCornersBuffer(this.gl);
  private shader: ShaderProgram;

  private textureCoordinateAdjustment = new Float32Array(4);

  private discardColor = vec4.fromValues(0.5, 0.5, 0.5, 1);

  constructor(public gl: GL, emitter: ShaderModule, mode: removeBackgroundMode) {
    super();
    let builder = new ShaderBuilder(gl);
    builder.addVarying('vec2', 'vTexCoord');
    builder.addUniform('sampler2D', 'uSampler');
    builder.addInitializer(shader => {
      gl.uniform1i(shader.uniform('uSampler'), 0);
    });
    builder.addUniform('vec4', 'uColorFactor');
    builder.addUniform('vec4', 'uBackgroundColor');
    builder.addUniform('mat4', 'uProjectionMatrix');
    builder.addUniform('vec4', 'uTextureCoordinateAdjustment');
    builder.addUniform('vec4', 'uDiscardColor');
    builder.require(emitter);
let originalFragment = `
vec4 sampledColor = texture2D(uSampler, vTexCoord);
if (sampledColor.a == 0.0) {
  sampledColor = uBackgroundColor;
}
emit(sampledColor * uColorFactor, vec4(0,0,0,0));
`;
let nehubaFragment = `
vec4 sampledColor = texture2D(uSampler, vTexCoord);
if (sampledColor.a == 0.0) {
  sampledColor = uBackgroundColor;
}
if (sampledColor.r ${mode} uDiscardColor.r && sampledColor.g ${mode} uDiscardColor.g && sampledColor.b ${mode} uDiscardColor.b) discard;
else emit(sampledColor * uColorFactor, vec4(0,0,0,0));
`;
    builder.setFragmentMain(mode === 'none' ? originalFragment : nehubaFragment);
    builder.addAttribute('vec4', 'aVertexPosition');
    builder.setVertexMain(`
vTexCoord = uTextureCoordinateAdjustment.xy + 0.5 * (aVertexPosition.xy + 1.0) * uTextureCoordinateAdjustment.zw;
gl_Position = uProjectionMatrix * aVertexPosition;
`);
    this.shader = this.registerDisposer(builder.build());
  }

  draw(
      texture: WebGLTexture|null, projectionMatrix: mat4, colorFactor: vec4, backgroundColor: vec4,
      xStart: number, yStart: number, xEnd: number, yEnd: number) {
    let {gl, shader, textureCoordinateAdjustment} = this;
    textureCoordinateAdjustment[0] = xStart;
    textureCoordinateAdjustment[1] = yStart;
    textureCoordinateAdjustment[2] = xEnd - xStart;
    textureCoordinateAdjustment[3] = yEnd - yStart;
    shader.bind();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniformMatrix4fv(shader.uniform('uProjectionMatrix'), false, projectionMatrix);
    gl.uniform4fv(shader.uniform('uColorFactor'), colorFactor);
    gl.uniform4fv(shader.uniform('uBackgroundColor'), backgroundColor);
    gl.uniform4fv(shader.uniform('uTextureCoordinateAdjustment'), textureCoordinateAdjustment);
    gl.uniform4fv(shader.uniform('uDiscardColor'), this.discardColor);

    let aVertexPosition = shader.attribute('aVertexPosition');
    this.copyVertexPositionsBuffer.bindToVertexAttrib(aVertexPosition, /*components=*/2);

    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    gl.disableVertexAttribArray(aVertexPosition);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Sets discardColor. Pixels with color greater, less or equal (depending on 'mode' in constructor) to discardColor will be discarded. */
  setDiscardColor(color: vec4) {
    this.discardColor = color;
  }

  static get(gl: GL, emitter: ShaderModule, mode: removeBackgroundMode) {
    return gl.memoize.get(
        `nehuba/NehubaSliceViewRenderHelper:${getObjectId(emitter)}:${mode}`,
        () => new NehubaSliceViewRenderHelper(gl, emitter, mode));
  }
}