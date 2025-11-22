
import { jsPDF } from "jspdf";
import { Story } from "../types";

// Helper to wrap text on canvas for image generation
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
    const words = text.split(' ');
    let line = '';
    const lines = [];

    for(let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        lines.push(line);
        line = words[n] + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line);

    for (let k = 0; k < lines.length; k++) {
        ctx.fillText(lines[k], x, y + (k * lineHeight));
    }
}

// Helper to create an image from text (Subtitle style for Cinematic PDF)
const createSubtitleImage = (text: string, width: number): string => {
    const height = 300; // Fixed height for subtitle area
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Semi-transparent gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.4, 'rgba(0,0,0,0.6)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Text settings
    ctx.fillStyle = '#ffffff';
    ctx.font = "bold 40px 'Noto Sans Bengali', 'Comic Neue', cursive"; // Match fonts in index.html
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Draw text centered
    wrapText(ctx, text, width / 2, 80, width - 100, 50);

    return canvas.toDataURL('image/png');
};

export const generatePDF = (story: Story): Blob | null => {
  try {
    // Create a 16:9 Landscape PDF (1920x1080 px equivalent)
    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [1920, 1080]
    });
    
    const pageWidth = 1920;
    const pageHeight = 1080;
    
    // --- Title Page ---
    doc.setFillColor(253, 246, 227); // Parchment color
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    doc.setTextColor(40, 40, 40);
    doc.setFontSize(80);
    doc.text(story.title, pageWidth / 2, pageHeight / 2 - 100, { align: "center" });
    
    doc.setFontSize(40);
    doc.text(`A ${story.theme} Story`, pageWidth / 2, pageHeight / 2 + 20, { align: "center" });
    
    doc.setFontSize(30);
    doc.text(`Lesson: ${story.lesson}`, pageWidth / 2, pageHeight / 2 + 100, { align: "center" });
    
    // --- Pages ---
    story.pages.forEach((page, i) => {
        doc.addPage([1920, 1080], 'landscape');
        doc.setFillColor(0, 0, 0); // Black background
        doc.rect(0, 0, pageWidth, pageHeight, 'F');

        // Image: Cinematic Cover (16:9)
        // Since source is usually 1:1 (1024x1024), we scale to width 1920 and crop height
        if (page.imageData) {
            const imgData = `data:image/png;base64,${page.imageData}`;
            
            // Target 1920x1080
            // Source ~1024x1024
            // Scale to width 1920 => Height = 1920. 
            // Crop: y = (1920 - 1080) / 2 = 420 offset.
            
            // jsPDF doesn't handle source cropping easily with addImage.
            // We place it so it covers, potentially bleeding off page? 
            // jsPDF clips content outside the page.
            // So if we draw a 1920x1920 image at y = -420, it should work.
            
            const scale = pageWidth / 1024; // assuming ~1024 source
            const renderHeight = 1024 * scale; // ~1920
            const yOffset = (pageHeight - renderHeight) / 2;
            
            try {
                doc.addImage(imgData, 'PNG', 0, yOffset, pageWidth, renderHeight);
            } catch (e) {
                console.warn("Failed to add image to PDF", e);
            }
            
            // Text Overlay at Bottom (Cinematic Subtitle)
            const textToPrint = page.voiceoverText || page.text;
            const subtitleImg = createSubtitleImage(textToPrint, pageWidth);
            if (subtitleImg) {
                doc.addImage(subtitleImg, 'PNG', 0, pageHeight - 300, pageWidth, 300);
            }
            
            // Page Number (Subtle)
            doc.setFontSize(20);
            doc.setTextColor(255, 255, 255);
            doc.text(`${i + 1}`, pageWidth - 40, pageHeight - 40, { align: "right" });

        } else {
             // Text only fallback (Parchment style)
             doc.setFillColor(253, 246, 227);
             doc.rect(0, 0, pageWidth, pageHeight, 'F');
             doc.setTextColor(0,0,0);
             doc.setFontSize(40);
             doc.text(page.text, 100, 100);
        }
    });

    return doc.output('blob');
  } catch (e) {
    console.error("PDF Generation failed", e);
    return null;
  }
};
