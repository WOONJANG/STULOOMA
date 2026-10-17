# Original garment models

STULOOMA's T-shirt and basketball jersey are independently authored parametric meshes in `src/core/garments/index.ts`. No commercial software assets, extracted models, product UI, or third-party garment templates are included. Run `npm run generate:assets` to reproduce every supplied GLB and artwork fixture.

The models have curved front and back panels, physical side depth, sloping shoulder bridges, an open neck, and an open lower hem. The T-shirt includes separate downward-angled hollow sleeves with open cuffs. The basketball jersey has narrower shoulders and exposed armhole openings. They are surface garments intended for visual mockups, not sewing patterns, body simulation, fitting certification, or production grading.

Coordinates are meters at a nominal height of 1.77 m; +Y is up and +Z is the front. Both models are centered near the origin. Mesh names and `extras.regionId` stay stable across GLB export/import:

| Region | Meshes | Meaning |
| --- | --- | --- |
| FRONT | FRONT | Curved chest and front hem |
| BACK | BACK, LEFT_SHOULDER, RIGHT_SHOULDER | Back and shoulder bridges |
| LEFT_SIDE / RIGHT_SIDE | Corresponding SIDE mesh | Physical side seam panels |
| LEFT_SLEEVE / RIGHT_SLEEVE | Corresponding SLEEVE mesh | T-shirt sleeve only |
| COLLAR | COLLAR | Neck trim ring |

Each mesh has independent full-range UV0 from 0 to 1, indexed triangles, and unit vertex normals. The front and back islands are oriented so artwork reads upright when looking at the corresponding side. Canvas coordinates use their top-left origin; texture sampling converts canvas `(x, y)` to `(u=x, v=1-y)`. Shoulder bridges share the back region texture. Sleeve UVs wrap around their circumference. Side UVs traverse the body seam; they are not a UV sewing atlas.

`samples/artwork/transparent-logo.png` is an original transparent monogram; `uv-checker.png` exposes stretching and orientation; `stulooma-badge.svg` exercises vector rasterization. `samples/invalid/no-uv.glb` and `damaged.glb` are intentional negative import fixtures.

For custom assets, use a self-contained binary glTF 2.0 (`.glb`) with triangle meshes, UV0, normals, and embedded buffers/images. The loader applies conservative file, vertex, and texture limits and rejects external resources before parsing. Map imported mesh IDs to FRONT/BACK/other regions in the advanced mapping panel. STULOOMA stores the original model bytes inside the project archive, allowing the project to reopen without the original filesystem path.

## 어깨 UV 연속 영역

어깨 메시 두 개는 BACK 부위의 상단 UV 띠를 이어 사용한다. 뒷판 전체 텍스처를 각 어깨에 반복하지 않는다. 부위 한 개가 여러 메시로 구성될 수 있으며 전체 0–1 UV 범위는 개별 메시가 아니라 논리 부위 기준으로 검증한다.
