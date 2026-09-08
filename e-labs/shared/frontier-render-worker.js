/* Image preparation runs off the UI thread; playback times remain synthetic. */
importScripts("frontier-models.js" + self.location.search);
self.onmessage = ({data}) => {
  try {
    const pixels=FrontierModels.renderImage(data.visual,data.resolution);
    self.postMessage({id:data.id,pixels},[pixels.buffer]);
  } catch(error) { self.postMessage({id:data.id,error:error.message}); }
};
