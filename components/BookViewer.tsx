
import React, { useState, useEffect, useRef } from 'react';
import { Story, StoryPage, Character } from '../types';
import { generateImageForPage, editImageWithPrompt, generatePageAudio } from '../services/geminiService';
import { ChevronLeft, ChevronRight, Wand2, RefreshCw, AlertCircle, Download, Volume2, VolumeX, PlayCircle, PauseCircle, Undo2 } from 'lucide-react';
import { jsPDF } from "jspdf";

interface BookViewerProps {
  story: Story;
  characters: Character[];
  onReset: () => void;
}

// Helper to decode raw PCM data from Gemini
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const BookViewer: React.FC<BookViewerProps> = ({ story, characters, onReset }) => {
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [pages, setPages] = useState<StoryPage[]>(story.pages);
  const [isEditing, setIsEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [isProcessingEdit, setIsProcessingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isAutoPlay, setIsAutoPlay] = useState(true);
  
  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Function to safely update a page
  const updatePage = (index: number, updates: Partial<StoryPage>) => {
    setPages(prev => prev.map((p, i) => i === index ? { ...p, ...updates } : p));
  };

  const triggerGeneration = (index: number) => {
    const page = pages[index];
    
    // Image Generation
    if (!page.imageData && !page.isGeneratingImage) {
      updatePage(index, { isGeneratingImage: true, hasError: false });
      
      // Use the first uploaded character as the reference (or handle multiple later)
      const characterRef = characters.length > 0 ? characters[0].imageData : undefined;

      generateImageForPage(page.imagePrompt, characterRef, story.theme)
        .then(base64 => {
          updatePage(index, { imageData: base64, isGeneratingImage: false, hasError: false });
        })
        .catch(err => {
          console.error(`Failed to generate image for page ${index + 1}`, err);
          updatePage(index, { isGeneratingImage: false, hasError: true });
        });
    }

    // Audio Generation
    // Use voiceoverText if available, fallback to text
    const textToSpeak = page.voiceoverText || page.text;
    if (!page.audioData && !page.isGeneratingAudio) {
       updatePage(index, { isGeneratingAudio: true });
       generatePageAudio(textToSpeak, story.language)
        .then(audioBase64 => {
           updatePage(index, { audioData: audioBase64, isGeneratingAudio: false });
        })
        .catch(err => {
           console.error(`Failed to generate audio for page ${index + 1}`, err);
           updatePage(index, { isGeneratingAudio: false });
        });
    }
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) { /* ignore */ }
      audioSourceRef.current = null;
    }
    setIsPlayingAudio(false);
  };

  const handleNext = () => {
    if (currentPageIndex < pages.length - 1) {
      setCurrentPageIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex(prev => prev - 1);
    }
  };

  const playPageAudio = async (base64Audio: string) => {
    try {
      stopAudio();

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const audioBuffer = await decodeAudioData(
        decode(base64Audio),
        audioContextRef.current,
        24000,
        1
      );

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      
      source.onended = () => {
        setIsPlayingAudio(false);
        if (isAutoPlay) {
           setTimeout(() => {
               setPages(currentPages => currentPages); // sync
               setCurrentPageIndex(prev => {
                 if (prev < pages.length - 1) return prev + 1;
                 return prev;
               });
           }, 800); // Slightly longer pause for dramatic effect
        }
      };
      
      audioSourceRef.current = source;
      source.start();
      setIsPlayingAudio(true);
    } catch (error) {
      console.error("Failed to play audio", error);
      setIsPlayingAudio(false);
    }
  };

  useEffect(() => {
    const indicesToLoad = [currentPageIndex, currentPageIndex + 1, currentPageIndex + 2].filter(i => i < pages.length);
    indicesToLoad.forEach(index => triggerGeneration(index));

    stopAudio();
    const currentPage = pages[currentPageIndex];
    
    let audioTimer: ReturnType<typeof setTimeout>;

    if (currentPage.audioData) {
        audioTimer = setTimeout(() => playPageAudio(currentPage.audioData!), 500);
    }
    
    return () => {
        clearTimeout(audioTimer);
        stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, pages[currentPageIndex].audioData]); 

  useEffect(() => {
    return () => stopAudio();
  }, []);

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);

    if (!editPrompt.trim() || !pages[currentPageIndex].imageData) return;

    setIsProcessingEdit(true);
    try {
      const newImage = await editImageWithPrompt(pages[currentPageIndex].imageData!, editPrompt);
      updatePage(currentPageIndex, { imageData: newImage });
      setEditPrompt('');
      setIsEditing(false);
    } catch (error) {
      console.error("Edit failed", error);
      setEditError("Couldn't transform the image. Gemini might be busy or the request was filtered. Try a simpler prompt.");
    } finally {
      setIsProcessingEdit(false);
    }
  };

  const handleRegenerateCurrent = () => {
     const index = currentPageIndex;
     updatePage(index, { imageData: undefined, isGeneratingImage: false, hasError: false });
     setTimeout(() => triggerGeneration(index), 0);
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
        const doc = new jsPDF();
        const pageWidth = 210;
        const margin = 20;
        const imageWidth = pageWidth - (margin * 2);
        const imageHeight = imageWidth * (9/16); 
        
        // Title Page
        doc.setFont("times", "bold");
        doc.setFontSize(24);
        doc.text(story.title, pageWidth / 2, 50, { align: "center" });
        doc.setFontSize(12);
        doc.text(`Theme: ${story.theme}`, pageWidth / 2, 65, { align: "center" });
        doc.setFontSize(14);
        doc.text(`Lesson: ${story.lesson}`, pageWidth / 2, 80, { align: "center" });

        // Pages
        for (let i = 0; i < pages.length; i++) {
            doc.addPage();
            const page = pages[i];
            
            if (page.imageData) {
                const imgData = `data:image/png;base64,${page.imageData}`;
                try {
                   doc.addImage(imgData, 'PNG', margin, margin, imageWidth, imageHeight);
                } catch (e) { /* ignore */ }
            }

            const textY = page.imageData ? margin + imageHeight + 20 : margin;
            doc.setFontSize(12);
            doc.setFont("times", "normal");
            
            // Use full voiceover text for PDF if user wants full story, or short text? 
            // Usually stories are better read fully. Let's use voiceoverText if available.
            const textToPrint = page.voiceoverText || page.text;
            const splitText = doc.splitTextToSize(textToPrint, imageWidth);
            doc.text(splitText, margin, textY);
            
            doc.setFontSize(10);
            doc.text(`- ${i + 1} -`, pageWidth / 2, 280, { align: "center" });
        }

        doc.save("DreamWeaverStory.pdf");
    } catch (e) {
        alert("Could not generate PDF. Please try again when all images are loaded.");
    } finally {
        setIsExporting(false);
    }
  };

  const toggleAudio = () => {
    if (isPlayingAudio) {
        stopAudio();
    } else if (pages[currentPageIndex].audioData) {
        playPageAudio(pages[currentPageIndex].audioData!);
    }
  };

  const currentPage = pages[currentPageIndex];
  const progress = ((currentPageIndex + 1) / pages.length) * 100;

  return (
    <div className="flex flex-col items-center justify-center min-h-full w-full max-w-6xl mx-auto p-4 gap-6">
      
      {/* Header */}
      <div className="w-full flex justify-between items-center text-slate-600">
        <button onClick={onReset} className="hover:text-magic-blue transition-colors flex items-center gap-2 font-comic font-bold">
          &larr; New
        </button>
        <h1 className="text-xl font-story font-bold truncate max-w-md text-center hidden md:block" title={story.title}>
          {story.title}
        </h1>
        <div className="flex items-center gap-2 md:gap-4">
            <button 
              onClick={() => setIsAutoPlay(!isAutoPlay)}
              className={`flex items-center gap-2 text-sm font-bold px-3 py-1 rounded-full transition-colors ${isAutoPlay ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}
            >
              {isAutoPlay ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
              <span className="hidden md:inline">Auto-Flip</span>
            </button>
            <button 
                onClick={handleExportPDF}
                disabled={isExporting}
                className="flex items-center gap-2 text-sm font-bold text-magic-purple hover:bg-purple-50 px-3 py-1 rounded-full transition-colors"
            >
                {isExporting ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}
                <span className="hidden md:inline">PDF</span>
            </button>
        </div>
      </div>

      {/* Book View */}
      <div className="relative w-full aspect-[16/10] md:aspect-[16/9] bg-parchment rounded-lg shadow-2xl book-shadow overflow-hidden flex flex-col md:flex-row border-r-8 border-r-slate-800/10 border-b-8 border-b-slate-800/10 transform transition-all duration-500 hover:scale-[1.01]">
        
        {/* Left: Image */}
        <div className="w-full md:w-2/3 h-1/2 md:h-full relative bg-slate-200 flex items-center justify-center overflow-hidden group">
          {currentPage.imageData ? (
            <>
                <div className="w-full h-full overflow-hidden perspective-1000">
                    <img 
                        src={`data:image/png;base64,${currentPage.imageData}`} 
                        alt="Story illustration"
                        className="w-full h-full object-cover animate-ken-burns"
                    />
                </div>
                
                <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                     <button 
                        onClick={() => setIsEditing(!isEditing)}
                        className="bg-white/90 p-2 rounded-full shadow-lg hover:bg-white text-magic-purple transition-all"
                        title="Edit Image"
                    >
                        <Wand2 size={20} />
                    </button>
                    <button 
                        onClick={handleRegenerateCurrent}
                        className="bg-white/90 p-2 rounded-full shadow-lg hover:bg-white text-slate-700 transition-all"
                        title="Regenerate"
                    >
                        <RefreshCw size={20} />
                    </button>
                </div>

                {isEditing && (
                    <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md p-4 border-t border-slate-200 animate-in slide-in-from-bottom-10 fade-in z-20">
                        <h3 className="font-bold text-sm text-slate-700 mb-2">Magic Edit</h3>
                        <form onSubmit={handleEditSubmit} className="flex gap-2">
                            <input 
                                type="text" 
                                value={editPrompt}
                                onChange={(e) => setEditPrompt(e.target.value)}
                                placeholder="What should change? (e.g., 'Make the sky pink')"
                                className="flex-1 px-4 py-2 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-magic-purple font-comic text-sm"
                                autoFocus
                            />
                            <button 
                                type="submit" 
                                disabled={isProcessingEdit || !editPrompt.trim()}
                                className="bg-magic-purple text-white px-4 py-2 rounded font-bold hover:bg-opacity-90 disabled:opacity-50 flex items-center gap-2 text-sm whitespace-nowrap"
                            >
                                {isProcessingEdit ? <RefreshCw className="animate-spin" size={14}/> : <Wand2 size={14}/>}
                                Go
                            </button>
                            <button 
                                type="button" 
                                onClick={() => { setIsEditing(false); setEditError(null); }}
                                className="text-slate-500 px-2 hover:text-slate-700 text-sm"
                            >
                                <Undo2 size={18} />
                            </button>
                        </form>
                        {editError && (
                             <div className="mt-2 flex items-center gap-2 text-red-500 text-xs font-bold bg-red-50 p-2 rounded">
                                <AlertCircle size={14} /> {editError}
                             </div>
                        )}
                    </div>
                )}
            </>
          ) : (
            <div className="text-center p-8 text-slate-400 w-full h-full flex items-center justify-center">
              {currentPage.isGeneratingImage ? (
                 <div className="flex flex-col items-center gap-4 animate-pulse">
                    <Wand2 className="animate-spin text-magic-blue" size={48} />
                    <p className="font-comic text-lg">Painting in {story.theme} style...</p>
                 </div>
              ) : currentPage.hasError ? (
                 <div className="flex flex-col items-center gap-4">
                    <AlertCircle className="text-red-400" size={48} />
                    <p className="text-slate-600 max-w-xs text-center">Failed to paint.</p>
                    <button onClick={() => triggerGeneration(currentPageIndex)} className="px-4 py-2 bg-magic-blue text-white rounded-full font-bold text-sm">
                       Retry
                    </button>
                 </div>
              ) : (
                 <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 bg-slate-200 rounded-full animate-bounce"></div>
                    <p className="text-sm">Queued...</p>
                 </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Text */}
        <div className="w-full md:w-1/3 h-1/2 md:h-full bg-parchment p-6 md:p-8 flex flex-col justify-between relative z-0">
           <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-yellow-100/50 to-transparent rounded-bl-full pointer-events-none"></div>
           
           <div className="flex-1 flex flex-col justify-center">
                {/* We show the SHORT text for reading, while audio plays long version */}
                <p className="font-story text-lg md:text-xl leading-relaxed text-slate-800">
                    {currentPage.text}
                </p>
                
                <div className="mt-6 flex justify-center md:justify-start">
                    <button 
                        onClick={toggleAudio}
                        className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold transition-all ${
                            isPlayingAudio 
                                ? "bg-magic-blue text-white shadow-md scale-105" 
                                : currentPage.audioData 
                                    ? "bg-slate-200 text-slate-600 hover:bg-slate-300" 
                                    : "opacity-50 cursor-wait"
                        }`}
                        disabled={!currentPage.audioData}
                    >
                        {isPlayingAudio ? <Volume2 size={16} className="animate-pulse"/> : <VolumeX size={16}/>}
                        {isPlayingAudio ? "Narrating..." : "Play"}
                    </button>
                </div>
           </div>

           <div className="mt-4 text-center flex justify-center">
                <span className="inline-block w-8 h-8 leading-8 rounded-full bg-slate-800 text-white font-bold font-comic shadow-md text-sm">
                    {currentPageIndex + 1}
                </span>
           </div>
        </div>
      </div>

      {/* Controls */}
      <div className="w-full flex justify-between items-center max-w-4xl">
        <button 
            onClick={handlePrev} 
            disabled={currentPageIndex === 0}
            className="p-4 rounded-full bg-white shadow-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 hover:scale-110 transition-all text-magic-blue"
        >
            <ChevronLeft size={32} />
        </button>

        <div className="flex-1 mx-8 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div 
                className="h-full bg-magic-blue transition-all duration-500"
                style={{ width: `${progress}%` }}
            ></div>
        </div>

        <button 
            onClick={handleNext} 
            disabled={currentPageIndex === pages.length - 1}
            className="p-4 rounded-full bg-white shadow-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 hover:scale-110 transition-all text-magic-blue"
        >
            <ChevronRight size={32} />
        </button>
      </div>
    </div>
  );
};
