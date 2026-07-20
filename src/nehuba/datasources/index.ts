/**
 * Registers nehuba's custom data source providers with neuroglancer's default
 * data source registry. Import this module for its side effects, before any
 * viewer is created.
 */
import "./blob_kvstore/blob_kvstore";
import "./precompmesh/register_default";
import "./swc/register_default";
import "./nehuba_nifti/register_default";
