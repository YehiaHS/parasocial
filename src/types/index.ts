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
    content: string; // Used for raw text input/output in UI
    encryptedContent?: ArrayBuffer; // Stored encrypted data
    iv?: Uint8Array; // Initialization vector for decryption
    embedding?: number[]; // Semantic memory vector
    tags: string[];
    importance: number; // 1-10
    timestamp: number;
}
