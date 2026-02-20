import type { MemoryEntry } from '../types';

class MemoryManager {
    private dbName = 'parasocial-memory';
    private storeName = 'entries';

    private async getDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
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
        const db = await this.getDB();
        const entry: MemoryEntry = {
            id: crypto.randomUUID(),
            content,
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

    async retrieveRelevantMemory(query: string): Promise<string[]> {
        const db = await this.getDB();
        const keywords = this.extractKeywords(query);

        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                const allMemories: MemoryEntry[] = request.result;
                // Simple keyword-based scoring for now (until we have embeddings)
                const relevant = allMemories
                    .map(m => ({
                        content: m.content,
                        score: m.tags.filter(t => keywords.includes(t)).length * 2 + (m.importance / 10)
                    }))
                    .filter(m => m.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 5)
                    .map(m => m.content);

                resolve(relevant);
            };
            request.onerror = () => reject(request.error);
        });
    }

    private extractKeywords(text: string): string[] {
        // Simple stopwords removal and lowercase
        const stopwords = ['the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'I', 'you'];
        return text.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3 && !stopwords.includes(word));
    }
}

export const memoryManager = new MemoryManager();
