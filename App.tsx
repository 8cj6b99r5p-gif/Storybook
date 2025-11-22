
import React, { useState, useEffect } from 'react';
import { Story, AppState, Character, StoryTheme } from './types';
import { generateStoryStructure } from './services/geminiService';
import { BookViewer } from './components/BookViewer';
import { saveStoryToDB, getAllStoriesFromDB, deleteStoryFromDB } from './services/db';
import { generatePDF } from './services/pdfService';
import { BookOpen, Sparkles, AlertCircle, User, Plus, Trash2, Check, Menu, Library, Home, X, FileText } from 'lucide-react';

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
      const maxDim = 512; 
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
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => resolve(base64); 
  });
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [storyIdea, setStoryIdea] = useState('');
  const [theme, setTheme] = useState<StoryTheme>('Watercolor');
  const [language, setLanguage] = useState('English');
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Navigation & Menu
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [storyLibrary, setStoryLibrary] = useState<Story[]>([]);
  
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

  // Save library to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('dreamweaver_library', JSON.stringify(library));
      setStorageError(null);
    } catch (e) {
      setStorageError("Storage full! Delete some characters.");
    }
  }, [library]);

  // Load story library from DB when needed
  const loadStoryLibrary = async () => {
      try {
          const stories = await getAllStoriesFromDB();
          setStoryLibrary(stories);
      } catch (e) {
          console.error("Failed to load stories", e);
      }
  };

  const navigateTo = (newState: AppState) => {
      setState(newState);
      setIsMenuOpen(false);
      if (newState === AppState.VIEWING_LIBRARY) {
          loadStoryLibrary();
      }
      if (newState === AppState.IDLE) {
          setStory(null);
          setStoryIdea('');
      }
  };

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
           const compressed = await compressImage(rawBase64);
           setTempCharImage(compressed);
        } catch (err) {
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
      setSelectedIds(prev => [...prev, newChar.id]);
      setTempCharImage(null);
      setCharUploadName('');
    }
  };

  const deleteFromLibrary = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (window.confirm("Delete this character?")) {
        setLibrary(prev => prev.filter(c => c.id !== id));
        setSelectedIds(prev => prev.filter(cid => cid !== id));
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => 
        prev.includes(id) ? prev.filter(cid => cid !== id) : [...prev, id]
    );
  };

  const startStoryGeneration = async () => {
    setState(AppState.GENERATING_STORY);
    setError(null);

    try {
      const selectedChars = library.filter(c => selectedIds.includes(c.id));
      const generatedStory = await generateStoryStructure(storyIdea, theme, language, selectedChars);
      
      // Save to DB immediately
      await saveStoryToDB(generatedStory);
      
      setStory(generatedStory);
      setState(AppState.VIEWING_BOOK);
    } catch (err) {
      setError("Oops! The magic scribes are taking a nap. Please try a different idea or check your key.");
      setState(AppState.ERROR);
    }
  };

  const handleDeleteStory = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(window.confirm("Delete this story forever?")) {
          await deleteStoryFromDB(id);
          loadStoryLibrary();
      }
  };

  const handleOpenStory = (savedStory: Story) => {
      setStory(savedStory);
      setState(AppState.VIEWING_BOOK);
  };

  const handlePDFDownload = (savedStory: Story, e: React.MouseEvent) => {
      e.stopPropagation();
      generatePDF(savedStory);
  };

  const selectedCharacters = library.filter(c => selectedIds.includes(c.id));

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      
      {/* Navigation Menu Button */}
      <button 
        onClick={() => setIsMenuOpen(true)}
        className="fixed top-4 left-4 z-50 p-2 bg-white/80 backdrop-blur rounded-full shadow-md hover:bg-white transition-all text-slate-700"
      >
        <Menu size={24} />
      </button>

      {/* Sidebar / Drawer */}
      {isMenuOpen && (
          <div className="fixed inset-0 z-50 flex">
              <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setIsMenuOpen(false)}></div>
              <div className="relative w-64 bg-white shadow-2xl h-full flex flex-col p-6 animate-in slide-in-from-left">
                  <button onClick={() => setIsMenuOpen(false)} className="self-end p-2 text-slate-400 hover:text-slate-800">
                      <X size={24} />
                  </button>
                  
                  <h2 className="text-2xl font-story font-bold text-slate-800 mb-8">DreamWeaver</h2>
                  
                  <nav className="flex flex-col gap-4">
                      <button 
                        onClick={() => navigateTo(AppState.IDLE)}
                        className={`flex items-center gap-3 p-3 rounded-lg font-bold transition-colors ${state === AppState.IDLE || state === AppState.CHARACTER_SETUP ? 'bg-magic-blue text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                          <Home size={20} /> Create New
                      </button>
                      <button 
                        onClick={() => navigateTo(AppState.VIEWING_LIBRARY)}
                        className={`flex items-center gap-3 p-3 rounded-lg font-bold transition-colors ${state === AppState.VIEWING_LIBRARY ? 'bg-magic-blue text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                          <Library size={20} /> My Stories
                      </button>
                  </nav>
                  
                  <div className="mt-auto text-xs text-slate-400">
                      v1.0.0
                  </div>
              </div>
          </div>
      )}

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
                  Create magical stories with AI. Choose your theme and language!
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
                          className="w-full px-6 py-4 text-lg outline-none font-comic placeholder:text-slate-400 bg-white text-slate-900"
                          autoFocus
                      />
                  </div>
                </div>

                <div className="flex gap-4">
                   <select 
                     value={theme}
                     onChange={(e) => setTheme(e.target.value as StoryTheme)}
                     className="flex-1 p-3 rounded-lg border border-slate-300 bg-white text-slate-900 font-comic focus:border-magic-purple outline-none"
                   >
                      {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
                   </select>
                   <select 
                     value={language}
                     onChange={(e) => setLanguage(e.target.value)}
                     className="flex-1 p-3 rounded-lg border border-slate-300 bg-white text-slate-900 font-comic focus:border-magic-purple outline-none"
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

        {state === AppState.VIEWING_LIBRARY && (
            <div className="p-8 max-w-6xl mx-auto min-h-full">
                <h2 className="text-3xl font-story font-bold text-slate-800 mb-8 pl-12">My Story Library</h2>
                
                {storyLibrary.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-slate-100">
                        <BookOpen size={48} className="text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-500 font-comic">No stories yet. Time to create magic!</p>
                        <button onClick={() => navigateTo(AppState.IDLE)} className="mt-4 text-magic-blue font-bold hover:underline">
                            Create New Story
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {storyLibrary.map(savedStory => (
                            <div key={savedStory.id} className="bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow border border-slate-100 overflow-hidden flex flex-col">
                                {/* Preview Image (use first page image or placeholder) */}
                                <div className="h-48 bg-slate-200 relative">
                                    {savedStory.pages[0]?.imageData ? (
                                        <img src={`data:image/png;base64,${savedStory.pages[0].imageData}`} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-slate-400">
                                            <Sparkles />
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                                        <span className="text-white text-xs font-bold px-2 py-1 bg-white/20 backdrop-blur rounded-full">
                                            {savedStory.theme}
                                        </span>
                                    </div>
                                </div>
                                
                                <div className="p-4 flex-1 flex flex-col">
                                    <h3 className="font-story font-bold text-lg text-slate-800 mb-1 line-clamp-1">{savedStory.title}</h3>
                                    <p className="text-xs text-slate-500 mb-4">{new Date(savedStory.createdAt).toLocaleDateString()} • {savedStory.language}</p>
                                    
                                    <div className="mt-auto flex gap-2">
                                        <button 
                                            onClick={() => handleOpenStory(savedStory)}
                                            className="flex-1 py-2 bg-magic-blue text-white rounded-lg font-bold text-sm hover:bg-blue-600"
                                        >
                                            Read
                                        </button>
                                        <button 
                                            onClick={(e) => handlePDFDownload(savedStory, e)}
                                            className="p-2 text-magic-purple bg-purple-50 hover:bg-purple-100 rounded-lg"
                                            title="Download PDF"
                                        >
                                            <FileText size={20} />
                                        </button>
                                        <button 
                                            onClick={(e) => handleDeleteStory(savedStory.id, e)}
                                            className="p-2 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg"
                                            title="Delete"
                                        >
                                            <Trash2 size={20} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}

        {state === AppState.CHARACTER_SETUP && (
            <div className="flex flex-col items-center justify-center min-h-full p-6 pt-16">
                <div className="max-w-5xl w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
                    <div className="text-center mb-8">
                         <h2 className="text-3xl font-story font-bold text-slate-800 mb-2">Cast Your Characters</h2>
                         <p className="text-slate-500 font-comic">Select characters from your library or add new ones.</p>
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
                                className="w-full mb-4 px-4 py-2 rounded border border-slate-300 focus:outline-none focus:border-magic-blue bg-white text-slate-900"
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
                                                    <div className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                                                        isSelected ? 'bg-magic-blue text-white' : 'bg-white/80 text-transparent border border-slate-300'
                                                    }`}>
                                                        <Check size={14} strokeWidth={3} />
                                                    </div>
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
                            onClick={() => navigateTo(AppState.IDLE)}
                            className="px-6 py-3 text-slate-500 hover:text-slate-800 font-bold"
                        >
                            Cancel
                        </button>
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
                onClick={() => navigateTo(AppState.IDLE)}
                className="px-6 py-3 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800"
             >
                Try Again
             </button>
          </div>
        )}

        {state === AppState.VIEWING_BOOK && story && (
           <BookViewer story={story} characters={selectedCharacters} onReset={() => navigateTo(AppState.VIEWING_LIBRARY)} />
        )}
      </main>
      
      <footer className="py-4 text-center text-xs text-slate-400 bg-white border-t border-slate-100">
        Powered by Gemini 2.5 Flash & Flash Image
      </footer>
    </div>
  );
};

export default App;
