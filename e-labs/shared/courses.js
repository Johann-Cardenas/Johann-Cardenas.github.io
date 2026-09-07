(function () {
  "use strict";
  const make = (
    id,
    nav,
    intro,
    body,
    equation,
    tryIt,
    question,
    answers,
    correct,
    feedback,
  ) => ({
    id,
    nav,
    title: nav,
    subtitle: intro,
    intro,
    body,
    equation,
    takeaway: tryIt,
    question,
    answers,
    correct,
    feedback,
  });
  const fe = [
    make(
      "fea-intro",
      "What is a finite element?",
      "A continuous body becomes connected, manageable pieces.",
      "An element is a small region. Nodes connect neighboring regions; degrees of freedom are the unknown values solved at those nodes. Two-dimensional elasticity usually has two displacement components per node. The same method can solve temperature, pressure, or electric potential with different equations.",
      "body → elements → shared nodes → unknowns",
      "Change the mesh density. The shape remains the same while the number of unknowns grows.",
      "What is a degree of freedom?",
      [
        "An independent unknown at a node.",
        "A material name.",
        "An individual force arrow.",
      ],
      0,
      "A displacement component is one degree of freedom. The field being solved determines which unknowns each node carries.",
    ),
    make(
      "materials",
      "Force, stress & stiffness",
      "Force loads a body. Stress describes its internal response.",
      "Stress is force per area; strain measures relative deformation. Young’s modulus relates axial stress to elastic strain. Poisson’s ratio relates transverse contraction to axial extension. This structural lab fixes ν = 0.3 and varies E; all calculations use N, mm, and MPa.",
      "σ = F/A · ε = ΔL/L · σ = Eε",
      "Double Young’s modulus and compare displacement under the same force.",
      "With the same axial stress, doubling E does what to strain?",
      ["Halves it.", "Doubles it.", "Leaves it unchanged."],
      0,
      "From ε = σ/E, a stiffer elastic material strains less at the same stress.",
    ),
    make(
      "axial-bar",
      "Solve a one-dimensional bar",
      "Start with one displacement per node.",
      "A bar element has stiffness EA/h. Neighboring element matrices are added at shared nodes, the left-end displacement is prescribed, and the remaining unknowns are solved. A distributed axial load makes the exact displacement curve quadratic; linear elements interpolate it piece by piece.",
      "kₑ = (EA/h)[1 −1; −1 1]",
      "Refine the bar. Its nodal solution is exact for this load, while the interpolation between nodes improves.",
      "Can accurate nodal values hide interpolation error?",
      [
        "Yes, values between nodes may still be approximate.",
        "No, nodes determine an exact continuum solution.",
        "Only when E is zero.",
      ],
      0,
      "In this uniform bar, constant distributed load gives exact nodal displacements but a curved exact field between them.",
    ),
    make(
      "weak-form",
      "From physics to a weak form",
      "Balance work before assembling equations.",
      "The strong form of an axial bar is −(EAu′)′ = q. Multiply by a test displacement v and integrate by parts: only first derivatives of u remain. Test functions vanish at prescribed-displacement boundaries. Applied end forces enter the boundary work naturally.",
      "∫ EA u′v′ dx = ∫ qv dx + P v(L)",
      "Vary the distributed load in the bar experiment and follow its contribution to the displacement.",
      "Why integrate by parts?",
      [
        "To reduce the derivative order required of the displacement field.",
        "To remove the load from the model.",
        "To make every element rigid.",
      ],
      0,
      "The weak form needs first derivatives instead of second derivatives, allowing continuous piecewise-linear approximations.",
    ),
    make(
      "element-library",
      "Beams, shells & solids",
      "Match the element to the geometry and the unknowns.",
      "Beams represent slender members; shells represent thin surfaces; solids resolve a volume. Triangles and quadrilaterals discretize surfaces, while tetrahedra and hexahedra discretize volumes. Higher-order elements add interpolation freedom, but geometry, distortion, and integration remain important.",
      "slender → beam · thin → shell · bulk → solid",
      "Switch families and inspect the spatial idealization. These are geometry examples, not alternative solves of the beam.",
      "Which family is a natural first choice for a thin curved panel?",
      ["Shell elements.", "A single axial spring.", "Point masses alone."],
      0,
      "Shells represent membrane and bending behavior of thin surfaces without meshing several solid elements through the thickness.",
    ),
    make(
      "quadrature",
      "Numerical integration",
      "Approximate an integral with weighted samples.",
      "Gauss quadrature samples an integrand at carefully chosen points. In one dimension, n points integrate polynomials through degree 2n−1 exactly. Element stiffness uses these rules after mapping from natural coordinates. Distortion can make the stiffness integrand more complicated than a polynomial.",
      "∫₋₁¹ f(ξ)dξ ≈ Σ wᵢ f(ξᵢ)",
      "Try ξ⁴ with two points, then three. Compare each estimate with the exact integral.",
      "How many Gauss points guarantee exact integration of ξ⁴?",
      ["Three.", "One.", "Two."],
      0,
      "Three points integrate polynomials up to degree five; two points are guaranteed only through degree three.",
    ),
    make(
      "conditioning",
      "Constraints & conditioning",
      "A small residual is only one part of a good solve.",
      "Insufficient constraints leave rigid-body modes and a singular stiffness matrix. A valid but ill-conditioned system can also be difficult to solve: distorted elements or large stiffness contrasts amplify sensitivity. Direct methods factor a matrix; iterative methods reduce a residual. Preconditioning improves the system seen by the iteration.",
      "unique static solution → constrain rigid-body modes",
      "Increase mesh density and inspect the iteration count. Solver tolerance and mesh error are separate.",
      "Can preconditioning repair an unconstrained rigid body?",
      [
        "No. The physical constraints must first define a unique solution.",
        "Yes, it replaces boundary conditions.",
        "Only by adding more elements.",
      ],
      0,
      "Preconditioning helps a valid algebraic system; it does not supply missing physical constraints.",
    ),
    make(
      "integration",
      "Accuracy, locking & hourglassing",
      "Integration choices change both cost and behavior.",
      "Full integration can produce excessive stiffness in some low-order bending or nearly incompressible problems. Reduced integration can alleviate locking but may introduce zero-energy hourglass modes, requiring stabilization. Higher-order or mixed formulations are alternatives. Choose by the physical problem, then verify with refinement.",
      "locking: too stiff · hourglassing: spurious zero-energy motion",
      "Compare T3 and fully integrated Q4 bending. This lab does not claim to simulate reduced integration or hourglass control.",
      "Is reduced integration always more accurate?",
      [
        "No; stability and the element formulation also matter.",
        "Yes, fewer samples are always better.",
        "Yes, because it removes boundary conditions.",
      ],
      0,
      "Reduced integration is a formulation choice with tradeoffs, not a universal accuracy switch.",
    ),
  ];
  const hpc = [
    make(
      "hpc-intro",
      "What is high-performance computing?",
      "Many connected computers tackle a problem together.",
      "A cluster contains compute nodes linked by a network. A login node is the entry point for preparing and submitting work. Compute nodes execute jobs; shared storage holds inputs and results. HPC is useful when a workload needs more capacity or parallel throughput than a suitable single machine can provide.",
      "prepare → submit → compute → collect",
      "Increase the number of compute nodes and watch the available core count change.",
      "Where should a large scheduled calculation run?",
      [
        "On allocated compute nodes.",
        "On the login node by default.",
        "Inside the scheduler itself.",
      ],
      0,
      "The login node is for access and preparation. The scheduler assigns compute resources to run the calculation.",
    ),
    make(
      "hardware",
      "Nodes, cores & accelerators",
      "These words describe different levels of the machine.",
      "A node is one computer with processors and memory. A CPU contains cores; a hardware thread is an execution context, not automatically another full core. A GPU is an accelerator with its own memory. More hardware helps only when the program can use it.",
      "total CPU cores = nodes × cores per node",
      "Change nodes and cores separately. The total may match, but memory placement and communication differ.",
      "Are 32 CPU cores necessarily 32 nodes?",
      [
        "No; one node can contain many cores.",
        "Yes; the terms are interchangeable.",
        "Only if a GPU is installed.",
      ],
      0,
      "Nodes are computers; cores are processing units inside their CPUs.",
    ),
    make(
      "memory-models",
      "Shared versus distributed memory",
      "Within a node, threads can share memory. Across nodes, data must move.",
      "Shared-memory threads access one address space, as in many OpenMP programs. Distributed processes have separate address spaces and exchange messages, as in MPI programs. Hybrid applications combine both. Adding node RAM does not automatically give a serial process a single larger address space.",
      "shared address space ≠ pooled cluster memory",
      "Compare total cluster RAM with RAM per node. Ask whether the program supports distributing its data.",
      "A serial process needs 100 GB. Do two 64 GB nodes automatically satisfy it?",
      [
        "No; their address spaces are separate.",
        "Yes, all RAM is automatically pooled.",
        "Yes, if the queue is empty.",
      ],
      0,
      "The application must support distributing data or use a node with sufficient accessible memory.",
    ),
    make(
      "allocations",
      "Request the right resources",
      "A job request is a reservation, not a performance guarantee.",
      "CPU count limits available processing capacity. Memory must fit the workload. Walltime is a runtime limit, not an estimate of how long the queue will take. Over-requesting can waste capacity or constrain placement. The scheduler’s actual wait depends on availability and policy.",
      "fit in RAM · use the cores · leave enough walltime",
      "Change problem size and compare required memory with requested memory.",
      "What does a one-hour walltime request mean?",
      [
        "The running job may be stopped after one hour.",
        "The job starts within one hour.",
        "The job must use exactly one hour.",
      ],
      0,
      "Walltime limits execution duration; it does not promise a queue wait or force a job to run longer than needed.",
    ),
    make(
      "storage",
      "Memory, storage & I/O",
      "RAM holds working data. Storage keeps files.",
      "I/O moves data between storage and memory. Checkpointing saves a recoverable state, while excessive small writes can become a bottleneck. Some applications overlap I/O with computation; this teaching estimate assumes a sequential transfer at constant bandwidth and excludes metadata latency.",
      "transfer time = data size / sustained bandwidth",
      "Double the output size, then double storage bandwidth. Compare the transfer times.",
      "Does more RAM automatically make every file transfer faster?",
      [
        "No; storage and access patterns can remain limiting.",
        "Yes, RAM and disk are the same resource.",
        "Only for empty files.",
      ],
      0,
      "RAM capacity and storage throughput are different properties. Caching may help some access patterns, but does not eliminate storage limits.",
    ),
    make(
      "accounting",
      "Runtime, efficiency & service units",
      "Finishing faster can cost more allocated compute time.",
      "Elapsed runtime measures duration. Parallel efficiency compares speedup with worker count. This lesson defines one service unit as one allocated core-hour; real centers may use different weights for nodes, memory, or GPUs. Queue time is separate from the running allocation in this example.",
      "SU = allocated cores × runtime in hours",
      "Compare a small and a large allocation for the same workload.",
      "Eight cores allocated for two hours use how many core-hours?",
      ["16.", "4.", "2."],
      0,
      "Allocated core-hours multiply the reserved core count by the execution time in hours.",
    ),
    make(
      "parallel-work",
      "Serial work & work queues",
      "Independent tasks can run together. Dependencies must wait.",
      "Serial work uses one worker at a time. Independent work can be split into batches across workers. If there are fewer ready tasks than workers, some workers idle. The experiment uses equal-duration tasks, a serial-first phase, and no communication overhead to make that distinction visible.",
      "time = serial tasks + ceil(parallel tasks / workers)",
      "Try more workers than independent tasks. Watch the queue stop benefiting from additional workers.",
      "What limits a batch of four independent tasks on sixteen workers?",
      [
        "Only four workers can receive a task in that batch.",
        "All sixteen workers must be equally busy.",
        "The tasks become serial.",
      ],
      0,
      "Available parallelism is limited by the ready work, not just the hardware allocation.",
    ),
    make(
      "strong-weak",
      "Strong versus weak scaling",
      "Either keep the problem fixed or grow it with the machine.",
      "Strong scaling asks how much faster a fixed problem runs. Weak scaling keeps parallel work per worker fixed by growing the problem. Here the serial work remains fixed and communication grows with log₂(P). Scaled speedup compares against solving that larger problem on one worker.",
      "strong: fixed total work · weak: fixed parallel work per worker",
      "Toggle the scaling mode and watch runtime and total work change.",
      "In weak scaling, what grows with worker count?",
      [
        "The parallel problem size.",
        "Only the color scale.",
        "The serial fraction must become zero.",
      ],
      0,
      "Weak scaling increases the problem size so each added worker receives a comparable amount of parallel work.",
    ),
    make(
      "render-race",
      "Watch a CPU and GPU render",
      "The same image, two different throughput models.",
      "Pixels provide independent work. This demonstration reveals one identical image using an assumed CPU rate of 8,192 pixels/s and GPU rate of 131,072 pixels/s, plus GPU launch and transfer overhead. These rates are illustrative, not measured hardware performance. Tiny images can favor the CPU.",
      "CPU: pixels/rate · GPU: overhead + pixels/rate",
      "Choose a small image, then a large one. Replay the race and compare the crossover.",
      "Why can a GPU lose on a tiny image?",
      [
        "Fixed launch and transfer overhead can dominate.",
        "GPUs cannot process pixels.",
        "The images must be different.",
      ],
      0,
      "A throughput advantage needs enough work to compensate for fixed overhead.",
    ),
    make(
      "animation-batch",
      "From one frame to an animation",
      "Repeated rendering turns small per-frame costs into large totals.",
      "A sequence multiplies per-frame work. This model treats frames sequentially and charges GPU overhead once per frame. Real applications can batch work, overlap transfers, or distribute frames, so their timing can differ. Compare total compute time with the animation’s playback duration.",
      "render time = frame count × time per frame",
      "Change frame count and frame rate. Frame rate changes playback duration, not the amount of rendering work for a fixed number of frames.",
      "For a fixed set of 120 frames, does higher playback FPS reduce the rendering work?",
      [
        "No; it only shortens playback duration.",
        "Yes; it deletes half the pixels.",
        "Only on a CPU.",
      ],
      0,
      "Playback speed and the cost of generating a fixed number of frames are different quantities.",
    ),
  ];
  const definitions = {
    fea: [
      [
        "Start with physics",
        ["fea-intro", "materials", "foundations", "axial-bar"],
      ],
      [
        "Build the approximation",
        [
          "weak-form",
          "shape",
          "mesh",
          "elements",
          "element-library",
          "mapping",
          "quadrature",
          "refinement",
        ],
      ],
      [
        "Solve and verify",
        ["assembly", "solvers", "conditioning", "convergence", "integration"],
      ],
      [
        "Apply your understanding",
        ["stress", "abaqus", "verification", "dynamics", "heat"],
      ],
    ],
    hpc: [
      [
        "Meet the machine",
        ["hpc-intro", "hardware", "memory-models", "memory"],
      ],
      [
        "Choose and run a job",
        ["rightsizing", "allocations", "workflow", "storage", "accounting"],
      ],
      [
        "Think in parallel",
        ["parallel-work", "scaling", "strong-weak", "network", "scheduling"],
      ],
      [
        "Understand acceleration",
        [
          "architecture",
          "render-race",
          "animation-batch",
          "roofline",
          "energy",
        ],
      ],
    ],
  };
  const brief = {
    stress:
      "A load produces displacement and internal stress. Inspect the computed response one element at a time.",
    foundations:
      "Displacements prescribe motion. Forces and tractions prescribe loading. Enough constraints are needed to prevent rigid-body motion.",
    assembly:
      "Each element contributes stiffness at shared nodes. Assembly connects those contributions into one system.",
    mesh: "A mesh approximates both geometry and a field. More resolution helps where the solution changes quickly.",
    elements:
      "T3 triangles use linear interpolation. Q4 quadrilaterals use bilinear interpolation; their behavior can differ in bending.",
    shape:
      "Shape functions turn nodal values into a field inside an element. Together, the four Q4 functions sum to one.",
    mapping:
      "The Jacobian translates between a regular parent element and the physical element. A negative determinant means inversion.",
    refinement:
      "h refinement adds smaller elements. p refinement adds richer polynomials inside each element.",
    convergence:
      "Refine the mesh while holding the physics fixed. Look for a stable quantity of interest.",
    solvers:
      "A solver finds displacements that balance the discrete equations. Its residual measures remaining algebraic imbalance.",
    dynamics:
      "A structure has natural vibration modes. Their frequencies depend on stiffness, mass, and constraints.",
    heat: "The same numerical ideas apply to temperature. Here, uniform steady conduction has an exact linear profile.",
    verification:
      "A converged calculation can still model the wrong physics. Numerical verification and physical validation answer different questions.",
    abaqus:
      "Carry the same geometry, material, loads, and units into another solver. Start by comparing displacements and reactions.",
    scaling:
      "Only the parallel portion speeds up when you add workers. Serial work and communication limit the benefit.",
    rightsizing:
      "Choose the smallest suitable resource for each task. Check CPU capacity, RAM, GPU memory, and whether the software can distribute work.",
    workflow:
      "Follow a batch job from submission through scheduling, allocation, execution, and collection.",
    architecture:
      "CPUs favor flexible, latency-sensitive work. GPUs favor large batches of similar operations.",
    memory:
      "A cache is small and fast; main memory is larger and slower. Reusing nearby data reduces expensive accesses.",
    roofline:
      "Performance is limited by compute throughput or memory traffic. Arithmetic intensity helps identify which one matters.",
    network:
      "Every message has startup latency and a size-dependent transfer cost. Both can limit distributed work.",
    scheduling:
      "Backfilling can use idle capacity without delaying an earlier reservation.",
    energy:
      "Runtime, allocated compute time, and energy are different objectives. A faster configuration need not minimize all three.",
  };
  const terms = {
    fea: [
      ["Node", "A point carrying unknown field values."],
      ["Element", "A connected region with an approximate field."],
      ["DOF", "One independent unknown."],
    ],
    hpc: [
      ["Node", "One computer in a cluster."],
      ["Core", "A CPU processing unit."],
      ["Job", "Work submitted with a resource request."],
    ],
  };
  const defaults = {
    "fea-intro": { density: 2, gain: 0, field: "displacement" },
    materials: { preset: "tension", E: 70000 },
    "axial-bar": { segments: 4, distributed: 10 },
    "weak-form": { segments: 4, distributed: 10 },
    "element-library": { family: "shell" },
    quadrature: { gaussPoints: 2, degree: 4 },
    conditioning: { density: 3 },
    "hpc-intro": { nodes: 2, coresPerNode: 8 },
    hardware: { nodes: 2, coresPerNode: 8 },
    "memory-models": { nodes: 2, coresPerNode: 8 },
    rightsizing: { task: 0, resourceChoice: "laptop" },
    allocations: { memoryGB: 64, problem: 2, walltime: 30 },
    workflow: { memoryGB: 64, problem: 2, walltime: 30 },
    accounting: { memoryGB: 64, problem: 2, walltime: 30 },
    storage: { dataGB: 20, ioBandwidth: 2 },
    "parallel-work": { workUnits: 32, serialPercent: 25, processors: 4 },
    "strong-weak": { weak: true },
    "render-race": { resolution: 128, launch: 0.12 },
    "animation-batch": { resolution: 128, frames: 24, fps: 24, launch: 0.12 },
  };
  const vocabulary = {
    materials: [
      ["Stress", "Internal force per unit area."],
      ["Strain", "Change in length divided by original length."],
    ],
    foundations: [
      ["Constraint", "A prescribed displacement."],
      ["Traction", "Force distributed over a boundary."],
    ],
    "axial-bar": [
      ["Stiffness", "Force needed per unit displacement."],
      ["Assembly", "Adding element contributions at shared nodes."],
    ],
    "weak-form": [
      ["Test function", "An admissible virtual variation of the field."],
      ["Weak form", "Balance expressed through weighted integrals."],
    ],
    shape: [
      ["Shape function", "A basis that interpolates nodal values."],
      ["Partition of unity", "All shape functions sum to one."],
    ],
    mesh: [
      ["Mesh", "Connected elements covering a domain."],
      ["Resolution", "How finely geometry and fields are represented."],
    ],
    elements: [
      ["T3", "A three-node linear triangle."],
      ["Q4", "A four-node bilinear quadrilateral."],
    ],
    "element-library": [
      ["Idealization", "A simpler representation of physical geometry."],
      ["Dimension", "A line, surface, or volume approximation."],
    ],
    mapping: [
      ["Parent element", "A regular reference coordinate domain."],
      ["Jacobian", "The local transformation of coordinates."],
    ],
    quadrature: [
      ["Sample point", "A location where the integrand is evaluated."],
      ["Weight", "A sample’s contribution to the integral."],
    ],
    refinement: [
      ["h refinement", "Use more, smaller elements."],
      ["p refinement", "Use higher-degree interpolation."],
    ],
    assembly: [
      ["Global matrix", "The connected system of element equations."],
      ["Sparsity", "Most matrix entries are zero."],
    ],
    solvers: [
      ["Residual", "The imbalance in the discrete equations."],
      ["Tolerance", "The chosen stopping threshold."],
    ],
    conditioning: [
      ["Conditioning", "Sensitivity of a solution to perturbations."],
      ["Preconditioner", "A transformation that helps an iterative solve."],
    ],
    convergence: [
      ["Convergence", "A chosen result stabilizes with refinement."],
      ["Error", "The difference from a reference solution."],
    ],
    integration: [
      ["Locking", "Artificially stiff behavior of a formulation."],
      ["Hourglass mode", "A spurious motion with no strain energy."],
    ],
    stress: [
      ["Displacement", "How far a material point moves."],
      ["von Mises stress", "A scalar measure of distortional stress."],
    ],
    abaqus: [
      ["Element code", "A solver’s name for a specific formulation."],
      ["Input deck", "A text description of the analysis model."],
    ],
    verification: [
      ["Verification", "Are the equations solved correctly?"],
      ["Validation", "Do the equations represent the real system?"],
    ],
    dynamics: [
      ["Mode shape", "A characteristic vibration pattern."],
      ["Frequency", "Oscillation cycles per second."],
    ],
    heat: [
      ["Conductivity", "How readily a material conducts heat."],
      ["Heat flux", "Heat transfer rate per unit area."],
    ],
    hardware: [
      ["Core", "A CPU processing unit inside a node."],
      ["Accelerator", "A device such as a GPU for specialized work."],
    ],
    "memory-models": [
      ["Shared memory", "Threads access a common address space."],
      ["Distributed memory", "Processes exchange data between address spaces."],
    ],
    memory: [
      ["Cache", "Small, fast storage close to a processor."],
      ["Locality", "Reusing data nearby in space or time."],
    ],
    rightsizing: [
      ["Capacity", "The hardware resources a task must fit."],
      ["Suitability", "Whether the software can use those resources."],
    ],
    allocations: [
      ["Allocation", "Resources reserved for a running job."],
      ["Walltime", "The maximum permitted execution duration."],
    ],
    workflow: [
      ["Scheduler", "The system that places waiting jobs."],
      ["Queue", "Jobs waiting for suitable resources."],
    ],
    storage: [
      ["I/O", "Moving data into or out of working memory."],
      ["Checkpoint", "A saved state from which work can resume."],
    ],
    accounting: [
      ["Core-hour", "One allocated CPU core for one hour."],
      ["Efficiency", "Speedup divided by worker count."],
    ],
    "parallel-work": [
      ["Serial work", "Tasks that must run in sequence."],
      ["Parallel work", "Tasks that can execute concurrently."],
    ],
    scaling: [
      ["Speedup", "One-worker runtime divided by parallel runtime."],
      ["Amdahl’s law", "Serial work limits fixed-workload speedup."],
    ],
    "strong-weak": [
      ["Strong scaling", "Add workers to the same total workload."],
      ["Weak scaling", "Increase workload with worker count."],
    ],
    network: [
      ["Latency", "The startup delay for a message."],
      ["Bandwidth", "The rate at which data can be transferred."],
    ],
    scheduling: [
      ["Reservation", "Resources held for a future job start."],
      ["Backfill", "Fit shorter jobs around that reservation."],
    ],
    architecture: [
      ["CPU", "Flexible processing with few powerful cores."],
      ["GPU", "Many lanes suited to similar parallel operations."],
    ],
    "render-race": [
      ["Pixel", "One image sample that needs computation."],
      ["Launch cost", "Overhead before GPU work can proceed."],
    ],
    "animation-batch": [
      ["Frame", "One rendered image in a sequence."],
      ["Frame rate", "Images displayed each second during playback."],
    ],
    roofline: [
      ["Intensity", "Operations performed per byte transferred."],
      ["Bottleneck", "The resource that limits performance."],
    ],
    energy: [
      ["Power", "The rate of energy use, measured in watts."],
      ["Energy", "Power accumulated over running time."],
    ],
  };
  window.LabCourses = {};
  for (const kind of ["fea", "hpc"]) {
    const map = new Map(
      [...LabCurriculum[kind], ...(kind === "fea" ? fe : hpc)].map((l) => [
        l.id,
        l,
      ]),
    );
    LabCourses[kind] = definitions[kind].map(([title, ids], i) => ({
      title,
      ids,
      index: i,
    }));
    LabCurriculum[kind] = definitions[kind].flatMap(([title, ids], course) =>
      ids.map((id) => {
        const l = map.get(id);
        l.course = course;
        l.courseTitle = title;
        l.intro = brief[id] || l.intro;
        l.defaults = defaults[id] || {};
        l.terms = vocabulary[id] || terms[kind];
        return l;
      }),
    );
    LabCurriculum[kind].forEach((l, index) => (l.index = index));
  }
})();
