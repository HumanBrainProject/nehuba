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
import { StatusMessage } from "neuroglancer/unstable/status.js";

const export_nehuba = {
  createUrlHashedNehubaViewer: function (config: Config | null = null, errhandler: (err: Error) => void) {
    const nehubaViewer = this.createNehubaViewer(config, errhandler)
    const viewer = nehubaViewer.ngviewer
    if (!viewer) {
      throw new Error(`viewer not created`)
    }
    const hashBinding = viewer.registerDisposer(
      new UrlHashBinding(
        viewer.state,
        viewer.dataSourceProvider.sharedKvStoreContext,
        {
          defaultFragment: undefined
        },
      ),
    );
    viewer.registerDisposer(
      hashBinding.parseError.changed.add(() => {
        const { value } = hashBinding.parseError;
        if (value !== undefined) {
          const status = new StatusMessage();
          status.setErrorMessage(`Error parsing state: ${value.message}`);
          console.log("Error parsing state", value);
        }
        hashBinding.parseError;
      }),
    );
    hashBinding.updateFromUrlHash();
    return viewer
  },
  createNehubaViewer: (config: Config | null = null, errhandler: (err: Error) => void) => {
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
  get NehubaViewer() {
    throw new Error(`.NehubaViewer is no longer supported`)
  },
  get ManagedUserLayer() {
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

  getNgPatchableObj() {
    return {
      UrlHashBinding,
      LayerManager,
      get SliceViewPanel() {
        throw new Error(`.SliceViewPanel is no longer supported`)
      },
      get PerspectivePanel() {
        throw new Error(`.PerspectivePanel is no longer supported`)
      }
    }
  },
  getNgHash(viewer?: any) {
    const _viewer = viewer || (window as any).viewer
    if (!_viewer) return null
    const stateJson = _viewer.state.toJSON()
    stateJson.layers = stateJson.layers.map((l: any) => ({ ...l, segmentColors: undefined }))
    const fragment = JSON.stringify(stateJson)
    return '#!' + encodeURI(fragment).replace(/[!'()*;,]/g, (c) =>
      '%' + c.charCodeAt(0).toString(16).toUpperCase())
  },
  openInVanillaNg(viewer?: any, url = "https://atlases.ebrains.eu/viewer/vanilla.html") {
    const hash = this.getNgHash(viewer)
    if (!hash) throw new Error('viewer is not provided as an argument, window.viewer is not defined')
    window.open(`${url}${hash}`, '_blank')
  },

  pako: {
    inflate() {
      throw new Error(`Use the async equivalent inflateAsync instead`)
    },
    async inflateAsync(buf: ArrayBuffer, opts?: { to?: 'string' }): Promise<Uint8Array | string> {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))
      const result = new Response(stream)
      if (opts?.to === "string") {
        return await result.text()
      }
      return new Uint8Array(await result.arrayBuffer())
    }
  },

  get removeBackgroundMode() {
    throw new Error(`.removeBackgroundMode is no longer supported`)
  },
  get SliceRenderEventDetail() {
    throw new Error(`.SliceRenderEventDetail is no longer supported`)
  },
  get sliceRenderEventType() {
    throw new Error(`.sliceRenderEventType is no longer supported`)
  },
  get dispatchEventWithModifiers() {
    throw new Error(`.dispatchEventWithModifiers is no longer supported`)
  },
  get Uint64() {
    throw new Error(`.Uint64 is no longer supported`)
  },
};


(globalThis as any).export_nehuba = export_nehuba




// const backgrd = [1, 1, 1] as any
// const scale = 1
// const space = {
//   id: "foo"
// }

// const PERSPECTIVE_ZOOM_FUDGE_FACTOR= 1

// const config: Config = {
//     "configName": "",
//     "globals": {
//       "hideNullImageValues": true,
//       "useNehubaLayout": true,
//       "useNehubaMeshLayer": true,

//       "useCustomSegmentColors": true
//     },
//     "zoomWithoutCtrl": true,
//     "hideNeuroglancerUI": true,
//     "rightClickWithCtrl": true,
//     "rotateAtViewCentre": true,
//     "enableMeshLoadingControl": true,
//     "zoomAtViewCentre": true,
//     // "restrictUserNavigation": true,
//     "dataset": {
//       "imageBackground": backgrd,
//       "initialNgState": {
//         "showDefaultAnnotations": false,
//         "layers": {},
//         "navigation": {
//           "zoomFactor": 350000 * scale,
//           pose: {
//             position: {
//               voxelSize: [1, 1, 1]
//             }
//           }
//         },
//         "perspectiveOrientation": [
//           0.3140767216682434,
//           -0.7418519854545593,
//           0.4988985061645508,
//           -0.3195493221282959
//         ],
//         "perspectiveZoom": 1922235.5293810747 * scale
//       }
//     },
//     "layout": {
//       "useNehubaPerspective": {
//         "perspectiveSlicesBackground": backgrd,
//         "fixedZoomPerspectiveSlices": {
//           "sliceViewportWidth": space.id === 'nencki/nm/referencespace/v1.0.0/MARMOSET_NM_NISSL_2020' ? 580 : 300,
//           "sliceViewportHeight": space.id === 'nencki/nm/referencespace/v1.0.0/MARMOSET_NM_NISSL_2020' ? 580 : 300,
//           "sliceZoom": 563818.3562426177 * scale,
//           "sliceViewportSizeMultiplier": 2
//         },
//         "mesh": {
//           "backFaceColor": backgrd,
//           "removeBasedOnNavigation": true,
//           "flipRemovedOctant": true,
//         },
//         "centerToOrigin": true,
//         // "restrictZoomLevel": {
//         //   "minZoom": 1200000 * scale * PERSPECTIVE_ZOOM_FUDGE_FACTOR,
//         //   "maxZoom": 3500000 * scale * PERSPECTIVE_ZOOM_FUDGE_FACTOR
//         // }
//       }
//     }
//   }

// const container = document.getElementById("neuroglancer-container");
// if (!container) {
//   throw new Error("Missing #neuroglancer-container element");
// }

// ; (window as any)['nehubaViewer'] = nehubaViewer = export_nehuba.createNehubaViewer(undefined, console.log)
// ;(window as any)['config'] = config

// const imgsrc = "https://neuroglancer.humanbrainproject.eu/precomputed/BigBrainRelease.2015/8bit"
// const segsrc = "https://neuroglancer.humanbrainproject.eu/precomputed/BigBrainRelease.2015/classif"
// nehubaViewer.addLayer({
//   source: imgsrc,
//   transform: [[1.0, 0.0, 0.0, -70677184.0], [0.0, 1.0, 0.0, -70010000.0], [0.0, 0.0, 1.0, -58788284.0], [0.0, 0.0, 0.0, 1.0]]
// }, "foo")
// nehubaViewer.addLayer({
//   source: segsrc,
//   transform: [[1, 0, 0, -70666600], [0, 1, 0, -72910000], [0, 0, 1, -58777700], [0, 0, 0, 1]]
// }, "foo2")
// setTimeout(() => {
//   const l = nehubaViewer.ngviewer?.layerManager.getLayerByName("foo2")
//   l.layer.displayState.segmentationGroupState.value.visibleSegments.setMeshesToLoad([100, 200])

// }, 100);
