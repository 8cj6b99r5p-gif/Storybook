
import React, { useState, useEffect } from 'react';
import { Story, AppState, Character, StoryTheme } from './types';
import { generateStoryStructure } from './services/geminiService';
import { BookViewer } from './components/BookViewer';
import { BookOpen, Sparkles, AlertCircle, User, Plus, X, Trash2, Check } from 'lucide-react';

const THEMES: StoryTheme[] = ['Watercolor', 'Cartoon', 'Pixel Art', '3D Render', 'Sketch', 'Oil Painting'];
const LANGUAGES = ['English', 'Bengali (Bangla)', 'Spanish', 'French', 'German', 'Japanese'];

// Helper to resize/compress images to save LocalStorage space
const compressImage = (base64: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const maxDim = 512; // Resize to max 512px to save space
      let w = img.width;
      let h = img.height;
      
      if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = w * ratio;
          h = h * ratio;
      }
      
      canvas.width = w;
      canvas.height = h;
      ctx?.drawImage(img, 0, 0, w, h);
      // Return as PNG to be compatible with existing logic
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => resolve(base64); // Fallback if loading fails
  });
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [storyIdea, setStoryIdea] = useState('');
  const [theme, setTheme] = useState<StoryTheme>('Watercolor');
  const [language, setLanguage] = useState('English');
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Character Management
  const [library, setLibrary] = useState<Character[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [charUploadName, setCharUploadName] = useState('');
  const [tempCharImage, setTempCharImage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Load library from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('dreamweaver_library');
    if (saved) {
      try {
        const parsedLibrary = JSON.parse(saved);
        setLibrary(parsedLibrary);
      } catch (e) {
        console.error("Failed to load library", e);
      }
    }
  }, []);

  // Save library to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('dreamweaver_library', JSON.stringify(library));
      setStorageError(null);
    } catch (e) {
      console.error("Failed to save library (likely quota exceeded)", e);
      setStorageError("Storage full! Delete some characters to save new ones.");
    }
  }, [library]);

  const handleIdeaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storyIdea.trim()) return;
    setState(AppState.CHARACTER_SETUP);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const rawBase64 = (reader.result as string).split(',')[1];
        try {
           // Compress before setting state to keep preview consistent with storage
           const compressed = await compressImage(rawBase64);
           setTempCharImage(compressed);
        } catch (err) {
           console.error("Compression failed", err);
           setTempCharImage(rawBase64);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const addToLibrary = () => {
    if (tempCharImage && charUploadName.trim()) {
      const newChar: Character = {
        id: Date.now().toString(),
        name: charUploadName,
        imageData: tempCharImage
      };
      
      setLibrary(prev => [...prev, newChar]);
      // Auto-select the newly added character
      setSelectedIds(prev => [...prev, newChar.id]);
      
      setTempCharImage(null);
      setCharUploadName('');
    }
  };

  const deleteFromLibrary = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent toggling selection
    if (window.confirm("Are you sure you want to delete this character?")) {
        setLibrary(prev => prev.filter(c => c.id !== id));
        setSelectedIds(prev => prev.filter(cid => cid !== id));
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => 
        prev.includes(id) 
            ? prev.filter(cid => cid !== id) 
            : [...prev, id]
    );
  };

  const startStoryGeneration = async () => {
    setState(AppState.GENERATING_STORY);
    setError(null);

    try {
      const generatedStory = await generateStoryStructure(storyIdea, theme, language);
      setStory(generatedStory);
      setState(AppState.VIEWING_BOOK);
    } catch (err) {
      setError("Oops! The magic scribes are taking a nap. Please try a different idea or check your key.");
      setState(AppState.ERROR);
    }
  };

  const handleReset = () => {
    setState(AppState.IDLE);
    setStory(null);
    setStoryIdea('');
    setError(null);
    setTempCharImage(null);
    setSelectedIds([]);
  };

  // Get the actual Character objects for the selected IDs
  const selectedCharacters = library.filter(c => selectedIds.includes(c.id));

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans selection:bg-magic-blue/20">
      
      <main className="flex-1 relative overflow-y-auto">
        
        {state === AppState.IDLE && (
          <div className="flex flex-col items-center justify-center min-h-full p-6">
            <div className="max-w-2xl w-full space-y-8 text-center">
              
              <div className="space-y-4">
                <div className="inline-block p-4 bg-white rounded-full shadow-xl mb-4 animate-bounce">
                   <BookOpen size={48} className="text-magic-blue" />
                </div>
                <h1 className="text-4xl md:text-6xl font-story font-bold text-slate-800 tracking-tight">
                  DreamWeaver
                  <span className="text-magic-purple"> Kids</span>
                </h1>
                <p className="text-lg md:text-xl text-slate-600 font-comic max-w-lg mx-auto">
                  Create magical stories with Gemini. Choose your theme and language!
                </p>
              </div>

              <form onSubmit={handleIdeaSubmit} className="w-full max-w-lg mx-auto space-y-4">
                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-magic-blue to-magic-purple rounded-lg blur opacity-25 group-hover:opacity-75 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative flex flex-col bg-white rounded-lg shadow-xl overflow-hidden border border-slate-100">
                      <input
                          type="text"
                          value={storyIdea}
                          onChange={(e) => setStoryIdea(e.target.value)}
                          placeholder="e.g., A lonely cloud looking for a friend..."
                          className="w-full px-6 py-4 text-lg outline-none font-comic text-slate-800 placeholder:text-slate-400"
                          autoFocus
                      />
                  </div>
                </div>

                <div className="flex gap-4">
                   <select 
                     value={theme}
                     onChange={(e) => setTheme(e.target.value as StoryTheme)}
                     className="flex-1 p-3 rounded-lg border border-slate-300 bg-white text-slate-700 font-comic focus:border-magic-purple outline-none"
                   >
                      {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
                   </select>
                   <select 
                     value={language}
                     onChange={(e) => setLanguage(e.target.value)}
                     className="flex-1 p-3 rounded-lg border border-slate-300 bg-white text-slate-700 font-comic focus:border-magic-purple outline-none"
                   >
                      {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                   </select>
                </div>

                <button 
                    type="submit"
                    disabled={!storyIdea.trim()}
                    className="w-full py-4 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                >
                    <Sparkles size={20} className="text-yellow-400" />
                    Start Creating
                </button>
              </form>
            </div>
          </div>
        )}

        {state === AppState.CHARACTER_SETUP && (
            <div className="flex flex-col items-center justify-center min-h-full p-6">
                <div className="max-w-5xl w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
                    <div className="text-center mb-8">
                         <h2 className="text-3xl font-story font-bold text-slate-800 mb-2">Cast Your Characters</h2>
                         <p className="text-slate-500 font-comic">Select characters from your library or add new ones for this story.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 h-[500px]">
                        {/* Left: Upload Section */}
                        <div className="md:col-span-1 flex flex-col items-center p-6 bg-slate-50 rounded-xl border-2 border-dashed border-slate-300 h-full justify-center">
                             <h3 className="font-bold text-slate-700 mb-4">Add New Character</h3>
                             <div className="relative w-32 h-32 bg-white rounded-full shadow-md mb-4 overflow-hidden flex items-center justify-center group cursor-pointer">
                                {tempCharImage ? (
                                    <img src={`data:image/png;base64,${tempCharImage}`} className="w-full h-full object-cover" />
                                ) : (
                                    <User size={48} className="text-slate-300" />
                                )}
                                <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                                <div className="absolute inset-0 bg-black/10 group-hover:bg-black/20 transition-colors"></div>
                             </div>
                             <input 
                                type="text" 
                                placeholder="Name (e.g. 'Bob')" 
                                value={charUploadName}
                                onChange={(e) => setCharUploadName(e.target.value)}
                                className="w-full mb-4 px-4 py-2 rounded border border-slate-300 focus:outline-none focus:border-magic-blue"
                             />
                             <button 
                                onClick={addToLibrary}
                                disabled={!tempCharImage || !charUploadName.trim()}
                                className="w-full px-6 py-2 bg-magic-blue text-white rounded-full font-bold disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors"
                             >
                                <Plus size={16} /> Save & Select
                             </button>
                        </div>

                        {/* Right: Library List */}
                        <div className="md:col-span-2 flex flex-col h-full">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                    Library <span className="bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-full">{library.length}</span>
                                </h3>
                                <span className="text-sm text-slate-500">{selectedIds.length} selected</span>
                            </div>
                            
                            {storageError && (
                                <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg flex items-center gap-2 text-sm font-bold animate-pulse">
                                    <AlertCircle size={16} /> {storageError}
                                </div>
                            )}

                            <div className="flex-1 overflow-y-auto bg-slate-50 rounded-xl border border-slate-200 p-4">
                                {library.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                        <User size={32} />
                                        <p>Library is empty. Add a character!</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                        {library.map(char => {
                                            const isSelected = selectedIds.includes(char.id);
                                            return (
                                                <div 
                                                    key={char.id} 
                                                    onClick={() => toggleSelection(char.id)}
                                                    className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                                                        isSelected 
                                                            ? 'border-magic-blue shadow-md bg-blue-50' 
                                                            : 'border-slate-200 hover:border-slate-300 bg-white'
                                                    }`}
                                                >
                                                    {/* Selection Indicator */}
                                                    <div className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                                                        isSelected ? 'bg-magic-blue text-white' : 'bg-white/80 text-transparent border border-slate-300'
                                                    }`}>
                                                        <Check size={14} strokeWidth={3} />
                                                    </div>

                                                    {/* Delete Button */}
                                                    <button 
                                                        onClick={(e) => deleteFromLibrary(char.id, e)}
                                                        className="absolute top-2 right-2 z-10 p-1.5 bg-white/90 text-slate-400 hover:text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white shadow-sm"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>

                                                    <div className="aspect-square bg-slate-200 relative">
                                                        <img src={`data:image/png;base64,${char.imageData}`} className="w-full h-full object-cover" />
                                                    </div>
                                                    <div className="p-2 text-center">
                                                        <p className={`text-sm font-bold truncate ${isSelected ? 'text-magic-blue' : 'text-slate-700'}`}>
                                                            {char.name}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4 justify-center mt-8 border-t pt-6">
                        <button 
                            onClick={startStoryGeneration}
                            className="px-8 py-3 bg-magic-purple text-white rounded-full font-bold shadow-lg hover:bg-purple-600 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 transition-all"
                        >
                            <Sparkles size={18} />
                            Generate Story 
                            {selectedIds.length > 0 && <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">with {selectedIds.length} chars</span>}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {state === AppState.GENERATING_STORY && (
          <div className="flex flex-col items-center justify-center min-h-full p-8 text-center">
             <div className="w-24 h-24 mb-8 relative">
                <div className="absolute inset-0 border-4 border-slate-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-magic-purple rounded-full border-t-transparent animate-spin"></div>
                <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-yellow-500 animate-pulse" size={32} />
             </div>
             <h2 className="text-2xl font-story font-bold text-slate-800 mb-2">Weaving your story...</h2>
             <p className="text-slate-500 font-comic">Creating 20-25 pages in {theme} style.</p>
             <p className="text-slate-400 text-sm mt-2">Writing in {language}...</p>
          </div>
        )}

        {state === AppState.ERROR && (
          <div className="flex flex-col items-center justify-center min-h-full p-8 text-center">
             <div className="bg-red-50 p-6 rounded-full mb-6">
                <AlertCircle className="text-red-500" size={48} />
             </div>
             <h3 className="text-xl font-bold text-slate-800 mb-2">Oh no!</h3>
             <p className="text-slate-600 mb-8 max-w-md">{error}</p>
             <button 
                onClick={handleReset}
                className="px-6 py-3 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800"
             >
                Try Again
             </button>
          </div>
        )}

        {state === AppState.VIEWING_BOOK && story && (
           <BookViewer story={story} characters={selectedCharacters} onReset={handleReset} />
        )}
      </main>
      
      <footer className="py-4 text-center text-xs text-slate-400 bg-white border-t border-slate-100">
        Powered by Gemini 2.5 Flash & Flash Image
      </footer>
    </div>
  );
};

export default App;
