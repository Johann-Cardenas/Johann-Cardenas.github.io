# Movement model evaluation — v1.2

The selected extension is an adaptive temporal trajectory layer over the existing
14-DOF rigid-body inverse-kinematics fit. v1.3 adds bounded solver steps,
per-frame observation-fit constraints and missing-ancestor measurement masks;
see `ENGINE-AUDIT.md`. This is a local implementation, not an
implementation of any of the learned models below. The app interface is unchanged.

## Alternatives considered

| Approach | Useful property | Decision for this app |
| --- | --- | --- |
| [OpenSim-style weighted IK](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090047) | Explicit marker and coordinate errors with a subject-specific skeleton | Retain the current planar geometric fit as the baseline |
| [KinePose temporal IK](https://arxiv.org/abs/2207.12841) | Optimizes pose and temporal terms in a biomechanically constrained chain | Supports exploring temporal constraints; a full sequence optimizer is a future alternative, not what ships here |
| [MediaPipe world landmarks](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) | Already exposes image and 3D world landmarks | Retain as pose-source information; inferred depth does not establish calibrated biomechanical accuracy |
| [VideoPose3D](https://github.com/facebookresearch/VideoPose3D) | Learned temporal convolutions lift 2D trajectories to 3D | Requires landmark mapping, browser inference packaging and running-specific evaluation before integration |
| [MHFormer](https://github.com/Vegetebird/MHFormer) | Multiple hypotheses and temporal attention address 3D pose ambiguity | Promising research candidate; requires weights, deployment work and a running validation dataset |

The last column is an engineering assessment, not a comparative accuracy claim.
No neural model weights were downloaded or evaluated in this change. Adding
degrees of freedom to a single side-view recording would add depth assumptions
that the present synthetic 2D oracle cannot validate.

## What ships

Each generalized-coordinate trajectory is fitted in centered local cubic windows
with three Cauchy reweighting passes. Angles are unwrapped before fitting.
Windows use actual timestamps, require at least seven observations, leave
boundaries unchanged and never cross missing samples or timestamp discontinuities.
The forward-kinematics reconstruction retains rigid lengths. Velocities and
mechanical work are recomputed from the resulting trajectories. Per-landmark and
overall residuals are recomputed after reconstruction.

Automatic selection requires at least 100 fps and an original median IK residual
of 0.4–3% of leg length. Radius is 30 ms below 1.5% residual and 45 ms above it.
These are engineering thresholds chosen on synthetic examples, not physiological
constants. Clean fits bypass the layer. Fits above 3% retain the poor-fit behavior.
`fitKinematicModel(cond, { temporal: false })` provides the reproducible baseline;
`temporal: true` forces the candidate at supported frame rates for experiments.

## Paired benchmark

Run `npm run benchmark:model`. Sixty clips: five deterministic seeds, three frame
rates, four noise levels; two knees per clip. Each clip lasts four seconds and
cadence varies with seed. Reference: direct knee angles from the conditioned,
noise-free rigid synthetic runner. This reference includes the conditioning
pipeline and does not validate camera, pose-estimator or real-world errors.

| fps | Landmark noise / leg length | Framewise knee RMS (°) | Adaptive knee RMS (°) |
| --- | --- | --- | --- |
| 60 | 0% | 0.198 | 0.198 |
| 60 | 1% | 1.271 | 1.271 |
| 60 | 2% | 2.514 | 2.514 |
| 60 | 4% | 5.132 | 5.132 |
| 120 | 0% | 0.188 | 0.188 |
| 120 | 1% | 0.848 | 0.827 |
| 120 | 2% | 1.725 | 1.682 |
| 120 | 4% | 3.386 | 3.087 |
| 240 | 0% | 0.189 | 0.189 |
| 240 | 1% | 0.637 | 0.637 |
| 240 | 2% | 1.258 | 1.213 |
| 240 | 4% | 2.479 | 2.255 |

An initial fixed 60 ms radius was rejected: on three 120 fps examples it added
about 1.30° RMS difference to clean knee trajectories despite helping at 4% noise.
The adaptive model therefore bypasses clean fits and uses shorter windows.
In the initial v1.2 run on this machine, the additional processing for noisy four-second clips was about
40–190 ms at 120–240 fps; this excludes video decoding and pose inference. The
additional v1.3 safeguards add computation; use the benchmark's current runtime
output rather than interpreting this original timing as a v1.3 performance claim.

Limits: this is offline temporal smoothing, not a 3D model, force estimator or
trained gait prior. Synthetic knee error improvements do not establish improved
event timing, all-joint accuracy or mechanical-work accuracy on real runners.
The next meaningful validation needs synchronized video and reference motion
capture, including occlusions, fast cadence changes and varied camera angles.
