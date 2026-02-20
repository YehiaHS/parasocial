import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, User, Bot, Loader2, MemoryStick as Memory, PlusCircle, BrainCircuit, X, Github, Globe, Trash2, Edit2 } from 'lucide-react';
import { useChatStore } from './store/chatStore';
import { streamCopilotResponse, fetchCopilotResponse } from './lib/copilot';
import { memoryManager } from './lib/memory';
import { performSearch } from './lib/search';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { MemoryEntry } from './types';
import { CopilotAuth } from './components/CopilotAuth';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const {
    sessions,
    currentSessionId,
    apiKey,
    createSession,
    addMessage,
    updateLastMessage,
    updateSessionTitle,
    deleteSession,
    getCurrentSession
  } = useChatStore();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [useSearch, setUseSearch] = useState(false);
  const [showMemoryBank, setShowMemoryBank] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [allMemories, setAllMemories] = useState<MemoryEntry[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentSession = getCurrentSession();

  // Load memories for the bank
  const loadMemories = async () => {
    const dbName = 'parasocial-memory';
    const storeName = 'entries';
    const request = indexedDB.open(dbName, 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const getAll = store.getAll();
      getAll.onsuccess = () => setAllMemories(getAll.result);
    };
  };

  const handleDeleteMemory = async (id: string) => {
    await memoryManager.deleteMemory(id);
    loadMemories();
  };

  useEffect(() => {
    if (showMemoryBank) loadMemories();
  }, [showMemoryBank]);

  // Initialize session if none exists
  useEffect(() => {
    if (!currentSessionId && sessions.length === 0) {
      createSession('Initial Thought');
    }
  }, [currentSessionId, sessions, createSession]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentSession?.messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || !currentSessionId) return;

    if (!apiKey) {
      setShowAuthModal(true);
      return;
    }

    const userMessage = input;
    setInput('');
    setLoading(true);

    try {
      // 1. Save message to store
      addMessage(currentSessionId, { role: 'user', content: userMessage });

      // 2. Retrieve memory context
      const memories = await memoryManager.retrieveRelevantMemory(userMessage);
      const memoryContext = memories.length > 0
        ? `\n\n[PAST MEMORIES RETRIEVED]: ${memories.join(' | ')}`
        : '';

      const toolContext = useSearch
        ? `\n\n[SYSTEM]: You have access to a SEARCH TOOL when needed. If the user asks for current information or facts you don't know, or you need to verify, you MUST use the search tool. To search, briefly explain your thought process inside a <details><summary>Thinking...</summary> ... </details> HTML block, then output EXACTLY [[SEARCH: <query>]] on a new line and STOP.`
        : '';

      // 3. Prep messages for API
      const isFirstMessage = currentSession?.messages.length === 0;

      const contextMessages = [
        { role: 'system', content: `You are Parasocial, an AI with incredible memory. Always be thoughtful, clean, and remember details provided in context. The current date is ${new Date().toLocaleDateString()}. You have access to a calculator (use internal thought to math if needed). ${memoryContext} ${toolContext}` },
        ...(currentSession?.messages.map(m => ({ role: m.role, content: m.content })) || []),
        { role: 'user', content: userMessage }
      ];

      // 4. Create placeholder for streaming response
      addMessage(currentSessionId, { role: 'assistant', content: '' });

      let fullResponse = '';

      // Auto Rename if First Message
      if (isFirstMessage) {
        fetchCopilotResponse([
          { id: crypto.randomUUID(), timestamp: Date.now(), role: 'system', content: 'You are a helpful assistant. Provide a very short 2-4 word summary of the user message to use as a conversation title. Output ONLY the title, no quotes or explanations.' },
          { id: crypto.randomUUID(), timestamp: Date.now(), role: 'user', content: userMessage }
        ], apiKey)
          .then((title) => {
            if (title) updateSessionTitle(currentSessionId, title.replace(/['"]/g, '').trim());
          })
          .catch((err) => console.error('Failed to auto-rename:', err));
      }

      // 5. Stream First Response (using Copilot credits)
      // @ts-ignore
      await streamCopilotResponse(contextMessages, apiKey, (chunk) => {
        fullResponse += chunk;
        updateLastMessage(currentSessionId, chunk);
      });

      // 6. Agentic Search Loop
      const searchMatch = fullResponse.match(/\[\[SEARCH:\s*(.*?)\]\]/);
      if (useSearch && searchMatch) {
        const query = searchMatch[1];
        // Provide visual feedback for the search
        updateLastMessage(currentSessionId, `\n\n<details><summary>Searching web...</summary>\n\n> *Query: "${query}"*\n\n`);

        const searchResults = await performSearch(query);

        // Complete the details block visually
        updateLastMessage(currentSessionId, `Results found.</details>\n\n`);

        // Prepare context for the follow-up generated answer
        const followUpContext = [
          ...contextMessages,
          { role: 'assistant', content: fullResponse },
          { role: 'user', content: searchResults }
        ];

        let followUpResponse = '';

        // @ts-ignore
        await streamCopilotResponse(followUpContext, apiKey, (chunk) => {
          followUpResponse += chunk;
          updateLastMessage(currentSessionId, chunk);
        });

        // Update fullResponse so memory indexing gets the complete context
        fullResponse += `\n\n[Search executed: ${query}]\n\n${followUpResponse}`;
      }

      // 7. Index new interaction for memory (after stream complete)
      const memoryRaw = `User said: ${userMessage} | Assistant replied: ${fullResponse}`;

      let finalMemoryToSave = memoryRaw;

      try {
        console.log("Attempting TOON compression with gpt-4o-mini...");
        // Compress data into TOON using the requested model via Copilot
        const compressed = await fetchCopilotResponse([
          { id: crypto.randomUUID(), timestamp: Date.now(), role: 'system', content: 'You are a deep-compression engine. Convert the following conversation fragment strictly into TOON (Token-Oriented Object Notation). Use a dense, symbol-based structure (like JSON but smaller, using arrays or pipe-delimiters mapped to keys) to maximize token context efficiency. Provide ONLY the TOON output.' },
          { id: crypto.randomUUID(), timestamp: Date.now(), role: 'user', content: memoryRaw }
        ], apiKey, 'gpt-4o');

        console.log("Compressed TOON:", compressed);

        if (compressed && compressed.trim() && compressed !== 'undefined') {
          finalMemoryToSave = compressed.trim();
        }
      } catch (e: any) {
        console.warn("Raptor TOON compression failed or unavailable, falling back to raw.", e.message);
      }

      console.log("Saving to memory bank:", finalMemoryToSave);
      await memoryManager.saveMemory(finalMemoryToSave);

    } catch (error: any) {
      console.error(error);
      const errorMsg = error.message || 'Unknown Error';
      addMessage(currentSessionId, { role: 'system', content: `Error: ${errorMsg}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-bg-dark text-white grain overflow-hidden font-display">

      {/* Sidebar */}
      <aside className="w-80 h-full glass border-r border-white/5 flex flex-col p-6 z-10 transition-all duration-500">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.3)]">
            <Bot className="text-black w-6 h-6" />
          </div>
          <h1 className="text-2xl font-serif tracking-tight">PARASOCIAL</h1>
        </div>

        <div className="space-y-4 mb-8">
          <button
            onClick={() => createSession()}
            className="flex items-center gap-3 w-full p-4 rounded-xl border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all group active:scale-[0.98]"
          >
            <PlusCircle className="w-5 h-5 opacity-50 group-hover:opacity-100" />
            <span className="text-sm font-semibold tracking-wide">NEW REFLECTION</span>
          </button>

          <button
            onClick={() => setShowMemoryBank(true)}
            className="flex items-center gap-3 w-full p-4 rounded-xl bg-white text-black hover:bg-white/90 transition-all group active:scale-[0.98]"
          >
            <BrainCircuit className="w-5 h-5" />
            <span className="text-sm font-semibold tracking-wide uppercase">Memory Bank</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scroll">
          {sessions.map(s => (
            <div key={s.id} className="relative group">
              <button
                onClick={() => {
                  if (editingSessionId !== s.id) {
                    useChatStore.setState({ currentSessionId: s.id });
                  }
                }}
                className={cn(
                  "w-full text-left p-4 rounded-xl transition-all text-sm group-hover:pr-16",
                  currentSessionId === s.id
                    ? "bg-white/10 border border-white/10 ring-1 ring-white/5"
                    : "hover:bg-white/5 text-white/40 hover:text-white"
                )}
              >
                {editingSessionId === s.id ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={() => {
                      updateSessionTitle(s.id, editTitle || 'Untitled');
                      setEditingSessionId(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        updateSessionTitle(s.id, editTitle || 'Untitled');
                        setEditingSessionId(null);
                      }
                      if (e.key === 'Escape') {
                        setEditingSessionId(null);
                      }
                    }}
                    className="w-full bg-transparent outline-none border-b border-white/30 text-white font-medium placeholder-white/20"
                    placeholder="Session name..."
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="truncate font-medium transition-transform group-hover:translate-x-1">{s.title}</div>
                    <div className="text-[10px] opacity-30 mt-1 font-mono">{new Date(s.createdAt).toLocaleDateString()}</div>
                  </>
                )}
              </button>

              {/* Actions */}
              {editingSessionId !== s.id && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditTitle(s.title); setEditingSessionId(s.id); }}
                    className="p-1.5 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-all"
                    title="Rename"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    className="p-1.5 hover:bg-white/10 rounded-md text-white/50 hover:text-red-400 transition-all"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="pt-6 border-t border-white/5">
          <button
            onClick={() => setShowAuthModal(true)}
            className="w-full flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all group"
          >
            <Github className="w-5 h-5 opacity-60 group-hover:opacity-100" />
            <div className="text-left">
              <div className="text-[10px] uppercase tracking-widest opacity-40 font-black">Authentication</div>
              <div className="text-xs font-mono opacity-60 group-hover:opacity-100 truncate w-32">
                {apiKey ? 'Connected' : 'Connect Copilot'}
              </div>
            </div>
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative h-full">

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-12 space-y-12 pb-32 custom-scroll"
        >
          <AnimatePresence initial={false}>
            {currentSession?.messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 30, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={cn(
                  "flex gap-8 max-w-4xl mx-auto group",
                  m.role === 'user' ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center shrink-0 border border-white/10 transition-all duration-500",
                  m.role === 'user' ? "bg-white/5 group-hover:border-white/20" : "bg-white text-black shadow-lg"
                )}>
                  {m.role === 'user' ? <User className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
                </div>

                <div className={cn(
                  "space-y-3 max-w-2xl",
                  m.role === 'user' ? "text-right" : "text-left shadow-lg bg-white/[0.02] p-6 rounded-2xl border border-white/5"
                )}>
                  <div className="text-[10px] uppercase tracking-[0.3em] opacity-30 font-black">
                    {m.role === 'user' ? "ECHOES OF YOU" : "PARASOCIAL"}
                  </div>
                  <div className={cn(
                    "leading-relaxed text-lg font-light markdown-content",
                    m.role === 'user' ? "text-white/80" : "text-white font-serif"
                  )}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {loading && (
            <div className="flex gap-8 max-w-4xl mx-auto animate-pulse">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin opacity-20" />
              </div>
              <div className="space-y-2 mt-4">
                <div className="h-3 bg-white/5 w-32 rounded-full" />
                <div className="h-4 bg-white/5 w-64 rounded-full" />
              </div>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="absolute bottom-0 left-0 right-0 p-12 bg-gradient-to-t from-bg-dark via-bg-dark to-transparent z-20">
          <div className="max-w-4xl mx-auto relative group flex gap-4 items-center">

            <button
              onClick={() => setUseSearch(!useSearch)}
              className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center transition-all border",
                useSearch
                  ? "bg-white text-black border-white"
                  : "bg-white/5 text-white/40 border-white/5 hover:bg-white/10 hover:text-white"
              )}
              title={useSearch ? "Disable Web Search" : "Enable Web Search"}
            >
              <Globe className="w-6 h-6" />
            </button>

            <div className="flex-1 relative">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-white/20 to-transparent rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity blur-sm" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={useSearch ? "Search the web or ask anything..." : "What should I remember?"}
                className="w-full glass rounded-2xl p-8 pr-24 text-white placeholder-white/10 outline-none focus:border-white/10 transition-all text-xl font-light relative"
              />
              <button
                onClick={handleSendMessage}
                disabled={loading || !input.trim()}
                className="absolute right-6 top-1/2 -translate-y-1/2 w-14 h-14 rounded-xl bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl disabled:opacity-50 disabled:scale-100 z-10"
              >
                <Send className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>

        {/* Memory Indicator */}
        <div className="absolute top-8 right-8 flex items-center gap-3 glass px-6 py-3 rounded-full text-[10px] tracking-[0.4em] opacity-40 uppercase font-black hover:opacity-80 transition-opacity cursor-help">
          <Memory className="w-4 h-4 text-white" />
          <span>RECALL ACTIVE</span>
        </div>

      </main>

      {/* Memory Bank Modal */}
      <AnimatePresence>
        {showMemoryBank && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-4xl glass max-h-[80vh] flex flex-col rounded-3xl overflow-hidden border border-white/10"
            >
              <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-4">
                  <BrainCircuit className="w-8 h-8 text-white" />
                  <div>
                    <h2 className="text-2xl font-serif">Memory Bank</h2>
                    <p className="text-xs tracking-widest opacity-30 uppercase font-black">All Persistent Knowledge</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMemoryBank(false)}
                  className="w-12 h-12 rounded-full hover:bg-white/10 flex items-center justify-center transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-4 custom-scroll">
                {allMemories.length === 0 ? (
                  <div className="text-center py-20 opacity-20 italic">No memories recorded yet.</div>
                ) : (
                  allMemories.map((m) => (
                    <div key={m.id} className="p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-all group">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex gap-2">
                          {m.tags.map(tag => (
                            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 opacity-50">#{tag}</span>
                          ))}
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-mono opacity-20">{new Date(m.timestamp).toLocaleString()}</span>
                          <button
                            onClick={() => handleDeleteMemory(m.id)}
                            className="opacity-20 hover:opacity-100 hover:text-red-400 transition-all"
                            title="Delete memory"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="text-lg font-light leading-relaxed">{m.content}</div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auth Modal */}
      {showAuthModal && <CopilotAuth onClose={() => setShowAuthModal(false)} />}

      <style>{`
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
