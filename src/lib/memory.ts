import type { MemoryEntry } from '../types';
import { getOrCreateKey, encryptData, decryptData } from './crypto';

class MemoryManager {
    private dbName = 'parasocial-memory';
    private storeName = 'entries-v2'; // Changed store name to force migration/fresh DB
    private worker: Worker;
    private cryptoKey: CryptoKey | null = null;
    private pendingEmbeddings: Map<string, { resolve: (val: number[]) => void, reject: (err: any) => void }> = new Map();

    constructor() {
        // Initialize Web Worker
        this.worker = new Worker(new URL('../workers/memory.worker.ts', import.meta.url), {
            type: 'module'
        });

        this.worker.onmessage = (event) => {
            const { id, type, embedding, error } = event.data;
            if (type === 'result' && this.pendingEmbeddings.has(id)) {
                this.pendingEmbeddings.get(id)!.resolve(embedding);
                this.pendingEmbeddings.delete(id);
            } else if (type === 'error' && this.pendingEmbeddings.has(id)) {
                this.pendingEmbeddings.get(id)!.reject(new Error(error));
                this.pendingEmbeddings.delete(id);
            }
        };

        // Initialize Crypto Key asynchronously
        getOrCreateKey().then(key => {
            this.cryptoKey = key;
        }).catch(err => {
            console.error("Failed to initialize memory encryption key:", err);
        });
    }

    private async getVectorEmbedding(text: string): Promise<number[]> {
        return new Promise((resolve, reject) => {
            const id = crypto.randomUUID();
            this.pendingEmbeddings.set(id, { resolve, reject });
            this.worker.postMessage({ id, text, type: 'embed' });
        });
    }

    private async getDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 2); // Version 2
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveMemory(content: string, importance: number = 5) {
        if (!this.cryptoKey) throw new Error("Encryption key not ready");

        // 1. Get embedding from worker
        let embedding: number[] = [];
        try {
            embedding = await this.getVectorEmbedding(content);
        } catch (e) {
            console.warn("Failed to generate embedding, continuing without semantic search.", e);
        }

        // 2. Encrypt contents
        const { encrypted, iv } = await encryptData(content, this.cryptoKey);

        const db = await this.getDB();
        const entry: Partial<MemoryEntry> = {
            id: crypto.randomUUID(),
            encryptedContent: encrypted,
            iv,
            embedding,
            tags: this.extractKeywords(content),
            importance,
            timestamp: Date.now(),
        };

        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            tx.objectStore(this.storeName).add(entry);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async deleteMemory(id: string) {
        const db = await this.getDB();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            tx.objectStore(this.storeName).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // Helper: Cosine Similarity
    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async retrieveRelevantMemory(query: string): Promise<string[]> {
        if (!this.cryptoKey) return [];
        const db = await this.getDB();
        const keywords = this.extractKeywords(query);

        // Try getting semantic vector for query
        let queryEmbedding: number[] | null = null;
        try {
            queryEmbedding = await this.getVectorEmbedding(query);
        } catch (e) {
            console.warn("Query embedding failed.", e);
        }

        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = async () => {
                const allMemories: MemoryEntry[] = request.result;

                // Score memories
                const scoredObj = allMemories.map(m => {
                    let score = 0;

                    // Semantic score
                    if (queryEmbedding && m.embedding && m.embedding.length > 0) {
                        const sim = this.cosineSimilarity(queryEmbedding, m.embedding);
                        score += sim * 10; // Base semantic weight
                    }

                    // Keyword boost
                    if (m.tags) {
                        const kwMatches = m.tags.filter(t => keywords.includes(t)).length;
                        score += kwMatches * 2;
                    }

                    // Importance boost
                    score += (m.importance || 5) / 10;

                    return { memory: m, score };
                }).filter(m => m.score > 3) // Minimum threshold
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 5); // Top 5

                // Decrypt top memories
                const decryptedContents: string[] = [];
                for (const item of scoredObj) {
                    try {
                        if (item.memory.encryptedContent && item.memory.iv) {
                            const dec = await decryptData(item.memory.encryptedContent, item.memory.iv, this.cryptoKey!);
                            decryptedContents.push(dec);
                        } else if (item.memory.content) {
                            // Fallback for legacy unencrypted (if any migration happened)
                            decryptedContents.push(item.memory.content);
                        }
                    } catch (e) {
                        console.error("Failed to decrypt memory entry:", e);
                    }
                }

                resolve(decryptedContents);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getAllMemoriesForUI(): Promise<MemoryEntry[]> {
        if (!this.cryptoKey) return [];
        const db = await this.getDB();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = async () => {
                const allMemories: MemoryEntry[] = request.result;
                const decryptedMemories: MemoryEntry[] = [];

                for (const m of allMemories) {
                    try {
                        let content = m.content || "[Encrypted]";
                        if (m.encryptedContent && m.iv) {
                            content = await decryptData(m.encryptedContent, m.iv, this.cryptoKey!);
                        }
                        decryptedMemories.push({ ...m, content });
                    } catch (e) {
                        decryptedMemories.push({ ...m, content: "[Decryption Failed]" });
                    }
                }

                // Sort by newest first
                decryptedMemories.sort((a, b) => b.timestamp - a.timestamp);
                resolve(decryptedMemories);
            };
            request.onerror = () => reject(request.error);
        });
    }

    private extractKeywords(text: string): string[] {
        const stopwords = ['the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'I', 'you'];
        return text.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3 && !stopwords.includes(word));
    }
}

export const memoryManager = new MemoryManager();
