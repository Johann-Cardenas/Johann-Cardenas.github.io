import * as THREE from 'three';

/** Small deterministic textures; no downloads or engineering geometry. */
export function surfaceTexture(kind) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(256, 256);
    let seed = 406;
    for (let i = 0; i < image.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const x=(i/4)%256, y=Math.floor(i/1024);
        const aggregate=seed/4294967296;
        const mottling=Math.sin(x*.049)*Math.cos(y*.037)*4;
        const grain = (aggregate - .5) * (kind === 'asphalt' ? 34 : 18) + mottling;
        const base = kind === 'asphalt' ? 62 : 183;
        image.data[i] = base + grain;
        image.data[i + 1] = base + grain;
        image.data[i + 2] = base + grain - (kind === 'concrete' ? 5 : 0);
        image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    if (kind === 'concrete') {
        ctx.strokeStyle = '#777972'; ctx.lineWidth = 1.5;
        ctx.strokeRect(.75, .75, 254.5, 254.5);
        ctx.strokeStyle = '#deded5'; ctx.lineWidth = 1;
        ctx.strokeRect(2, 2, 252, 252);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

export function skyTexture(kind,clouds='clear') {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, kind === 'sunset' ? '#525a86' : '#5c9dd0');
    gradient.addColorStop(.65, kind === 'sunset' ? '#d6a098' : '#c7deef');
    gradient.addColorStop(1, kind === 'sunset' ? '#f0d0b5' : '#eef3f5');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 256);
    if(clouds!=='clear') {
        for(let i=0;i<12;i++) {
            const x=(i*137+23)%512,y=35+(i*43)%130;
            const glow=ctx.createRadialGradient(x,y,0,x,y,55+(i%3)*20);
            glow.addColorStop(0,clouds==='overcast'?'rgba(242,245,249,.5)':'rgba(255,255,255,.28)');
            glow.addColorStop(1,'rgba(255,255,255,0)');
            ctx.fillStyle=glow;ctx.fillRect(0,0,512,256);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
