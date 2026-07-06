// Side-effect import: registers datasources, layer types and kvstores.
// The bare "neuroglancer" entry point exposes no named exports.
import "neuroglancer";

// The public API lives under the "neuroglancer/unstable/*" subpath,
// which the package's exports map resolves to its built `lib/*.js`.

import { NehubaViewer } from "./nehuba/NehubaViewer"
import { Config } from "./nehuba/config";

const container = document.getElementById("neuroglancer-container");
if (!container) {
  throw new Error("Missing #neuroglancer-container element");
}

const config: Config = {
    "configName": "",
    "globals": {
      "hideNullImageValues": true,
      "useNehubaLayout": true,
      "useNehubaMeshLayer": true,
      "useCustomSegmentColors": true
    },
    "zoomWithoutCtrl": true,
    "hideNeuroglancerUI": true,
    "rightClickWithCtrl": true,
    "rotateAtViewCentre": true,
    "enableMeshLoadingControl": true,
    "zoomAtViewCentre": true,
    // "restrictUserNavigation": true,
    "dataset": {
      "imageBackground": [1,1,1] as any,
      "initialNgState": {
        "showDefaultAnnotations": false,
        "layers": {},
        "navigation": {
          "zoomFactor": 350000 ,
          pose: {
            position: {
              voxelSize: [1, 1, 1]
            }
          }
        },
        "perspectiveOrientation": [
          0.3140767216682434,
          -0.7418519854545593,
          0.4988985061645508,
          -0.3195493221282959
        ],
        "perspectiveZoom": 1922235.5293810747
      }
    },
    "layout": {
      "useNehubaPerspective": {
        "perspectiveSlicesBackground": [1,1,1] as any,
        "removePerspectiveSlicesBackground": {"color":[1,1,1,1] as any,"mode":"=="},
        "fixedZoomPerspectiveSlices": {
          "sliceViewportWidth": 300,
          "sliceViewportHeight": 300,
          "sliceZoom": 563818.3562426177,
          "sliceViewportSizeMultiplier": 2
        },
        "mesh": {
          "backFaceColor": [1,1,1] as any,
          "removeBasedOnNavigation": true,
          "flipRemovedOctant": true,
          
        },
        "centerToOrigin": true,
        "drawSubstrates": {"color":[0.5,0.5,1,0.2] as any, },
        "drawZoomLevels": {"cutOff":150000  },
        "restrictZoomLevel": {
          "minZoom": 1200000 * 82.842712474619,
          "maxZoom": 3500000 * 82.842712474619
        }
      }
    }
  }

const nehubaViewer = NehubaViewer.create(config)

const spec = {
  type: "image",
  source: "precomputed://https://neuroglancer.humanbrainproject.eu/precomputed/BigBrainRelease.2015/8bit",
  transform: [[1.0, 0.0, 0.0, -70677184.0], [0.0, 1.0, 0.0, -70010000.0], [0.0, 0.0, 1.0, -58788284.0], [0.0, 0.0, 0.0, 1.0]],
}

const spec2 = {
  type: "segmentation",
  source: "precomputed://https://neuroglancer.humanbrainproject.eu/precomputed/BigBrainRelease.2015/classif",
  transform: [[1, 0, 0, -70666600], [0, 1, 0, -72910000], [0, 0, 1, -58777700], [0, 0, 0, 1]],
  segments: [100,200],
  segmentColors: {
    "100": "#ffffff",
    "200": "#cccccc",
  }
}

nehubaViewer.addLayer(spec, "foo")
nehubaViewer.addLayer(spec2, "foo2")

;(window as any)['nehubaViewer'] = nehubaViewer



// const viewer = setupDefaultViewer({ target: container });
// console.log(viewer);
