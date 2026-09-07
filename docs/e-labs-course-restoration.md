# Guided course restoration

The redesigned labs now use the website’s own light/dark palette and theme preference. Each lesson separates its introduction, experiment controls, explanation/evidence, and knowledge check. Only the selected step is visible. The course library and advanced settings stay closed until requested; progress and the last visited step are stored locally.

## Frontier — 19 lessons

| Course | Coverage restored or added |
| --- | --- |
| Meet the machine | What HPC is; login versus compute nodes; nodes, cores, accelerators; shared/distributed memory; cache and locality. |
| Choose and run a job | Twelve task-matching exercises with CPU/RAM/VRAM requirements, hints and explanations; problem size and resource requests; submit → queue → allocate → execute → collect; memory failures and walltime limits; storage and checkpoints; runtime, efficiency and service-unit accounting. |
| Think in parallel | Serial work units and parallel worker batches; elapsed time, speedup and efficiency; Amdahl’s law; strong/weak scaling; network latency and bandwidth; reservations and backfilling. |
| Understand acceleration | CPU/GPU architecture; equal-image pixel reveal races at several resolutions; multi-frame workloads and clip duration; launch/transfer overhead; roofline analysis; energy versus runtime. |

Resource sizes and performance rates are explicit illustrative assumptions. The workflow runs locally and submits no external jobs. A cluster’s aggregate memory is not presented as a single serial process’s memory. One modeled service unit equals one allocated core-hour; actual centers may charge differently. The rendering race is an explanation of work and overhead, not a hardware benchmark.

## Finite-Elemented — 22 lessons

| Course | Coverage restored or added |
| --- | --- |
| Start with physics | Elements, nodes, DOFs; stress/strain/stiffness and units; constraints and equilibrium; a real assembled one-dimensional bar with an exact reference field. |
| Build the approximation | Weak forms; Q4 basis functions; meshes; T3/Q4 behavior; beam/shell/solid idealizations; Jacobians; Gauss quadrature; h/p refinement. |
| Solve and verify | Actual stiffness-matrix sparsity; iterative solver residuals; conditioning and preconditioning; mesh-convergence studies; locking, reduced integration and hourglassing. |
| Apply your understanding | Stress inspection; Abaqus element nomenclature and input export; verification versus validation; analytical vibration modes; steady heat conduction. |

The plane-stress solver remains fully integrated Q4/constant-strain T3. Beam, shell, and 3D solid examples illustrate geometric idealizations; they are not additional finite-element solvers. Reduced integration and hourglassing are explained with formulation tradeoffs rather than simulated inaccurately. A separate real linear-bar model restores the connection between element assembly, nodal values, interpolation error, and refinement.

## Deliberate teaching changes

The original randomized workflow gauges are replaced by deterministic resource requirements, runtime/accounting estimates, and explicit execution states. The lesson text names model limits next to the corresponding evidence. Advanced concepts are introduced after their prerequisites, while every lesson remains freely accessible for returning learners.
