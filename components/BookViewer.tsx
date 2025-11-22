
import React, { useState, useEffect, useRef } from 'react';
import { Story, StoryPage, Character } from '../types';
import { generateImageForPage, editImageWithPrompt, generatePageAudio } from '../services/geminiService';
import { generatePDF } from '../services/pdfService';
import { saveStoryToDB } from '../services/db';
import { isSignedIn, uploadFileToDrive } from '../services/googleDriveService';
import { ChevronLeft, ChevronRight, Wand2, RefreshCw, AlertCircle, Download, Volume2, VolumeX, Play, Pause, Undo2, Pencil, Video, User, UserX, Cloud } from 'lucide-react';

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

// Helper to wrap text on canvas
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

    // Draw lines centered
    for (let k = 0; k < lines.length; k++) {
        ctx.fillText(lines[k], x, y + (k * lineHeight));
    }
    return lines.length * lineHeight;
}

export const BookViewer: React.FC<BookViewerProps> = ({ story, characters, onReset }) => {
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [pages, setPages] = useState<StoryPage[]>(story.pages);
  const [isEditing, setIsEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [isProcessingEdit, setIsProcessingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isAutoPlay, setIsAutoPlay] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [driveStatus, setDriveStatus] = useState<string | null>(null);

  // Character Selection State (PageIndex -> CharacterID)
  const [pageCharacterSelections, setPageCharacterSelections] = useState<Record<number, string>>({});

  // Text Editing State
  const [isEditingText, setIsEditingText] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [editedVoiceover, setEditedVoiceover] = useState('');
  
  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Save changes to DB
  const persistChanges = async (updatedPages: StoryPage[]) => {
    setSaveStatus('saving');
    try {
        await saveStoryToDB({ ...story, pages: updatedPages });
        setSaveStatus('saved');
    } catch (e) {
        console.error("Failed to auto-save story", e);
        setSaveStatus('error');
    }
  };

  // Function to safely update a page
  const updatePage = (index: number, updates: Partial<StoryPage>) => {
    setPages(prev => {
        const newPages = prev.map((p, i) => i === index ? { ...p, ...updates } : p);
        persistChanges(newPages);
        return newPages;
    });
  };

  const getSelectedCharacterForPage = (index: number) => {
    const selectedId = pageCharacterSelections[index];
    if (selectedId === 'none') return undefined;

    if (selectedId) {
        return characters.find(c => c.id === selectedId);
    }
    // Default to first character if available
    return characters.length > 0 ? characters[0] : undefined;
  };

  const triggerGeneration = (index: number) => {
    const page = pages[index];
    
    // Image Generation
    if (!page.imageData && !page.isGeneratingImage) {
      updatePage(index, { isGeneratingImage: true, hasError: false });
      
      const selectedChar = getSelectedCharacterForPage(index);
      const characterRef = selectedChar?.imageData;

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
      setIsEditingText(false);
    }
  };

  const handlePrev = () => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex(prev => prev - 1);
      setIsEditingText(false);
    }
  };

  const handleCharacterSelect = (charId: string) => {
    setPageCharacterSelections(prev => ({
        ...prev,
        [currentPageIndex]: charId
    }));
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
        if (isAutoPlay && !isEditingText && !isEditing) {
           setTimeout(() => {
               setPages(currentPages => currentPages); // sync
               setCurrentPageIndex(prev => {
                 if (prev < pages.length - 1) return prev + 1;
                 return prev;
               });
           }, 800);
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

    if (currentPage.audioData && !isEditingText && !isEditing && isAutoPlay) {
        audioTimer = setTimeout(() => playPageAudio(currentPage.audioData!), 500);
    }
    
    return () => {
        clearTimeout(audioTimer);
        stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, pages[currentPageIndex].audioData, isAutoPlay]); 

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
      setEditError("Couldn't transform the image. Gemini might be busy or the request was filtered.");
    } finally {
      setIsProcessingEdit(false);
    }
  };

  const handleStartTextEdit = () => {
    setIsAutoPlay(false);
    stopAudio();
    const page = pages[currentPageIndex];
    setEditedText(page.text);
    setEditedVoiceover(page.voiceoverText || page.text);
    setIsEditingText(true);
  };

  const handleStartImageEdit = () => {
      setIsAutoPlay(false);
      stopAudio();
      setIsEditing(!isEditing);
  }

  const handleSaveTextEdit = () => {
    const page = pages[currentPageIndex];
    const updates: Partial<StoryPage> = {
        text: editedText,
        voiceoverText: editedVoiceover
    };

    if (editedVoiceover !== (page.voiceoverText || page.text)) {
        updates.audioData = undefined;
        updates.isGeneratingAudio = false;
    }

    updatePage(currentPageIndex, updates);
    setIsEditingText(false);
  };

  const handleRegenerateCurrent = () => {
     setIsAutoPlay(false);
     stopAudio();
     const index = currentPageIndex;
     updatePage(index, { imageData: undefined, isGeneratingImage: false, hasError: false });
     setTimeout(() => triggerGeneration(index), 0);
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    setDriveStatus(null);
    try {
        const blob = generatePDF({ ...story, pages });
        if (!blob) throw new Error("PDF failed");
        
        // Download Local
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${story.title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Upload to Drive if connected
        if (isSignedIn()) {
            setDriveStatus('Uploading to Drive...');
            await uploadFileToDrive(blob, `${story.title}.pdf`, 'application/pdf');
            setDriveStatus('Saved to Drive!');
            setTimeout(() => setDriveStatus(null), 3000);
        }

    } catch (e) {
        alert("Could not generate PDF.");
    } finally {
        setIsExporting(false);
    }
  };

  const handleExportVideo = async () => {
    setIsExportingVideo(true);
    setExportProgress(0);
    setDriveStatus(null);
    stopAudio();

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not create canvas context");

      const exportAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
      const dest = exportAudioCtx.createMediaStreamDestination();
      
      const canvasStream = canvas.captureStream(30); 
      
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
      const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 8000000 });
      const chunks: Blob[] = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.start();

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        setExportProgress(Math.round(((i) / pages.length) * 100));

        let img: HTMLImageElement | null = null;
        if (page.imageData) {
           img = new Image();
           img.src = `data:image/png;base64,${page.imageData}`;
           await new Promise((r) => img!.onload = r);
        }

        let audioBuffer: AudioBuffer | null = null;
        let duration = 3; 
        
        if (page.audioData) {
           // Use 24000 Hz as the source rate to maintain correct speed
           audioBuffer = await decodeAudioData(decode(page.audioData), exportAudioCtx, 24000, 1);
           duration = audioBuffer.duration;
        } else {
           const wordCount = (page.voiceoverText || page.text).split(' ').length;
           duration = (wordCount * 0.3) + 2;
        }

        if (audioBuffer) {
           const source = exportAudioCtx.createBufferSource();
           source.buffer = audioBuffer;
           source.connect(dest);
           source.start(exportAudioCtx.currentTime);
        }

        const startTime = Date.now();
        const durationMs = duration * 1000;
        
        while (Date.now() - startTime < durationMs) {
           const elapsed = Date.now() - startTime;
           const progress = elapsed / durationMs;
           
           // Draw Background
           ctx.fillStyle = '#000';
           ctx.fillRect(0, 0, canvas.width, canvas.height);

           if (img) {
              // 16:9 Cover Logic with Zoom
              const scaleX = canvas.width / img.width;
              const scaleY = canvas.height / img.height;
              const baseScale = Math.max(scaleX, scaleY);
              
              const zoomScale = baseScale * (1 + (progress * 0.05)); // Ken Burns Zoom
              
              const w = img.width * zoomScale;
              const h = img.height * zoomScale;
              const x = (canvas.width - w) / 2;
              const y = (canvas.height - h) / 2;
              
              ctx.drawImage(img, x, y, w, h);
           }

           // Cinematic Subtitle Overlay
           const text = page.text; 
           const gradient = ctx.createLinearGradient(0, canvas.height - 300, 0, canvas.height);
           gradient.addColorStop(0, 'rgba(0,0,0,0)');
           gradient.addColorStop(0.4, 'rgba(0,0,0,0.7)');
           gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
           ctx.fillStyle = gradient;
           ctx.fillRect(0, canvas.height - 300, canvas.width, 300);

           ctx.font = 'bold 48px "Noto Sans Bengali", "Comic Neue", cursive'; 
           ctx.fillStyle = '#ffffff';
           ctx.textAlign = 'center';
           ctx.shadowColor = 'rgba(0,0,0,0.8)';
           ctx.shadowBlur = 10;
           ctx.shadowOffsetX = 2;
           ctx.shadowOffsetY = 2;
           
           wrapText(ctx, text, canvas.width / 2, canvas.height - 120, canvas.width - 200, 60);

           await new Promise(r => setTimeout(r, 33));
        }
      }

      recorder.stop();
      
      await new Promise<void>(resolve => {
          recorder.onstop = () => resolve();
      });

      const blob = new Blob(chunks, { type: mimeType });
      
      // Download Local
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${story.title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Upload to Drive
      if (isSignedIn()) {
          setDriveStatus('Uploading MP4 to Drive...');
          await uploadFileToDrive(blob, `${story.title}.mp4`, mimeType);
          setDriveStatus('Saved to Drive!');
          setTimeout(() => setDriveStatus(null), 3000);
      }

    } catch (e) {
       console.error("Export video failed", e);
       alert("Failed to create video.");
    } finally {
      setIsExportingVideo(false);
      setExportProgress(0);
    }
  };

  const toggleAudio = () => {
    if (isPlayingAudio) {
        stopAudio();
    } else if (pages[currentPageIndex].audioData) {
        playPageAudio(pages[currentPageIndex].audioData!);
    }
  };

  const togglePlayPause = () => {
      if (isAutoPlay) {
          setIsAutoPlay(false);
          stopAudio();
      } else {
          setIsAutoPlay(true);
          if (!isPlayingAudio && pages[currentPageIndex].audioData) {
              playPageAudio(pages[currentPageIndex].audioData!);
          }
      }
  };

  const currentPage = pages[currentPageIndex];
  const progress = ((currentPageIndex + 1) / pages.length) * 100;

  const currentSelectedCharId = pageCharacterSelections[currentPageIndex] !== undefined 
    ? pageCharacterSelections[currentPageIndex] 
    : (characters.length > 0 ? characters[0].id : 'none');

  return (
    <div className="flex flex-col items-center justify-center min-h-full w-full max-w-6xl mx-auto p-4 gap-6">
      
      {/* Header */}
      <div className="w-full flex flex-wrap justify-between items-center text-slate-600 gap-4">
        <button onClick={onReset} className="hover:text-magic-blue transition-colors flex items-center gap-2 font-comic font-bold bg-white px-3 py-1 rounded-full shadow-sm">
          &larr; Back
        </button>
        
        <h1 className="text-xl font-story font-bold truncate max-w-xs md:max-w-md text-center" title={story.title}>
          {story.title}
        </h1>
        
        <div className="flex items-center gap-2 md:gap-4 overflow-x-auto">
            {saveStatus === 'saving' && <span className="text-xs text-slate-400 animate-pulse">Saving...</span>}
            {driveStatus && (
                <span className="text-xs font-bold text-green-600 animate-pulse flex items-center gap-1">
                    <Cloud size={12} /> {driveStatus}
                </span>
            )}
            
            <button 
                onClick={handleExportPDF}
                disabled={isExporting || isExportingVideo}
                className="flex items-center gap-2 text-sm font-bold text-magic-purple hover:bg-purple-50 px-3 py-1 rounded-full transition-colors disabled:opacity-50 whitespace-nowrap"
            >
                {isExporting ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}
                <span className="hidden md:inline">PDF</span>
            </button>
            <button 
                onClick={handleExportVideo}
                disabled={isExporting || isExportingVideo}
                className="flex items-center gap-2 text-sm font-bold text-red-500 hover:bg-red-50 px-3 py-1 rounded-full transition-colors disabled:opacity-50 whitespace-nowrap"
            >
                {isExportingVideo ? (
                  <div className="flex items-center gap-2">
                    <RefreshCw className="animate-spin" size={16} />
                    <span>{exportProgress}%</span>
                  </div>
                ) : (
                  <>
                    <Video size={16} />
                    <span className="hidden md:inline">MP4</span>
                  </>
                )}
            </button>
        </div>
      </div>

      {/* Controls Bar - Top */}
      <div className="flex items-center gap-4 bg-white px-6 py-2 rounded-full shadow-lg">
          <button 
             onClick={handlePrev} 
             disabled={currentPageIndex === 0}
             className="text-slate-400 hover:text-magic-blue disabled:opacity-30"
          >
             <ChevronLeft size={28} />
          </button>

          <button 
             onClick={togglePlayPause}
             className={`w-12 h-12 rounded-full flex items-center justify-center shadow-md transition-all ${isAutoPlay ? 'bg-amber-100 text-amber-600' : 'bg-magic-blue text-white hover:scale-105'}`}
             title={isAutoPlay ? "Pause Auto-Play to Edit" : "Start Auto-Play"}
          >
             {isAutoPlay ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
          </button>

          <button 
             onClick={handleNext} 
             disabled={currentPageIndex === pages.length - 1}
             className="text-slate-400 hover:text-magic-blue disabled:opacity-30"
          >
             <ChevronRight size={28} />
          </button>
      </div>

      {/* Book View - Animated Container */}
      <div 
        key={currentPageIndex} 
        className="relative w-full aspect-[16/10] md:aspect-[16/9] bg-parchment rounded-lg shadow-2xl book-shadow overflow-hidden flex flex-col md:flex-row border-r-8 border-r-slate-800/10 border-b-8 border-b-slate-800/10 animate-page-enter"
      >
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
                        onClick={handleStartImageEdit}
                        className="bg-white/90 p-2 rounded-full shadow-lg hover:bg-white text-magic-purple transition-all"
                        title="Edit Image (Pauses Story)"
                    >
                        <Wand2 size={20} />
                    </button>
                    <button 
                        onClick={handleRegenerateCurrent}
                        className="bg-white/90 p-2 rounded-full shadow-lg hover:bg-white text-slate-700 transition-all"
                        title="Regenerate (Pauses Story)"
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
                                placeholder="e.g., 'Make the sky pink'"
                                className="flex-1 px-4 py-2 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-magic-purple font-comic text-sm bg-white text-slate-900"
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

          {/* Character Selector Overlay */}
          {characters.length > 0 && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center gap-2">
                <div className="bg-white/90 backdrop-blur-sm rounded-full shadow-lg p-1.5 flex items-center gap-2 border border-slate-200">
                    {/* None Option */}
                    <button
                        onClick={() => handleCharacterSelect('none')}
                        className={`relative w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${currentSelectedCharId === 'none' ? 'border-slate-400 bg-slate-100 text-slate-500' : 'border-transparent text-slate-400 hover:bg-slate-100'}`}
                        title="No Character"
                    >
                        <UserX size={16} />
                    </button>
                    <div className="w-px h-6 bg-slate-300"></div>
                    {characters.map(char => (
                        <button
                            key={char.id}
                            onClick={() => handleCharacterSelect(char.id)}
                            className={`relative w-8 h-8 rounded-full overflow-hidden border-2 transition-all ${currentSelectedCharId === char.id ? 'border-magic-blue scale-110 ring-1 ring-offset-1 ring-magic-blue' : 'border-transparent opacity-70 hover:opacity-100'}`}
                            title={`Use ${char.name}`}
                        >
                             <img src={`data:image/png;base64,${char.imageData}`} className="w-full h-full object-cover" alt={char.name} />
                        </button>
                    ))}
                </div>
                <span className="text-xs text-white font-bold shadow-black drop-shadow-md pointer-events-none">Select Character</span>
            </div>
          )}
        </div>

        {/* Right: Text */}
        <div className="w-full md:w-1/3 h-1/2 md:h-full bg-parchment p-6 md:p-8 flex flex-col justify-between relative z-0 group">
           <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-yellow-100/50 to-transparent rounded-bl-full pointer-events-none"></div>
           
           <div className="flex-1 flex flex-col justify-center relative">
                {isEditingText ? (
                    <div className="flex flex-col gap-4 animate-in fade-in w-full h-full overflow-y-auto">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Display Text (Short)</label>
                            <textarea 
                                value={editedText}
                                onChange={e => setEditedText(e.target.value)}
                                className="w-full p-2 rounded border border-slate-300 font-story text-sm focus:ring-2 focus:ring-magic-blue focus:border-transparent outline-none bg-white text-slate-900"
                                rows={3}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Voiceover Script (Long)</label>
                            <textarea 
                                value={editedVoiceover}
                                onChange={e => setEditedVoiceover(e.target.value)}
                                className="w-full p-2 rounded border border-slate-300 font-story text-sm focus:ring-2 focus:ring-magic-blue focus:border-transparent outline-none bg-white text-slate-900"
                                rows={6}
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button 
                                onClick={() => setIsEditingText(false)} 
                                className="px-3 py-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleSaveTextEdit} 
                                className="px-4 py-1 text-sm bg-magic-blue text-white rounded font-bold hover:bg-blue-600 transition-colors"
                            >
                                Save & Update
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <button 
                            onClick={handleStartTextEdit}
                            className="absolute top-0 right-0 p-2 text-slate-300 hover:text-magic-purple opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10"
                            title="Edit Text & Transcript (Pauses Story)"
                        >
                            <Pencil size={18} />
                        </button>
                        <p className="font-story text-lg md:text-xl leading-relaxed text-slate-800 whitespace-pre-wrap">
                            {currentPage.text}
                        </p>
                    </>
                )}
                
                {!isEditingText && (
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
                            {isPlayingAudio ? "Narrating..." : currentPage.isGeneratingAudio ? "Generating Audio..." : "Play"}
                        </button>
                    </div>
                )}
           </div>

           <div className="mt-4 text-center flex justify-center">
                <span className="inline-block w-8 h-8 leading-8 rounded-full bg-slate-800 text-white font-bold font-comic shadow-md text-sm">
                    {currentPageIndex + 1}
                </span>
           </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full max-w-4xl px-4">
         <div className="h-2 bg-slate-200 rounded-full overflow-hidden w-full">
            <div 
                className="h-full bg-magic-blue transition-all duration-500"
                style={{ width: `${progress}%` }}
            ></div>
        </div>
      </div>
    </div>
  );
};
