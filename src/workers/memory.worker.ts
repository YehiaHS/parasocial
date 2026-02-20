import { pipeline, env } from '@xenova/transformers';

// Skip local model check since we are in a browser
// @ts-ignore
env.allowLocalModels = false;
env.useBrowserCache = true;

class PipelineSingleton {
    static task = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    static instance: any = null;

    static async getInstance(progress_callback?: Function) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task as any, this.model, { progress_callback });
        }
        return this.instance;
    }
}

self.addEventListener('message', async (event) => {
    const { id, text, type } = event.data;

    if (type === 'embed') {
        try {
            const extractor = await PipelineSingleton.getInstance((x: any) => {
                self.postMessage({ type: 'progress', data: x });
            });
            const output = await extractor(text, { pooling: 'mean', normalize: true });

            // output.data is a Float32Array
            self.postMessage({ id, type: 'result', embedding: Array.from(output.data) });
        } catch (error: any) {
            self.postMessage({ id, type: 'error', error: error.message });
        }
    }
});
