importScripts("models.js");
self.onmessage = ({ data }) => {
  try {
    if (data.action === "convergence")
      self.postMessage({
        id: data.id,
        results: [1, 2, 3, 4, 6, 8].map((density) => {
          const r = LabModels.solveFE({ ...data.options, density });
          return {
            density,
            tip: Math.abs(r.tip),
            dofs: r.dofs,
            converged: r.converged,
          };
        }),
      });
    else
      self.postMessage({
        id: data.id,
        result: LabModels.solveFE(data.options),
      });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
