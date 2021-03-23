import { RefCounted } from "neuroglancer/util/disposable";
import { ScaleBarDimensions } from "neuroglancer/widget/scale_bar";
import { removeFromParent } from "neuroglancer/util/dom";

import './old_scale_bar.css';
/** https://github.com/google/neuroglancer/commit/1e06a4768702596f366fb605e9e953f9b8e48386 
 *  changed the scalebar rendering to be done with WebGL instead of separate HTML element to avoid
 *  some kind of flickering. 
 * 
 *  I don't know which flickering are they talking about.
 * 
 *  THE PROBLEM: Clear and very disturbing regression of visual experience on highdpi screens.
 *  Since neuroglancer is not highdpi-aware, new scalebar is rendered in low dpi and because it contains text,
 *  this mismatch of dpi is clearly visible.
 * 
 *  THE SOLUTION: Take an opportunity to make the whole neuroglancer render in highdpi. TODO submmit upstream.
 * 
 *  Until then we use this old scalebar widget. See `useOldScaleBar` in `nehuba_layout.ts`
 */
export class ScaleBarWidget extends RefCounted {
	element = document.createElement('div');
	textNode = document.createTextNode('');
	barElement = document.createElement('div');
	constructor(public dimensions = new ScaleBarDimensions()) {
	  super();
	  let {element, textNode, barElement} = this;
	  element.className = 'scale-bar-container';
	  element.appendChild(textNode);
	  element.appendChild(barElement);
	  barElement.className = 'scale-bar';
	}
 
	update() {
	  let {dimensions} = this;
	  if (dimensions.update()) {
		 this.textNode.textContent = `${dimensions.physicalLength} ${dimensions.physicalUnit}`;
		 this.barElement.style.width = `${dimensions.lengthInPixels}px`;
	  }
	}
 
	disposed() {
	  removeFromParent(this.element);
	}
 }
 