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
        "hideSlices": ["slice2", "slice3"],
        "mesh": {
          "backFaceColor": [1,1,1] as any,
          "removeBasedOnNavigation": true,
          "flipRemovedOctant": true,
          
        },
        "centerToOrigin": true,
        "drawSubstrates": {"color":[0.5,0.5,0.5,0] as any, },
        "drawZoomLevels": {
          "cutOff":150000,
          min: 5e6
        },
        "restrictZoomLevel": {
          "minZoom": 1200000 * 82.842712474619,
          "maxZoom": 3500000 * 82.842712474619
        }
      }
    },
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
  segments: [],
  segmentColors: {
    "100": "#ffffff",
    "200": "#ffffff",
  }
}

nehubaViewer.addLayer(spec, "foo")
nehubaViewer.addLayer(spec2, "foo2")

;(window as any)['nehubaViewer'] = nehubaViewer

setTimeout(() => {
  const l = nehubaViewer.ngviewer?.layerManager.getLayerByName("foo2")
  l.layer.displayState.segmentationGroupState.value.visibleSegments.setMeshesToLoad([100, 200])
  const panels = Array.from(nehubaViewer.ngviewer.display.panels)
  const sv = panels[0].element
  const pv = panels[3].element
  const v: HTMLElement|null = document.querySelector('.neuroglancer-layer-group-viewer')
  if (!!v) {

    for (const c of v.children){
      v?.removeChild(c)
    }
    v.style.position = 'relative'
    
    sv.style.position = 'relative'
    sv.style.zIndex = '0'

    pv.style.position = 'absolute'
    pv.style.zIndex = '1'
    pv.style.width = '10dvw'
    pv.style.height = '10dvh'
    pv.style.bottom = '2dvh'
    pv.style.right = '2dvw'

    v.appendChild(sv)
    v.appendChild(pv)
  }

}, 100);

// const viewer = setupDefaultViewer({ target: container });
// console.log(viewer);
