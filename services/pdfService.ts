
import { jsPDF } from "jspdf";
import { Story } from "../types";

export const generatePDF = (story: Story) => {
  try {
    const doc = new jsPDF();
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 20;
    const imageWidth = pageWidth - (margin * 2);
    const imageHeight = imageWidth * (9/16); 
    
    // Title Page
    doc.setFont("times", "bold");
    doc.setFontSize(24);
    const titleLines = doc.splitTextToSize(story.title, pageWidth - 40);
    doc.text(titleLines, pageWidth / 2, 60, { align: "center" });
    
    doc.setFontSize(12);
    doc.text(`Theme: ${story.theme || 'Classic'}`, pageWidth / 2, 90, { align: "center" });
    doc.setFontSize(14);
    doc.text(`Lesson: ${story.lesson}`, pageWidth / 2, 110, { align: "center" });
    
    doc.setFontSize(10);
    doc.text("Created with DreamWeaver AI", pageWidth / 2, 270, { align: "center" });

    // Pages
    story.pages.forEach((page, i) => {
        doc.addPage();
        
        if (page.imageData) {
            const imgData = `data:image/png;base64,${page.imageData}`;
            try {
               doc.addImage(imgData, 'PNG', margin, margin, imageWidth, imageHeight);
            } catch (e) {
                console.warn("Failed to add image to PDF", e);
            }
        }

        const textY = page.imageData ? margin + imageHeight + 20 : margin;
        
        // Story Text
        doc.setFontSize(14);
        doc.setFont("times", "normal");
        const textToPrint = page.voiceoverText || page.text;
        const splitText = doc.splitTextToSize(textToPrint, imageWidth);
        doc.text(splitText, margin, textY);
        
        // Footer
        doc.setFontSize(10);
        doc.text(`- ${i + 1} -`, pageWidth / 2, 280, { align: "center" });
    });

    doc.save(`${story.title.replace(/[^a-z0-9]/gi, '_')}.pdf`);
    return true;
  } catch (e) {
    console.error("PDF Generation failed", e);
    return false;
  }
};
