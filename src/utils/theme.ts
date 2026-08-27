export interface BrutalTheme {
  brutalBlack: string;
  brutalWhite: string;
  brutalNeon: string;
}

export async function extractBrutalTheme(imageUrl: string, isLightMode: boolean): Promise<BrutalTheme | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (!imageUrl.startsWith('blob:')) {
      img.crossOrigin = 'Anonymous';
    }
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      
      // Scale down for faster pixel processing
      canvas.width = 64;
      canvas.height = 64;
      ctx.drawImage(img, 0, 0, 64, 64);
      
      try {
        const imageData = ctx.getImageData(0, 0, 64, 64).data;
        let r = 0, g = 0, b = 0;
        let count = 0;
        
        let maxS = -1;
        let bestR = 0, bestG = 0, bestB = 0;
        
        for (let i = 0; i < imageData.length; i += 4) {
          if (imageData[i + 3] < 128) continue;
          
          const cr = imageData[i];
          const cg = imageData[i + 1];
          const cb = imageData[i + 2];
          
          r += cr;
          g += cg;
          b += cb;
          count++;
          
          // Find the most saturated colorful pixel
          const [, currS] = rgbToHsl(cr, cg, cb);
          if (currS > maxS) {
            maxS = currS;
            bestR = cr;
            bestG = cg;
            bestB = cb;
          }
        }
        
        if (count === 0) {
          console.warn("[Theme] Image was entirely transparent or empty.");
          resolve(null);
          return;
        }
        
        // Use average color for background, but if best pixel is highly saturated, mix it in
        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);
        
        // If the average is very gray, but we have a colorful pixel, lean towards colorful
        const [avgH, avgS] = rgbToHsl(r, g, b);
        let finalH = avgH;
        let finalS = avgS;
        
        if (avgS < 15 && maxS > 30) {
           const [bestH] = rgbToHsl(bestR, bestG, bestB);
           finalH = bestH;
           finalS = maxS;
        } else if (avgS < 10 && maxS <= 30) {
           // Grayscale cover, fallback to brutal green hue (135)
           finalH = 135;
           finalS = 0; // will boost later
        }

        console.log(`[Theme] Extracted raw HSL: ${finalH}, ${finalS}`);

        // Brutalist theme logic:
        const accentH = finalH;
        // Boost saturation for the neon effect unless it's perfectly gray
        const accentS = finalS < 5 ? 100 : Math.max(finalS, 75); 
        const accentL = 55;
        const brutalNeon = `hsl(${Math.round(accentH)}, ${Math.round(accentS)}%, ${Math.round(accentL)}%)`;
        
        let brutalBlack, brutalWhite;
        
        if (!isLightMode) {
          brutalBlack = `hsl(${Math.round(finalH)}, ${Math.round(finalS * 0.4)}%, 6%)`;
          brutalWhite = `hsl(${Math.round(finalH)}, ${Math.round(finalS * 0.2)}%, 92%)`;
        } else {
          brutalBlack = `hsl(${Math.round(finalH)}, ${Math.round(finalS * 0.3)}%, 94%)`;
          brutalWhite = `hsl(${Math.round(finalH)}, ${Math.round(finalS * 0.5)}%, 8%)`;
        }
        
        console.log(`[Theme] Colors applied - Neon: ${brutalNeon}`);
        resolve({
          brutalBlack,
          brutalWhite,
          brutalNeon,
        });
        
      } catch (e) {
        console.error("Error extracting colors:", e);
        resolve(null);
      }
    };
    
    img.onerror = () => {
      resolve(null);
    };
    
    img.src = imageUrl;
  });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}
