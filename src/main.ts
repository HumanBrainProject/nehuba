// Side-effect import: registers datasources, layer types and kvstores.
// The bare "neuroglancer" entry point exposes no named exports.
import "neuroglancer";

// The public API lives under the "neuroglancer/unstable/*" subpath,
// which the package's exports map resolves to its built `lib/*.js`.

// Side-effect import: registers nehuba's custom data sources (precompmesh, swc).
import "./nehuba/datasources";

import { NehubaViewer } from "./nehuba/NehubaViewer"
import { Config } from "./nehuba/config";
import { kAxes, mat3, mat4, quat, vec3, vec4 } from "neuroglancer/unstable/util/geom.js";
import { registerActionListener } from "neuroglancer/unstable/util/event_action_map.js";
import { UrlHashBinding } from "neuroglancer/unstable/ui/url_hash_binding.js"
import { LayerManager } from "neuroglancer/unstable/layer/index.js";

const export_nehuba = {
  createNehubaViewer: (config: Config, errhandler: (err: Error) => void) => {
    const nehubaViewer = NehubaViewer.create(config, undefined, errhandler)
    const viewer = nehubaViewer.ngviewer;
    (window as any).viewer = viewer;
    (window as any).nehubaViewer = nehubaViewer;
    return nehubaViewer
  },
  quat,
  vec3,
  vec4,
  mat3,
  mat4,
  kAxes,
  get NehubaViewer(){
    throw new Error(`.NehubaViewer is no longer supported`)
  },
  get ManagedUserLayer(){
    throw new Error(`.ManagedUserLayer is no longer supported`)
  },
  get Config() {
    throw new Error(`.Config is no longer supported`)
  },
  get LayoutEventDetail() {
    throw new Error(`.LayoutEventDetail is no longer supported`)
  },
  get layoutEventType() {
    throw new Error(`.layoutEventType is no longer supported`)
  },
  get PerspectiveRenderEventDetail() {
    throw new Error(`.PerspectiveRenderEventDetail is no longer supported`)
  },
  get perspectiveRenderEventType() {
    throw new Error(`.perspectiveRenderEventType is no longer supported`)
  },
  registerActionListener,

  getNgPatchableObj(){
    return {
      UrlHashBinding,
      LayerManager,
      get SliceViewPanel(){
        throw new Error(`.SliceViewPanel is no longer supported`)
      },
      get PerspectivePanel(){
        throw new Error(`.PerspectivePanel is no longer supported`)
      }
    }
  },
  getNgHash(viewer?: any){
    const _viewer = viewer || (window as any).viewer
    if (!_viewer) return null
    const stateJson = viewer.state.toJSON()
    stateJson.layers = stateJson.layers.map((l: any) => ({ ...l, segmentColors: undefined }))
    const fragment = JSON.stringify(stateJson)
    return '#!' + encodeURI(fragment).replace(/[!'()*;,]/g, (c) =>
      '%' + c.charCodeAt(0).toString(16).toUpperCase())
  },
  openInVanillaNg(viewer? : any, url = "https://atlases.ebrains.eu/viewer/vanilla.html"){
    const hash = this.getNgHash(viewer)
    if (!hash) throw new Error('viewer is not provided as an argument, window.viewer is not defined')
    window.open(`${url}${hash}`, '_blank')
  },

  get pako(){
    throw new Error(`.pako is no longer supported`)
  },


  get removeBackgroundMode(){
    throw new Error(`.removeBackgroundMode is no longer supported`)
  },
  get SliceRenderEventDetail(){
    throw new Error(`.SliceRenderEventDetail is no longer supported`)
  },
  get sliceRenderEventType(){
    throw new Error(`.sliceRenderEventType is no longer supported`)
  },
  get dispatchEventWithModifiers(){
    throw new Error(`.dispatchEventWithModifiers is no longer supported`)
  },
  get Uint64(){
    throw new Error(`.Uint64 is no longer supported`)
  },
};


(globalThis as any).export_nehuba = export_nehuba

// (window as any).export_nehuba = export_nehuba

// const container = document.getElementById("neuroglancer-container");
// if (!container) {
//   throw new Error("Missing #neuroglancer-container element");
// }




// ;(window as any)['nehubaViewer'] = nehubaViewer

// setTimeout(() => {
//   const l = nehubaViewer.ngviewer?.layerManager.getLayerByName("foo2")
//   l.layer.displayState.segmentationGroupState.value.visibleSegments.setMeshesToLoad([100, 200])

// }, 100);

// const viewer = setupDefaultViewer({ target: container });
// console.log(viewer);
