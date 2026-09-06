# Model X Studio: implications for E-Labs

## Recommendation

Adopt the inspection and rendering patterns in a shared Three.js layer. A wholesale migration to the reference application's React/Vite stack is unnecessary for this static portfolio. Finite-Elemented and Frontier now share locally hosted scene infrastructure, and their catalog miniatures use that same geometry and numerical model.

This review inspected the public source and portfolio descriptions. The deployed Model X demo was not available through the browsing tool, so these findings do not claim a firsthand frame-rate or interaction benchmark.

## What the reference does well

[Model X Studio](https://github.com/ashemag/model-x-studio) uses imperative Three.js inside a React component. Its [dependencies](https://github.com/ashemag/model-x-studio/blob/main/package.json) include Three.js 0.159; its approach does not require React Three Fiber.

The [scene implementation](https://github.com/ashemag/model-x-studio/blob/main/app/vehicle-scene.tsx) combines environment lighting, ACES tone mapping, soft shadows, raycast inspection, projected labels, automatic camera framing, and transitions between assembled, grouped, and individually inspected components. Render invalidation, capped pixel density, hidden-tab suspension, reduced motion, and resource disposal are especially relevant to a page with multiple miniatures.

Its [explosion layout](https://github.com/ashemag/model-x-studio/blob/main/app/explosion-layout.ts) arranges projected component bounds while preserving orientation and scale. That is useful for component catalogs and isolation views. Engineering explanations should also retain an assembled reference so an exploded display does not imply a change in physical connectivity.

## Where the portfolio benefits

| Priority | Tool | Useful visualization | Quantitative connection to preserve |
|---|---|---|---|
| Immediate | Gear3D | Vehicle → axle → wheel → contact-patch isolation; exploded assembly; selectable dimensions; camera fit | Actual wheel spacing, axle loads, footprint coordinates, and engineering scale |
| Immediate | Cross-Section Studio | Separate pavement layers; inspect thickness and materials; switch between annotated and publication views | Thickness, elevations, interfaces, and dimension annotations |
| Current rebuild | Finite-Elemented | Solved deformation, reference overlay, element picking, element separation, shape-function surfaces, Jacobian distortion, modal motion | The assembled stiffness system, actual stress recovery, units, deformation scale, and convergence evidence |
| Current rebuild | Frontier | Rack/node inspection, active compute lanes, memory hierarchy, communication packets | Explicit scaling assumptions, resource requests, job state, timeline, and bottleneck charts |
| High scientific value | Asphera | Section cuts, clipping planes, time scrub, field probes, deformation overlays | Existing simulation arrays, physical coordinates, time, consistent legends, and interpolation conventions |
| Selective | AirCrafter | Wheel/contact geometry, traction surfaces, vector resultants, and slices | Normal/tangential forces, contact area, and coordinate system |
| Selective | LEAPS | Linked layer isolation and stress-bulb exploration | Existing multilayer solver, evaluation points, wheel loads, and quantitative profiles |
| Provisional | Stride Lab | If the current objective is gait: phase scrub, skeleton, contact states, and force vectors | Measured or modeled kinematics and explicit force assumptions |

Portfolio context: [published E-Labs catalog](https://www.johanncardenas.com/E-Labs.html). The public catalog did not expose Stride Lab during this review, so its recommendation needs confirmation against its current implementation. [LEAPS](https://www.johanncardenas.com/e-labs/leaps/index.html) already has a numerical workflow that a 3D layer should share.

## Implementation principles

1. Keep a single source of geometry and calculated fields for the full tool, miniature, selected-object readout, and exported result.
2. Make changes to the physical model visibly distinct from inspection transforms. Separating elements must not silently alter the numerical mesh.
3. Keep 2D charts for trends, scaling, timelines, and convergence. Use 3D where spatial relationships matter.
4. Fit the camera to the geometry and viewport; provide keyboard camera controls and a non-canvas numerical alternative.
5. Reduce labels and pixel density in miniatures. Initialize near the viewport, animate on hover or focus, and pause when hidden.
6. Treat scientific color as data. Label the field, units, extrema, deformation exaggeration, and any analytical approximation.
7. Plan a separate data pipeline for Asphera's scientific fields. An assembly viewer alone does not solve large-array streaming, slicing, interpolation, or temporal caching.

## Reuse boundaries

The reference documents artist-authored vehicle parts and asset-specific licensing in its [repository attribution](https://github.com/ashemag/model-x-studio). No explicit root code license was identified during this review. The rebuilt labs use original procedural engineering geometry and independently implemented interactions; they do not import the reference's assets or copy its source.

Its [validation notes](https://github.com/ashemag/model-x-studio/blob/main/VALIDATION.md) distinguish geometry/build checks from browser performance testing. The same distinction applies here: numerical checks establish model behavior, while browser checks and screenshots assess the actual learning interface.
