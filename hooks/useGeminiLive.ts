import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, LogEntry, AIConfig } from '../types';
import { decode, decodeAudioData, createPcmBlob } from '../utils/audioUtils';

// Constants
const SAMPLE_RATE_INPUT = 16000;
const SAMPLE_RATE_OUTPUT = 24000;

export const useGeminiLive = () => {
  const [status, setStatus] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);

  // Refs for Gemini Audio
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const activeSessionRef = useRef<any>(null); 
  
  // Refs for OpenAI/Groq (Web Speech API)
  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef<boolean>(false);
  
  // Refs for transcription accumulation
  const currentInputRef = useRef<string>('');
  const currentOutputRef = useRef<string>('');

  const addLog = useCallback((sender: LogEntry['sender'], message: string) => {
    setLogs((prev) => [...prev, { timestamp: new Date(), sender, message }]);
  }, []);

  const cleanup = useCallback(() => {
    // Cleanup Gemini Audio
    sourcesRef.current.forEach((source) => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();

    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Cleanup OpenAI/Groq (Web Speech)
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null; // Clear ref first to prevent onend restart
      rec.stop();
    }
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }

    activeSessionRef.current = null;
    setOutputAnalyser(null);
    setStatus(ConnectionState.DISCONNECTED);
  }, []);

  // --- OpenAI / Groq Implementation ---
  const connectOpenAI = async (config: AIConfig) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
        addLog('system', 'Error: Browser does not support Web Speech API required for non-Gemini providers.');
        setStatus(ConnectionState.ERROR);
        return;
    }

    // Determine Base URL based on key
    const isGroq = config.apiKey.startsWith('gsk_');
    const baseUrl = isGroq ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    
    setStatus(ConnectionState.CONNECTING);
    addLog('system', `Initializing adapter for ${isGroq ? 'Groq' : 'OpenAI'} (${config.modelId})...`);
    
    // Ensure voices are loaded
    if (window.speechSynthesis.getVoices().length === 0) {
       await new Promise<void>(resolve => {
           const onVoicesChanged = () => {
               window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
               resolve();
           };
           window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
           // Timeout just in case
           setTimeout(resolve, 1000);
       });
    }

    try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false; 
        recognition.lang = 'pt-BR'; 
        
        recognition.onstart = () => {
            setStatus(ConnectionState.CONNECTED);
            addLog('system', 'James Online. Listening...');
        };

        recognition.onerror = (event: any) => {
            // Quietly handle "no-speech" (silence) and "aborted" to keep the loop going
            if (event.error === 'no-speech' || event.error === 'aborted') {
                return; 
            }

            console.error('Speech recognition error', event.error);
            if (event.error === 'not-allowed') {
                addLog('system', 'Error: Microphone access denied.');
                setStatus(ConnectionState.ERROR);
            } else {
                 // For other errors, we might want to log them but attempt to keep going
                 // addLog('system', `Mic Error: ${event.error}`); 
            }
        };

        recognition.onend = () => {
            // Auto-restart mechanism for continuous listening
            // Only restart if we are still "connected" (recognitionRef is valid) and NOT currently processing/speaking
            if (recognitionRef.current === recognition && !isProcessingRef.current) {
                try {
                    recognition.start();
                } catch (e) {
                    // Ignore start errors (e.g. if already started)
                }
            }
        };

        recognition.onresult = async (event: any) => {
            if (isProcessingRef.current) return;

            const lastResultIndex = event.results.length - 1;
            const text = event.results[lastResultIndex][0].transcript;
            
            if (event.results[lastResultIndex].isFinal && text.trim().length > 0) {
                addLog('user', text);
                isProcessingRef.current = true;
                
                // Pause recognition while thinking/speaking
                recognition.stop(); 
                
                try {
                    // Call LLM
                    const messages = [
                        { role: 'system', content: config.systemInstruction },
                        { role: 'user', content: text }
                    ];

                    const response = await fetch(`${baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${config.apiKey}`
                        },
                        body: JSON.stringify({
                            model: config.modelId,
                            messages: messages,
                            stream: false
                        })
                    });

                    if (!response.ok) {
                        const err = await response.json();
                        throw new Error(err.error?.message || 'API Request Failed');
                    }

                    const data = await response.json();
                    const aiText = data.choices?.[0]?.message?.content || "";
                    
                    addLog('ai', aiText);

                    // TTS Output
                    if (aiText && window.speechSynthesis) {
                        const utterance = new SpeechSynthesisUtterance(aiText);
                        
                        // --- JARVIS VOICE CONFIGURATION ---
                        utterance.pitch = 1.0; // Natural pitch (no robotic shift)
                        utterance.rate = 1.1;  // Slightly faster/efficient

                        const voices = window.speechSynthesis.getVoices();
                        
                        // Enhanced Voice Selection for "Jarvis" Persona
                        // We prioritize:
                        // 1. "Microsoft Daniel" (Excellent PT-BR Male)
                        // 2. Any Portuguese Male voice
                        // 3. Any Portuguese voice (fallback)
                        
                        let selectedVoice = voices.find(v => v.name.includes('Microsoft Daniel') && v.lang.includes('pt'));
                        
                        if (!selectedVoice) {
                            // Try to find a male voice in Portuguese
                            selectedVoice = voices.find(v => 
                                v.lang.includes('pt') && 
                                (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('masculino'))
                            );
                        }

                        if (!selectedVoice) {
                            // Fallback to any PT-BR voice
                            selectedVoice = voices.find(v => v.lang === 'pt-BR');
                        }

                        // Last resort: Google UK Male if English text is detected (unlikely but possible)
                        // or just any voice
                        if (!selectedVoice) {
                            selectedVoice = voices.find(v => v.lang.includes('pt'));
                        }

                        if (selectedVoice) {
                            utterance.voice = selectedVoice;
                        }
                        
                        // Resume listening after speech ends
                        utterance.onend = () => {
                            isProcessingRef.current = false;
                            try { recognition.start(); } catch(e) {} 
                        };
                        
                        utterance.onerror = (e) => {
                             console.error("TTS Error", e);
                             isProcessingRef.current = false;
                             try { recognition.start(); } catch(e) {}
                        };
                        
                        window.speechSynthesis.speak(utterance);
                    } else {
                        isProcessingRef.current = false;
                         try { recognition.start(); } catch(e) {}
                    }

                } catch (error: any) {
                    addLog('system', `LLM Error: ${error.message}`);
                    isProcessingRef.current = false;
                    try { recognition.start(); } catch(e) {}
                }
            }
        };

        recognitionRef.current = recognition;
        recognition.start();

        // Create a fake audio context for visualizer to prevent crash
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        setOutputAnalyser(analyser); 

    } catch (e: any) {
        addLog('system', `Init Error: ${e.message}`);
        setStatus(ConnectionState.ERROR);
    }
  };


  // --- Gemini Implementation ---
  const connectGemini = async (config: AIConfig) => {
    try {
      setStatus(ConnectionState.CONNECTING);
      addLog('system', `Initializing JAMES audio interface (${config.modelId})...`);

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      inputContextRef.current = new AudioContextClass({ sampleRate: SAMPLE_RATE_INPUT });
      outputContextRef.current = new AudioContextClass({ sampleRate: SAMPLE_RATE_OUTPUT });

      const analyser = outputContextRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      setOutputAnalyser(analyser);

      addLog('system', 'Accessing microphone feed...');
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      const ai = new GoogleGenAI({ apiKey: config.apiKey });
      
      const sessionPromise = ai.live.connect({
        model: config.modelId,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName } },
          },
          systemInstruction: config.systemInstruction,
        },
        callbacks: {
          onopen: () => {
            addLog('system', 'Uplink established. James is online.');
            setStatus(ConnectionState.CONNECTED);
            
            currentInputRef.current = '';
            currentOutputRef.current = '';

            if (!inputContextRef.current || !streamRef.current) return;
            
            const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
            const scriptProcessor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              }).catch(err => {
                 // Ignore sporadic send errors
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription?.text) {
                currentInputRef.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription?.text) {
                currentOutputRef.current += message.serverContent.outputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
                if (currentInputRef.current.trim()) {
                    addLog('user', currentInputRef.current.trim());
                    currentInputRef.current = '';
                }
                if (currentOutputRef.current.trim()) {
                    addLog('ai', currentOutputRef.current.trim());
                    currentOutputRef.current = '';
                }
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputContextRef.current) {
              const ctx = outputContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              try {
                const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, SAMPLE_RATE_OUTPUT, 1);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                
                if (analyser) {
                    source.connect(analyser);
                    analyser.connect(ctx.destination);
                } else {
                    source.connect(ctx.destination);
                }

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
                source.onended = () => sourcesRef.current.delete(source);
              } catch (err) {
                console.error("Audio decoding error", err);
              }
            }

            if (message.serverContent?.interrupted) {
              addLog('system', 'Interruption detected.');
              if (currentOutputRef.current.trim()) {
                  addLog('ai', currentOutputRef.current.trim() + ' -- [INTERRUPTED]');
                  currentOutputRef.current = '';
              }
              sourcesRef.current.forEach(src => src.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onclose: () => {
            addLog('system', 'Connection closed.');
            setStatus(ConnectionState.DISCONNECTED);
          },
          onerror: (err) => {
            console.error(err);
            addLog('system', 'System Error: ' + (err instanceof Error ? err.message : String(err)));
            setStatus(ConnectionState.ERROR);
          }
        }
      });
      activeSessionRef.current = sessionPromise;
    } catch (error: any) {
      console.error(error);
      const errorMessage = error.message || String(error);
      if (errorMessage.includes("service is currently unavailable")) {
         addLog('system', 'Error: Service Unavailable. The model server is currently overloaded or experiencing downtime. Please try again later.');
      } else {
         addLog('system', `Init Error: ${errorMessage}`);
      }
      setStatus(ConnectionState.ERROR);
      cleanup();
    }
  };

  const connect = useCallback(async (config: AIConfig) => {
    // Resolve API key here to ensure it is passed even if not present in the config state
    const apiKey = config.apiKey || process.env.API_KEY;
    if (!apiKey) {
      addLog('system', 'Critical Error: API Key missing. Please ensure your API_KEY environment variable is set.');
      setStatus(ConnectionState.ERROR);
      return;
    }

    const effectiveConfig = { ...config, apiKey };

    if (config.provider === 'gemini') {
        await connectGemini(effectiveConfig);
    } else {
        await connectOpenAI(effectiveConfig);
    }
  }, [addLog, cleanup]);

  const disconnect = useCallback(() => {
    addLog('system', 'Terminating Uplink...');
    cleanup();
  }, [addLog, cleanup]);

  return { status, connect, disconnect, logs, outputAnalyser };
};