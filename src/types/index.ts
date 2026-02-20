export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
}

export interface ChatSession {
    id: string;
    title: string;
    messages: Message[];
    createdAt: number;
}

export interface MemoryEntry {
    id: string;
    content: string;
    tags: string[];
    importance: number; // 1-10
    timestamp: number;
}
