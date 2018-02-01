Nehuba
======
**Ne**uroglancer for **hu**man **b**rain **a**tlas (nehuba) is a wrapper around awesome [Neuroglancer](https://github.com/google/neuroglancer) project providing a number of runtime patches and extensions used in creating brain atlas viewers for [Human Brain Project (HBP)](https://www.humanbrainproject.eu).  
It is still quite early work in progress, so it contains only specific features needed for HBP viewers added on ad-hoc basis and by no means complete, feature-rich or generic enough for general use. You might be better off with original Neuroglancer to avoid additional complexity.  
Expect braking changes with each commit, so check git log and read commit messages before git pulling.

Getting started
---------------
The long-term goal is to provide ready to use, compiled and easily npm installable package, but we are not quite there yet.
### Setting up
1. Install [node.js](https://nodejs.org). On linux you might want to use NVM (node version manager) [https://github.com/creationix/nvm](https://github.com/creationix/nvm)
2. `git clone` Neuroglancer from [https://github.com/HumanBrainProject/neuroglancer](https://github.com/HumanBrainProject/neuroglancer). This fork should be identical to original neuroglancer, but might lag few commits behind. The reason to use it is to be protected from accidentally pulling breaking updates from upstream neuroglancer when nehuba is not yet adapted to use the latest version.
3. From within neuroglancer directory type `npm link`. This will create a symbolic link to neuroglancer inside npm to be used later on.
4. Repeat two previous steps for this repository:
	- `git clone https://github.com/HumanBrainProject/nehuba`
	- from within nehuba directory: `npm link`
5. Create your project:
	- Copy `examples/dependent-project` subfolder of neuroglancer to somewhere on your file system. This will be your project.
	- Rename the copied folder and `my-neuroglancer-project` subfolder in `src` according to your project name
	- Edit `name`, `description`, `version`, `license` etc. in the `package.json` of your brand new and shiny project
	- Replace `my-neuroglancer-project` to whatever you named it in the `paths` section of `tsconfig.json`
6. From within your project folder type:
	- `npm link neuroglancer`. This will create a symlink in your `node_modules` to the symlink created at step 3.
	- `npm link nehuba`
	- `npm i` to install the rest of dependencies
7. In the `third_party` directory of your project you will find a symlink to neuroglancer source. On linux it should just work. On windows you can delete it and create symlink with (from within third_party): `mklink /d neuroglancer ..\node_modules\neuroglancer\src\neuroglancer`. Use `/j` instead of `/d` if you don't have admin rights to your machine.
8. Now create similar link to nehuba sources. (for windows `mklink /d nehuba ..\node_modules\nehuba\src\nehuba` and if you use linux you know what to do ;-)
9. Add `"nehuba/*": ["third_party/nehuba/*"]` to the `paths` section of `tsconfig.json`
10. It's all set and ready to go. You can start the dev server by `npm run dev-server` and compile your project using `npm run build` or `npm run build-min`.
11. You can discard the example code from neuroglancer if you wish. Just replace `main.ts` with the one from `neuroglancer/src` and delete other source files in `{you project}/src/{your project sources}`

### Updating

Don't forget that you depend on two repositories. Always `git pull` both `HumanBrainProject/neuroglancer` and `HumanBrainProject/nehuba`. Check commit history before doing so and be prepared to modify your code.

### Using

Instead of original neuroglancer `setupDefaultViewer` function use `createNehubaViewer` from nehuba to get the wrapper. Simple example of `main.ts` could look like this:

```typescript
import { createNehubaViewer, Config } from "nehuba/exports";

window.addEventListener('DOMContentLoaded', () => {
  const config: Config = { restrictUserNavigation: true } //could be fetched from external json file
  const viewer = createNehubaViewer(config); //viewer is of type NehubaViewer, which is a wrapper around neuroglancer's Viewer

  //Use reactive API to observe the state change
  viewer.navigationState.all.subscribe(
    navState => { 
      /* send current user position and zoom level from navState to ilastik backend */ 
    }
  )

  if ( /* User ticks corresponding checkbox */ ) {
    config.zoomWithoutCtrl = true; //Change of the config is picked up by the viewer
  }
});
```

## The Config
Most of the nehuba functionality is controlled by a single [Config](https://github.com/HumanBrainProject/nehuba/blob/master/src/nehuba/config.ts) object, which is the first and main parameter of `createNehubaViewer` function. It is a simple object making it easy to use json to store and pass it around. 

Everything in Config is optional. Nehuba's design goal is that the user has to opt-in for any modification to neuroglancer provided by this project. Therefore if no config or an empty `{}` object is provided to `createNehubaViewer` then the viewer should behave identically to vanilla neuroglancer. Every option tries to default to original neuroglancer if not provided (currently the main exception being nehuba layout, which follows neurological convention by default. But the user still needs to opt-in to use nehuba layout instead of the one from neuroglancer)  
This way you can start from scratch (neuroglancer) and enable Nehuba features one-by-one to experiment and see how they work.

Where possible, the values in cofig are checked at runtime. Meaning that if you hold a reference to the config object passed to `createNehubaViewer` then you can toggle and switch many options directly on config and the changes will be picked up by the viewer automagically. So instead of implementing shortcuts to every config option in `NehubaViewer`, the `Config` itself is a legitimate part of nehuba API. Some options might require a call to `NehubaViewer.redraw()` or `NehubaViewer.relayout()` to take effect. Others are not "togglable" at all. See the [Config](https://github.com/HumanBrainProject/nehuba/blob/master/src/nehuba/config.ts) interface for detailed description of particular options.

### config.globals

The `config.globals{}` section is special. Options in this section require "monkey-patching" of neuroglancer **code** before any instances of the viewer are created. For example, in nehuba we extend `MeshLayer` class of neuroglancer to provide additional functionality which is totally fine and normal practice. But we still need a way to make neuroglancer use our `NehubaMeshLayer` subclass instead of its own. This is currently achieved by monkey-patching neuroglancer code at runtime and controlled by `useNehubaMeshLayer` flag in `globals` section of the config.

The consequence is that these options are applied "globally" and affect every instance of the viewer on the page. They are also not "togglable" and can not be reversed without re-loading the page. This should be fine for normal use case with one viewer, but might be problematic in complex scenarios where viewer is reused/re-created with different config or where there are multiple viewers on the same page. To make things worse, this section of config is processed only when the first viewer is created and ignored for subsequent viewers. We are trying hard to work around it and get rid of this section alltogether in future versions. But for the time being you need to be aware of this limitation.

Documentation
-------------
There is no standalone documentation at the moment, but we are trying to document public facing API with JSDoc as good as we can. See the source of the [Config](https://github.com/HumanBrainProject/nehuba/blob/master/src/nehuba/config.ts) object interface and the first half of [NehubaViewer](https://github.com/HumanBrainProject/nehuba/blob/master/src/nehuba/NehubaViewer.ts) class source for available methods of the wrapper (before `create` static method, there is only private stuff after it). If something is still unclear, please don't hesitate to contact us or raise an issue.

In action
---------
Here are some dedicated atlas viewers for [Human Brain Project](https://www.humanbrainproject.eu) made using this project:
1. BigBrain [https://bigbrain.humanbrainproject.org](https://bigbrain.humanbrainproject.org)
2. JuBrain [https://jubrain.humanbrainproject.org](https://jubrain.humanbrainproject.org)
3. Waxholm [https://waxholm.humanbrainproject.org](https://waxholm.humanbrainproject.org)
4. AMBA [https://amba.humanbrainproject.org](https://amba.humanbrainproject.org)