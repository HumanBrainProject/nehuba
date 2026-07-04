import { vec3 } from "neuroglancer/unstable/util/geom.js"
import { Config } from "./config"
import { NavigationState } from "neuroglancer/unstable/navigation_state.js"

export interface ExtraRenderContext {
  config: Config
  showSliceViewsCheckboxValue: boolean
  slicesNavigationState: NavigationState
  perspectiveNavigationState: NavigationState
  /** To be set by our custom renderLayers to indicate that mesh has been rendered. So it is a return value from draw method to avoid changing draw method signature */
  meshRendered?: boolean
  /** Value of -1 indicates that there are no visible segmentation layers */
  meshesLoaded: number
  /** Value of -1 indicates that there are no visible segmentation layers */
  meshFragmentsLoaded: number
  lastMeshId?: string
  crossSectionBackground: vec3
}
