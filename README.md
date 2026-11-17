# nehuba (v2)

## Insstallation

```sh
cd ${WORKINGDIR}

nvm insetall 24
nvm use 24

git clone git@github.com:google/neuroglancer.git neuroglancer-master
# known working sha256: 0b0b261a16ef6f551c0d8244cde4f20894bc571e

git clone git@github.com:HumanBrainProject/nehuba.git

npm -C neuroglancer-master i
npm -C nehuba i
```

## Local debug

```sh

# if not already in directory
cd nehuba

mv nehuba/main.debug.ts nehuba/main.ts

npm run dev
```
