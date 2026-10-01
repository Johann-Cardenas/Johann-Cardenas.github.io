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
        const grain = (seed / 4294967296 - .5) * (kind === 'asphalt' ? 28 : 16);
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
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

export function skyTexture(kind) {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, kind === 'sunset' ? '#525a86' : '#5c9dd0');
    gradient.addColorStop(.65, kind === 'sunset' ? '#d6a098' : '#c7deef');
    gradient.addColorStop(1, kind === 'sunset' ? '#f0d0b5' : '#eef3f5');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 16, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
