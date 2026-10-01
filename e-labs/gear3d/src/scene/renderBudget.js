/** Live-view budgets; figure exports retain their requested resolution. */
export function liveRenderRatio({width,height,dpr=1,targetPx=3840,maxRatio=4,gpuLimit=16384,mobile=false,moving=false}) {
    const area=Math.max(1,width*height);
    const wanted=Math.max(dpr,targetPx/Math.max(1,width));
    const pixelCap=mobile?Math.sqrt((moving?750000:1500000)/area):Infinity;
    const interactionCap=moving?(mobile?1.25:Math.max(1.25,dpr)):Infinity;
    return Math.max(mobile?0.1:1,Math.min(wanted,maxRatio,mobile?2:Infinity,pixelCap,interactionCap,gpuLimit/Math.max(1,width,height)));
}

export function mobileViewport(width,coarsePointer=false) {
    return coarsePointer || width<600;
}

/** Auto favors interaction on compact/touch views; explicit detail always wins. */
export function liveGeometryQuality(requested,tireCount,mobile=false) {
    if(mobile && (!requested || requested==='auto')) return tireCount>8?'draft':'standard';
    return requested;
}
