
import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { Story, StoryPage, StoryTheme } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- Queue & Retry Logic ---

class RequestQueue {
  private queue: (() => Promise<any>)[] = [];
  private isProcessing = false;

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;
    
    try {
      const task = this.queue.shift();
      if (task) {
        await task();
      }
    } finally {
      this.isProcessing = false;
      setTimeout(() => this.process(), 500); 
    }
  }
}

const imageQueue = new RequestQueue();

async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isQuotaError = 
      error.status === 429 || 
      error.code === 429 || 
      (error.message && (
        error.message.includes('429') || 
        error.message.includes('quota') || 
        error.message.includes('RESOURCE_EXHAUSTED')
      ));

    if (isQuotaError && retries > 0) {
      console.warn(`Quota exceeded. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

// --- Schema ---

const storySchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "A catchy title for the book" },
    lesson: { type: Type.STRING, description: "The moral or lesson at the end of the story" },
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: "Very short text for the page (10-15 words max). Easy to read for kids." },
          voiceoverText: { type: Type.STRING, description: "Detailed, engaging narration script for this page (40-60 words). Adds depth to the story." },
          imagePrompt: { type: Type.STRING, description: "A detailed visual description of the scene." }
        },
        required: ["text", "voiceoverText", "imagePrompt"]
      }
    }
  },
  required: ["title", "lesson", "pages"]
};

// --- API Methods ---

export const generateStoryStructure = async (idea: string, theme: StoryTheme, language: string): Promise<Story> => {
  return retryWithBackoff(async () => {
    const ai = getAI();
    const model = "gemini-2.5-flash"; 

    const prompt = `
      Write a children's story book based on this idea: "${idea}".
      
      Configuration:
      - Language: ${language} (Ensure all text and voiceoverText is in this language).
      - Visual Theme: ${theme} (Ensure imagePrompts explicitly describe this art style).
      
      Requirements:
      1. Length: 20-25 pages.
      2. Text: "text" field must be short (for display). "voiceoverText" field must be longer (for audio).
      3. Total Audio Duration target: ~100 seconds.
      4. Ending: Must conclude with a clear lesson.
    `;

    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: storySchema,
          systemInstruction: "You are a world-class children's book author."
        }
      });

      const text = response.text;
      if (!text) throw new Error("No text returned from Gemini");
      
      const rawData = JSON.parse(text);
      
      const pages: StoryPage[] = rawData.pages.map((p: any, index: number) => ({
        pageNumber: index + 1,
        text: p.text,
        voiceoverText: p.voiceoverText || p.text,
        imagePrompt: p.imagePrompt,
        isGeneratingImage: false,
        hasError: false
      }));

      return {
        title: rawData.title,
        lesson: rawData.lesson,
        theme: theme,
        language: language,
        pages
      };

    } catch (error) {
      console.error("Story generation failed", error);
      throw error;
    }
  });
};

export const generateImageForPage = async (imagePrompt: string, characterImage?: string, theme: StoryTheme = 'Watercolor'): Promise<string> => {
  return imageQueue.add(() => retryWithBackoff(async () => {
    const ai = getAI();
    const model = "gemini-2.5-flash-image";

    try {
      // Append theme to prompt
      const fullPrompt = `${imagePrompt}. Art Style: ${theme}. High quality, detailed children's book illustration.`;
      
      let contents: any;
      if (characterImage) {
        contents = {
          parts: [
            { text: `${fullPrompt} IMPORTANT: The main character must look like the person in the reference image provided, adapted to the ${theme} style.` },
            { inlineData: { mimeType: "image/png", data: characterImage } }
          ]
        };
      } else {
        contents = { parts: [{ text: fullPrompt }] };
      }

      const response = await ai.models.generateContent({
        model,
        contents: contents,
        config: {}
      });

      for (const candidate of response.candidates || []) {
          for (const part of candidate.content.parts) {
              if (part.inlineData && part.inlineData.data) {
                  return part.inlineData.data;
              }
          }
      }
      throw new Error("No image data found in response");
    } catch (error) {
      console.error("Image generation failed", error);
      throw error;
    }
  }, 5, 4000)); 
};

export const editImageWithPrompt = async (base64Image: string, editPrompt: string): Promise<string> => {
  return imageQueue.add(() => retryWithBackoff(async () => {
    const ai = getAI();
    const model = "gemini-2.5-flash-image";

    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { data: base64Image, mimeType: "image/png" } },
            { text: `Edit this image: ${editPrompt}. Maintain the original art style and composition.` }
          ]
        }
      });

      for (const candidate of response.candidates || []) {
          for (const part of candidate.content.parts) {
              if (part.inlineData && part.inlineData.data) {
                  return part.inlineData.data;
              }
          }
      }
      throw new Error("No edited image data found");
    } catch (error) {
      console.error("Image editing failed", error);
      throw error;
    }
  }, 3, 4000));
};

export const generatePageAudio = async (text: string, language: string = 'English'): Promise<string> => {
  return imageQueue.add(() => retryWithBackoff(async () => {
    const ai = getAI();
    const model = "gemini-2.5-flash-preview-tts";

    try {
      // Gemini TTS supports multiple languages natively based on input text.
      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }, 
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error("No audio data returned");
      }
      return base64Audio;
    } catch (error) {
      console.error("Audio generation failed", error);
      throw error;
    }
  }, 3, 2000));
};
