/* Run each QPDF task in a disposable worker: passwords never enter URLs or logs. */
importScripts("vendor/qpdf/qpdf.js");
self.onmessage = async ({ data }) => {
  try {
    const module = await Module({
      noInitialRun: true,
      locateFile: () =>
        new URL("vendor/qpdf/qpdf.wasm", self.location.href).href,
      print() {},
      printErr() {},
    });
    module.FS.writeFile("/input.pdf", data.bytes);
    let args;
    if (data.mode === "protect")
      args = [
        "/input.pdf",
        "--encrypt",
        data.password,
        data.owner,
        "256",
        "--",
        "/output.pdf",
      ];
    else if (data.mode === "unlock")
      args = [
        `--password=${data.password}`,
        "--decrypt",
        "/input.pdf",
        "/output.pdf",
      ];
    else if (data.mode === "web")
      args = [
        "/input.pdf",
        "--linearize",
        "--object-streams=generate",
        "/output.pdf",
      ];
    else
      args = [
        "/input.pdf",
        "--object-streams=generate",
        "--stream-data=compress",
        "/output.pdf",
      ];
    let code;
    try {
      code = module.callMain(args);
    } catch (error) {
      if (typeof error.status === "number") code = error.status;
      else throw error;
    }
    if (code !== undefined && code !== 0 && code !== 3)
      throw new Error("QPDF failed.");
    const bytes = module.FS.readFile("/output.pdf").slice();
    self.postMessage({ bytes }, [bytes.buffer]);
  } catch {
    self.postMessage({
      error:
        data.mode === "unlock"
          ? "Could not unlock this PDF. Check the password and try again."
          : "This PDF could not be processed. Try an unencrypted, valid PDF.",
    });
  }
};
