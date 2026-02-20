import type { Message } from '../types';


const COPILOT_API_URL = '/api/github-copilot/chat/completions';
const GITHUB_TOKEN_URL = '/api/github/copilot_internal/v2/token';

async function getCopilotToken(githubPat: string) {
    const response = await fetch(GITHUB_TOKEN_URL, {
        headers: {
            'Authorization': `token ${githubPat}`,
            'Accept': 'application/json',
            'Editor-Version': 'vscode/1.96.0',
            'Editor-Plugin-Version': 'copilot-chat/0.14.0',
            'User-Agent': 'GitHubCopilotChat/0.14.0',
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get Copilot token: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.token;
}

export async function fetchCopilotResponse(messages: Message[], githubPat: string, model: string = 'gpt-4o') {
    // 1. Exchange PAT for a short-lived Copilot session token
    const sessionToken = await getCopilotToken(githubPat);

    // 2. Prep messages
    const formattedMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
    }));

    // 3. Request completions
    const response = await fetch(COPILOT_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Editor-Version': 'vscode/1.96.0',
            'Editor-Plugin-Version': 'copilot-chat/0.14.0',
            'User-Agent': 'GitHubCopilotChat/0.14.0',
        },
        body: JSON.stringify({
            messages: formattedMessages,
            model: model,
            stream: false,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Copilot API Error Details:', errorText);
        let message = `API Error: ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            message = errorJson.message || message;
        } catch (e) {
            message = errorText || message;
        }
        throw new Error(message);
    }

    const data = await response.json();
    console.log("Full response data:", data); // Debugging
    return data.choices[0].message.content;
}

export async function streamCopilotResponse(
    messages: Message[],
    githubPat: string,
    onChunk: (chunk: string) => void
) {
    // 1. Exchange PAT for a short-lived Copilot session token (this might need caching/optimizing in prod)
    const sessionToken = await getCopilotToken(githubPat);

    // 2. Prep messages
    const formattedMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
    }));

    const response = await fetch(COPILOT_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Editor-Version': 'vscode/1.96.0',
            'Editor-Plugin-Version': 'copilot-chat/0.14.0',
            'User-Agent': 'GitHubCopilotChat/0.14.0',
        },
        body: JSON.stringify({
            messages: formattedMessages,
            model: 'gpt-4o',
            stream: true, // Enable streaming
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} ${errorText}`);
    }

    // Manual SSE Parser
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) return;

    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last partial line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
                const json = JSON.parse(data);
                const text = json.choices[0]?.delta?.content || "";
                if (text) {
                    onChunk(text);
                }
            } catch (e) {
                // Ignore parse errors for incomplete chunks
            }
        }
    }
}
