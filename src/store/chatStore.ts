import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message, ChatSession } from '../types';

interface ChatStore {
    sessions: ChatSession[];
    currentSessionId: string | null;
    apiKey: string | null;

    setApiKey: (key: string) => void;
    createSession: (title?: string) => string;
    addMessage: (sessionId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
    updateLastMessage: (sessionId: string, content: string) => void;
    updateSessionTitle: (sessionId: string, title: string) => void;
    deleteSession: (sessionId: string) => void;
    getCurrentSession: () => ChatSession | undefined;
}

export const useChatStore = create<ChatStore>()(
    persist(
        (set, get) => ({
            sessions: [],
            currentSessionId: null,
            apiKey: null,

            setApiKey: (key) => set({ apiKey: key }),

            createSession: (title = 'New Converation') => {
                const id = crypto.randomUUID();
                const newSession: ChatSession = {
                    id,
                    title,
                    messages: [],
                    createdAt: Date.now(),
                };
                set((state) => ({
                    sessions: [newSession, ...state.sessions],
                    currentSessionId: id,
                }));
                return id;
            },

            addMessage: (sessionId, message) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === sessionId
                            ? {
                                ...s,
                                messages: [
                                    ...s.messages,
                                    { ...message, id: crypto.randomUUID(), timestamp: Date.now() },
                                ],
                            }
                            : s
                    ),
                }));
            },

            updateLastMessage: (sessionId, content) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === sessionId
                            ? {
                                ...s,
                                messages: s.messages.map((m, idx) =>
                                    idx === s.messages.length - 1
                                        ? { ...m, content: m.content + content }
                                        : m
                                ),
                            }
                            : s
                    ),
                }));
            },

            updateSessionTitle: (sessionId, title) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === sessionId ? { ...s, title } : s
                    ),
                }));
            },

            deleteSession: (sessionId) => {
                set((state) => ({
                    sessions: state.sessions.filter((s) => s.id !== sessionId),
                    currentSessionId: state.currentSessionId === sessionId
                        ? (state.sessions.find(s => s.id !== sessionId)?.id || null)
                        : state.currentSessionId,
                }));
            },

            getCurrentSession: () => {
                const { sessions, currentSessionId } = get();
                return sessions.find((s) => s.id === currentSessionId);
            },
        }),
        {
            name: 'parasocial-storage',
        }
    )
);
