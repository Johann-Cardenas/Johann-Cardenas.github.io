# Engine robustness audit — v1.3

This pass addresses demonstrated failure modes in the analysis and decoding
paths. It is not a claim that every vulnerability has been found, or that
synthetic accuracy establishes accuracy on real runners.

## Selected model

Retain subject-specific 14-DOF planar IK with Cauchy reweighting and adaptive
temporal cubic trajectories. Add bounded nonlinear optimization and an
observation-fit constraint on temporal reconstruction. This is the currently
tested option for the available side-view inputs and synthetic reference data.
No evidence here establishes that it is the best possible model for real video.
The learned 3D alternatives and validation requirements remain documented in
`MODEL-RESEARCH.md`.

## Corrected failure modes

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| Claimed FPS could override decoded timestamps | Derive processing rate from timestamps; report conflicting metadata | A 30 fps recording claiming 240 fps still suppresses contact time |
| Irregular observations went into uniform-rate filters and derivatives | Resample landmarks on presentation time before filtering; preserve long gaps | Affine trajectories retain their values on a uniform grid |
| Resampling could imply stronger timing evidence | Quantization, precision classes and timing gates use the lower of median rate and reciprocal p90 original interval | A median 60 fps irregular recording with p90 equivalent to 48 fps remains timing-suppressed |
| Invalid buffers, calibration and timestamps could reach numerical code | Validate dimensions, buffer sizes, canonical order, finite increasing times and positive calibration | Malformed, duplicate, backward, non-finite and invalid-calibration cases return controlled failures |
| Invalid cutoffs could create unstable filters | Validate corrected design cutoff against Nyquist; validate primitive filter and derivative parameters | Invalid cutoff cases fail before fitting |
| Long occlusions were held across IIR filters and finite differences | Process finite runs independently | A position jump across a missing interval creates no reacquisition velocity spike |
| Event sampling could substitute a nearby value for a missing sample | Exact missing samples and interpolation touching a gap return NaN | Missing event samples remain unavailable |
| Display skeleton holds could become energy measurements | Separate display tracks from measurement tracks; propagate missing ancestors through the segment tree | Occluded trunk coordinates mask descendant measurement tracks and energy curves |
| Clip-wide completeness could hide an unusable stride | Require 90% finite coverage of each required landmark in each measured cycle | Implemented before per-cycle values enter aggregates or playback samples |
| Gauss-Newton could overshoot a nonlinear fit | Cap root/angle steps, backtrack on the actual weighted observation-plus-prior objective, reject non-finite steps | Clean, noisy and mirrored model regressions retain their checks |
| Temporal smoothing could worsen isolated frames despite improving an average | Backtrack along generalized-coordinate changes; final RMS may not exceed max(1.1 × original RMS, original RMS + 0.2% leg length) | Per-frame residual bound checked on a noisy synthetic runner |
| Anatomical gating modified caller-owned data | Copy and sanitize visibility before gating | Source visibility remains unchanged after a bad-anatomy analysis |
| MP4 counts could allocate excessive arrays before validation | Check counts against box payloads, file bytes and a one-million-sample limit before allocation | Oversized count fixtures fail without expanding tables |
| MP4 reads could cross box boundaries or accept invalid sample bytes | Validate box headers, table lengths, decode runs, sample/chunk maps, byte ranges and membership in mdat | Truncated fixtures, corrupt tables and 250 deterministic random buffers return controlled failures |
| Sample-to-chunk lookup could become quadratic | Advance a cursor through sorted, validated runs | Mapping is linear in chunk and run counts |
| Large sample arrays could exhaust argument limits in duration calculation | Reduce presentation end times instead of spreading an array into Math.max | Duration uses each sample's presentation time plus its own duration |

## Operational bounds and compatibility

- At most 120,000 analyzed pose frames, including a resampled grid. This bounds
  allocation and fitting work; trim longer recordings before analysis.
- A resampling grid may not expand beyond four times the observed frame count.
  Short gaps use interpolation only between supported observations; long gaps
  retain missing coordinates and zero visibility.
- MP4 table expansion is limited to one million samples. Unsupported or malformed
  containers return a parser result that selects the existing playback decoder.
- Long gaps can now suppress work and joint metrics previously derived from
  held positions. This reduction in availability is intentional.
- Regular, fully observed golden metrics remain unchanged. Precision classes
  can become more conservative on recordings with genuinely irregular timing.
- The app interface remains unchanged; new diagnostics stay in analysis metadata.

## Verification and remaining limits

Browser-specific findings and release gates are recorded in `TESTING.md` and
D60 of `DECISIONS.md`. They include Firefox playback bitmap orientation,
consumer-error propagation, worker cleanup, graphics selection, responsive
overlay alignment, cached score expiry and the collapsed History panel.

Run `npm test` for the baseline and adversarial suite, and
`npm run benchmark:model` for 60 paired synthetic clips. The latter tests knee
angles at three frame rates and four noise levels; it does not evaluate 3D pose,
all joints, neural-backend errors, real camera motion or real-world energy accuracy.

Random-byte and corrupted-fixture tests are bounded fuzz checks, not a proof of
parser security. Browser codec implementations and third-party pose runtimes
remain external dependencies. Independent real-running reference data is still
required before choosing or validating a learned 3D replacement. Adding an
unvalidated network would not resolve those unknowns.
